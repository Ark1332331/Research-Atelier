import {pathToFileURL} from 'node:url';
import {mkdir} from 'node:fs/promises';
import assert from 'node:assert/strict';
const base=process.env.STUDY_TEST_URL;
if(!base)throw Error('Set STUDY_TEST_URL to an isolated test server; this test creates study documents.');
const {chromium}=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE??'C:/Users/pc/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/playwright/index.mjs').href);
const browser=await chromium.launch({channel:'msedge',headless:true});
const name='粘贴验收 '+Date.now(),markdown='# 条件期望练习\n\n直接粘贴的中文、English 和 **重点**。\n\n$$\nE(X\\mid Y)=E(X)\n$$\n\n| 条件 | 说明 |\n| --- | --- |\n| 独立 | 分布不变 |\n\n```python\nprint("hello")\n```\n';
try{
 const page=await browser.newPage({viewport:{width:1280,height:960}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(base+'/?view=study');await page.getByRole('button',{name:'导入资料',exact:true}).click();const dialog=page.getByRole('dialog',{name:'导入学习资料'});
 await dialog.getByRole('button',{name:'粘贴 Markdown',exact:true}).click();const submit=dialog.getByRole('button',{name:'开始导入',exact:true});assert.ok(await submit.isDisabled());
 await dialog.getByLabel('Markdown 正文',{exact:true}).fill(markdown);assert.equal(await dialog.getByLabel('文档标题',{exact:true}).inputValue(),'条件期望练习');
 await dialog.getByLabel('文档标题',{exact:true}).fill('我自己的练习');await dialog.getByLabel('导入到',{exact:true}).selectOption('new');await dialog.getByLabel('资料库名称',{exact:true}).fill(name);
 await dialog.getByRole('button',{name:'文件 / 文件夹',exact:true}).click();await dialog.getByRole('button',{name:'粘贴 Markdown',exact:true}).click();assert.equal(await dialog.getByLabel('Markdown 正文',{exact:true}).inputValue(),markdown);
 let fail=true;await page.route('**/api/study-library/import',r=>fail?r.fulfill({status:503,json:{error:'模拟导入失败，请重试'}}):r.continue());
 await submit.click();await dialog.getByRole('alert').waitFor();assert.equal(await dialog.getByLabel('Markdown 正文',{exact:true}).inputValue(),markdown);assert.equal(await dialog.getByLabel('文档标题',{exact:true}).inputValue(),'我自己的练习');
 fail=false;await submit.click();await dialog.waitFor({state:'hidden'});await page.getByText('已导入 1 篇文档。',{exact:true}).waitFor();
 const nodes=(await(await page.request.get(base+'/api/study-library')).json()).nodes,library=nodes.find(n=>n.name===name),doc=nodes.find(n=>n.parentId===library.id&&n.name==='我自己的练习.md');assert.ok(doc);
 const saved=await(await page.request.get(base+'/api/study-library/document?id='+doc.id)).json();assert.equal(saved.content,markdown,'paste must preserve Markdown bytes, including TeX, whitespace and code');
 await page.getByRole('link',{name:'我自己的练习.md',exact:true}).click();await page.locator('.study-markdown .katex').waitFor();await page.locator('.study-markdown table').waitFor();assert.equal(await page.locator('.study-markdown pre code').textContent(),'print("hello")\n');
 await page.locator('.study-markdown p').first().evaluate(el=>{const range=document.createRange();range.selectNodeContents(el);const selection=window.getSelection();selection.removeAllRanges();selection.addRange(range);document.dispatchEvent(new Event('selectionchange'));});await page.getByRole('button',{name:'划线追问',exact:true}).waitFor();
 const folder=await(await page.request.post(base+'/api/study-library',{data:{action:'create',kind:'folder',name:'复习目录',parentId:library.id}})).json();
 await page.goto(base+'/?view=study&folder='+folder.createdId);await page.getByRole('button',{name:'导入到这里',exact:true}).click();await dialog.getByRole('button',{name:'粘贴 Markdown',exact:true}).click();assert.equal(await dialog.getByLabel('导入到',{exact:true}).inputValue(),folder.createdId);
 await dialog.getByLabel('Markdown 正文',{exact:true}).fill('不含标题的正文');assert.ok(await submit.isDisabled());await dialog.getByLabel('文档标题',{exact:true}).fill('第二篇');
 await page.setViewportSize({width:390,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await mkdir('.build-cache/study-paste',{recursive:true});await page.screenshot({path:'.build-cache/study-paste/mobile.png'});
 await submit.click();await dialog.waitFor({state:'hidden'});const after=(await(await page.request.get(base+'/api/study-library')).json()).nodes;assert.ok(after.some(n=>n.name==='第二篇.md'&&n.parentId===folder.createdId));
 assert.deepEqual(errors,[]);console.log('PASS pasted Markdown, automatic/editable title, mode-switch and error draft retention, exact persisted content, math/table/code, selection tools, selected folder, mobile');
}finally{await browser.close();}
