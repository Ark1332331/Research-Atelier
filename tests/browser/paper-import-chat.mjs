import {pathToFileURL} from 'node:url';
import {mkdir} from 'node:fs/promises';
import assert from 'node:assert/strict';

const {chromium}=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE??'C:/Users/pc/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/playwright/index.mjs').href);
const browser=await chromium.launch({channel:'msedge',headless:true});
const page=await browser.newPage({viewport:{width:1440,height:1000}});
page.setDefaultTimeout(15000);
const errors=[];page.on('pageerror',error=>errors.push(error.message));
let session=null,posts=[],reads=0,libraryReads=0,release;
const stamp=()=>new Date().toISOString();
const candidate=(candidateId,title)=>({id:candidateId,candidateId,title,authors:'A. Researcher',year:'2024',abstract:'',isOa:true,oaPdfUrl:'https://arxiv.org/pdf/2401.00001',publisherUrl:'https://example.org/paper',publisherName:'arXiv',automatic:true});
const item=(id,query,status,extra={})=>({id,query,status,candidates:[],updatedAt:stamp(),...extra});
const receipt=(slug,title,imported=true)=>({slug,title,imported,pages:8});
const annotatedList='请把以下 24 篇放入 UAV 分组：\n'+Array.from({length:24},(_,index)=>`${index+1}. UAV Paper ${index+1} — 2024：这是论文研究路线的原始说明，需要保留作上下文，但不能作为完整检索标题。`).join('\n');
const json=(route,data)=>route.fulfill({contentType:'application/json',body:JSON.stringify(data)});
async function parallelConversations(){
 const other=await browser.newPage({viewport:{width:1440,height:1000}});
 const sessions=new Map(),releases=new Map(),sent=[];let latest=null,changedReads=0;
 other.on('pageerror',error=>errors.push(error.message));
 await other.route('**/api/**',async route=>{
  const request=route.request(),url=new URL(request.url());
  if(url.pathname==='/api/projects'){changedReads++;return json(route,{projects:[],groups:[]});}
  if(url.pathname!=='/api/paper-import')return json(route,{papers:[],threads:[],entries:[],profiles:[],memories:[],runs:[],audit:[]});
  if(request.method()==='GET'){
   if(url.searchParams.has('list'))return json(route,{sessions:[...sessions.values()].map(value=>({id:value.id,title:value.messages[0]?.content||'新对话',busy:value.busy,updatedAt:value.updatedAt,itemCount:value.items.length}))});
   return json(route,{session:sessions.get(url.searchParams.get('sessionId')||latest)||null});
  }
  const body=request.postDataJSON();sent.push(body);
  if(body.action==='new'){
   const value={id:'parallel-'+sessions.size,messages:[],items:[],busy:false,updatedAt:stamp()};sessions.set(value.id,value);latest=value.id;
   return json(route,{session:value});
  }
  assert.equal(body.action,'message');
  const value=sessions.get(body.sessionId);value.busy=true;value.updatedAt=stamp();
  value.messages.push({id:'user-'+sent.length,role:'user',content:body.message,createdAt:stamp()});
  value.items=[item(value.id,body.message,'searching',{targetGroup:body.message==='第一批'?'视觉':'语言'})];
  await new Promise(resolve=>releases.set(value.id,resolve));
  value.busy=false;value.updatedAt=stamp();value.items[0]={...value.items[0],status:'imported',result:receipt(value.id,body.message)};
  return json(route,{session:value});
 });
 try{
  await other.goto(process.env.READER_TEST_URL??'http://localhost:3000');await other.getByRole('button',{name:'对话导入',exact:true}).click();
  const dialog=other.getByRole('dialog',{name:'对话导入',exact:true}),box=dialog.getByRole('textbox',{name:'导入需求'}),newChat=dialog.getByRole('button',{name:'新对话',exact:true});
  await box.fill('第一批');await box.press('Enter');await dialog.getByText('正在检索',{exact:true}).waitFor();
  assert.equal(await newChat.isEnabled(),true,'a busy import must allow a new conversation');
  assert.equal(await box.inputValue(),'','poll acknowledgement clears the accepted draft');
  await newChat.evaluate(button=>{button.click();button.click();});await dialog.getByText('把想读的论文交给我',{exact:true}).waitFor();
  assert.equal(sent.filter(body=>body.action==='new').length,2,'rapid new-chat clicks create only one new session');
  await box.fill('第二批');await box.press('Enter');await dialog.getByText('正在检索',{exact:true}).waitFor();
  await box.fill('第二批的新草稿');
  const before=changedReads;releases.get('parallel-0')();
  await dialog.getByRole('combobox',{name:'历史对话'}).locator('option[value="parallel-0"]').waitFor({state:'attached'});
  await other.waitForFunction(()=>document.querySelector('[aria-label="历史对话"] option[value="parallel-0"]')?.textContent.includes('已完成'));
  assert.equal(await dialog.getByRole('link',{name:'阅读 第一批'}).count(),0,'late old response cannot replace the selected conversation');
  assert.equal(await box.inputValue(),'第二批的新草稿','late old response cannot clear a new draft');
  assert.ok(changedReads>before,'background completion refreshes the library');
  assert.equal(await dialog.getByRole('button',{name:'正在处理…',exact:true}).isDisabled(),true,'old finally cannot unlock the second request');
  await box.press('Enter');assert.equal(sent.filter(body=>body.action==='message').length,2,'second request remains locked');
  await dialog.getByRole('combobox',{name:'历史对话'}).selectOption('parallel-0');
  await dialog.getByRole('link',{name:'阅读 第一批'}).waitFor();
  await dialog.getByRole('combobox',{name:'历史对话'}).selectOption('parallel-1');
  await dialog.getByText('正在检索',{exact:true}).waitFor();
  await box.fill('保留编辑后的草稿');releases.get('parallel-1')();
  await dialog.getByRole('link',{name:'阅读 第二批'}).waitFor();
  assert.equal(await box.inputValue(),'保留编辑后的草稿');
  console.log('PASS parallel import conversations: busy new chat, acknowledgement, background completion, generation isolation, independent locks, history switching');
 }finally{for(const done of releases.values())done();await other.close();}
}
await page.route('**/api/**',async route=>{
 const request=route.request(),url=new URL(request.url());
 if(url.pathname==='/api/projects'){libraryReads++;return json(route,{projects:[],groups:[]});}
 if(url.pathname!=='/api/paper-import')return json(route,{papers:[],threads:[],entries:[],profiles:[],memories:[],runs:[],audit:[]});
 if(request.method()==='GET'){reads++;if(url.searchParams.has('list'))return json(route,{sessions:session?[{id:session.id,title:session.messages[0]?.content||'新对话',busy:session.busy,updatedAt:session.updatedAt,itemCount:session.items.length}]:[]});return json(route,{session:url.searchParams.has('sessionId')&&url.searchParams.get('sessionId')!==session?.id?null:session});}
 const body=request.postDataJSON();posts.push(body);
 if(body.action==='new'){session={id:'import-'+posts.length,messages:[],items:[],busy:false,updatedAt:stamp()};return json(route,{session});}
 if(body.action==='message'){
  if(body.message==='reject before acceptance')return route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'服务暂不可用'})});
  session.messages.push({id:'message-'+posts.length,role:'user',content:body.message,createdAt:stamp()});
  if(body.message==='network failure'){session.error='连接中断，服务器已保留记录';return route.abort();}
  if(body.message==='继续处理'){session.error=undefined;session.messages.push({id:'continued',role:'assistant',content:'已继续处理。',createdAt:stamp()});return json(route,{session});}
  if(body.message==='重复导入第一篇'){session.items.push(item('duplicate','Attention Is All You Need','existing',{result:receipt('attention','Attention Is All You Need',false)}));return json(route,{session});}
  if(body.message===annotatedList){
   session.groups=['UAV','视觉'];session.busy=true;session.updatedAt=stamp();
   session.items=Array.from({length:24},(_,index)=>item('uav-'+index,'UAV Paper '+(index+1),index===0?'searching':'queued',{context:'2024：这是论文研究路线的原始说明',original:`${index+1}. UAV Paper ${index+1} — 2024：这是论文研究路线的原始说明`,targetGroup:index===1?'视觉':'UAV',sourceUrl:index===1?'https://example.org/original-source':undefined}));
   await new Promise(resolve=>{release=resolve;});
   session.busy=false;session.updatedAt=stamp();
   session.items=session.items.map(entry=>({...entry,status:'not_found',error:'没有找到可靠候选'}));
   session.items[0]={...session.items[0],status:'imported',error:undefined,result:receipt('uav-first','UAV Paper 1: A Complete Research Title'),groupError:'分组暂时写入失败'};
   session.items[1]={...session.items[1],status:'unavailable',error:'未找到开放 PDF',candidates:[{...candidate('uav-closed','UAV Paper 2'),automatic:false,oaPdfUrl:undefined}]};
   session.items[3]={...session.items[3],status:'unavailable'};
   return json(route,{session});
  }
  assert.match(body.requestId,/^[0-9a-f-]{36}$/i);assert.equal(body.sessionId,session.id);
  session.busy=true;
  session.items=[item('attention','Attention Is All You Need','importing'),item('ambiguous','World Model','searching')];
  await new Promise(resolve=>{release=resolve;});
  session.busy=false;session.updatedAt=stamp();
  session.items=[item('attention','Attention Is All You Need','imported',{result:receipt('attention','Attention Is All You Need')}),item('ambiguous','World Model','choice',{candidates:[{...candidate('world-a','World Models'),automatic:false,oaPdfUrl:undefined},candidate('world-b','A World Model')]}),item('failed','Diffusion Paper','failed',{error:'下载连接中断',selectedId:'diffusion-a',candidates:[candidate('diffusion-a','Diffusion Paper'),candidate('diffusion-b','Diffusion Alternative')]}),item('closed','Closed Paper','unavailable',{error:'未找到开放 PDF',selectedId:'closed-candidate',candidates:[{...candidate('closed-candidate','Closed Paper'),automatic:false,oaPdfUrl:undefined}]}),item('missing','Missing Paper','unavailable',{error:'没有找到可靠候选'})];
  session.messages.push({id:'answer',role:'assistant',content:'已导入一篇，请选择 World Model 的版本；另有下载失败和需要手动获取的论文。',createdAt:stamp()});
  return json(route,{session});
 }
 if(body.action==='choose'){
  if(body.candidateId==='world-a'){session.items[1]={...session.items[1],status:'unavailable',selectedId:'world-a',error:'所选论文无可下载 PDF'};return json(route,{session});}
  assert.equal(body.candidateId,'world-b');session.items[1]={...session.items[1],status:'imported',selectedId:'world-b',error:undefined,result:receipt('world','A World Model')};return json(route,{session});
 }
 if(body.action==='retry'){
  if(body.itemId==='uav-0'){session.items[0]={...session.items[0],groupError:undefined,result:{...session.items[0].result,group:'UAV'}};session.updatedAt=stamp();return json(route,{session});}
  if(body.itemId==='missing'){session.items[4]={...session.items[4],status:'imported',error:undefined,result:receipt('missing','Missing Paper')};return json(route,{session});}
  assert.equal(body.itemId,'failed');session.items[2]={...session.items[2],status:'imported',error:undefined,result:receipt('diffusion','Diffusion Paper')};return json(route,{session});
 }
 if(body.action==='retry_pending'){
  assert.equal(body.sessionId,session.id);
  session.items=session.items.map(entry=>entry.status==='not_found'||entry.status==='failed'||entry.status==='unavailable'&&!entry.candidates.length?{...entry,status:'imported',error:undefined,result:{...receipt(entry.id,entry.query),group:'UAV'}}:entry);
  session.updatedAt=stamp();return json(route,{session});
 }
 throw Error('Unexpected import request: '+JSON.stringify(body));
});
await mkdir('.build-cache/paper-import-verification',{recursive:true});
try{
 await parallelConversations();
 await page.goto(process.env.READER_TEST_URL??'http://localhost:3000');
 await page.getByRole('button',{name:'对话导入',exact:true}).click();
 const panel=page.getByRole('dialog',{name:'对话导入',exact:true});await panel.waitFor();
 const input=panel.getByRole('textbox',{name:'导入需求'});
 await input.fill('帮我导入 Attention Is All You Need、World Model、Diffusion Paper、Closed Paper 和 Missing Paper');
 await input.press('Enter');
 await panel.getByText('正在导入 PDF',{exact:true}).waitFor();
 assert.ok(reads>=2,'in-flight POST must poll its persisted session');
 await panel.getByRole('button',{name:'关闭对话导入',exact:true}).click();
 assert.equal(await panel.isVisible(),false);
 await page.getByRole('button',{name:'对话导入',exact:true}).click();
 assert.equal(posts.filter(body=>body.action==='message').length,1,'reopen must not replay submission');
 release();
 await panel.getByRole('link',{name:'阅读 Attention Is All You Need'}).waitFor();
 assert.ok(libraryReads>=2,'import receipt refreshes library');
 await panel.getByRole('button',{name:'导入 World Models',exact:true}).click();
 await panel.getByText('所选论文无可下载 PDF',{exact:true}).waitFor();
 assert.equal(await panel.getByRole('button',{name:'导入 A World Model',exact:true}).count(),0,'alternatives remain collapsed until requested');
 await panel.getByRole('button',{name:'重新选择 World Model',exact:true}).click();
 await panel.getByRole('button',{name:'导入 A World Model',exact:true}).click();
 await panel.getByRole('link',{name:'阅读 A World Model'}).waitFor();
 await panel.getByRole('button',{name:'重新选择 Diffusion Paper',exact:true}).click();
 await panel.getByRole('button',{name:'导入 Diffusion Alternative',exact:true}).waitFor();
 await panel.getByRole('button',{name:'重新选择 Diffusion Paper',exact:true}).click();
 await panel.getByRole('button',{name:'重试 Diffusion Paper',exact:true}).click();
 await panel.getByRole('link',{name:'阅读 Diffusion Paper'}).waitFor();
 await panel.getByRole('button',{name:'重新检索 Missing Paper',exact:true}).click();
 await panel.getByRole('link',{name:'阅读 Missing Paper'}).waitFor();
 assert.equal(await panel.getByRole('link',{name:'查看来源页面'}).getAttribute('href'),'https://example.org/paper');
 await input.fill('重复导入第一篇');await input.press('Enter');
 await panel.getByText('库中已有',{exact:true}).waitFor();
 await input.fill('reject before acceptance');await input.press('Enter');
 await panel.getByText('服务暂不可用',{exact:true}).waitFor();
 assert.equal(await input.inputValue(),'reject before acceptance','unaccepted message remains available to edit or resend');
 await input.fill('network failure');await input.press('Enter');
 await panel.getByRole('button',{name:'继续处理',exact:true}).waitFor();
 assert.equal(posts.filter(body=>body.message==='network failure').length,1);
 await panel.getByRole('button',{name:'继续处理',exact:true}).click();
 await panel.getByText('已继续处理。',{exact:true}).waitFor();
 await page.evaluate(()=>localStorage.setItem('paper-import-session','removed-session'));
 await page.reload();await page.getByRole('button',{name:'对话导入',exact:true}).click();
 await panel.getByRole('link',{name:'阅读 A World Model'}).waitFor();
 assert.equal(posts.filter(body=>body.action==='choose').length,2);
 assert.equal(posts.filter(body=>body.action==='retry').length,2);
 await page.setViewportSize({width:390,height:844});
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
 await panel.getByRole('textbox',{name:'导入需求'}).fill('下一批');
 await panel.getByRole('textbox',{name:'导入需求'}).press('Shift+Enter');
 assert.equal(await panel.getByRole('textbox',{name:'导入需求'}).inputValue(),'下一批\n');
 await page.screenshot({path:'.build-cache/paper-import-verification/mobile.png',fullPage:true});
 await panel.getByRole('button',{name:'新对话',exact:true}).click();
 await panel.getByRole('link',{name:'阅读 A World Model'}).waitFor({state:'hidden'});
 await input.fill(annotatedList);await input.press('Enter');
 await panel.locator('.paper-import-item[data-status="queued"]').first().waitFor();
 assert.equal(await panel.locator('.paper-import-item').count(),24,'all parsed papers appear immediately');
 await panel.getByText(/已处理 0 \/ 24/).waitFor();
 assert.equal(await input.inputValue(),'','accepted message clears while the long-running POST is still pending');
 assert.match(await panel.locator('.paper-import-composer').textContent(),/UAV/,'destination remains visible in the composer');
 assert.match(await panel.locator('.paper-import-composer').textContent(),/视觉/,'all destination groups remain visible in the composer');
 assert.match(await panel.locator('.paper-import-item').nth(1).textContent(),/目标分组：视觉/,'each pending item shows its own destination');
 const pastedMessage=panel.locator('.paper-import-message.is-user details');
 assert.equal(await pastedMessage.count(),1,'long annotated list is collapsed');
 assert.equal(await pastedMessage.getAttribute('open'),null);
 assert.equal(await panel.locator('.paper-import-item-head strong').first().textContent(),'UAV Paper 1');
 assert.equal(await panel.getByRole('button',{name:'重试未完成',exact:true}).count(),0,'bulk action waits for the current operation');
 release();
 await panel.getByRole('button',{name:'重试分组 UAV Paper 1',exact:true}).waitFor();
 const missingCard=panel.locator('.paper-import-item').nth(2),legacyMissingCard=panel.locator('.paper-import-item').nth(3);
 assert.equal(await missingCard.locator('.paper-import-status').textContent(),'未找到匹配论文');
 assert.equal(await legacyMissingCard.locator('.paper-import-status').textContent(),'未找到匹配论文','legacy empty candidate snapshots use the correct label');
 assert.equal(await panel.locator('.paper-import-item').nth(1).locator('.paper-import-status').textContent(),'暂无可用 PDF');
 assert.equal(await panel.locator('.paper-import-item').nth(1).getByRole('link',{name:'原始来源'}).getAttribute('href'),'https://example.org/original-source','no-PDF items keep a clickable original source');
 assert.doesNotMatch(await missingCard.textContent(),/从出版社获取 PDF/);
 assert.equal(await panel.locator('.paper-import-item-head strong').first().textContent(),'UAV Paper 1','matched full title does not replace the concise query');
 const firstCard=panel.locator('.paper-import-item').first();
 await firstCard.getByText('查看原始说明',{exact:true}).click();
 assert.ok(await firstCard.getByText('1. UAV Paper 1 — 2024：这是论文研究路线的原始说明',{exact:true}).isVisible());
 await panel.getByRole('button',{name:'重试分组 UAV Paper 1',exact:true}).click();
 await firstCard.getByText('已归入：UAV',{exact:true}).waitFor();
 await panel.getByRole('button',{name:'重试未完成',exact:true}).click();
 await panel.getByText(/已入库 23 \/ 24/).waitFor();
 assert.equal(posts.filter(body=>body.action==='retry_pending').length,1,'bulk retry is one mutation');
 assert.equal(await panel.getByRole('button',{name:'重试未完成',exact:true}).count(),0,'unavailable PDF does not keep the search retry action visible');
 await panel.locator('.floating-panel-content').evaluate(element=>{element.scrollTop=element.scrollHeight;});
 assert.ok(await panel.getByText(/已处理 24 \/ 24/).isVisible(),'progress remains visible while reviewing the queue');
 await page.screenshot({path:'.build-cache/paper-import-verification/uav-mobile.png',fullPage:true});
 assert.deepEqual(errors,[]);
 console.log('PASS import chat: natural batch, live progress, close/reopen without replay, partial success, candidate reselection, empty search retry, publisher fallback, existing receipt, network recovery, persistence, mobile, 24-item queue, collapsed notes, distinct no-match/no-PDF states, group repair, bulk retry, persistent progress (mocked APIs)');
}catch(error){await page.screenshot({path:'.build-cache/paper-import-verification/failure.png',fullPage:true});throw error;}
finally{release?.();await browser.close();}
