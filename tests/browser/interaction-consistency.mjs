import {readFileSync,mkdirSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
const {chromium}=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const browser=await chromium.launch({channel:'msedge',headless:true});
const page=await browser.newPage({viewport:{width:1440,height:1000}});
page.setDefaultTimeout(15000);
const base=process.env.READER_TEST_URL||'http://localhost:3000';
const errors=[];page.on('pageerror',e=>errors.push(e.message));
const project=(id,title,slug)=>({id,title,paperSlug:slug,pdfAvailable:!!slug,reproState:{current:'已记录研究进展'},notes:[],history:[],environmentRefs:[],executionSessions:[],aiMessages:[]});
let projects=[project('one','第一篇论文','paper-one'),project('legacy','旧版研究笔记')],chatCalls=0;
const threads=[];
let failDelete=false,holdProjectRead=false,heldProjectRead;
const json=(route,data,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(data)});
await page.route('**/api/**',async route=>{
  const request=route.request(),url=new URL(request.url());
  const body=request.method()==='POST'&&request.headers()['content-type']?.includes('application/json')?request.postDataJSON():null;
  if(url.pathname==='/api/projects'){
    if(body){const p=projects.find(p=>p.id===body.id);
      if(body.action==='rename'){p.title=body.title.trim();return json(route,{project:p});}
      if(body.action==='delete'){if(failDelete)return json(route,{error:'文件占用，请稍后重试'},400);projects=projects.filter(p=>p.id!==body.id);return json(route,{ok:true});}
      if(body.action==='create')throw Error('Empty project creation must not be used');
      return json(route,{project:p});
    }
    if(url.searchParams.has('id')){const p=projects.find(p=>p.id===url.searchParams.get('id'));if(holdProjectRead){holdProjectRead=false;heldProjectRead={route,data:structuredClone({project:p})};return;}return json(route,p?{project:p}:{error:'论文项目已删除或不存在'},p?200:404);}
    return json(route,{projects,groups:[]});
  }
  if(url.pathname==='/api/paper'){
    if(request.method()==='POST'&&!body){const p=project('imported','导入的论文','paper-imported');projects.push(p);return json(route,{project:p,meta:{slug:p.paperSlug,title:p.title}});}
    if(body?.action==='rename'){projects.find(p=>p.paperSlug===body.slug).title=body.title.trim();return json(route,{title:body.title.trim()});}
    if(body?.action==='delete'){projects=projects.filter(p=>p.paperSlug!==body.slug);return json(route,{ok:true});}
    if(url.searchParams.has('slug'))return json(route,{translation:'这是论文译文。收益的基线需要结合原文理解。',pages:[]});
    return json(route,{papers:projects.filter(p=>p.paperSlug).map(p=>({slug:p.paperSlug,title:p.title,pages:8,projectId:p.id}))});
  }
  if(url.pathname==='/api/paper/pdf')return route.fulfill({status:200,contentType:'application/pdf',body:readFileSync('public/papers/nsr.pdf')});
  if(url.pathname==='/api/vocabulary')return json(route,{docId:'a'.repeat(64),entries:[]});
  if(url.pathname==='/api/terms')return json(route,{terms:[]});
  if(url.pathname==='/api/reading-collection')return json(route,{entries:[]});
  if(url.pathname==='/api/reading-memory'){
    if(!body)return json(route,{threads});
    if(body.action==='create'){const thread={id:'memory-one',anchor:body.anchor,messages:[],createdAt:new Date().toISOString()};threads.push(thread);return json(route,{thread});}
    if(body.action==='ask'){const thread=threads[0];thread.messages.push({role:'user',content:body.question},{role:'assistant',content:'这是参考基线的解释。'});return json(route,{thread});}
  }
  if(url.pathname==='/api/chat'){chatCalls++;return json(route,{choices:[{message:{content:'参考基线表示比较起点。公式为 $R=\\frac{a}{b}$。'}}]});}
  if(url.pathname==='/api/session-history')return json(route,{sessions:[],id:'saved-chat'});
  return json(route,{});
});
const rename=async(name)=>{await page.getByRole('dialog').getByRole('textbox').fill(name);await page.getByRole('button',{name:'保存名称',exact:true}).click();};
mkdirSync('.build-cache/interaction-verification',{recursive:true});
try{
  await page.goto(base);
  await page.getByRole('heading',{name:'我的论文库'}).waitFor();
  await page.getByText('旧记录 · 待补充 PDF').waitFor();
  assert.equal(await page.getByRole('button',{name:'创建项目',exact:true}).count(),0);
  await page.getByRole('button',{name:'重命名《第一篇论文》',exact:true}).click();await rename('统一后的论文名称');
  await page.getByRole('button',{name:'重命名《统一后的论文名称》',exact:true}).waitFor();
  await page.getByRole('searchbox',{name:'搜索论文'}).fill('统一后');assert.equal(await page.locator('.v1-project-card').count(),1);
  await page.getByRole('link',{name:'阅读 PDF'}).click();await page.locator('.full-reader-title').filter({hasText:'统一后的论文名称'}).waitFor();
  assert.match(page.url(),/project=one/);
  await page.getByRole('button',{name:'重命名《统一后的论文名称》'}).click();await rename('阅读器修改的名称');
  await page.getByRole('link',{name:'返回论文项目'}).click();await page.getByRole('heading',{name:'阅读器修改的名称'}).waitFor();
  await page.reload();await page.getByRole('heading',{name:'阅读器修改的名称'}).waitFor();assert.match(page.url(),/project=one/);
  holdProjectRead=true;await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
  for(let i=0;i<50&&!heldProjectRead;i++)await new Promise(r=>setTimeout(r,10));assert.ok(heldProjectRead);
  await page.getByRole('button',{name:'重命名《阅读器修改的名称》'}).click();await rename('项目修改的新名称');
  await page.getByRole('heading',{name:'项目修改的新名称'}).waitFor();await json(heldProjectRead.route,heldProjectRead.data);await page.waitForTimeout(100);
  await page.getByRole('heading',{name:'项目修改的新名称'}).waitFor();
  await page.getByRole('link',{name:'阅读论文'}).click();await page.getByRole('button',{name:'AI 讲解',exact:true}).click();
  const chat=page.locator('.reader-chat');await chat.waitFor();
  const input=chat.getByRole('textbox',{name:'对话输入'});await input.fill('尚未发送的草稿');
  await input.dispatchEvent('keydown',{key:'Enter',code:'Enter',isComposing:true});assert.equal(chatCalls,0);
  await chat.getByRole('button',{name:'关闭 AI 讲解'}).click();await chat.waitFor({state:'hidden'});
  await page.getByRole('button',{name:'AI 讲解',exact:true}).click();assert.equal(await input.inputValue(),'尚未发送的草稿');
  await chat.getByRole('button',{name:'发送',exact:true}).click();await chat.locator('.katex').waitFor();assert.equal(chatCalls,1);
  const handle=chat.locator('.floating-panel-drag');let box=await handle.boundingBox();
  await page.mouse.move(box.x+50,box.y+16);await page.mouse.down();await page.mouse.move(10,10,{steps:8});await page.mouse.up();
  box=await chat.boundingBox();assert.ok(box.x>=8&&box.y>=8&&box.x<100);
  const grip=chat.locator('.floating-panel-resize');const g=await grip.boundingBox();
  await page.mouse.move(g.x+10,g.y+10);await page.mouse.down();await page.mouse.move(g.x+130,g.y-150,{steps:8});await page.mouse.up();
  const resized=await chat.boundingBox();assert.ok(resized.width>box.width&&resized.height<box.height);
  await chat.getByRole('button',{name:'收起窗口'}).click();assert.ok((await chat.boundingBox()).height<100);
  await chat.getByRole('button',{name:'展开窗口'}).click();await chat.locator('.katex').waitFor();
  await chat.getByRole('button',{name:'放大窗口',exact:true}).click();box=await chat.boundingBox();assert.equal(box.width,1424);assert.equal(box.height,984);
  await chat.getByRole('button',{name:'还原窗口'}).click();assert.equal((await chat.boundingBox()).width,resized.width);
  await chat.getByRole('button',{name:'重置窗口位置'}).click();box=await chat.boundingBox();assert.equal(box.width,560);
  // Opening a follow-up raises it. Escape dismisses only this top window.
  await page.evaluate(()=>{const el=document.querySelector('.reader-chat .md-body p');const range=document.createRange();range.selectNodeContents(el);const sel=window.getSelection();sel.removeAllRanges();sel.addRange(range);el.dispatchEvent(new MouseEvent('mouseup',{bubbles:true}));});
  await page.getByRole('toolbar',{name:'回答选区操作'}).waitFor();await page.getByRole('button',{name:'划线追问',exact:true}).click();
  const memory=page.locator('.reading-memory-panel');await memory.waitFor();
  await page.getByRole('textbox',{name:'追问内容'}).fill('解释基线');await page.getByRole('button',{name:'关闭追问'}).click();
  await page.evaluate(()=>{const el=document.querySelector('.reader-chat .md-body p');const range=document.createRange();range.selectNodeContents(el);const sel=window.getSelection();sel.removeAllRanges();sel.addRange(range);el.dispatchEvent(new MouseEvent('mouseup',{bubbles:true}));});
  await page.getByRole('toolbar',{name:'回答选区操作'}).waitFor();await page.getByRole('button',{name:'划线追问',exact:true}).click();
  assert.equal(await page.getByRole('textbox',{name:'追问内容'}).inputValue(),'解释基线');
  await input.focus();assert.ok(await chat.evaluate(el=>Number(el.style.zIndex))>await memory.evaluate(el=>Number(el.style.zIndex)));
  await page.getByRole('textbox',{name:'追问内容'}).focus();assert.ok(await memory.evaluate(el=>Number(el.style.zIndex))>await chat.evaluate(el=>Number(el.style.zIndex)));
  await page.getByRole('button',{name:'发送追问'}).click();await memory.locator('.reading-message--assistant').waitFor();
  await page.keyboard.press('Escape');await memory.waitFor({state:'hidden'});assert.ok(await chat.isVisible());
  await page.setViewportSize({width:390,height:844});await page.waitForTimeout(150);box=await chat.boundingBox();assert.ok(box.x>=0&&box.y>=0&&box.x+box.width<=390&&box.y+box.height<=844);
  await page.screenshot({path:'.build-cache/interaction-verification/mobile-chat.png'});
  await page.setViewportSize({width:1440,height:1000});await chat.getByRole('button',{name:'关闭 AI 讲解'}).click();
  await page.getByRole('link',{name:'返回论文项目'}).click();await page.getByRole('button',{name:'返回论文库',exact:false}).click();
  await page.locator('input[type=file]').setInputFiles({name:'test.pdf',mimeType:'application/pdf',buffer:readFileSync('public/papers/nsr.pdf')});
  await page.getByRole('heading',{name:'导入的论文'}).waitFor();assert.match(page.url(),/project=imported/);
  await page.getByRole('button',{name:'删除《导入的论文》'}).click();failDelete=true;await page.getByRole('button',{name:'确认删除'}).click();await page.getByRole('alert').filter({hasText:'文件占用'}).waitFor();
  assert.ok(projects.some(p=>p.id==='imported'));failDelete=false;await page.getByRole('button',{name:'确认删除'}).click();await page.getByRole('heading',{name:'我的论文库'}).waitFor();
  assert.equal(await page.getByRole('button',{name:'删除《导入的论文》'}).count(),0);
  await page.screenshot({path:'.build-cache/interaction-verification/library.png'});
  await page.goto(base+'/?project=deleted');await page.getByRole('alert').filter({hasText:'已删除或不存在'}).waitFor();
  assert.deepEqual(errors,[]);
  console.log('PASS rename across library/project/reader, URL return/reload, import, deletion failure/retry, legacy records, drag, resize, collapse, maximize, reset, draft retention, IME, topmost Escape, mobile bounds (mocked APIs)');
}catch(e){console.error((await page.locator('body').innerText()).slice(0,5000),errors);await page.screenshot({path:'.build-cache/interaction-verification/failure.png'});throw e;}finally{await browser.close();}
