import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
import {existsSync} from 'node:fs';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import os from 'node:os';import path from 'node:path';import {pathToFileURL,fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../src/',import.meta.url));
registerHooks({resolve(s,c,next){if(s.startsWith('@/')){const file=path.join(root,s.slice(2))+'.ts';if(existsSync(file))return {url:pathToFileURL(file).href,shortCircuit:true};}return next(s,c);}});
const dir=await mkdtemp(path.join(os.tmpdir(),'ra-study-'));process.env.RA_DATA_DIR=dir;process.env.DEEPSEEK_API_KEY='test-only';delete process.env.VERCEL_KV_REST_API_URL;delete process.env.VERCEL_KV_REST_API_TOKEN;
after(()=>rm(dir,{recursive:true,force:true}));
const {reviewTerm,termsForPaper}=await import('../src/lib/terms.ts');
const {mergeExtractedTerms,readTerms,mutateTerms}=await import('../src/lib/terms-store.ts');
const {validateRects}=await import('../src/lib/vocabulary.ts');
const {POST:termPost}=await import('../src/app/api/terms/route.ts');
const {GET:wordGet,POST:wordPost}=await import('../src/app/api/vocabulary/route.ts');
const req=(route,body)=>new Request('http://localhost/api/'+route,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
test('cross-paper concept meanings remain distinct; exact quoted evidence only; normalized names deduplicate',async()=>{
 await mergeExtractedTerms([{name:'Point Cloud / 点云',note:'离散三维点',quote:'a point cloud is reconstructed'}],{slug:'paper-a',title:'A'},['a point cloud is reconstructed']);
 await mergeExtractedTerms([{name:'point cloud',note:'此文输入来自激光雷达',quote:'fabricated quote'}],{slug:'paper-b',title:'B'},['measured lidar points']);
 const terms=await readTerms();assert.equal(terms.length,1);assert.equal(terms[0].note,'离散三维点');assert.equal(terms[0].contexts.length,2);assert.equal(terms[0].contexts[0].page,1);assert.equal(terms[0].contexts[1].quote,'');assert.equal(terms[0].status,'未接触');assert.equal(termsForPaper(terms,'paper-a').length,1);assert.equal(termsForPaper(terms,'other').length,0);
});
test('recall requires actual learner text, retains evidence, never upgrades from explanation',async()=>{
 const t=(await readTerms())[0];assert.throws(()=>reviewTerm(t,'','good','能解释'));const r=reviewTerm(t,'把点放进体素格子再用邻居聚合','good','能解释',1000);assert.equal(r.status,'能解释');assert.equal(r.reviews[0].answer,'把点放进体素格子再用邻居聚合');assert.equal(Date.parse(r.dueAt),1000+2*86400000);assert.equal(reviewTerm(r,'还是不清楚','again','能实现',2000).status,'有直觉');
 const response=await termPost(req('terms',{term:{id:t.id,name:t.name,status:'能实现'}}));assert.equal(response.status,400);assert.equal((await readTerms())[0].status,'未接触');
});
test('concurrent term writes and malformed store do not silently lose data',async()=>{
 await Promise.all(Array.from({length:12},(_,i)=>mutateTerms(ts=>ts.push({id:String(i),name:'test'+i}))));assert.equal((await readTerms()).length,13);
 const before=await readFile(path.join(dir,'glossary.json'),'utf8');await writeFile(path.join(dir,'glossary.json'),'invalid');await assert.rejects(()=>mutateTerms(t=>t.push({id:'bad'})));assert.equal(await readFile(path.join(dir,'glossary.json'),'utf8'),'invalid');await writeFile(path.join(dir,'glossary.json'),before);
});
test('annotations reject impossible geometry, retain document identity, failures leave no false highlight',async()=>{
 assert.throws(()=>validateRects([{x:.8,y:.1,w:.6,h:.1}]));assert.throws(()=>validateRects([{x:NaN,y:0,w:.1,h:.1}]));
 await mkdir(path.join(dir,'papers','demo'),{recursive:true});await writeFile(path.join(dir,'papers','demo','original.pdf'),'test pdf bytes');
 const {docId}=await (await wordGet(new Request('http://localhost/api/vocabulary?slug=demo'))).json();
 const body={action:'translate',slug:'demo',docId,text:'terrain',context:'The robot traverses rough terrain.',page:1,rects:[{x:.1,y:.2,w:.1,h:.02}]};
 const realFetch=globalThis.fetch;globalThis.fetch=async()=>Response.json({choices:[{message:{content:JSON.stringify({meaning:'地形',lemma:'terrain',partOfSpeech:'名词',usage:'机器人经过的地面环境'})}}]});
 try{const r=await wordPost(req('vocabulary',body));assert.equal(r.status,200);const saved=(await r.json()).saved;assert.equal(saved.meaning,'地形');assert.deepEqual(saved.rects,body.rects);
 const d=await (await wordGet(new Request('http://localhost/api/vocabulary?slug=demo'))).json();assert.equal(d.entries.length,1);
 globalThis.fetch=async()=>Response.json({choices:[{message:{content:'{}'}}]});assert.equal((await wordPost(req('vocabulary',{...body,text:'other'}))).status,400);assert.equal((await (await wordGet(new Request('http://localhost/api/vocabulary?slug=demo'))).json()).entries.length,1);
 await writeFile(path.join(dir,'papers','demo','original.pdf'),'replacement');assert.equal((await wordPost(req('vocabulary',body))).status,409);assert.equal((await (await wordGet(new Request('http://localhost/api/vocabulary?slug=demo'))).json()).entries.length,0);
 }finally{globalThis.fetch=realFetch;}
});
test('checked recall is provisional until confirmation; assessment cannot be reused or invented',async()=>{
 const term=(await readTerms())[0];const beforeStatus=term.status;const fetchBefore=globalThis.fetch;
 globalThis.fetch=async()=>Response.json({choices:[{message:{content:JSON.stringify({verdict:'supported',suggestedStatus:'能实现',feedback:'能说明对象和用途，不能证明实现能力',nextQuestion:'这些点如何传入下一步？'})}}]});
 try{const assessed=await termPost(req('terms',{action:'assess',id:term.id,answer:'点云是一组有三维坐标的点，用于表示场景。'}));assert.equal(assessed.status,200);const data=await assessed.json();assert.equal(data.assessment.suggestedStatus,'能解释');assert.equal((await readTerms())[0].status,beforeStatus);
 const bad=await termPost(req('terms',{action:'review',id:term.id,answer:'另一份复述',rating:'good',assessmentId:data.assessment.id}));assert.equal(bad.status,400);
 const body={action:'review',id:term.id,answer:data.assessment.answer,rating:'good',assessmentId:data.assessment.id};assert.equal((await termPost(req('terms',body))).status,200);assert.equal((await readTerms())[0].status,'能解释');assert.equal((await termPost(req('terms',body))).status,400);
 const fresh=await (await termPost(req('terms',{action:'assess',id:term.id,answer:body.answer}))).json();
 await termPost(req('terms',{term:{id:term.id,name:term.name,note:'修改后的参考定义'}}));
 assert.equal((await termPost(req('terms',{...body,assessmentId:fresh.assessment.id}))).status,400);
 }finally{globalThis.fetch=fetchBefore;}
});
test('capture verifies a real paper page, preserves same-name glossary entry, never marks mastery',async()=>{
 await writeFile(path.join(dir,'papers','demo','meta.json'),JSON.stringify({title:'Demo'}));await writeFile(path.join(dir,'papers','demo','page_01.txt'),'The point cloud consists of three-dimensional points.');
 const response=await termPost(req('terms',{action:'capture',slug:'demo',page:1,text:'point cloud'}));assert.equal(response.status,200);const data=await response.json();assert.equal(data.saved.id,(await readTerms())[0].id);assert.ok(data.saved.contexts.some(c=>c.slug==='demo'&&c.page===1&&c.quote.includes('point cloud')));
 assert.equal((await termPost(req('terms',{action:'capture',slug:'demo',page:1,text:'nonexistent concept'}))).status,400);
});
test('duplicate merging keeps historical card data and aliases, without raising understanding status',async()=>{
 const {consolidateTerms}=await import('../src/lib/terms.ts');const items=[{id:'old',name:'Encoder / 编码器',status:'有直觉',note:'旧解释',papers:[{slug:'a',title:'A'}]},{id:'new',name:'encoder',status:'能实现',note:'另一份原始解释',papers:[{slug:'b',title:'B'}]}];const merged=consolidateTerms(items);assert.equal(merged.length,1);assert.equal(merged[0].status,'有直觉');assert.equal(merged[0].legacyCards[0].note,'另一份原始解释');assert.deepEqual(merged[0].legacyIds,['new']);assert.equal(merged[0].papers.length,2);assert.equal(items.length,2);assert.deepEqual(consolidateTerms(merged),merged);
});
test('PDF term ranges match whole words across text spans and escape punctuation',async()=>{
 const {termRanges}=await import('../src/lib/pdf-term-ranges.ts');const oldNode=globalThis.Node,oldDocument=globalThis.document;
 const spans=['point','cloud','autoencoder','C++'].map(text=>({textContent:text,firstChild:{nodeType:3,textContent:text}}));const matches=[];
 globalThis.Node={TEXT_NODE:3};globalThis.document={createRange(){let a,b;return {setStart(node,offset){a={node,offset};},setEnd(node,offset){b={node,offset};},getClientRects(){matches.push([a,b]);return [{left:125,top:8,width:35,height:10}];}};}};
 try{const boxes=termRanges({querySelectorAll:()=>spans},{getBoundingClientRect:()=>({left:100,top:0}),scrollLeft:20,scrollTop:0},[{name:'point cloud',id:'pc'},{name:'encoder',id:'e'},{name:'C++',id:'cpp'}]);assert.equal(boxes.length,2);assert.equal(boxes[0].x,45);assert.equal(matches[0][0].node,spans[0].firstChild);assert.equal(matches[0][1].node,spans[1].firstChild);assert.equal(boxes[1].term.id,'cpp');}finally{globalThis.Node=oldNode;globalThis.document=oldDocument;}
});

test('a mistaken term recall proposes a teaching adjustment without activating it or degrading mastery',async()=>{
 const {readLearning}=await import('../src/lib/learning/store.ts');
 const term=(await readTerms())[0],status=term.status,originalFetch=globalThis.fetch;
 globalThis.fetch=async()=>Response.json({choices:[{message:{content:JSON.stringify({verdict:'needs-work',suggestedStatus:'有直觉',feedback:'把点坐标与体素索引混淆了，应先比较两者',nextQuestion:'同一个体素里能有几个点？'})}}]});
 try {const response=await termPost(req('terms',{action:'assess',id:term.id,answer:'点云就是每个体素的整数索引。'}));assert.equal(response.status,200);
 const memory=(await readLearning()).memories.find(m=>m.key.startsWith('term-gap:'));assert.ok(memory);assert.equal(memory.status,'pending');assert.equal(memory.evidence[0].quote,'点云就是每个体素的整数索引。');assert.match(memory.text,/点坐标与体素索引/);assert.equal((await readTerms())[0].status,status);
 }finally{globalThis.fetch=originalFetch;}
});
