import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
const dir = await mkdtemp(path.join(os.tmpdir(), 'ra-learning-test-'));
process.env.RA_DATA_DIR = dir;
delete process.env.VERCEL_KV_REST_API_URL;
delete process.env.VERCEL_KV_REST_API_TOKEN;
const { emptyState, extractCandidates, selectMemories, isLearningFeedback } = await import('../src/lib/learning/core.ts');
const { readLearning, manageLearning, prepareLearning, finishLearning, addProposal, exportMarkdown } = await import('../src/lib/learning/store.ts');
after(() => rm(dir, { recursive: true, force: true }));
const propose = (text, extra = {}) => manageLearning({ action: 'propose', kind: 'preference', text, quote: text, scene: 'code', ...extra });
const approve = m => manageLearning({ action: 'approve', id: m.id, version: m.version });

test('only feedback is extracted; explaining a concept is not mastery', () => {
  assert.equal(extractCandidates('我已经讲解了 forward，复述通过', 'code').length, 0);
  assert.ok(extractCandidates('我不理解 forward，请先给输入输出', 'code').some(c => c.kind === 'gap'));
});
test('candidate → reviewed → applied → feedback → correction → rollback → forgetting', async () => {
  const state = await propose('讲代码先给输入输出'); const m = state.memories[0];
  assert.equal(selectMemories(state, '讲代码', 'code', null).length, 0);
  const active = await approve(m);
  assert.equal(selectMemories(active, '输入输出', 'code', null)[0].version, 2);
  const run = await prepareLearning('解释输入输出', 'code', null);
  await finishLearning(run, '这是输入和输出。');
  let s = await manageLearning({ action: 'feedback', runId: run.id, helpful: false, note: '需要给小输入执行轨迹' });
  assert.equal(s.runs[0].feedback.helpful, false);
  assert.ok(s.memories.some(m => m.kind === 'workflow' && m.status === 'pending'));
  s = await manageLearning({ action: 'edit', id: m.id, version: 2, text: '先给小输入轨迹' });
  assert.equal(s.memories[0].status, 'pending');
  await assert.rejects(() => manageLearning({ action: 'approve', id: m.id, version: 2 }), /其他窗口/);
  s = await manageLearning({ action: 'rollback', id: m.id, version: 3, targetVersion: 2 });
  assert.equal(s.memories[0].text, '讲代码先给输入输出');
  assert.equal(s.memories[0].status, 'pending');
  s = await manageLearning({ action: 'forget', id: m.id });
  assert.ok(!JSON.stringify(s).includes('讲代码先给输入输出'));
  assert.equal(s.runs.length, 0);
});
test('project/scene isolation and expiration', async () => {
  let s = await propose('甲项目专属规则', { projectId: 'alpha' }); let m = s.memories.at(-1); await approve(m);
  s = await propose('已过期规则', { expiresAt: '2020-01-01T00:00:00Z' }); await approve(s.memories.at(-1));
  s = await readLearning();
  assert.ok(selectMemories(s, '项目', 'code', 'alpha').some(x => x.id === m.id));
  assert.ok(!selectMemories(s, '项目', 'code', 'beta').some(x => x.id === m.id));
  assert.ok(!selectMemories(s, '项目', 'paper', 'alpha').some(x => x.id === m.id));
  assert.ok(!selectMemories(s, '已过期规则', 'code', null).some(x => x.text === '已过期规则'));
});
test('reject is sticky and evidence does not silently activate candidates', async () => {
  let s = await propose('被拒绝的规则'); const m = s.memories.at(-1);
  await manageLearning({ action: 'reject', id: m.id, version: m.version });
  s = await propose('被拒绝的规则'); assert.equal(s.memories.find(x => x.id === m.id).status, 'rejected');
});
test('collection and application can be paused independently', async () => {
  let s = await manageLearning({ action: 'settings', collecting: false }); const count = s.memories.length;
  s = await propose('暂停后不应采集'); assert.equal(s.memories.length, count);
  s = await manageLearning({ action: 'settings', applying: false }); assert.deepEqual(selectMemories(s, '项目', 'code', 'alpha'), []);
  await manageLearning({ action: 'settings', collecting: true, applying: true });
});
test('concurrent writers retain all updates and restart restores state', async () => {
  const before = (await readLearning()).memories.length;
  await Promise.all(Array.from({ length: 20 }, (_, i) => propose(`并发更新 ${i}`)));
  const s = await readLearning(); assert.equal(s.memories.length, before + 20);
  const disk = JSON.parse(await readFile(path.join(dir, 'learning/state.json'), 'utf8'));
  assert.deepEqual(s, disk); assert.ok(exportMarkdown(s).includes('待') === false || exportMarkdown(s).includes('pending'));
});
test('invalid proposals fail without modifying the store', async () => {
  const before = await readLearning();
  await assert.rejects(() => propose('x', { scene: '../../escape' }), /场景/);
  await assert.rejects(() => propose('x', { quote: '' }), /证据/);
  await assert.rejects(() => propose('x', { expiresAt: 'bad' }), /到期/);
  assert.deepEqual(await readLearning(), before);
});
test('retrieval respects bounded context even with many active rules', () => {
  const s = emptyState();
  for (let i = 0; i < 40; i++) { const m = addProposal(s, { key: String(i), kind: 'preference', text: '数据'.repeat(800), scene: 'code', projectId: null, quote: '证据', source: 'test' }); m.status = 'active'; }
  const selected = selectMemories(s, '数据', 'code', null);
  assert.ok(selected.length <= 12); assert.ok(selected.reduce((n, m) => n + m.text.length, 0) <= 5000);
});
test('forget during an in-flight request removes copied memory snapshots', async () => {
  const s = await propose('飞行中删除的规则'); const m = s.memories.at(-1); await approve(m);
  const pending = await prepareLearning('飞行中删除的规则', 'code', null);
  await manageLearning({ action: 'forget', id: m.id }); await finishLearning(pending, '完成');
  assert.ok(!(await readLearning()).runs.some(x => x.id === pending.id));
});
test('semantic extraction discards fabricated evidence and never activates proposals', async () => {
  const { analyzeFeedback } = await import('../src/lib/learning/extract.ts');
  const realFetch = globalThis.fetch; process.env.DEEPSEEK_API_KEY = 'test';
  globalThis.fetch = async () => Response.json({ choices: [{ message: { content: JSON.stringify({ candidates: [
    { kind: 'preference', text: '先给数据合同', quote: '我希望先给数据合同' },
    { kind: 'skill', text: '已经掌握', quote: '我希望先给数据合同' },
    { kind: 'preference', text: '编造规则', quote: '用户没有说的话' },
  ] }) } }] });
  try {
    const r = await analyzeFeedback('我希望先给数据合同', 'code', null);
    assert.equal(r.proposed, 1); assert.equal(r.discarded, 2);
    assert.equal(r.state.memories.at(-1).status, 'pending');
  } finally { globalThis.fetch = realFetch; delete process.env.DEEPSEEK_API_KEY; }
});
test('corrupt store is reported without being overwritten', async () => {
  const filename = path.join(dir, 'learning/state.json'); const original = await readFile(filename, 'utf8');
  await writeFile(filename, '{bad'); await assert.rejects(() => propose('不能覆盖损坏库'));
  assert.equal(await readFile(filename, 'utf8'), '{bad'); await writeFile(filename, original);
});
test('JSON import preserves review gate, rejects malformed backup atomically', async () => {
  const before = await readLearning();
  const sample = { text: '导入条目', kind: 'preference', scene: 'general', status: 'active', evidence: [{ quote: '备份中的原文' }] };
  let s = await manageLearning({ action: 'import', memories: [sample] });
  assert.equal(s.memories.at(-1).status, 'pending');
  await assert.rejects(() => manageLearning({ action: 'import', memories: [sample, { ...sample, text: '' }] }));
  assert.deepEqual(await readLearning(), s);
  assert.ok(s.memories.length > before.memories.length);
});
test('baseline mode leaves global settings intact and injects no memory', async () => {
  const before = await readLearning();
  const run = await prepareLearning('解释项目', 'code', 'alpha', false);
  assert.deepEqual(run.selected, []); assert.equal(run.prompt, ''); assert.equal(run.mode, 'baseline');
  await finishLearning(run, '基线回答'); assert.equal((await readLearning()).applying, before.applying);
});
test('abandoned process lock can be recovered without dropping concurrent updates', async () => {
  const { mkdir } = await import('node:fs/promises');
  const lock = path.join(dir, 'learning/.lock');
  await mkdir(lock); await writeFile(path.join(lock, 'owner.json'), JSON.stringify({ pid: 2147483647 }));
  const before = (await readLearning()).memories.length;
  await Promise.all([propose('恢复后的更新一'), propose('恢复后的更新二')]);
  assert.equal((await readLearning()).memories.length, before + 2);
});

 test("tool-use confusion is a discovery signal, not automatically confirmed preference", () => {
 for (const text of ["这个页面不知道怎么用", "看不懂这个参数", "工具按钮太混乱", "为什么下载失败"]) assert.equal(isLearningFeedback(text),true);
 assert.equal(isLearningFeedback("请介绍这篇论文"),false);
 });
