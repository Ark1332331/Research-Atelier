import {pathToFileURL} from 'node:url';
import {mkdir} from 'node:fs/promises';
import assert from 'node:assert/strict';
const base=process.env.STUDY_TEST_URL??'http://localhost:3132';
const {chromium}=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE??'C:/Users/pc/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/playwright/index.mjs').href);
const browser=await chromium.launch({channel:'msedge',headless:true});
const content=String.raw`# 条件期望

6.[b183-17] 设随机变量 $X\sim N(\mu,1),Y\sim N(0,1)$，且 X 与 Y 相互独立，令

$$
I=\begin{cases}1,&Y\le X\\0,&X\le Y\end{cases}
$$

试证明：

(1) $\mathbb E(I\mid X=x)=\Phi(x)$；

(2) $\mathbb E[\Phi(X)]=P(Y\le X)$；

(3) $\mathbb E[\Phi(X)]=\Phi(\mu/\sqrt{2})$。

下一道题，不应被高光覆盖。`;
const nodes=[{id:'book',parentId:null,kind:'library',name:'概率论',order:0},{id:'fixture',parentId:'book',kind:'document',name:'MinerU_markdown_202610281946789_572a20e3.md',order:0}];
let threads=[];
try {
 const page=await browser.newPage({viewport:{width:1440,height:1000}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/api/study-library',r=>r.fulfill({json:{nodes}}));
 await page.route('**/api/study-library/document?*',r=>r.fulfill({json:{node:nodes[1],content,links:{}}}));
 await page.route('**/api/reading-memory',async r=>{
  if(r.request().method()==='POST'){
   const body=r.request().postDataJSON();
   if(body.action==='delete')threads=threads.filter(t=>t.id!==body.id);
   else if(body.action==='create'){const thread={id:'child',anchor:body.anchor,messages:[]};threads.push(thread);return r.fulfill({json:{thread}});}
   else if(body.action==='ask'){const thread=threads.find(t=>t.id===body.id);thread.messages.push({role:'user',content:body.question},{role:'assistant',content:'先固定 $X=x$，再对 $Y$ 求概率。'});return r.fulfill({json:{thread}});}
  }
  await r.fulfill({json:{threads}});
 });
 await page.route('**/api/reading-notes',r=>r.fulfill({json:{notes:[]}}));
 await page.route('**/api/reading-collection*',r=>r.fulfill({json:{entries:[]}}));
 await page.goto(base+'/study/fixture');await page.locator('.study-markdown .katex').first().waitFor();
 assert.ok(await page.locator('.study-conversations').isVisible(),'opening a document must show the answer pane before any question has been asked');
 assert.equal(await page.locator('#study-reader-directory').isVisible(),false,'the book tree starts collapsed');
 assert.equal(await page.locator('#study-reader-toc').isVisible(),false,'page TOC must not replace the answer pane');
 assert.ok((await page.locator('.study-markdown > p').first().boundingBox()).y<250,'long imported filenames must not push the first question below the fold');
 await mkdir('.build-cache/highlight-qa',{recursive:true});await page.screenshot({path:'.build-cache/highlight-qa/initial-workspace.png'});
 await page.getByRole('button',{name:'收起问答区',exact:true}).click();await page.locator('.study-conversations').waitFor({state:'hidden'});
 await page.getByRole('button',{name:'展开问答区',exact:true}).click();await page.locator('.study-conversations').waitFor();
 await page.getByRole('button',{name:'展开书目',exact:true}).click();
 const anchor=await page.locator('[data-reading-source]').first().evaluate(el=>{
  const ps=el.querySelectorAll('.study-markdown > p');const range=document.createRange();range.setStartBefore(ps[0]);range.setEndAfter(ps[4]);
  const before=document.createRange();before.selectNodeContents(el);before.setEnd(range.startContainer,range.startOffset);
  return {scope:'/study/fixture',sourceKey:el.dataset.readingSource,label:'条件期望练习',text:range.toString(),context:el.textContent,start:before.toString().length,end:before.toString().length+range.toString().length};
 });
 threads=[{id:'parent',anchor,messages:[{role:'user',content:'为什么可以先固定 X？'},{role:'assistant',content:'先把 **条件期望** 看成一个关于 $x$ 的函数。\n\n固定 $X=x$ 后，随机性只来自 $Y$。由于独立性，$Y$ 仍服从标准正态分布。\n\n$$\\mathbb E(I\\mid X=x)=P(Y\\le x)=\\Phi(x)$$\n\n最后对 $X$ 取期望，即可得到所求结论。'}]}];
 await page.reload();await page.locator('.reading-memory-links button').first().waitFor();
 await mkdir('.build-cache/highlight-qa',{recursive:true});
 await page.screenshot({path:'.build-cache/highlight-qa/before-or-after.png'});
 assert.ok(await page.locator('.reading-highlight--memory').count()>0,'saved selections need continuous visual highlights, including whole formulas');
 const count=await page.locator('.reading-highlight--memory').count();assert.ok(count<=9,'one strip per visible line/formula, not per KaTeX glyph: '+count);
 assert.ok(await page.locator('.study-reader-viewport').evaluate(el=>{
   const formula=el.querySelector('.katex-display .katex-html');const rects=[...el.querySelectorAll('.reading-highlight--memory')].map(el=>el.getBoundingClientRect());
   const walker=document.createTreeWalker(formula,NodeFilter.SHOW_TEXT);let node;
   while((node=walker.nextNode())){if(!['0,','1,'].includes(node.textContent))continue;const range=document.createRange();range.selectNodeContents(node);const box=range.getBoundingClientRect();if(!rects.some(r=>r.top<=box.top+1&&r.bottom>=box.bottom-1))return false;}
   return true;
 }),'both rows of a cases formula have a continuous background');
 await page.locator('.reading-memory-links button').first().click();const panel=page.getByRole('dialog',{name:'划线追问',exact:true});
 await panel.waitFor();
 await page.getByRole('button',{name:'收起问答区',exact:true}).click();await panel.waitFor({state:'hidden'});
 await page.locator('.reading-memory-links button').first().click();await panel.waitFor();
 const reader=page.locator('.study-reader-viewport');
 const sourceBounds=await reader.boundingBox(),answerBounds=await panel.boundingBox();
 assert.ok(sourceBounds.x+sourceBounds.width<=answerBounds.x+1,'question and answer must occupy separate, non-overlapping columns');
 await page.getByRole('button',{name:'收起书目',exact:true}).click();
 await page.locator('#study-reader-directory').waitFor({state:'hidden'});
 const wider=await reader.boundingBox();assert.ok(wider.width>sourceBounds.width,'closing the directory gives space back to the question');
 await page.getByRole('separator',{name:'调整题目与回答比例'}).press('ArrowLeft');
 await page.waitForFunction(width=>document.querySelector('.reading-memory-panel:not([hidden])').getBoundingClientRect().width>width,answerBounds.width);
 assert.ok((await panel.boundingBox()).width>answerBounds.width,'divider changes answer proportions');
 const divider=await page.getByRole('separator',{name:'调整题目与回答比例'}).boundingBox();
 await page.mouse.move(divider.x+divider.width/2,divider.y+100);await page.mouse.down();await page.mouse.move(divider.x-30,divider.y+100,{steps:5});await page.mouse.up();
 assert.ok((await panel.boundingBox()).width>answerBounds.width+30,'pointer dragging resizes the split');
 await panel.waitFor();const source=panel.locator('.reading-source-details');assert.equal(await source.getAttribute('open'),null,'source is collapsed so answers receive the space');
 const bodyBox=await panel.locator('.reading-memory-scroll').boundingBox(),panelBox=await panel.boundingBox();assert.ok(bodyBox.height/panelBox.height>.65,'answer viewport should occupy most of the panel');
 await source.locator(':scope > summary').click();await source.locator('.katex').first().waitFor();
 assert.ok((await source.locator('annotation').allTextContents()).every(latex=>!latex.includes('b183-17')),'literal question references must not turn into display math');
 await source.locator(':scope > summary').click();
 await page.screenshot({path:'.build-cache/highlight-qa/desktop.png'});
 await panel.getByRole('button',{name:'关闭追问',exact:true}).click();assert.equal(threads.length,1);
 const strip=page.locator('.reading-highlight--memory').first();const stripBox=await strip.boundingBox();await page.mouse.click(stripBox.x+stripBox.width/2,stripBox.y+stripBox.height/2);await panel.waitFor();
 // Child windows coexist with their source window.
 await panel.locator('.reading-message--assistant [data-reading-source] p').first().evaluate(el=>{const range=document.createRange();range.selectNodeContents(el);const s=window.getSelection();s.removeAllRanges();s.addRange(range);document.dispatchEvent(new Event('selectionchange'));});
 await page.getByRole('button',{name:'划线追问',exact:true}).click();assert.equal(await page.locator('.reading-memory-panel:visible').count(),2);
 const siblings=await page.locator('.reading-memory-panel:visible').evaluateAll(elements=>elements.map(el=>{const b=el.getBoundingClientRect();return {top:b.top,bottom:b.bottom,z:Number(getComputedStyle(el).zIndex)};}));
 assert.ok(siblings[0].bottom>siblings[1].top&&siblings[1].z>siblings[0].z,'independent windows overlap, with the newest in front, as in AnyReader');
 assert.ok(await page.locator('.study-conversations').evaluate(el=>el.scrollHeight<=el.clientHeight+1),'more questions must not grow the right pane into a vertical list');
 await page.screenshot({path:'.build-cache/highlight-qa/parallel.png'});
 const child=page.locator('.reading-memory-panel:visible').last();await child.getByLabel('追问内容',{exact:true}).fill('再解释一下');
 const topmost=locator=>locator.evaluate(el=>{const b=el.getBoundingClientRect();return el.contains(document.elementFromPoint(b.x+b.width/2,b.y+b.height/2));});
 await page.locator('.study-reader-viewport .reading-memory-links button').first().click();
 assert.ok(await topmost(page.locator('.reading-memory-panel:visible').first()),'clicking a saved source raises its existing window');
 assert.equal(await child.getByLabel('追问内容',{exact:true}).inputValue(),'再解释一下','background drafts survive switching');
 const childHead=await child.locator('.floating-panel-head').boundingBox();await page.mouse.click(childHead.x+childHead.width-3,childHead.y+12);
 assert.ok(await topmost(child),'clicking an exposed window brings it forward');
 const initialChild=await child.boundingBox();
 await child.getByRole('button',{name:'调整划线追问大小，可使用方向键',exact:true}).press('ArrowLeft');
 await child.getByRole('button',{name:'调整划线追问大小，可使用方向键',exact:true}).press('ArrowUp');
 assert.ok((await child.boundingBox()).width<initialChild.width,'window resizing works inside the answer canvas');
 const drag=await child.locator('.floating-panel-drag').boundingBox();await page.mouse.move(drag.x+50,drag.y+10);await page.mouse.down();await page.mouse.move(drag.x+60,drag.y+20,{steps:5});await page.mouse.up();
 const moved=await child.boundingBox();assert.ok(moved.x>initialChild.x&&moved.y>initialChild.y,'title drag moves a window inside the answer canvas');
 await child.getByRole('button',{name:'放大窗口',exact:true}).click();const maximized=await child.boundingBox(),workspace=await page.locator('.study-conversations').boundingBox();assert.ok(maximized.x>=workspace.x&&maximized.x+maximized.width<=workspace.x+workspace.width,'maximize stays beside the source');
 await child.getByRole('button',{name:'还原窗口',exact:true}).click();assert.equal((await child.boundingBox()).width,moved.width);
 await child.getByRole('button',{name:'发送追问',exact:true}).click();await child.locator('.reading-message--assistant').waitFor();assert.equal((await child.boundingBox()).width,moved.width,'first persistence must retain the resized geometry');
 await child.getByRole('button',{name:'收起窗口',exact:true}).click();assert.ok((await child.boundingBox()).height<60);
 await child.getByRole('button',{name:'展开窗口',exact:true}).click();
 await page.screenshot({path:'.build-cache/highlight-qa/stacked-answers.png'});
 assert.ok(threads.find(t=>t.id==='child').anchor.quoteMarkdown,'new math-aware quote persists alongside unchanged anchor offsets');
 page.on('dialog',d=>d.accept());await child.getByRole('button',{name:'删除对话及高光',exact:true}).click();await page.waitForFunction(()=>document.querySelectorAll('.reading-memory-panel:not([hidden])').length===1);assert.equal(threads.length,1);
 await page.setViewportSize({width:900,height:900});const tabletReader=await reader.boundingBox(),tabletAnswer=await panel.boundingBox();assert.ok(tabletReader.x+tabletReader.width<=tabletAnswer.x+1);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
 await page.setViewportSize({width:390,height:844});await page.screenshot({path:'.build-cache/highlight-qa/mobile.png'});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
 await panel.getByRole('button',{name:'关闭追问',exact:true}).click();await page.locator('.study-conversations-empty').waitFor();
 assert.deepEqual(errors,[]);console.log('PASS default split before asking, compact long filename, collapsed directories, pane toggle/reopen, continuous math highlights, split resizing, stacked independent threads, tablet/mobile');
} finally {await browser.close();}
