import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {registerHooks} from 'node:module';
import {fileURLToPath} from 'node:url';
import os from 'node:os';
import path from 'node:path';
registerHooks({resolve(specifier,context,next){if(specifier.startsWith('.')&&!path.extname(specifier)&&context.parentURL){const url=new URL(specifier+'.ts',context.parentURL);if(existsSync(fileURLToPath(url)))return {url:url.href,shortCircuit:true};}return next(specifier,context);}});
const dir=await mkdtemp(path.join(os.tmpdir(),'ra-answer-stream-'));process.env.RA_DATA_DIR=dir;process.env.DEEPSEEK_API_KEY='test-only';
const realFetch=globalThis.fetch;after(async()=>{globalThis.fetch=realFetch;await rm(dir,{recursive:true,force:true});});
const {POST:memory,GET:read}=await import('../src/app/api/reading-memory/route.ts');
const {POST:chat}=await import('../src/app/api/chat/route.ts');
const {POST:projectChat}=await import('../src/app/api/project-ai/route.ts');
const {createProject,getProject}=await import('../src/lib/project.ts');
const {readAnswer}=await import('../src/lib/answer-stream.ts');
const encoder=new TextEncoder(),request=(body,stream=true)=>new Request('http://test',{method:'POST',headers:stream?{Accept:'application/x-ndjson'}:{},body:JSON.stringify(body)});
const frame=choice=>'data: '+JSON.stringify({choices:[choice]})+'\n\n';
function upstream(first,rest,gate){return new Response(new ReadableStream({async start(c){c.enqueue(encoder.encode(frame({delta:{content:first}})));await gate;c.enqueue(encoder.encode(rest));c.close();}}),{headers:{'Content-Type':'text/event-stream'}});}
const finish=frame({delta:{},finish_reason:'stop'})+'data: [DONE]\n\n';
async function waitUntil(check){for(let i=0;i<200;i++){if(check())return;await new Promise(r=>setTimeout(r,5));}assert.fail('streaming event was not delivered before upstream completion');}
test('reading API sends partial text immediately and commits a complete turn with learning metadata only at completion',async()=>{
 const anchor={scope:'/study/test',sourceKey:'study:test',label:'测试题',text:'X',context:'独立变量 X 和 Y',start:0,end:1};
 const {thread}=await (await memory(request({action:'create',anchor},false))).json();let release;const gate=new Promise(r=>release=r),seen=[];
 globalThis.fetch=async(_,init)=>{assert.equal(JSON.parse(init.body).stream,true);return upstream('先说明条件。',frame({delta:{content:'再推导公式。'}})+finish,gate);};
 const pending=readAnswer(await memory(request({action:'ask',id:thread.id,revision:0,question:'解题'})),text=>seen.push(text));
 await waitUntil(()=>seen.length);assert.equal((await (await read()).json()).threads[0].messages.length,0);release();
 const result=await pending;assert.equal(result.thread.messages.at(-1).content,'先说明条件。再推导公式。');assert.ok(result.thread.messages.at(-1).learning.runId);
 globalThis.fetch=async()=>upstream('半截回答','',Promise.resolve());const partial=[];
 await assert.rejects(readAnswer(await memory(request({action:'ask',id:thread.id,revision:2,question:'继续'})),text=>partial.push(text)));
 assert.deepEqual(partial,['半截回答']);assert.equal((await (await read()).json()).threads[0].messages.length,2);
});
test('general chat and project AI stream before completion and preserve their final metadata contracts',async()=>{
 const project=await createProject({title:'流式验证'});
 for(const [route,body] of [[chat,{messages:[{role:'user',content:'说明条件'}]}],[projectChat,{projectId:project.id,question:'说明条件'}]]){
  let release;const gate=new Promise(r=>release=r),seen=[];const first='从已知条件开始，逐步解释。'.repeat(30);
  globalThis.fetch=async(_,init)=>{assert.equal(JSON.parse(init.body).stream,true);return upstream(first,frame({delta:{content:'最终结论。'}})+finish,gate);};
  const pending=readAnswer(await route(request(body)),text=>{if(text)seen.push(text);});await waitUntil(()=>seen.length);
  if(route===projectChat)assert.equal((await getProject(project.id)).aiMessages?.length??0,0);
  release();const result=await pending;assert.ok(result.learning.runId);assert.equal(result.answer??result.choices[0].message.content,first+'最终结论。');
 }
});

test('reading answers keep streaming beyond two minutes while new content arrives',async t=>{
 const anchor={scope:'/study/slow',sourceKey:'study:slow',label:'长题',text:'Y',context:'求 Y 的分布',start:0,end:1};
 const {thread}=await (await memory(request({action:'create',anchor},false))).json();
 // Make native AbortSignal.timeout use the same virtual clock as application timers.
 t.mock.timers.enable({apis:['setTimeout']});
 t.mock.method(AbortSignal,'timeout',ms=>{const c=new AbortController();setTimeout(()=>c.abort(new DOMException('timeout','TimeoutError')),ms);return c.signal;});
 let controller,upstreamSignal,settled=false;
 globalThis.fetch=async(_,init)=>{upstreamSignal=init.signal;return new Response(new ReadableStream({start(c){controller=c;}}),{headers:{'Content-Type':'text/event-stream'}});};
 const result=readAnswer(await memory(request({action:'ask',id:thread.id,revision:0,question:'逐步推导'})),()=>{}).then(result=>({result}),error=>({error})).finally(()=>{settled=true;});
 const drain=async()=>{for(let i=0;i<100;i++)await new Promise(r=>setImmediate(r));};
 try{
  for(let i=0;i<100&&!controller;i++)await drain();assert.ok(controller);
  for(let i=0;i<4;i++){
   t.mock.timers.tick(60000);await drain();
   assert.equal(upstreamSignal.aborted,false,'ongoing upstream output must survive the old 120-second deadline');
   assert.equal(settled,false,'active output must not be cancelled at a fixed total deadline');
   controller.enqueue(encoder.encode(frame({delta:{content:`第 ${i} 步。`}})));await drain();
  }
  controller.enqueue(encoder.encode(finish));controller.close();
  const outcome=await result;assert.equal(outcome.error,undefined);assert.equal(outcome.result.thread.messages.at(-1).content,'第 0 步。第 1 步。第 2 步。第 3 步。');
  assert.equal((await (await read()).json()).threads.find(t=>t.id===thread.id).messages.length,2);
 }finally{try{controller?.error(Error('test cleanup'));}catch{}await result;t.mock.timers.reset();}
});
