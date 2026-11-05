import {readFileSync,mkdirSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE?pathToFileURL(process.env.PLAYWRIGHT_MODULE).href:'playwright');
const browser=await chromium.launch({channel:'msedge',headless:true});
const page=await browser.newPage({viewport:{width:1440,height:1000}});
page.setDefaultTimeout(15000);
const errors=[],threads=[],words=[],collections=[];
let fail=false, failFeedback=false, observationReads=0, failCollection=false, translationCalls=0;
const feedbackRequests=[];
const learning={runId:'test-run',observationId:'test-observation',proposedIds:[],profile:[{id:'test-profile',version:2,text:'生成回答时的概率论背景',topic:'概率论',dimension:'knowledge',reason:'用户确认'}],selected:[{id:'test-strategy',version:3,text:'先说明比较基线，再解释公式。',reason:'已确认',score:1,rationale:'根据当时的概率论背景选择解释起点。'}]};
let holdMemoryRead=false,heldRead;
const translation=String.raw`# 单查询训练的收益

这里讨论相对全数据训练的收益，需要先明确比较基线。Entropy measures uncertainty in this example.

恢复率为 \(R_t = \frac{M_t-M_0}{M_F-M_0}\)，变量下标应当正确显示。

\[
v_t = \frac{d_t-d_{t+1}}{d_t}
\]

普通代码应保持原样：`+'`x_train` `y_pred`。';
page.on('pageerror',e=>errors.push(e.message));
const json=(route,data,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(data)});
await page.route('**/api/**',async route=>{
  const url=new URL(route.request().url());const body=route.request().method()==='POST'?route.request().postDataJSON():null;
  if(url.pathname==='/api/learning/observations'){observationReads++;return json(route,{});}
  if(url.pathname==='/api/learning'){if(failFeedback)return json(route,{error:'模拟反馈保存失败'},500);if(body)feedbackRequests.push(body);return json(route,{profiles:[],memories:[],runs:[],audit:[],observations:[]});}
  if(url.pathname==='/api/paper/pdf')return route.fulfill({status:200,contentType:'application/pdf',body:readFileSync('public/papers/nsr.pdf')});
  if(url.pathname==='/api/paper')return json(route,url.search?{translation,pages:[{text:'Original text'}]}:{papers:[{slug:'memory-test',title:'Reading memory verification',pages:8}]});
  if(url.pathname==='/api/vocabulary')return json(route,{docId:'a'.repeat(64),entries:[]});
  if(url.pathname==='/api/terms')return json(route,{terms:[]});
  if(url.pathname==='/api/reading-memory'){
    if(!body){if(holdMemoryRead){holdMemoryRead=false;heldRead={route,snapshot:structuredClone({threads})};return;}return json(route,{threads});}
    if(body.action==='create'){const thread={id:`t${threads.length}`,anchor:body.anchor,messages:[],createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()};threads.push(thread);return json(route,{thread});}
    const thread=threads.find(t=>t.id===body.id);
    if(body.action==='ask'){if(fail)return json(route,{error:'模拟网络中断，请重试'},400);assert.equal(body.revision,thread.messages.length);thread.messages.push({role:'user',content:body.question},{role:'assistant',learning,content:String.raw`基线是全数据训练。分母表示参考增益，\(R=\frac{a}{b}\)。Entropy 表示不确定性。`});return json(route,{thread});}
    if(body.action==='delete'){threads.splice(threads.indexOf(thread),1);return json(route,{ok:true});}
  }
  if(url.pathname==='/api/reading-collection'){
    if(!body)return json(route,{entries:words});if(failCollection)return json(route,{error:'模拟收藏保存失败'},400);collections.push(body);
    const saved={id:'w'+words.length,text:body.anchor.text,sourceAnchor:body.anchor,meaning:'熵：语境中的不确定性',usage:'这里用来度量不确定性',context:body.anchor.context,slug:'memory-test',page:0};
    if(body.kind==='word')words.push(saved);return json(route,{saved});
  }
  if(url.pathname==='/api/chat')return json(route,{choices:[{message:{content:translation}}]});
  if(url.pathname==='/api/reader/translate'){translationCalls++;return route.fulfill({status:200,contentType:'application/x-ndjson',body:JSON.stringify({delta:'这是翻译中的参考增益，保留公式 \\(R=\\frac{a}{b}\\)。'})+'\n{"done":true}\n'});}
  if(url.pathname==='/api/session-history')return json(route,{sessions:[],id:'chat-test'});
  return json(route,{});
});
const base=process.env.READER_TEST_URL||'http://localhost:3000';
async function select(selector,text){
  await page.locator(selector).first().waitFor();
  await page.evaluate(({selector,text})=>{
    const root=document.querySelector(selector);const all=root.textContent;const index=all.indexOf(text);if(index<0)throw Error('Text missing: '+text);
    const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);let offset=0,node;const range=document.createRange();let began=false;
    while((node=walker.nextNode())){const size=node.textContent.length;if(!began&&index<offset+size){range.setStart(node,index-offset);began=true;}if(began&&index+text.length<=offset+size){range.setEnd(node,index+text.length-offset);break;}offset+=size;}
    const selection=window.getSelection();selection.removeAllRanges();selection.addRange(range);root.dispatchEvent(new MouseEvent('mouseup',{bubbles:true}));
  },{selector,text});
  await page.getByRole('toolbar',{name:'回答选区操作'}).waitFor();
}
const visibleMemory='.reading-memory-panel:not([hidden])';
async function send(question){
  const panel=page.locator(visibleMemory).last();
  const replies=await panel.locator('.reading-message--assistant').count();
  await panel.getByRole('textbox',{name:'追问内容'}).fill(question);
  await panel.getByRole('button',{name:'发送追问',exact:true}).click();
  await panel.locator('.reading-message--assistant').nth(replies).waitFor();
}
mkdirSync('.build-cache/reading-memory-verification',{recursive:true});
try{
  await page.goto(base+'/read/memory-test?view=zh');
  await page.locator('.reader-zh .katex-display').waitFor();
  assert.equal(await page.locator('.reader-zh .katex-error').count(),0);
  assert.equal(await page.locator('.reader-zh code').first().textContent(),'x_train');
  await select('.reader-zh .md-body','相对全数据训练的收益');
  await page.getByRole('button',{name:'划线追问',exact:true}).click();await send('相对哪个基线？');
  assert.equal(threads.length,1);assert.match(threads[0].anchor.context,/比较基线/);
  const footer=page.locator(`${visibleMemory} .response-learning`).first();
  assert.equal(await footer.locator('.response-learning-actions button').allTextContents().then(x=>x.join(' · ')),'有帮助 · 调整讲法 · 查看依据');
  await footer.getByRole('button',{name:'查看依据',exact:true}).click();await page.getByRole('dialog',{name:'这次回答的依据'}).waitFor();
  await page.getByText('生成回答时的概率论背景',{exact:false}).waitFor();
  await page.keyboard.press('Escape');await page.getByRole('dialog',{name:'这次回答的依据'}).waitFor({state:'hidden'});
  assert.equal(await page.getByRole('dialog',{name:'划线追问'}).isVisible(),true,'Escape only closes the top drawer');
  assert.equal(await footer.getByRole('button',{name:'查看依据',exact:true}).evaluate(e=>e===document.activeElement),true);
  await footer.getByRole('button',{name:'调整讲法',exact:true}).click();await footer.getByLabel('希望怎样调整讲法').fill('请先解释分母。');
  failFeedback=true;await footer.getByRole('button',{name:'提交反馈'}).click();await footer.getByRole('alert').waitFor();
  assert.equal(await footer.getByLabel('希望怎样调整讲法').inputValue(),'请先解释分母。');
  failFeedback=false;await footer.getByRole('button',{name:'提交反馈'}).click();await footer.getByRole('status').waitFor();
  assert.equal(feedbackRequests.at(-1).note,'请先解释分母。');assert.equal(observationReads,0,'answers must not poll observation candidates');
  await footer.getByRole('button',{name:'查看依据',exact:true}).click();
  await page.getByRole('link',{name:'查看当前画像',exact:true}).click();await page.getByRole('heading',{name:'个性化',exact:true}).waitFor();
  await page.getByRole('button',{name:'关闭侧栏',exact:true}).click();
  assert.equal(await page.locator('dialog[open]').count(),0,'navigation must close retained reader dialog');
  assert.notEqual(await page.evaluate(()=>document.body.style.overflow),'hidden');
  await page.goto(base+'/read/memory-test?view=zh');await page.locator('.reader-zh .reading-memory-links button').click();


  await page.getByRole('button',{name:'关闭追问'}).click();
  await page.locator('.reader-zh .reading-highlight--memory').first().waitFor();
  // Click the real text range, not the fallback history chip.
  const point=await page.evaluate(()=>{const r=document.querySelector('.reader-zh .reading-highlight--memory').getBoundingClientRect();return{x:r.left+3,y:r.top+r.height/2};});
  await page.mouse.click(point.x,point.y);await page.getByRole('dialog',{name:'划线追问'}).waitFor();
  await send('为什么使用这个分母？');assert.equal(threads[0].messages.length,4);
  await select(`${visibleMemory} .reading-message--assistant .md-body`,'分母表示参考增益');
  await page.getByRole('button',{name:'划线追问',exact:true}).click();await send('这句话可以举例吗？');
  assert.equal(threads.length,2);assert.match(threads[1].anchor.context,/相对哪个基线/);
  const parent=page.locator(visibleMemory).filter({has:page.locator('[data-thread-id="t0"]')});
  const child=page.locator(visibleMemory).filter({has:page.locator('[data-thread-id="t1"]')});
  assert.equal(await page.locator(visibleMemory).count(),2,'branching keeps both independent windows visible');
  assert.equal(await parent.isVisible(),true);assert.equal(await child.isVisible(),true);
  assert.equal(await parent.locator('.reading-message--assistant').count(),2);
  assert.equal(await child.locator('.reading-message--assistant').count(),1);
  // The parent can be focused and moved while its child stays open.
  await parent.locator('.floating-panel-drag').focus();
  await page.keyboard.press('ArrowLeft');
  await parent.locator('.reading-source-details > summary').click();
  assert.match(await parent.locator('.reading-source-body').textContent(),/相对全数据训练/);
  await page.screenshot({path:'.build-cache/reading-memory-verification/formulas-followup.png'});
  await child.focus();await child.getByRole('button',{name:'关闭追问'}).click();
  assert.equal(await parent.isVisible(),true,'closing the child leaves its parent available');
  await parent.getByRole('button',{name:'关闭追问'}).click();
  await page.reload();await page.locator('.reader-zh .reading-memory-links button').waitFor();
  await page.locator('.reader-zh .reading-highlight--memory').first().waitFor();
  await page.locator('.reader-zh .reading-memory-links button').click();
  assert.equal(await page.locator(`${visibleMemory} .reading-message--assistant`).count(),2);
  fail=true;await page.locator(visibleMemory).getByRole('textbox',{name:'追问内容'}).fill('失败后重试');await page.locator(visibleMemory).getByRole('button',{name:'发送追问',exact:true}).click();await page.locator(visibleMemory).getByRole('alert').filter({hasText:'模拟网络中断'}).waitFor();assert.equal(threads[0].messages.length,4);
  fail=false;await page.locator(visibleMemory).getByRole('button',{name:'发送追问',exact:true}).click();await page.waitForFunction(()=>document.querySelectorAll('.reading-memory-panel:not([hidden]) .reading-message--assistant').length===3);
  await page.getByRole('button',{name:'关闭追问'}).click();
  await select('.reader-zh .md-body','Entropy');assert.equal(await page.getByRole('toolbar',{name:'回答选区操作'}).getByRole('button',{name:'加入生词本',exact:true}).count(),0);await page.getByRole('button',{name:'翻译 / 释义',exact:true}).click();await page.getByText('翻译完成',{exact:true}).waitFor();assert.equal(words.length,0);await page.getByRole('button',{name:'加入生词本',exact:true}).click();await page.getByRole('status').filter({hasText:'已加入生词本'}).waitFor();assert.equal(words.length,1);assert.match(collections.at(-1).meaning,/参考增益/);await page.getByRole('button',{name:'关闭翻译',exact:true}).click();
  await page.locator('.reader-zh .reading-highlight--word').first().waitFor();
  await page.reload();await page.locator('.reader-zh .reading-highlight--word').first().waitFor();
  await select('.reader-zh .md-body','相对全数据训练');await page.getByRole('button',{name:'翻译 / 释义',exact:true}).click();await page.getByText('翻译完成',{exact:true}).waitFor();await page.getByRole('button',{name:'加入术语卡片',exact:true}).click();await page.getByRole('status').filter({hasText:'已加入术语卡片'}).waitFor();assert.equal(collections.at(-1).kind,'term');assert.match(collections.at(-1).meaning,/参考增益/);await page.getByRole('button',{name:'关闭翻译',exact:true}).click();
  // Real PDF passage anchors and zoom-stable memories.
  await page.getByRole('button',{name:'查看原文 PDF'}).click();await page.locator('.reader-text-layer span').first().waitFor();
  await page.evaluate(()=>{const layer=document.querySelector('.reader-text-layer'),spans=[...layer.querySelectorAll('span')].filter(s=>s.firstChild?.nodeType===3);const range=document.createRange();range.setStart(spans[0].firstChild,0);range.setEnd(spans[5].firstChild,spans[5].textContent.length);const sel=window.getSelection();sel.removeAllRanges();sel.addRange(range);document.dispatchEvent(new Event('selectionchange'));});
  await page.getByRole('toolbar',{name:'选中文字操作'}).waitFor();await page.getByRole('button',{name:'划线追问',exact:true}).click();await send('解释这段原文');
  assert.ok(threads.at(-1).anchor.rects.length>0);await page.getByRole('button',{name:'关闭追问'}).click();
  await page.locator('.pdf-memory-highlight').first().waitFor();await page.getByRole('button',{name:'放大',exact:true}).click();
  await page.screenshot({path:'.build-cache/reading-memory-verification/pdf-memory.png'});
  await page.evaluate(()=>{const layer=document.querySelector('.reader-text-layer'),spans=[...layer.querySelectorAll('span')].filter(s=>s.firstChild?.nodeType===3);const range=document.createRange();range.setStart(spans[6].firstChild,0);range.setEnd(spans[10].firstChild,spans[10].textContent.length);const sel=window.getSelection();sel.removeAllRanges();sel.addRange(range);document.dispatchEvent(new Event('selectionchange'));});
  await page.getByRole('toolbar',{name:'选中文字操作'}).waitFor();await page.getByRole('button',{name:'翻译',exact:true}).click();await page.locator('.reader-translation-result .katex').first().waitFor();
  await select('.reader-translation-result .md-body','翻译中的参考增益');await page.getByRole('button',{name:'划线追问',exact:true}).click();await send('译文里的增益指什么？');assert.match(threads.at(-1).anchor.context,/原文：/);await page.getByRole('button',{name:'关闭追问'}).click();await page.getByRole('button',{name:'关闭翻译',exact:true}).click();
  // Main AI reply participates in the same selection workflow.
  await page.getByRole('button',{name:'AI 讲解',exact:true}).click();await page.locator('.reader-chat:not([hidden]) textarea').last().fill('说明收益');
  await page.locator('.reader-chat:not([hidden])').getByRole('button',{name:'发送',exact:true}).click();await page.locator('.reader-chat:not([hidden]) .katex-display').waitFor();
  await select('.reader-chat:not([hidden]) .md-body','Entropy');await page.getByRole('button',{name:'翻译 / 释义',exact:true}).click();await page.getByText('翻译完成',{exact:true}).waitFor();
  const translatedCount=translationCalls,collectionCount=collections.length;
  failCollection=true;await page.getByRole('button',{name:'加入术语卡片',exact:true}).click();await page.getByRole('status').filter({hasText:'模拟收藏保存失败'}).waitFor();
  assert.equal(collections.length,collectionCount);assert.equal(await page.getByRole('button',{name:'加入术语卡片',exact:true}).isEnabled(),true);
  failCollection=false;await page.getByRole('button',{name:'加入术语卡片',exact:true}).click();await page.getByRole('button',{name:'已加入术语卡片',exact:true}).waitFor();
  assert.equal(translationCalls,translatedCount);assert.match(collections.at(-1).anchor.sourceKey,/chat:/);assert.match(collections.at(-1).meaning,/参考增益/);
  await page.keyboard.press('Escape');assert.equal(await page.getByRole('dialog',{name:'AI 讲解对话'}).isVisible(),true);
  await select('.reader-chat:not([hidden]) .md-body','相对全数据训练的收益');await page.getByRole('button',{name:'划线追问',exact:true}).click();await send('回答中的收益是什么意思？');
  assert.match(threads.at(-1).anchor.sourceKey,/chat:/);
  await page.setViewportSize({width:390,height:844});await page.waitForTimeout(200);
  const box=await page.locator(visibleMemory).last().boundingBox();assert.ok(box.x>=0&&box.x+box.width<=390&&box.y+box.height<=844);
  await page.screenshot({path:'.build-cache/reading-memory-verification/mobile.png'});
  await page.getByRole('button',{name:'关闭追问'}).click();
  await page.goto(base+'/terms?paper=memory-test');await page.getByRole('heading',{name:'术语卡片',exact:true}).waitFor();
  await page.goto(base+'/vocabulary');await page.getByRole('heading',{name:'生词本',exact:true}).waitFor();await page.getByRole('heading',{name:'Entropy',exact:true}).waitFor();
  await page.goto(base+'/read/memory-test?view=zh');await page.locator('.reader-zh .reading-memory-links button').waitFor();
  holdMemoryRead=true;await page.locator('.reader-zh .reading-memory-links button').click();
  await page.waitForTimeout(100);assert.ok(heldRead);
  page.once('dialog',dialog=>dialog.accept());await page.locator(visibleMemory).getByRole('button',{name:'删除对话及高光',exact:true}).click();await page.getByRole('dialog',{name:'划线追问'}).waitFor({state:'hidden'});
  await json(heldRead.route,heldRead.snapshot);await page.waitForTimeout(150);
  assert.equal(await page.locator('.reader-zh .reading-memory-links button').count(),0,'stale read must not resurrect a deleted highlight');
  assert.deepEqual(errors,[]);
  console.log('PASS math, code preservation, selection, clickable memory, independent parent/child windows, context, reload, failure retry, both collections, PDF passage, zoom, main chat, mobile, stale-read deletion (mocked APIs)');
}catch(e){console.error("PAGE",(await page.locator("body").innerText()).slice(0,6000),"ERRORS",errors);await page.screenshot({path:".build-cache/reading-memory-verification/failure.png"});throw e;}finally{await browser.close();}
