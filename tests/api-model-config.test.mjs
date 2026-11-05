import '../tests/helpers/alias-hooks.mjs';
import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
const dir=await mkdtemp(path.join(os.tmpdir(),'ra-model-api-'));
process.env.RA_DATA_DIR=dir;
delete process.env.DEEPSEEK_API_KEY;
delete process.env.VERCEL_KV_REST_API_URL;delete process.env.VERCEL_KV_REST_API_TOKEN;
const realFetch=globalThis.fetch;
after(async()=>{globalThis.fetch=realFetch;await rm(dir,{recursive:true,force:true});});
const {GET,POST}=await import('../src/app/api/model-configs/route.ts');
const {POST:chat}=await import('../src/app/api/chat/route.ts');
const {POST:translate}=await import('../src/app/api/reader/translate/route.ts');
const {readAnswer}=await import('../src/lib/answer-stream.ts');
const req=(body,origin='http://localhost')=>new Request('http://localhost/api/model-configs',{method:'POST',headers:{origin,'Content-Type':'application/json'},body:JSON.stringify(body)});
const draft={name:'测试模型',baseUrl:'https://model.example/v1',model:'research-model',apiKey:'test-secret-do-not-return'};
let id;

test('configuration API protects keys, tests unsaved changes, and keeps the chosen profile across processes',async()=>{
 assert.equal((await POST(req({...draft,action:'save'},'https://other.example'))).status,403);
 assert.equal((await GET()).headers.get('cache-control'),'no-store');
 assert.equal((await (await GET()).json()).profiles.length,0);
 const response=await POST(req({...draft,action:'save',activate:true}));assert.equal(response.status,200);
 const data=await response.json();id=data.activeId;
 assert.ok(id);assert.ok(!JSON.stringify(data).includes(draft.apiKey));assert.equal(data.profiles[0].hasKey,true);
 let sent;
 globalThis.fetch=async(url,init)=>{sent={url,headers:new Headers(init.headers),body:JSON.parse(init.body)};return Response.json({choices:[{message:{content:'OK'}}]});};
 assert.equal((await POST(req({...draft,id,apiKey:'',model:'draft-model',action:'test'}))).status,200);
 assert.equal(sent.body.model,'draft-model');assert.equal(sent.headers.get('authorization'),'Bearer '+draft.apiKey);
 assert.deepEqual(sent.body.messages,[{role:'user',content:'Reply OK.'}]);
 assert.equal((await (await GET()).json()).profiles[0].model,'research-model','testing must not save or activate a draft');
 const moduleUrl=new URL('../src/lib/model-config.ts',import.meta.url).href;
 const output=execFileSync(process.execPath,['--experimental-strip-types','--input-type=module','-e',`const {readPublicModelConfigs}=await import(${JSON.stringify(moduleUrl)});console.log(JSON.stringify(await readPublicModelConfigs()));`],{env:process.env,encoding:'utf8'});
 assert.equal(JSON.parse(output).activeId,id);assert.ok(!output.includes(draft.apiKey));
 const bad=await POST(new Request('http://localhost/api/model-configs',{method:'POST',body:'{broken'}));assert.equal(bad.status,400);
});

test('actual chat and translation handlers use the saved profile without an environment key and keep streaming',async()=>{
 const payloads=[];
 globalThis.fetch=async(url,init)=>{
  const body=JSON.parse(init.body);payloads.push(body);
  assert.equal(url,draft.baseUrl+'/chat/completions');assert.equal(new Headers(init.headers).get('authorization'),'Bearer '+draft.apiKey);assert.equal(body.model,draft.model);
  return new Response('data: '+JSON.stringify({choices:[{delta:{content:'已使用所选模型'}}]})+'\n\ndata: '+JSON.stringify({choices:[{delta:{},finish_reason:'stop'}]})+'\n\ndata: [DONE]\n\n',{headers:{'Content-Type':'text/event-stream'}});
 };
 const response=await chat(new Request('http://localhost/api/chat',{method:'POST',headers:{Accept:'application/x-ndjson'},body:JSON.stringify({messages:[{role:'user',content:'说明条件'}]})}));
 const deltas=[];const answer=await readAnswer(response,text=>deltas.push(text));
 assert.equal(answer.choices[0].message.content,'已使用所选模型');assert.ok(deltas.length);
 const translated=await translate(new Request('http://localhost/api/reader/translate',{method:'POST',body:JSON.stringify({text:'independent'})}));
 const events=(await translated.text()).trim().split('\n').map(JSON.parse);
 assert.equal(events[0].delta,'已使用所选模型');assert.equal(events.at(-1).done,true);
 assert.equal(payloads.length,2);assert.ok(payloads.every(p=>p.stream));
});
