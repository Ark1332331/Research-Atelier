import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
const {chromium}=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE??'C:/Users/pc/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/playwright/index.mjs').href);
const browser=await chromium.launch({channel:'msedge',headless:true});
const node={id:'concurrent-fixture',parentId:null,kind:'document',name:'并发验证.md',order:0};
const content='# 并发追问\n\n'+Array.from({length:6},(_,i)=>`第 ${i+1} 题：解释 $X_${i+1}$ 的分布。`).join('\n\n')+'\n\n[返回本节](#并发追问)';
const threads=[],errors=[];let releaseCreate,created,gets=0;
const createdPromise=new Promise(r=>created=r),createGate=new Promise(r=>releaseCreate=r);
try{
 const page=await browser.newPage({viewport:{width:1440,height:1000}});page.setDefaultTimeout(10000);page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>{
  const real=window.fetch;window.streams=[];
  window.fetch=async(input,init)=>{
   const body=init?.body?JSON.parse(init.body):null;
   if(String(input)==='/api/reading-memory'&&body?.action==='ask')return new Response(new ReadableStream({start(c){
    init.signal?.addEventListener('abort',()=>c.error(init.signal.reason),{once:true});
    window.streams.push({body,push:e=>c.enqueue(new TextEncoder().encode(JSON.stringify(e)+'\n'))});
   }}),{headers:{'Content-Type':'application/x-ndjson'}});
   return real(input,init);
  };
 });
 await page.route('**/api/**',async r=>{
  const path=new URL(r.request().url()).pathname,body=r.request().method()==='POST'?r.request().postDataJSON():null;
  if(path==='/api/model-configs')return r.fulfill({json:{activeId:null,profiles:[],environment:{model:'mock',hasKey:true}}});
  if(path==='/api/study-library')return r.fulfill({json:{nodes:[node]}});
  if(path==='/api/study-library/document')return r.fulfill({json:{node,content,links:{}}});
  if(path==='/api/study-shortcuts')return r.fulfill({json:{revision:0,shortcuts:[]}});
  if(path==='/api/reading-memory'){
   if(body?.action==='create'){
    const thread={id:'thread-'+threads.length,anchor:body.anchor,messages:[]};threads.push(thread);
    if(threads.length===1){created();await createGate;}
    return r.fulfill({json:{thread}});
   }
   gets++;return r.fulfill({json:{threads}});
  }
  return r.fulfill({json:{notes:[],entries:[]}});
 });
 await page.goto((process.env.STUDY_TEST_URL??'http://localhost:3000')+'/study/'+node.id);
 const paragraphs=page.locator('.study-markdown > p');await paragraphs.first().waitFor();
 async function ask(i){
  await paragraphs.nth(i).evaluate(el=>{const r=document.createRange();r.selectNodeContents(el);const s=getSelection();s.removeAllRanges();s.addRange(r);document.dispatchEvent(new Event('selectionchange'));});
  await page.getByRole('button',{name:'划线追问',exact:true}).click();
  const panel=page.locator('.reading-memory-panel:visible').last();
  await panel.getByLabel('追问内容',{exact:true}).fill('解释题目 '+i);
  await panel.getByRole('button',{name:'发送追问',exact:true}).click();
 }
 await ask(0);await createdPromise;
 // Another refresh sees the persisted anchor before its create response reaches its owner.
 // Seed a reload using a failed second request, without completing the first create.
 await ask(1);await page.waitForFunction(()=>window.streams.length===1);
 await page.evaluate(()=>window.streams[0].push({error:'模拟第二处请求失败'}));
 await page.locator('.reading-memory-links button').first().waitFor();
 await page.locator('.study-reader-viewport .reading-memory-links button').first().click();
 assert.equal(await page.locator('.reading-memory-panel').count(),2,'clicking an anchor awaiting create acknowledgement must not open an empty duplicate window');
 releaseCreate();await page.waitForFunction(()=>window.streams.length===2);
 await page.locator('.study-reader-viewport .reading-memory-links').getByTitle(threads[1].anchor.text,{exact:true}).click();
 const retry=page.locator('.reading-memory-panel').filter({has:page.locator('[data-thread-id="thread-1"]')});
 await retry.getByRole('alert').filter({hasText:'模拟第二处请求失败'}).waitFor();
 assert.equal(await retry.getByLabel('追问内容',{exact:true}).inputValue(),'解释题目 1','failed requests retain their question and error when reopened');
 await retry.getByRole('button',{name:'发送追问',exact:true}).click();await page.waitForFunction(()=>window.streams.length===3);
 for(let i=2;i<6;i++){await ask(i);await page.waitForFunction(n=>window.streams.length===n,i+2);}
 const clear=page.getByRole('button',{name:'清空画布',exact:true});
 await clear.click();
 assert.equal(await page.locator('.reading-memory-panel:visible').count(),0);
 assert.ok(await clear.isDisabled());
 assert.equal(threads.length,6,'clearing the canvas must not delete conversations');
 assert.ok(await page.locator('.reading-highlight--memory').count()>0,'clearing the canvas keeps source highlights');
 // Complete in reverse order while every window is closed.
 for(const i of [5,4,3,2,1,0]){
  const thread=threads[i];thread.messages=[{role:'user',content:'解释题目 '+i},{role:'assistant',content:'完整回答 '+i+'：先固定条件，再积分。'}];
  await page.evaluate(({thread})=>window.streams.findLast(s=>s.body.id===thread.id).push({done:true,result:{thread}}),{thread});
 }
 await page.waitForTimeout(150);
 assert.equal(await page.locator('.reading-memory-panel:visible').count(),0,'background completion must not reopen cleared windows');
 await page.evaluate(()=>window.sourceLink=document.querySelector('.study-markdown a'));
 const before=gets;
 for(const i of [0,1,2,3,4,5]){
  await page.locator('.study-reader-viewport .reading-memory-links').getByTitle(threads[i].anchor.text,{exact:true}).click();const panel=page.locator('.reading-memory-panel').filter({has:page.locator(`[data-thread-id="thread-${i}"]`)});
  await panel.locator('.reading-message--assistant').filter({hasText:'完整回答 '+i}).waitFor();
  assert.equal(await panel.locator('.reading-thread-empty').count(),0);
  await panel.getByRole('button',{name:'关闭追问',exact:true}).click();
 }
 assert.equal(gets,before,'opening cached highlights must not reload every conversation');
 assert.ok(await page.evaluate(()=>window.sourceLink.isConnected),'opening highlights must preserve the unchanged document DOM instead of reparsing/remounting its contents');
 // Hit testing must reuse painted boxes, not walk every text node/formula on a click.
 const rect=await page.locator('.reading-highlight--memory').first().boundingBox();
 const walked=await page.evaluate(({x,y})=>{
  let count=0;const original=Range.prototype.intersectsNode;Range.prototype.intersectsNode=function(n){count++;return original.call(this,n);};
  try{document.elementFromPoint(x,y).dispatchEvent(new MouseEvent('click',{bubbles:true,clientX:x,clientY:y}));return count;}finally{Range.prototype.intersectsNode=original;}
 },{x:rect.x+rect.width/2,y:rect.y+rect.height/2});
 assert.equal(walked,0,'highlight click must not recompute selection geometry');
 const draftPanel=page.locator('.reading-memory-panel:visible');await draftPanel.waitFor();
 const draftId=await draftPanel.locator('[data-thread-id]').getAttribute('data-thread-id');
 await draftPanel.getByLabel('追问内容',{exact:true}).fill('还没发出的草稿');
 await clear.click();
 await page.locator('.study-reader-viewport .reading-memory-links').getByTitle(threads.find(t=>t.id===draftId).anchor.text,{exact:true}).click();
 assert.equal(await draftPanel.getByLabel('追问内容',{exact:true}).inputValue(),'还没发出的草稿');
 await page.setViewportSize({width:390,height:844});
 const clearBox=await clear.boundingBox();assert.ok(clearBox.x>=0&&clearBox.x+clearBox.width<=390,'clear action stays accessible on mobile');
 await clear.click();assert.equal(await page.locator('.reading-memory-panel:visible').count(),0);
 assert.deepEqual(errors,[]);console.log('PASS delayed-create identity, six parallel windows, clear canvas preserves drafts/highlights/background completion, mobile clear action, cached reopening and geometry-free hit testing');
}finally{releaseCreate?.();await browser.close();}
