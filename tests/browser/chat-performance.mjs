import {pathToFileURL} from 'node:url';
import {mkdir,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const {chromium}=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE??'C:/Users/pc/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/playwright/index.mjs').href);
const base=process.env.STUDY_TEST_URL??'http://localhost:3000',baseline=process.env.PERF_BASELINE==='1';
const browser=await chromium.launch({channel:'msedge',headless:true});
let threads=[];
try{
 const page=await browser.newPage({viewport:{width:1440,height:950}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>{
  window.perfStats={selectionAdds:0,selectionListeners:new Set(),highlightTargets:new Set()};
  const add=document.addEventListener.bind(document),remove=document.removeEventListener.bind(document);
  document.addEventListener=(name,fn,opts)=>{if(name==='selectionchange'){window.perfStats.selectionAdds++;window.perfStats.selectionListeners.add(fn);}return add(name,fn,opts);};
  document.removeEventListener=(name,fn,opts)=>{if(name==='selectionchange')window.perfStats.selectionListeners.delete(fn);return remove(name,fn,opts);};
  const RO=window.ResizeObserver;
  window.ResizeObserver=class extends RO{targets=new Set();observe(el,opts){if(el.hasAttribute('data-reading-source')){this.targets.add(el);window.perfStats.highlightTargets.add(el);}return super.observe(el,opts);}disconnect(){for(const el of this.targets)window.perfStats.highlightTargets.delete(el);this.targets.clear();return super.disconnect();}};
 });
 const node={id:'perf-fixture',parentId:null,kind:'document',name:'性能验证.md',order:0};
 await page.route('**/api/**',r=>{
  const p=new URL(r.request().url()).pathname;
  if(p==='/api/model-configs')return r.fulfill({json:{activeId:null,profiles:[],environment:{model:'fixture',hasKey:true}}});
  if(p==='/api/study-library')return r.fulfill({json:{nodes:[node]}});
  if(p==='/api/study-library/document')return r.fulfill({json:{node,content:'# 测试\n\n解释条件期望。',links:{}}});
  if(p==='/api/reading-memory')return r.fulfill({json:{threads}});
  if(p==='/api/study-shortcuts')return r.fulfill({json:{revision:0,shortcuts:[]}});
  return r.fulfill({json:{notes:[],entries:[]}});
 });
 await page.goto(base+'/study/perf-fixture');await page.locator('.study-markdown p').waitFor();
 const anchor=await page.locator('[data-reading-source]').first().evaluate(el=>{const p=el.querySelector('p'),range=document.createRange(),before=document.createRange();range.selectNodeContents(p);before.selectNodeContents(el);before.setEnd(range.startContainer,range.startOffset);return {scope:'/study/perf-fixture',sourceKey:el.dataset.readingSource,label:'性能验证',text:range.toString(),context:el.textContent,start:before.toString().length,end:before.toString().length+range.toString().length};});
 const answer=Array.from({length:8},(_,i)=>`第 ${i+1} 步：固定条件后积分。\n\n$$ E(X \\mid Y=y)=\\int_{-\\infty}^{\\infty}x f(x\\mid y)\\,dx $$`).join('\n\n');
 threads=[{id:'many-turns',anchor,messages:Array.from({length:24},(_,i)=>({role:i%2?'assistant':'user',content:i%2?answer:`解释第 ${i/2+1} 个条件`}))}];
 await page.reload();const link=page.locator('.study-reader-viewport .reading-memory-links button').first();await link.click();
 const panel=page.locator('.reading-memory-panel:visible');await panel.locator('.reading-message--assistant').last().waitFor();
 await page.waitForTimeout(250);
 const open=await page.evaluate(()=>({selectionListeners:window.perfStats.selectionListeners.size,highlightObservers:window.perfStats.highlightTargets.size}));
 await page.evaluate(()=>window.perfStats.selectionAdds=0);
 const input=panel.getByLabel('追问内容',{exact:true}),start=performance.now();await input.pressSequentially('Explain the next step in detail');
 const typingMs=Math.round(performance.now()-start);await page.waitForTimeout(150);
 const listenerRebinds=await page.evaluate(()=>window.perfStats.selectionAdds);
 await panel.locator('.reading-memory-scroll').evaluate(el=>el.scrollTop=250);
 await panel.getByRole('button',{name:'关闭追问',exact:true}).click();await page.waitForTimeout(150);
 const closed=await page.evaluate(()=>({selectionListeners:window.perfStats.selectionListeners.size,highlightObservers:window.perfStats.highlightTargets.size}));
 await link.click();assert.equal(await input.inputValue(),'Explain the next step in detail');
 assert.equal(await panel.locator('.reading-memory-scroll').evaluate(el=>el.scrollTop),250);
 const metrics={turns:12,formulas:96,typingMs,listenerRebinds,open,closed};
 await mkdir('.build-cache/chat-performance',{recursive:true});await writeFile(`.build-cache/chat-performance/${baseline?'before':'after'}.json`,JSON.stringify(metrics,null,2));console.log(JSON.stringify(metrics));
 if(!baseline){assert.equal(listenerRebinds,0,'typing must not rerender and rebind historical reading surfaces');assert.equal(open.highlightObservers,1,'only the annotated source needs geometry observers');assert.ok(closed.selectionListeners<open.selectionListeners,'closed history must release global selection listeners');}
 assert.deepEqual(errors,[]);
}finally{await browser.close();}
