import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
const dir=await fs.mkdtemp(path.join(os.tmpdir(),'ra-model-config-'));process.env.RA_DATA_DIR=dir;process.env.DEEPSEEK_API_KEY='env-secret';
const originalFetch=globalThis.fetch;after(async()=>{globalThis.fetch=originalFetch;await fs.rm(dir,{recursive:true,force:true});});
const {readPublicModelConfigs,mutateModelConfigs,fetchModel,testModelConfig}=await import('../src/lib/model-config.ts');
test('profiles persist, redact keys, preserve blank edit keys, and switch endpoint/model/authorization live',async()=>{
 const a=await mutateModelConfigs({action:'save',name:'A',baseUrl:'https://a.example/v1/chat/completions/',model:'model-a',apiKey:'secret-a',activate:true});
 const id=a.activeId;assert.ok(id);assert.ok(!JSON.stringify(a).includes('secret-a'));
 const b=await mutateModelConfigs({action:'save',name:'B',baseUrl:'https://b.example/v2',model:'model-b',apiKey:'secret-b'});
 const second=b.profiles.find(x=>x.name==='B').id;
 const calls=[];globalThis.fetch=async(url,init)=>{calls.push({url,headers:new Headers(init.headers),body:JSON.parse(init.body),signal:init.signal});return new Response('{}');};
 const signal=new AbortController().signal;
 const request={method:'POST',headers:{Authorization:'Bearer old'},body:JSON.stringify({model:'old',stream:true,messages:[{role:'user',content:'hi'}]}),signal};
 await fetchModel(request);assert.equal(calls[0].url,'https://a.example/v1/chat/completions');assert.equal(calls[0].body.model,'model-a');assert.equal(calls[0].headers.get('Authorization'),'Bearer secret-a');assert.equal(calls[0].signal,signal);
 await mutateModelConfigs({action:'activate',id:second});await fetchModel(request);assert.equal(calls[1].body.model,'model-b');assert.equal(calls[1].headers.get('Authorization'),'Bearer secret-b');
 await mutateModelConfigs({action:'save',id:second,name:'B edited',baseUrl:'https://b.example/v2',model:'model-b2',apiKey:''});await fetchModel(request);assert.equal(calls[2].body.model,'model-b2');assert.equal(calls[2].headers.get('Authorization'),'Bearer secret-b');
 assert.ok((await fs.readFile(path.join(dir,'model-configs.json'),'utf8')).includes('model-b2'));
 await assert.rejects(mutateModelConfigs({action:'delete',id:second}),/切换/);
 await mutateModelConfigs({action:'activate',id:null});await fetchModel(request);assert.equal(calls[3].headers.get('Authorization'),'Bearer env-secret');
 await mutateModelConfigs({action:'delete',id:second});assert.equal((await readPublicModelConfigs()).profiles.length,1);
});
test('invalid URLs and missing keys are rejected; provider errors cannot echo credentials',async()=>{
 for(const baseUrl of ['file:///tmp/x','javascript:bad','https://user:pass@example.com','https://example.com?api_key=secret'])await assert.rejects(mutateModelConfigs({action:'save',name:'bad',baseUrl,model:'x',apiKey:'x'}));
 await assert.rejects(mutateModelConfigs({action:'save',name:'bad',baseUrl:'https://example.com',model:'x',apiKey:''}));
 globalThis.fetch=async()=>new Response(JSON.stringify({error:{message:'env-secret'}}),{status:401});
 const response=await fetchModel({body:JSON.stringify({messages:[]})});assert.equal(response.status,401);assert.ok(!(await response.text()).includes('env-secret'));
});

test('connection diagnostics distinguish provider model errors and show the exact endpoint without exposing credentials',async()=>{
 const draft={name:'诊断',baseUrl:'https://provider.example/v1',model:'test-model',apiKey:'sk-private-diagnostic-secret'};
 for(const payload of [
  {error:{code:'model_not_found',message:`Model test-model not found. Authorization: Bearer ${draft.apiKey}`}},
  {code:'model_not_found',message:`No channel for model test-model; api_key=${draft.apiKey}`},
 ]){
  globalThis.fetch=async()=>Response.json(payload,{status:404});
  await assert.rejects(testModelConfig(draft),error=>{
   assert.match(error.message,/HTTP 404/);assert.match(error.message,/https:\/\/provider.example\/v1\/chat\/completions/);
   assert.match(error.message,/model_not_found/);assert.match(error.message,/test-model/);
   assert.ok(!error.message.includes(draft.apiKey));return true;
  });
 }
 globalThis.fetch=async()=>new Response('<html>proxy failure with sensitive headers</html>',{status:404});
 await assert.rejects(testModelConfig(draft),error=>{assert.match(error.message,/Chat Completions/);assert.ok(!error.message.includes('<html>'));return true;});
});
