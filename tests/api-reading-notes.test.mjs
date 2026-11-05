import test, {after} from 'node:test';
import assert from 'node:assert/strict';
import {promises as fs} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';

const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'ra-reading-notes-'));
process.env.RA_DATA_DIR = directory;
const originalFetch = globalThis.fetch;
globalThis.fetch = () => { throw Error('Notes must not invoke a model or observer'); };
after(async () => {
  globalThis.fetch = originalFetch;
  await fs.rm(directory, {recursive: true, force: true});
});
const route = await import('../src/app/api/reading-notes/route.ts');
const request = body => new Request('http://localhost/api/reading-notes', {method: 'POST', body: JSON.stringify(body)});
const anchor = {scope: '/read/test', sourceKey: 'answer-one', label: 'AI 回答', text: 'entropy', context: 'Entropy measures uncertainty.', start: 0, end: 7};
const read = async () => (await (await route.GET()).json()).notes;
const post = body => route.POST(request(body));

test('notes endpoint provides an empty, uncached library', async () => {
  assert.ok(route, 'The reading-notes route must exist');
  const response = await route.GET();
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.deepEqual(await response.json(), {notes: []});
});

test('saves source snapshots and annotations without invoking AI; deduplicates exact anchors', async () => {
  const response = await post({action: 'save', anchor, comment: '  我的理解  '});
  assert.equal(response.status, 200);
  const {note} = await response.json();
  assert.equal(note.comment, '我的理解');
  assert.deepEqual(note.anchor, anchor);
  assert.ok(note.id);
  assert.ok(Number.isFinite(Date.parse(note.createdAt)));
  assert.equal(note.updatedAt, note.createdAt);
  const duplicate = await (await post({action: 'save', anchor, comment: '不应覆盖已有笔记'})).json();
  assert.deepEqual(duplicate.note, note);
  for (const changed of [{sourceKey: 'answer-two'}, {scope: '/other'}, {start: 1, end: 8}, {text: 'Entropy'}]) {
    assert.equal((await post({action: 'save', anchor: {...anchor, ...changed}, comment: '另一处选区'})).status, 200);
  }
  assert.equal((await read()).length, 5);
  assert.deepEqual((await fs.readdir(directory)).sort(), ['reading-notes.json']);
});

test('concurrent saves deduplicate transactionally', async () => {
  const source = {...anchor, sourceKey: 'concurrent'};
  const responses = await Promise.all(Array.from({length: 4}, () => post({action: 'save', anchor: source, comment: '同一条'})));
  const results = await Promise.all(responses.map(response => response.json()));
  assert.equal(new Set(results.map(result => result.note.id)).size, 1);
  assert.equal((await read()).filter(note => note.anchor.sourceKey === source.sourceKey).length, 1);
});

test('preserves translation snapshots and chat or memory return-source identities', async () => {
  const origins = [
    {kind: 'translation', content: '# 完整翻译\n\n熵衡量不确定性。'},
    {kind: 'chat', historyKey: 'main-chat', sessionId: 'session-one', messageId: 'answer-one'},
    {kind: 'memory', threadId: 'thread-one'},
  ];
  for (const origin of origins) {
    const source = {...anchor, sourceKey: `origin-${origin.kind}`, origin};
    const response = await post({action: 'save', anchor: source, comment: '可以回到这处来源'});
    assert.equal(response.status, 200);
    const {note} = await response.json();
    assert.deepEqual(note.anchor, source);
    assert.deepEqual((await read()).find(item => item.id === note.id).anchor.origin, origin);
  }
});

test('updates only the annotation and deletes the requested note', async () => {
  const before = (await read())[0];
  const response = await post({action: 'update', id: before.id, comment: '  新理解  ', anchor: {...anchor, text: 'overwrite'}});
  assert.equal(response.status, 200);
  const {note} = await response.json();
  assert.equal(note.comment, '新理解');
  assert.deepEqual(note.anchor, before.anchor);
  assert.equal(note.createdAt, before.createdAt);
  assert.ok(Date.parse(note.updatedAt) >= Date.parse(before.updatedAt));
  const deleted = await post({action: 'delete', id: before.id});
  assert.deepEqual(await deleted.json(), {ok: true});
  assert.ok(!(await read()).some(item => item.id === before.id));
});

test('invalid annotations, anchors, actions and missing IDs do not mutate stored notes', async () => {
  const existing = (await read())[0];
  const before = await fs.readFile(path.join(directory, 'reading-notes.json'), 'utf8');
  const invalid = [null, {}, {action: 'other'}, {action: 'update', id: 'missing', comment: 'text'}, {action: 'delete', id: 'missing'}];
  for (const comment of [undefined, null, 1, {}, '', '  ', 'a'.repeat(2001)]) {
    invalid.push({action: 'save', anchor, comment}, {action: 'update', id: existing.id, comment});
  }
  for (const scope of ['javascript:alert(1)', 'https://example.com', '//example.com', '/\\example.com', '/\n/example.com']) {
    invalid.push({action: 'save', anchor: {...anchor, scope}, comment: 'note'});
  }
  invalid.push({action: 'save', anchor: {...anchor, end: 0}, comment: 'note'});
  invalid.push({action: 'save', anchor: {...anchor, origin: {kind: 'chat', historyKey: ''}}, comment: 'note'});
  for (const body of invalid) {
    const response = await post(body);
    assert.equal(response.status, 400, JSON.stringify(body));
    assert.equal(typeof (await response.json()).error, 'string');
  }
  const malformed = await route.POST(new Request('http://localhost/api/reading-notes', {method: 'POST', body: '{'}));
  assert.equal(malformed.status, 400);
  assert.equal(await fs.readFile(path.join(directory, 'reading-notes.json'), 'utf8'), before);
});

test('PDF save verifies identity; snapshots remain editable after source removal', async () => {
  const paperDirectory = path.join(directory, 'papers', 'paper');
  await fs.mkdir(paperDirectory, {recursive: true});
  const file = path.join(paperDirectory, 'original.pdf');
  await fs.writeFile(file, 'first');
  const source = {...anchor, sourceKey: 'pdf', slug: 'paper', docId: createHash('sha256').update('first').digest('hex'), page: 1, rects: [{x: 0.1, y: 0.1, w: 0.2, h: 0.03}]};
  const response = await post({action: 'save', anchor: source, comment: '论文笔记'});
  assert.equal(response.status, 200);
  const {note} = await response.json();
  const before = await fs.readFile(path.join(directory, 'reading-notes.json'), 'utf8');
  await fs.writeFile(file, 'changed');
  const mismatch = await post({action: 'save', anchor: source, comment: 'stale'});
  assert.equal(mismatch.status, 400);
  assert.match((await mismatch.json()).error, /文件已变化/);
  assert.equal(await fs.readFile(path.join(directory, 'reading-notes.json'), 'utf8'), before);
  await fs.unlink(file);
  const missing = await post({action: 'save', anchor: source, comment: 'missing'});
  assert.equal(missing.status, 400);
  assert.match((await missing.json()).error, /论文.*(不存在|无法读取|已删除)/);
  assert.equal((await post({action: 'update', id: note.id, comment: '删除论文后仍能修改自己的注释'})).status, 200);
  assert.deepEqual((await read()).find(item => item.id === note.id).anchor, source);
});

test('corrupt storage is reported without replacing the original bytes', async () => {
  const file = path.join(directory, 'reading-notes.json');
  const before = await fs.readFile(file, 'utf8');
  try {
    await fs.writeFile(file, '{broken');
    assert.equal((await route.GET()).status, 500);
    assert.equal((await post({action: 'save', anchor, comment: 'test'})).status, 400);
    assert.equal(await fs.readFile(file, 'utf8'), '{broken');
  } finally {
    await fs.writeFile(file, before);
  }
});
