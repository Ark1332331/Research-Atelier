import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const {chromium}=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE??'C:/Users/pc/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/playwright/index.mjs').href);
const base=process.env.STUDY_TEST_URL??'http://localhost:3132',browser=await chromium.launch({channel:'msedge',headless:true});
const nodes=[{id:'book',parentId:null,kind:'library',name:'数学',order:0},{id:'fixture',parentId:'book',kind:'document',name:'条件期望.md',order:0}];
const content='# 条件期望\n\n设 X 和 Y 独立，请解释条件期望。',longAnswer=Array.from({length:45},(_,i)=>`第 ${i+1} 步：先明确条件，再完成推导。`).join('\n\n');let threads=[];
try{
 const page=await browser.newPage({viewport:{width:1440,height:950}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>{
  const real=window.fetch;window.testStreams=[];
  window.fetch=async(input,init)=>{
   const url=String(input),body=init?.body?JSON.parse(init.body):null;
   if((url==='/api/reading-memory'&&body?.action==='ask')||url==='/api/chat'&&body?.messages){
    const encoder=new TextEncoder();return new Response(new ReadableStream({start(controller){init.signal?.addEventListener('abort',()=>controller.error(init.signal.reason),{once:true});window.testStreams.push({body,accept:init.headers.Accept,push:event=>controller.enqueue(encoder.encode(JSON.stringify(event)+'\n')),close:()=>controller.close()});}}),{headers:{'Content-Type':'application/x-ndjson'}});
   }
   return real(input,init);
  };
 });
 await page.route('**/api/**',async r=>{
  const path=new URL(r.request().url()).pathname,body=r.request().method()==='POST'?r.request().postDataJSON():null;
  if(path==='/api/model-configs')return r.fulfill({json:{activeId:null,profiles:[],environment:{id:'environment',name:'环境默认',baseUrl:'https://example.invalid',model:'test-model',hasKey:true}}});
  if(path==='/api/study-library')return r.fulfill({json:{nodes}});
  if(path==='/api/study-library/document')return r.fulfill({json:{node:nodes[1],content,links:{}}});
  if(path==='/api/study-shortcuts')return r.fulfill({json:{revision:0,shortcuts:[]}});
  if(path==='/api/paper/pdf')return r.fulfill({contentType:'application/pdf',body:readFileSync('public/papers/nsr.pdf')});
  if(path==='/api/paper')return r.fulfill({json:{translation:content,pages:[{text:content}]}});
  if(path==='/api/vocabulary')return r.fulfill({json:{docId:'a'.repeat(64),entries:[]}});
  if(path==='/api/reading-memory'){
   if(body?.action==='create'){const thread={id:'thread-'+threads.length,anchor:body.anchor,messages:[]};threads.push(thread);return r.fulfill({json:{thread}});}
   return r.fulfill({json:{threads}});
  }
  return r.fulfill({json:{notes:[],entries:[],sessions:[],terms:[],projects:[]}});
 });
 await page.goto(base+'/study/fixture');await page.locator('.study-markdown p').waitFor();
 const anchor=await page.locator('[data-reading-source]').first().evaluate(el=>{const p=el.querySelector('p'),range=document.createRange();range.selectNodeContents(p);const before=document.createRange();before.selectNodeContents(el);before.setEnd(range.startContainer,range.startOffset);const start=before.toString().length;return {scope:'/study/fixture',sourceKey:el.dataset.readingSource,label:'条件期望',text:range.toString(),context:el.textContent,start,end:start+range.toString().length};});
 threads=[{id:'saved',anchor,messages:[{role:'user',content:'请逐步解释'},{role:'assistant',content:longAnswer}]}];await page.reload();
 const link=page.locator('.study-reader-viewport .reading-memory-links button').first();await link.click();const panel=page.locator('.reading-memory-panel:visible'),scroll=panel.locator('.reading-memory-scroll');
 assert.equal(await scroll.evaluate(el=>el.scrollTop),0,'opening saved answers begins at the start');
 await scroll.evaluate(el=>el.scrollTop=220);await panel.getByRole('button',{name:'关闭追问',exact:true}).click();await link.click();assert.equal(await scroll.evaluate(el=>el.scrollTop),220,'reopening preserves the reading position');
 await panel.getByLabel('追问内容',{exact:true}).fill('继续推导');await panel.getByRole('button',{name:'发送追问',exact:true}).click();await page.waitForFunction(()=>window.testStreams.length===1);
 assert.equal(await page.evaluate(()=>window.testStreams[0].accept),'application/x-ndjson');
 const waiting=panel.getByRole('status');
 assert.ok((await waiting.textContent()).includes('等待模型返回正文'));
 const questionBox=await panel.locator('[data-answer-start] .reading-message--user').boundingBox(),waitingBox=await waiting.boundingBox();
 assert.ok(waitingBox.y-questionBox.y-questionBox.height<80,'waiting status should be directly below the question, not below a full screen of blank space');
 assert.ok(await panel.getByRole('button',{name:'停止回答',exact:true}).isEnabled());
 await panel.getByRole('button',{name:'关闭追问',exact:true}).click();
 await page.evaluate(()=>window.testStreams[0].push({delta:'关闭窗口期间继续输出。'}));
 await link.click();await panel.locator('.is-provisional').filter({hasText:'关闭窗口期间继续输出'}).waitFor();
 const push=event=>page.evaluate(event=>window.testStreams[0].push(event),event);
 await push({text:'这是新回答的开头。\n\n'+longAnswer});await page.waitForFunction(()=>document.querySelector('.is-provisional')?.textContent.startsWith('这是新回答的开头'));
 assert.ok((await panel.locator('.is-provisional').textContent()).startsWith('这是新回答的开头'));
 const firstPosition=await scroll.evaluate(el=>el.scrollTop);await push({delta:'\n\n第二批内容。'+longAnswer});await page.waitForFunction(()=>document.querySelector('.is-provisional')?.textContent.includes('第二批内容'));
 assert.equal(await scroll.evaluate(el=>el.scrollTop),firstPosition,'incoming text must not skip the beginning');
 const box=await scroll.boundingBox();await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.wheel(0,-800);await page.waitForTimeout(250);
 const readingPosition=await scroll.evaluate(el=>el.scrollTop);await push({delta:'\n\n第三批内容。'+longAnswer});await page.waitForFunction(()=>document.querySelector('.is-provisional')?.textContent.includes('第三批内容'));
 assert.equal(await scroll.evaluate(el=>el.scrollTop),readingPosition,'upward reading must not be interrupted by output');
 await scroll.evaluate(el=>{el.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}));el.scrollTop=el.scrollHeight;});await page.waitForTimeout(80);
 await push({delta:'\n\n跟随测试。'+longAnswer});await page.waitForFunction(()=>document.querySelector('.is-provisional')?.textContent.includes('跟随测试'));
 assert.ok(await scroll.evaluate(el=>el.scrollHeight-el.scrollTop-el.clientHeight<35),'explicitly scrolling to the bottom enables following');
 await scroll.evaluate(el=>el.scrollTop=180);await page.waitForTimeout(80);
 const final='这是新回答的开头。\n\n'+longAnswer+'\n\n第二批内容。'+longAnswer+'\n\n第三批内容。'+longAnswer+'\n\n跟随测试。'+longAnswer;
 threads[0].messages.push({role:'user',content:'继续推导'},{role:'assistant',content:final});await push({done:true,result:{thread:threads[0]}});await panel.locator('.is-provisional').waitFor({state:'hidden'});
 assert.equal(await scroll.evaluate(el=>el.scrollTop),180,'completion must not force the viewport to the end');
 await panel.getByRole('button',{name:'关闭追问',exact:true}).click();await link.click();assert.equal(await scroll.evaluate(el=>el.scrollTop),180);
 await panel.getByLabel('追问内容',{exact:true}).fill('停止测试');await panel.getByRole('button',{name:'发送追问',exact:true}).click();await page.waitForFunction(()=>window.testStreams.length===2);
 await page.evaluate(()=>window.testStreams[1].push({delta:'这是一段尚未完成的回答。'}));await panel.locator('.is-provisional').waitFor();
 await panel.getByRole('button',{name:'停止回答',exact:true}).click();
 await panel.getByRole('alert').filter({hasText:'已停止'}).waitFor();
 assert.ok(await panel.getByRole('button',{name:'发送追问',exact:true}).isEnabled());
 assert.equal(await panel.getByLabel('追问内容',{exact:true}).inputValue(),'停止测试');
 assert.equal(threads[0].messages.length,4,'stopping must not commit a partial turn');
 await page.clock.install();
 await panel.getByLabel('追问内容',{exact:true}).fill('长回答测试');await panel.getByRole('button',{name:'发送追问',exact:true}).click();await page.waitForFunction(()=>window.testStreams.length===3);
 for(let i=0;i<4;i++){
  await page.clock.fastForward(60000);
  assert.ok(await panel.getByRole('button',{name:'停止回答',exact:true}).isVisible(),'continuing output must survive the old 150-second total limit');
  await page.evaluate(i=>window.testStreams[2].push({delta:`持续输出第 ${i} 段。`}),i);
  await panel.locator('.is-provisional').filter({hasText:`持续输出第 ${i} 段。`}).waitFor();
 }
 await page.clock.fastForward(120001);
 await panel.getByRole('alert').filter({hasText:'输出中断'}).waitFor();
 assert.ok((await panel.locator('.is-provisional').textContent()).includes('持续输出第 3 段。'),'timeout keeps partial text visible without committing it');
 await panel.getByLabel('追问内容',{exact:true}).fill('超时测试');await panel.getByRole('button',{name:'发送追问',exact:true}).click();await page.waitForFunction(()=>window.testStreams.length===4);
 await page.clock.fastForward(21000);
 assert.ok((await panel.getByRole('status').textContent()).includes('21 秒'));
 assert.ok((await panel.getByRole('status').textContent()).includes('尚未返回正文'));
 await page.clock.fastForward(190000);
 await panel.getByRole('alert').filter({hasText:'等待超时'}).waitFor();
 assert.ok(await panel.getByRole('button',{name:'发送追问',exact:true}).isEnabled());
 assert.equal(await panel.getByLabel('追问内容',{exact:true}).inputValue(),'超时测试');
 await page.clock.resume();
 await page.goto(base+'/read/notes-test?view=zh');await page.getByRole('button',{name:'AI 讲解',exact:true}).click();
 const chat=page.locator('.reader-chat');await chat.getByLabel('对话输入').fill('解释这篇论文');await chat.getByRole('button',{name:'发送',exact:true}).click();await page.waitForFunction(()=>window.testStreams.length===1);
 await push({delta:'先从定义讲起。\n\n'+longAnswer});await chat.locator('.msg-streaming .md-body').waitFor();assert.equal(await chat.locator('.msg-stream').evaluate(el=>el.scrollTop),0);
 await push({delta:'\n\n最后再总结。'});await page.waitForFunction(()=>document.querySelector('.msg-streaming')?.textContent.includes('最后再总结'));
 assert.equal(await chat.locator('.msg-stream').evaluate(el=>el.scrollTop),0,'main explanation also keeps the beginning visible');
 await push({done:true,result:{choices:[{message:{content:'先从定义讲起。\n\n'+longAnswer+'\n\n最后再总结。'}}]}});await chat.locator('.msg-streaming').waitFor({state:'hidden'});
 assert.equal(await chat.locator('.msg-stream').evaluate(el=>el.scrollTop),0);
 assert.deepEqual(errors,[]);console.log('PASS streaming, waiting status beside question, elapsed time, stop, timeout, retained drafts; open/reopen position, beginning-first reading, no scroll stealing, opt-in bottom following, stable completion');
}finally{await browser.close();}
