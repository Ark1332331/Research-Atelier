import { pathToFileURL } from 'node:url';
import { mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
const {chromium}=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const browser=await chromium.launch({channel:'msedge',headless:true});
const page=await browser.newPage({viewport:{width:1440,height:1000}});page.setDefaultTimeout(15000);
const errors=[];page.on('pageerror',e=>errors.push(e.message));
const terms=[{id:'entropy',name:'Entropy',meaning:'熵：衡量随机变量的不确定性。',note:'我的笔记：先比较确定与随机的两种情况。',collection:'manual',status:'未接触',source:'测试论文',papers:[{slug:'sample',title:'测试论文'}],excerpts:[]}];
const words=[
 {id:'word',text:'substantially',meaning:'显著地；大幅度地。',context:'The result improves substantially.',lemma:'substantially',partOfSpeech:'',usage:'',slug:'sample',page:1},
 {id:'second-word',text:'robust',meaning:'稳健的。',context:'A robust method.',slug:'second'},
 {id:'orphan-word',text:'archived',meaning:'已归档的。',context:'An archived paper.',slug:'missing-paper'},
 {id:'unassociated-word',text:'otherwise',meaning:'否则。',context:'Otherwise, continue.',slug:''},
];
let failPaperList=false;
const json=(route,data)=>route.fulfill({contentType:'application/json',body:JSON.stringify(data)});
await page.route('**/api/**',async route=>{
 const url=new URL(route.request().url()),body=route.request().method()==='POST'?route.request().postDataJSON():null;
 if(url.pathname==='/api/terms'){
  if(body?.term){const term=terms.find(t=>t.id===body.term.id);Object.assign(term,body.term);return json(route,{terms,saved:term});}
  return json(route,{terms});
 }
 if(url.pathname==='/api/reading-collection'){
  if(body?.action==='delete-word'){words.splice(words.findIndex(w=>w.id===body.id),1);return json(route,{ok:true});}
  return json(route,{entries:words});
 }
 if(url.pathname==='/api/paper')return failPaperList?route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'论文列表暂不可用'})}):json(route,{papers:[{slug:'sample',title:'测试论文'},{slug:'second',title:'第二篇论文'}]});
 if(url.pathname==='/api/reading-memory')return json(route,{threads:[]});
 return json(route,{projects:[],profiles:[],memories:[],runs:[],audit:[]});
});
await mkdir('.build-cache/collection-verification',{recursive:true});
const base=process.env.READER_TEST_URL??'http://localhost:3000';
try{
 await page.goto(base+'/terms/entropy?paper=sample');
 await page.getByRole('heading',{name:'术语卡片',exact:true}).waitFor();
 assert.equal(new URL(page.url()).pathname,'/');assert.equal(new URL(page.url()).searchParams.get('term'),'entropy');
 await page.getByRole('navigation',{name:'项目导航'}).waitFor();
 await page.getByLabel('术语论文范围').locator('option[value=sample]').waitFor({state:'attached'});assert.equal(await page.getByLabel('术语论文范围').inputValue(),'sample');
 await page.locator('.concept-detail').getByText(terms[0].meaning,{exact:true}).waitFor();
 await page.locator('.concept-detail').getByText(terms[0].note,{exact:true}).waitFor();
 await page.getByRole('button',{name:'编辑卡片',exact:true}).click();
 await page.getByLabel('释义',{exact:false}).fill('修正释义：不确定性的度量。');
 await page.getByRole('button',{name:'保存卡片',exact:true}).click();await page.getByRole('status').filter({hasText:'已保存'}).waitFor();
 assert.equal(terms[0].meaning,'修正释义：不确定性的度量。');assert.match(terms[0].note,/我的笔记/);
 await page.screenshot({path:'.build-cache/collection-verification/terms.png',fullPage:true});
 await page.getByRole('navigation',{name:'项目导航'}).getByRole('button',{name:'生词本',exact:true}).click();
 await page.getByRole('heading',{name:'生词本',exact:true}).waitFor();assert.equal(new URL(page.url()).pathname,'/');
 await page.getByText(words[0].meaning,{exact:true}).waitFor();
 await page.reload();await page.getByRole('heading',{name:'substantially',exact:true}).waitFor();
 await page.goBack();await page.getByRole('heading',{name:'术语卡片',exact:true}).waitFor();
 await page.goto(base+'/vocabulary?paper=sample');await page.getByRole('heading',{name:'生词本',exact:true}).waitFor();
 assert.equal(new URL(page.url()).pathname,'/');assert.equal(new URL(page.url()).searchParams.get('paper'),'sample');
 const paperFilter=page.getByLabel('生词论文范围');
 await paperFilter.locator('option').filter({hasText:'第二篇论文'}).waitFor({state:'attached'});
 assert.equal(await paperFilter.locator('option:checked').textContent(),'测试论文');
 assert.deepEqual(await page.locator('.vocabulary-item h2').allTextContents(),['substantially']);
 await paperFilter.selectOption({label:'第二篇论文'});
 await page.waitForURL(url=>url.searchParams.get('paper')==='second');
 await page.getByRole('heading',{name:'robust',exact:true}).waitFor();
 assert.deepEqual(await page.locator('.vocabulary-item h2').allTextContents(),['robust']);
 await page.reload();await page.getByRole('heading',{name:'robust',exact:true}).waitFor();
 assert.equal(await paperFilter.locator('option:checked').textContent(),'第二篇论文');
 await page.goBack();await page.getByRole('heading',{name:'substantially',exact:true}).waitFor();
 assert.equal(new URL(page.url()).searchParams.get('paper'),'sample');
 await paperFilter.selectOption({label:'未关联论文'});
 await page.getByRole('heading',{name:'otherwise',exact:true}).waitFor();
 assert.deepEqual(await page.locator('.vocabulary-item h2').allTextContents(),['otherwise']);
 await page.reload();await page.getByRole('heading',{name:'otherwise',exact:true}).waitFor();
 assert.equal(await paperFilter.locator('option:checked').textContent(),'未关联论文');
 await paperFilter.selectOption({label:'全部论文'});
 await page.waitForURL(url=>!url.searchParams.has('paper')&&!url.searchParams.has('paperScope'));
 await page.getByRole('heading',{name:'robust',exact:true}).waitFor();
 assert.equal(await page.locator('.vocabulary-item').count(),4);
 await page.getByLabel('搜索生词').fill('稳健');
 assert.deepEqual(await page.locator('.vocabulary-item h2').allTextContents(),['robust']);
 await page.getByLabel('搜索生词').fill('');
 await paperFilter.selectOption({label:'missing-paper'});
 await page.waitForURL(url=>url.searchParams.get('paper')==='missing-paper');
 await page.getByRole('heading',{name:'substantially',exact:true}).waitFor({state:'hidden'});
 await page.getByRole('heading',{name:'archived',exact:true}).waitFor();
 assert.deepEqual(await page.locator('.vocabulary-item h2').allTextContents(),['archived']);
 failPaperList=true;
 await page.reload();await page.getByRole('heading',{name:'archived',exact:true}).waitFor();
 await paperFilter.selectOption({label:'sample'});
 await page.getByRole('heading',{name:'substantially',exact:true}).waitFor();
 failPaperList=false;
 await page.setViewportSize({width:390,height:844});
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
 await page.screenshot({path:'.build-cache/collection-verification/vocabulary-mobile.png',fullPage:true});
 await page.getByRole('button',{name:'移除',exact:true}).click();await page.getByRole('heading',{name:'substantially',exact:true}).waitFor({state:'hidden'});assert.equal(words.length,3);
 await page.goto(base+'/terms?paper=sample');await page.getByRole('heading',{name:'术语卡片',exact:true}).waitFor();
 assert.equal(new URL(page.url()).pathname,'/');assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
 assert.deepEqual(errors,[]);
 console.log('PASS single workspace, legacy collection routes, term focus, vocabulary paper/all/unassociated filters, missing paper/API fallback, search, persisted meaning separate from notes, navigation/back/reload, word removal, mobile (mocked APIs)');
}catch(e){await page.screenshot({path:'.build-cache/collection-verification/failure.png',fullPage:true});throw e;}
finally{await browser.close();}
