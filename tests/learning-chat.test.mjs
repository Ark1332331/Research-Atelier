import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../src/', import.meta.url));
registerHooks({ resolve(specifier, context, next) {
  if (specifier.startsWith('@/')) {
    const base = path.join(root, specifier.slice(2));
    const resolved = [base + '.ts', base + '/index.ts'].find(existsSync);
    if (resolved) return { url: pathToFileURL(resolved).href, shortCircuit: true };
  }
  return next(specifier, context);
} });
const dir = await mkdtemp(path.join(os.tmpdir(), 'ra-chat-test-'));
process.env.RA_DATA_DIR = dir; process.env.DEEPSEEK_API_KEY = 'test-only';
delete process.env.VERCEL_KV_REST_API_URL; delete process.env.VERCEL_KV_REST_API_TOKEN;
const { manageLearning, readLearning } = await import('../src/lib/learning/store.ts');
const { processObservation }=await import("../src/lib/learning/observations.ts");
const { POST } = await import('../src/app/api/chat/route.ts');
after(() => rm(dir, { recursive: true, force: true }));
const request = useMemory => new Request('http://localhost/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ scene: 'code', useMemory, messages: [{ role: 'user', content: '解释输入输出' }] }) });
test('actual chat handler injects reviewed memory, records exact version, baseline and pause stop injection', async () => {
  let state = await manageLearning({ action: 'propose', kind: 'preference', scene: 'code', text: '先给真实输入输出', quote: '我希望先给真实输入输出' });
  const m = state.memories[0]; await manageLearning({ action: 'approve', id: m.id, version: 1 });
  const realFetch = globalThis.fetch; const payloads = [];
  globalThis.fetch = async (url, options) => {
    assert.equal(url, 'https://api.deepseek.com/chat/completions');
    const payload = JSON.parse(options.body); payloads.push(payload);
    return Response.json({ choices: [{ message: { role: 'assistant', content: '模型测试回答' } }] });
  };
  try {
    let response = await POST(request(true)); assert.equal(response.status, 200);
    let data = await response.json(); assert.equal(data.learning.selected.length, 1); assert.equal(data.learning.selected[0].version, 2);
    assert.ok(JSON.stringify(payloads[0].messages).includes('先给真实输入输出'));
    assert.equal((await readLearning()).runs.at(-1).answer, '模型测试回答');
    await POST(request(false)); assert.ok(!JSON.stringify(payloads[1].messages).includes('先给真实输入输出'));
    await manageLearning({ action: 'pause', id: m.id, version: 2 });
    response = await POST(request(true)); data = await response.json(); assert.equal(data.learning.selected.length, 0);
    assert.ok(!JSON.stringify(payloads[2].messages).includes('先给真实输入输出'));
  } finally { globalThis.fetch = realFetch; }
});
test('failed provider call is visible in the run log', async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ error: { message: 'test provider denied' } }, { status: 401 });
  try {
    assert.equal((await POST(request(true))).status, 401);
    const run = (await readLearning()).runs.at(-1); assert.equal(run.outcome, 'failed'); assert.match(run.error, /HTTP 401/); assert.ok(!run.error.includes('test provider denied'));
  } finally { globalThis.fetch = realFetch; }
});

test('a saved answer can restore its original session by message identity without crossing tools',async()=>{
  const {GET,POST:history}=await import('../src/app/api/session-history/route.ts');
  const saved=await (await history(new Request('http://localhost/api/session-history',{method:'POST',body:JSON.stringify({tool:'read-test',action:'upsert',msgs:[{id:'answer-for-note',role:'assistant',content:'供笔记返回的回答',time:'12:00'}]})}))).json();
  const found=await GET(new Request('http://localhost/api/session-history?tool=read-test&messageId=answer-for-note'));
  assert.equal(found.status,200);const result=await found.json();assert.equal(result.session.id,saved.id);assert.equal(result.session.msgs[0].content,'供笔记返回的回答');
  assert.equal((await GET(new Request('http://localhost/api/session-history?tool=other&messageId=answer-for-note'))).status,404);
  await history(new Request('http://localhost/api/session-history',{method:'POST',body:JSON.stringify({tool:'read-test',action:'delete',id:saved.id})}));
  assert.equal((await GET(new Request('http://localhost/api/session-history?tool=read-test&messageId=answer-for-note'))).status,404);
});
test('chat injects the separate user profile and includes its exact version in response metadata',async()=>{
 const s=await manageLearning({action:'profile-add',dimension:'background',topic:'语言经历',text:'我有 Java 基础，正在学 Python',scene:'code'});
 const realFetch=globalThis.fetch;let input;globalThis.fetch=async(_url,options)=>{input=JSON.parse(options.body);return Response.json({choices:[{message:{role:'assistant',content:'用 Java 类比 Python 对象。'}}]});};
 try{const r=await POST(request(true)),data=await r.json();assert.equal(r.status,200);assert.match(JSON.stringify(input.messages),/Java 基础/);assert.equal(data.learning.profile[0].id,s.profiles[0].id);assert.equal((await readLearning()).runs.at(-1).profile[0].version,s.profiles[0].version);}finally{globalThis.fetch=realFetch;}
});
test('ordinary conversational corrections create evidence-backed pending rules without an extra dashboard step',async()=>{
 const realFetch=globalThis.fetch;const quote='你刚才跳过了符号和执行边界，讲得太快';let calls=0;
 globalThis.fetch=async(_url,options)=>{calls++;const input=JSON.parse(options.body);return Response.json({choices:[{message:{role:'assistant',content:input.response_format?JSON.stringify({reason:"用户反馈讲解遗漏，需要先补执行边界",candidates:[{kind:'preference',text:'先说明符号和执行边界，再讲结论。',quote}]}):'我会从符号与执行边界开始。'}}]});};
 try{const r=await POST(new Request('http://localhost/api/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({scene:'code',messages:[{role:'user',content:quote}]})}));assert.equal(r.status,200);const d=await r.json();assert.equal(calls,1);assert.ok(d.learning.observationId);while(await processObservation()){};const state=await readLearning();const observation=state.observations.find(o=>o.id===d.learning.observationId);assert.equal(observation.status,"proposed");const m=state.memories.find(m=>m.id===observation.candidateIds[0]);assert.equal(m.status,'pending');assert.equal(m.evidence[0].quote,quote);assert.ok(!d.learning.selected.some(s=>s.id===m.id));}finally{globalThis.fetch=realFetch;}
});
