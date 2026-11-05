import {pathToFileURL} from 'node:url';
import {mkdir} from 'node:fs/promises';
import assert from 'node:assert/strict';
const {chromium}=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE??'C:/Users/pc/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/playwright/index.mjs').href);
const browser=await chromium.launch({channel:'msedge',headless:true});
const formula=String.raw`补集与结果：

$$\overline A\cap\overline B=\overline{A\cup B}$$

$$\boxed{P(AB)=0.4,\qquad P(\overline A\,\overline B)=0.3}$$

$$\underline{X+Y}\quad\frac{1}{2}\quad\sqrt{x^2+1}$$

$$\begin{array}{c|cc}X&0&1\\\hline P&0.4&0.6\end{array}$$`;
const node={id:'math-css-fixture',parentId:null,kind:'document',name:'公式回归.md',order:0};let threads=[];
try{
 const page=await browser.newPage({viewport:{width:1440,height:1000}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/api/**',r=>{
  const p=new URL(r.request().url()).pathname;
  if(p==='/api/model-configs')return r.fulfill({json:{activeId:null,profiles:[],environment:{model:'mock',hasKey:true}}});
  if(p==='/api/study-library')return r.fulfill({json:{nodes:[node]}});
  if(p==='/api/study-library/document')return r.fulfill({json:{node,content:'# 数学公式\n\n'+formula,links:{}}});
  if(p==='/api/reading-memory')return r.fulfill({json:{threads}});
  if(p==='/api/study-shortcuts')return r.fulfill({json:{revision:0,shortcuts:[]}});
  return r.fulfill({json:{entries:[],notes:[]}});
 });
 await page.goto((process.env.STUDY_TEST_URL??'http://localhost:3000')+'/study/'+node.id);
 await page.locator('.study-markdown .katex').first().waitFor();
 const anchor=await page.locator('[data-reading-source]').first().evaluate(el=>{const p=el.querySelector('p'),r=document.createRange(),before=document.createRange();r.selectNodeContents(p);before.selectNodeContents(el);before.setEnd(r.startContainer,r.startOffset);return {scope:location.pathname,sourceKey:el.dataset.readingSource,label:'公式回归',text:r.toString(),context:el.textContent,start:before.toString().length,end:before.toString().length+r.toString().length};});
 const answer=formula.replace(/\$\$([^\n]*)\$\$/g,(_match,tex)=>'\\[\n'+tex+'\n\\]');
 threads=[{id:'math-thread',anchor,messages:[{role:'user',content:'解释补集概率'},{role:'assistant',content:answer}]}];
 await page.reload();await page.locator('.study-reader-viewport .reading-memory-links button').click();
 await page.locator('.reading-memory-panel .katex').first().waitFor();await page.evaluate(()=>document.fonts.ready);
 await mkdir('.build-cache/math-rendering',{recursive:true});
 await page.screenshot({path:'.build-cache/math-rendering/'+(process.env.MATH_BASELINE?'before':'after')+'.png'});
 for(const selector of ['.study-markdown','.reading-memory-panel .reading-message--assistant']){
  const result=await page.locator(selector).evaluate(root=>{
   const lines=[...root.querySelectorAll('.overline-line,.underline-line,.hline')].map(el=>{const b=el.getBoundingClientRect(),s=getComputedStyle(el);return {width:b.width,height:b.height,border:parseFloat(s.borderBottomWidth),style:s.borderBottomStyle};});
   const box=root.querySelector('.fbox'),bounds=box.getBoundingClientRect();
   return {lines,box:{width:bounds.width,height:bounds.height},errors:root.querySelectorAll('.katex-error').length};
  });
  console.log(selector,JSON.stringify(result));
  assert.equal(result.errors,0);assert.ok(result.lines.length>=7);
  assert.ok(result.lines.every(l=>l.width>3&&l.height>=.5&&l.border>0&&l.style==='solid'),'complement/underline/table lines must have visible width and border');
  assert.ok(result.box.width>180&&result.box.height>20,'boxed answer must wrap the whole equation instead of collapsing to a vertical stroke');
 }
 assert.deepEqual(errors,[]);console.log('PASS source and saved AI answer: complement bars, boxed equations, underlines, fractions, roots and table rules');
}finally{await browser.close();}
