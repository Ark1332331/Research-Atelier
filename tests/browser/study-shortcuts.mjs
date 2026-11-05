import {pathToFileURL} from 'node:url';
import {mkdir} from 'node:fs/promises';
import assert from 'node:assert/strict';
const base=process.env.STUDY_TEST_URL??'http://localhost:3132';
const {chromium}=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE??'C:/Users/pc/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/playwright/index.mjs').href);
const {DEFAULT_STUDY_SHORTCUTS}=await import('../../src/lib/study-shortcuts.ts');
const browser=await chromium.launch({channel:'msedge',headless:true});
const nodes=[{id:'book',parentId:null,kind:'library',name:'概率论',order:0},{id:'fixture',parentId:'book',kind:'document',name:'条件期望.md',order:0}];
const content='# 条件期望\n\n已知随机变量 $X$ 与 $Y$ 相互独立，试计算 $E(X\\mid Y)$。\n\n请说明使用的条件，并检查结论。';
let settings={revision:0,shortcuts:structuredClone(DEFAULT_STUDY_SHORTCUTS)},threads=[],asks=[],releaseFirst,failAsk=false,failSave=false;
const firstGate=new Promise(resolve=>{releaseFirst=resolve;});
try{
 const page=await browser.newPage({viewport:{width:1440,height:1000}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/api/study-library',r=>r.fulfill({json:{nodes}}));
 await page.route('**/api/study-library/document?*',r=>r.fulfill({json:{node:nodes[1],content,links:{}}}));
 await page.route('**/api/reading-notes',r=>r.fulfill({json:{notes:[]}}));
 await page.route('**/api/reading-collection*',r=>r.fulfill({json:{entries:[]}}));
 await page.route('**/api/study-shortcuts',async r=>{
  if(r.request().method()==='PUT'){
   if(failSave)return r.fulfill({status:500,json:{error:'保存失败，请重试'}});
   const body=r.request().postDataJSON();assert.equal(body.revision,settings.revision);settings={shortcuts:body.shortcuts,revision:settings.revision+1};
  }
  await r.fulfill({json:settings});
 });
 await page.route('**/api/reading-memory',async r=>{
  if(r.request().method()==='POST'){
   const body=r.request().postDataJSON();
   if(body.action==='create'){
    const thread={id:'thread-'+threads.length,anchor:body.anchor,messages:[]};threads.push(thread);return r.fulfill({json:{thread}});
   }
   if(body.action==='ask'){
    asks.push(body);if(asks.length===1)await firstGate;
    if(failAsk)return r.fulfill({status:503,json:{error:'模型暂时不可用，请重试'}});
    const thread=threads.find(t=>t.id===body.id);assert.equal(body.revision,thread.messages.length,'queued questions must use the latest turn revision');
    thread.messages.push({role:'user',content:body.question},{role:'assistant',content:'独立性意味着知道 $Y$ 的值不会改变 $X$ 的分布。\n\n因此 $E(X\\mid Y)=E(X)$。'});
    return r.fulfill({json:{thread}});
   }
  }
  await r.fulfill({json:{threads}});
 });
 const select=async locator=>{
  await locator.scrollIntoViewIfNeeded();
  await locator.evaluate(el=>{const range=document.createRange();range.selectNodeContents(el);const s=window.getSelection();s.removeAllRanges();s.addRange(range);document.dispatchEvent(new Event('selectionchange'));});
  await page.getByRole('toolbar',{name:'回答选区操作'}).waitFor();
 };
 const quick=title=>page.getByRole('toolbar').getByRole('button',{name:title,exact:true});
 await page.goto(base+'/study/fixture');const source=page.locator('.study-markdown > p').first();await source.waitFor();
 await select(source);assert.deepEqual(await page.locator('.reading-study-shortcuts button').allTextContents(),['解题','是什么','为什么']);
 await mkdir('.build-cache/shortcut-qa',{recursive:true});await page.screenshot({path:'.build-cache/shortcut-qa/menu.png'});
 await quick('解题').click();await page.getByRole('status').filter({hasText:'正在结合'}).waitFor();
 await select(source);await quick('是什么').click();
 releaseFirst();await page.waitForFunction(()=>document.querySelectorAll('.reading-message--assistant').length===2);
 assert.equal(threads.length,1);assert.equal(asks.length,2,'exactly one request per click');
 assert.deepEqual(asks.map(a=>a.question),DEFAULT_STUDY_SHORTCUTS.slice(0,2).map(s=>s.prompt));
 assert.ok(threads[0].anchor.quoteMarkdown.includes('\\mid'));assert.ok(threads[0].anchor.context.includes('检查结论'));
 await page.locator('.reading-highlight--memory').first().waitFor();
 await select(page.locator('.reading-message--assistant p').first());await quick('为什么').click();
 await page.waitForFunction(()=>document.querySelectorAll('.reading-message--assistant').length===3);
 assert.equal(threads.length,2);assert.equal(threads[1].anchor.origin.threadId,threads[0].id);assert.ok(threads[1].anchor.context.includes(DEFAULT_STUDY_SHORTCUTS[0].prompt));
 assert.equal(await page.locator('.reading-memory-panel:visible').count(),2,'child and parent coexist');
 await page.getByRole('button',{name:'自定义快捷',exact:true}).click();const editor=page.getByRole('dialog',{name:'自定义快捷提问',exact:true});
 await editor.getByLabel('提问指令',{exact:true}).first().fill('先提示我一步，再展示推导。');
 await editor.getByRole('region',{name:'快捷指令 2',exact:true}).getByLabel('启用').uncheck();
 await editor.getByRole('button',{name:'新增快捷指令',exact:false}).click();
 const custom=editor.getByRole('region',{name:'快捷指令 4',exact:true});await custom.getByLabel('按钮名称').fill('举个例子');await custom.getByLabel('提问指令').fill('用一个简单的反例解释这段话。');
 for(let i=0;i<3;i++)await editor.getByRole('button',{name:'上移举个例子',exact:true}).click();
 failSave=true;await editor.getByRole('button',{name:'保存快捷指令',exact:true}).click();await editor.getByRole('alert').waitFor();
 assert.equal(await editor.getByLabel('按钮名称').first().inputValue(),'举个例子','save errors must retain the draft');
 failSave=false;await editor.getByRole('button',{name:'保存快捷指令',exact:true}).click();await editor.waitFor({state:'hidden'});
 await page.reload();await source.waitFor();await select(source);
 assert.deepEqual(await page.locator('.reading-study-shortcuts button').allTextContents(),['举个例子','解题','为什么']);
 failAsk=true;await quick('举个例子').click();const parent=page.locator('.reading-memory-panel:visible').first();
 await parent.getByRole('alert').waitFor();assert.equal(asks.at(-1).question,'用一个简单的反例解释这段话。');
 assert.equal(await parent.getByLabel('追问内容',{exact:true}).inputValue(),'用一个简单的反例解释这段话。');
 const count=asks.length;await page.waitForTimeout(500);assert.equal(asks.length,count,'failed quick requests must not loop');
 failAsk=false;await parent.getByRole('button',{name:'发送追问',exact:true}).click();await page.waitForFunction(()=>document.querySelectorAll('.reading-message--assistant').length===3);
 await select(source);await quick('解题').focus();await page.keyboard.press('Enter');await page.waitForFunction(()=>document.querySelectorAll('.reading-message--assistant').length===4);
 assert.equal(asks.at(-1).question,'先提示我一步，再展示推导。');
 await page.getByRole('button',{name:'自定义快捷',exact:true}).click();await editor.getByLabel('按钮名称').first().waitFor();await page.screenshot({path:'.build-cache/shortcut-qa/editor.png'});
 await editor.getByRole('button',{name:'取消',exact:true}).click();
 await page.setViewportSize({width:390,height:844});await select(source);
 const bounds=await page.getByRole('toolbar').boundingBox();assert.ok(bounds.x>=0&&bounds.x+bounds.width<=390&&bounds.y>=0&&bounds.y+bounds.height<=844,'wrapped mobile selection menu stays on screen');
 await page.screenshot({path:'.build-cache/shortcut-qa/mobile.png'});await quick('自定义快捷').click();await editor.getByLabel('按钮名称').first().waitFor();
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
 assert.deepEqual(errors,[]);console.log('PASS automatic quick questions, queued turns, math/context, parent-child panels, editing/order/disable/persistence, save and ask recovery, keyboard and mobile');
}finally{releaseFirst();await browser.close();}
