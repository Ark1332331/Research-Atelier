import {test,after} from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';import os from 'node:os';import path from 'node:path';
const dir=await mkdtemp(path.join(os.tmpdir(),'ra-observation-'));process.env.RA_DATA_DIR=dir;process.env.DEEPSEEK_API_KEY='test-only';delete process.env.VERCEL_KV_REST_API_URL;delete process.env.VERCEL_KV_REST_API_TOKEN;
after(()=>rm(dir,{recursive:true,force:true}));
const {recordObservation,processObservation,retryObservation,redactObservation,observationContext}=await import('../src/lib/learning/observations.ts');
const {readLearning,manageLearning,mutateLearning}=await import('../src/lib/learning/store.ts');
const {withToolObservation}=await import('../src/lib/learning/tool-observation.ts');
const model=(payload)=>async()=>Response.json({choices:[{message:{content:JSON.stringify(payload)}}]});
const event=(text,extra={})=>recordObservation({source:'测试对话',scene:'code',kind:'conversation',action:'发送消息',userText:text,...extra});
test('every ordinary message queues durable observation; full recent context and tool outcome reach the observer',async()=>{
 const tool=await recordObservation({source:'代码读取',scene:'code',projectId:'p',kind:'tool',action:'打开文件',tool:{ok:false,status:404,durationMs:5}});
 const o=await event('这个怎么处理？',{projectId:'p',context:observationContext([{role:'system',content:'secret'},{role:'assistant',content:'刚才示例使用了 np.reshape'},{role:'user',content:'这个怎么处理？'}])});assert.equal(o.status,'queued');assert.equal((await readLearning()).observations.at(-1).id,o.id);
 const old=globalThis.fetch;let payload;globalThis.fetch=async(_,opts)=>{payload=JSON.parse(opts.body);return model({reason:'普通提问未证明长期偏好',candidates:[]})();};
 try{assert.equal(await processObservation(),true);const input=JSON.parse(payload.messages[1].content);assert.equal(input.recentConversation[0].content,'刚才示例使用了 np.reshape');assert.equal(input.recentTools[0].tool.status,404);assert.equal((await readLearning()).observations.find(x=>x.id===o.id).status,'no-change');assert.equal((await readLearning()).observations.find(x=>x.id===tool.id).status,'no-change');}finally{globalThis.fetch=old;}
});
test('concurrent worker claims cannot analyze an event twice; fabricated assistant evidence is discarded; new candidates remain pending',async()=>{
 const o=await event('我更容易从一个小数组理解形状变化。');const old=globalThis.fetch;let calls=0;
 globalThis.fetch=async()=>{calls++;await new Promise(r=>setTimeout(r,30));return model({reason:'用户要求具体数组',candidates:[{kind:'preference',text:'讲解形状变化先给小数组。',quote:'从一个小数组理解形状变化'},{kind:'preference',text:'用户已经掌握张量',quote:'助手说掌握了张量'}]})();};
 try{await Promise.all([processObservation(),processObservation()]);assert.equal(calls,1);const s=await readLearning();const done=s.observations.find(x=>x.id===o.id);assert.equal(done.status,'proposed');assert.equal(done.candidateIds.length,1);assert.equal(s.memories.find(m=>m.id===done.candidateIds[0]).status,'pending');assert.match(done.reason,/丢弃/);}finally{globalThis.fetch=old;}
});
test('model failure is visible and retryable; stale processing leases recover after restart',async()=>{
 const o=await event('我希望看见输入的实际变化');const old=globalThis.fetch;globalThis.fetch=async()=>Response.json({}, {status:503});
 try{await processObservation();assert.equal((await readLearning()).observations.find(x=>x.id===o.id).status,'failed');await retryObservation(o.id);
 await mutateLearning(s=>{const x=s.observations.find(x=>x.id===o.id);x.status='analyzing';x.leaseUntil=new Date(0).toISOString();});globalThis.fetch=model({reason:'原话可保留，暂未形成新的长期改法',candidates:[]});await processObservation();assert.equal((await readLearning()).observations.find(x=>x.id===o.id).status,'no-change');}finally{globalThis.fetch=old;}
});
test('pause cancels queued and in-flight learning; forgetting purges linked observation context',async()=>{
 const o=await event('我更容易从一个小数组理解形状变化。');const old=globalThis.fetch;let started;const ready=new Promise(r=>started=r);let release;const gate=new Promise(r=>release=r);
 globalThis.fetch=async()=>{started();await gate;return model({reason:'数组偏好',candidates:[{kind:'preference',text:'新增具体例子改法',quote:'一个小数组理解形状变化'}]})();};
 try{const work=processObservation();await ready;await manageLearning({action:'settings',collecting:false});release();await work;assert.equal((await readLearning()).observations.find(x=>x.id===o.id).status,'paused');assert.ok(!(await readLearning()).memories.some(m=>m.text==='新增具体例子改法'));
 const paused=await event('token=SECRET_VALUE 不应采集');assert.equal(paused.userText,'');await manageLearning({action:'settings',collecting:true});const memory=(await readLearning()).memories[0];await manageLearning({action:'forget',id:memory.id});assert.ok(!(await readLearning()).observations.some(x=>x.candidateIds.includes(memory.id)));}finally{globalThis.fetch=old;}
});
test('ordinary tool operations preserve responses without writing learning observations; credentials are excluded',async()=>{
 const wrapped=withToolObservation({source:'翻译',scene:'paper'},async()=>Response.json({error:'test failure'},{status:422}));const r=await wrapped(new Request('http://localhost/api/vocabulary',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'translate',slug:'demo',text:'word',token:'SECRET',context:'private document'})}));assert.equal(r.status,422);assert.equal(r.headers.get('X-RA-Observation'),null);assert.ok(!(await readLearning()).observations.some(o=>o.source==='翻译')); assert.ok(!redactObservation('api_key=SECRET_VALUE Bearer SECRET_TOKEN').includes('SECRET'));
});

test('forgetting removes observations linked to applied rules, including paraphrased assistant context',async()=>{
 const {prepareLearning,finishLearning}=await import('../src/lib/learning/store.ts');
 let s=await manageLearning({action:'propose',text:'教学时要优先讲执行顺序',quote:'我希望优先讲执行顺序',kind:'preference',scene:'code'});let m=s.memories.at(-1);await manageLearning({action:'approve',id:m.id,version:m.version});const p=await prepareLearning('解释这个函数','code');await finishLearning(p,'先沿着运行时序走一遍，然后再解释算法。');
 const o=await event('还需要一个例子',{context:observationContext([{role:'assistant',content:'先沿着运行时序走一遍，然后再解释算法。',learning:{runId:p.id}}])});
 await manageLearning({action:'forget',id:m.id});s=await readLearning();assert.ok(!s.observations.some(x=>x.id===o.id));assert.ok(!s.runs.some(x=>x.id===p.id));
});
test('background translation saves results without logging unrelated learning observations',async()=>{
 const {mkdir,readFile}=await import('node:fs/promises');const {saveTranslationResult}=await import('../src/lib/translate-store.ts');const paper=path.join(dir,'papers','test-paper');await mkdir(paper,{recursive:true});const before=(await readLearning()).observations.length;
 assert.equal(await saveTranslationResult(paper,'成功译文'),'ok');assert.equal(await readFile(path.join(paper,'translation.md'),'utf8'),'成功译文');
 assert.equal(await saveTranslationResult(paper,'（翻译失败：provider unavailable）'),'error');assert.equal((await readLearning()).observations.length,before);
});
test('opening a paper or file is not a learning trigger',async()=>{
 const before=(await readLearning()).observations.length;const wrapped=withToolObservation({source:'论文阅读',scene:'paper'},async()=>Response.json({ok:true}));assert.equal((await wrapped(new Request('http://localhost/api/paper?slug=demo'))).status,200);assert.equal((await readLearning()).observations.length,before);
});
