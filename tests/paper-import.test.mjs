import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('../src/', import.meta.url));
registerHooks({ resolve(specifier, context, next) {
  const base = specifier.startsWith('@/') ? path.join(root, specifier.slice(2))
    : specifier.startsWith('.') && context.parentURL ? fileURLToPath(new URL(specifier, context.parentURL)) : undefined;
  if (base && !path.extname(base)) {
    const file = [base + '.ts', path.join(base, 'index.ts')].find(existsSync);
    if (file) return {url:pathToFileURL(file).href,shortCircuit:true};
  }
  return next(specifier,context);
} });
const dir = await mkdtemp(path.join(os.tmpdir(), 'ra-paper-import-'));
const envBefore = Object.fromEntries(['RA_DATA_DIR','DEEPSEEK_API_KEY','VERCEL_KV_REST_API_URL','VERCEL_KV_REST_API_TOKEN'].map(key=>[key,process.env[key]]));
process.env.RA_DATA_DIR = dir;
delete process.env.DEEPSEEK_API_KEY;
delete process.env.VERCEL_KV_REST_API_URL;
delete process.env.VERCEL_KV_REST_API_TOKEN;
const fetchBefore = globalThis.fetch;
let unexpectedFetches = 0;
globalThis.fetch = async () => { unexpectedFetches++; throw Error('Network forbidden in isolated import tests'); };
const {newImportSession,readImportSession,sendImportMessage,actOnImportItem,retryPendingImports,ImportBusyError} = await import('../src/lib/paper-import.ts');
const {manageLearning} = await import('../src/lib/learning/store.ts');
await manageLearning({action:'settings',collecting:false,applying:false});
after(async () => {
  globalThis.fetch=fetchBefore;
  for(const [key,value] of Object.entries(envBefore)) { if(value===undefined)delete process.env[key];else process.env[key]=value; }
  await rm(dir,{recursive:true,force:true});
  assert.equal(unexpectedFetches,0,'all providers must be injected, without real network calls');
});

const paper = (title, extra={}) => ({id:'https://openalex.org/'+title.replace(/\W/g,''),title,authors:'Test Author',year:'2024',abstract:'Test abstract',isOa:true,oaPdfUrl:'https://papers.example.org/'+encodeURIComponent(title)+'.pdf',publisherUrl:'https://papers.example.org/article',publisherName:'Test Journal',...extra});
const tool = (id,name,args) => ({id,type:'function',function:{name,arguments:JSON.stringify(args)}});
const toolResults = messages => messages.filter(m=>m.role==='tool').map(m=>JSON.parse(m.content));
const downloaded = (options, extra={}) => ({slug:options.title.toLowerCase().replace(/\W+/g,'-'),title:options.title,pages:8,url:options.pdfUrl,imported:true,...extra});
const deferred = () => { let resolve; const promise=new Promise(done=>{resolve=done;}); return {promise,resolve}; };
const snapshot = async id => JSON.parse(await readFile(path.join(dir,'paper-import-chat.json'),'utf8')).find(s=>s.id===id);

function conversation(queries, {importCandidates=true,onTools}={}) {
  let round=0;
  return async messages => {
    round++;
    if(round===1)return {tool_calls:queries.map((query,i)=>tool('find-'+i,'find_papers',{query}))};
    if(round===2){
      const results=toolResults(messages);onTools?.(results);
      if(importCandidates)return {tool_calls:results.filter(r=>r.candidates?.length).map((r,i)=>tool('import-'+i,'import_paper',{candidateId:r.selectedId??r.candidates[0].candidateId}))};
    }
    return {content:'模型文字不会作为实际导入状态。'};
  };
}

test('multiquery tool workflow imports the exact paper while ambiguous candidates require a user choice',async()=>{
  const session=await newImportSession(),downloads=[],queries=[];
  const deps={
    search:async query=>{queries.push(query);return query==='Exact Paper'?[paper(query)]:[paper('Shared Title',{id:'candidate-a'}),paper('Shared Title',{id:'candidate-b'})];},
    download:async options=>{downloads.push(options);return downloaded(options);},
    model:conversation(['Exact Paper','Shared Title']),
  };
  const result=await sendImportMessage(session.id,'导入 Exact Paper 和 Shared Title','multi-query-request',deps);
  assert.deepEqual(queries,['Exact Paper','Shared Title']);
  assert.deepEqual(result.items.map(i=>i.status),['imported','choice']);
  assert.equal(downloads.length,1);
  const choice=result.items[1];
  assert.equal(choice.selectedId,undefined);
  assert.ok(choice.candidates.every(c=>!c.automatic));
  const confirmed=await actOnImportItem(session.id,choice.id,choice.candidates[1].candidateId,deps);
  assert.equal(confirmed.items[1].status,'imported');
  assert.equal(confirmed.items[1].selectedId,choice.candidates[1].candidateId);
  assert.equal(downloads.length,2);
  assert.equal(confirmed.busy,false);
});

test('server finishes ready exact matches even when the model stops after finding them',async()=>{
  const session=await newImportSession(),downloads=[];
  const result=await sendImportMessage(session.id,'导入 Ready Paper','server-drain-request',{
    search:async query=>[paper(query)],download:async options=>{downloads.push(options);return downloaded(options);},
    model:conversation(['Ready Paper'],{importCandidates:false}),
  });
  assert.equal(result.items[0].status,'imported');
  assert.equal(downloads.length,1);
});

test('partial download failure retains successes and one explicit retry targets only the failed paper',async()=>{
  const session=await newImportSession(),attempts=[];
  const deps={search:async query=>[paper(query)],model:conversation(['First Paper','Flaky Paper']),download:async options=>{
    attempts.push(options.title);
    if(options.title==='Flaky Paper'&&attempts.filter(t=>t===options.title).length===1)throw Error('temporary PDF failure');
    return downloaded(options);
  }};
  const first=await sendImportMessage(session.id,'导入 First Paper 和 Flaky Paper','partial-failure-request',deps);
  assert.deepEqual(first.items.map(i=>i.status),['imported','failed']);
  assert.match(first.items[1].error,/temporary PDF failure/);
  assert.deepEqual(attempts,['First Paper','Flaky Paper']);
  const retry=await actOnImportItem(session.id,first.items[1].id,undefined,deps);
  assert.deepEqual(retry.items.map(i=>i.status),['imported','imported']);
  assert.deepEqual(attempts,['First Paper','Flaky Paper','Flaky Paper']);
  assert.deepEqual(retry.items[0].result,first.items[0].result);
});

test('search failures can be retried without creating a duplicate item',async()=>{
  const session=await newImportSession();let searches=0,downloads=0;
  const deps={model:conversation(['Retry Search']),search:async query=>{if(++searches===1)throw Error('search offline');return [paper(query)];},download:async options=>{downloads++;return downloaded(options);}};
  const result=await sendImportMessage(session.id,'导入 Retry Search','search-retry-request',deps);
  assert.equal(result.items[0].status,'failed');
  assert.equal(downloads,0);
  const retry=await actOnImportItem(session.id,result.items[0].id,undefined,deps);
  assert.equal(retry.items.length,1);
  assert.equal(retry.items[0].id,result.items[0].id);
  assert.equal(retry.items[0].status,'imported');
  assert.equal(searches,2);assert.equal(downloads,1);
});

test('existing library results remain idempotent across user actions and later messages',async()=>{
  const session=await newImportSession();let downloads=0,searches=0;
  const deps={search:async query=>{searches++;return [paper(query)];},download:async options=>{downloads++;return downloaded(options,{slug:'already-present',imported:false});},model:conversation(['Existing Paper'])};
  const first=await sendImportMessage(session.id,'导入 Existing Paper','existing-first-request',deps);
  assert.equal(first.items[0].status,'existing');
  assert.equal(first.items[0].result.slug,'already-present');
  await actOnImportItem(session.id,first.items[0].id,first.items[0].selectedId,deps);
  const again=await sendImportMessage(session.id,'再导入 Existing Paper','existing-second-request',{...deps,model:conversation(['Existing Paper'])});
  assert.equal(again.items.length,1);assert.equal(again.items[0].status,'existing');
  assert.equal(downloads,1);assert.equal(searches,1);
});

test('duplicate request IDs reuse the in-flight result while a different concurrent request is busy',async()=>{
  const session=await newImportSession(),entered=deferred(),release=deferred();let modelCalls=0;
  const deps={search:async()=>{assert.fail('no search expected');},download:async()=>{assert.fail('no download expected');},model:async()=>{modelCalls++;entered.resolve();await release.promise;return {content:'done'};}};
  const first=sendImportMessage(session.id,'导入论文','concurrent-request-one',deps);
  await entered.promise;
  try{
    const duplicate=await sendImportMessage(session.id,'导入论文','concurrent-request-one',deps);
    assert.equal(duplicate.busy,true);assert.equal(duplicate.messages.length,1);
    await assert.rejects(sendImportMessage(session.id,'另一请求','concurrent-request-two',deps),ImportBusyError);
    assert.equal(modelCalls,1);
  }finally{release.resolve();await first;}
  const duplicate=await sendImportMessage(session.id,'导入论文','concurrent-request-one',deps);
  assert.equal(duplicate.busy,false);assert.equal(modelCalls,1);
  assert.equal(duplicate.messages.filter(m=>m.role==='user').length,1);
});

test('searching, importing, and completed progress are persisted while the request is still running',async()=>{
  const session=await newImportSession(),searchEntered=deferred(),searchRelease=deferred(),downloadEntered=deferred(),downloadRelease=deferred();
  const deps={model:conversation(['Progress Paper']),search:async query=>{searchEntered.resolve();await searchRelease.promise;return [paper(query)];},download:async options=>{downloadEntered.resolve();await downloadRelease.promise;return downloaded(options);}};
  const pending=sendImportMessage(session.id,'导入 Progress Paper','persist-progress-request',deps);
  await searchEntered.promise;
  try{
    const searching=await snapshot(session.id);assert.equal(searching.busy,true);assert.equal(searching.items[0].status,'searching');
    assert.equal((await readImportSession(session.id)).items[0].status,'searching');
    searchRelease.resolve();await downloadEntered.promise;
    const importing=await snapshot(session.id);assert.equal(importing.busy,true);assert.equal(importing.items[0].status,'importing');assert.equal(importing.items[0].result,undefined);
  }finally{searchRelease.resolve();downloadRelease.resolve();await pending;}
  const completed=await snapshot(session.id);assert.equal(completed.busy,false);assert.equal(completed.items[0].status,'imported');assert.equal(completed.items[0].result.pages,8);
});

test('a fabricated model success statement never becomes a reported import',async()=>{
  const session=await newImportSession();
  const result=await sendImportMessage(session.id,'导入一篇论文','fake-success-request',{
    search:async()=>assert.fail('no search expected'),download:async()=>assert.fail('no download expected'),model:async()=>({content:'已经成功导入 999 篇论文，slug=fabricated-paper'}),
  });
  assert.deepEqual(result.items,[]);
  assert.doesNotMatch(result.messages.at(-1).content,/999|fabricated-paper|成功导入/);
});

test('forged model candidate IDs and candidates from another item are rejected',async()=>{
  const session=await newImportSession();let rounds=0,downloadCalls=0,forgedError;
  const deps={search:async query=>[paper(query+' option A'),paper(query+' option B')],download:async options=>{downloadCalls++;return downloaded(options);},model:async messages=>{
    if(++rounds===1)return {tool_calls:[tool('forged','import_paper',{candidateId:'invented-id'}),tool('a','find_papers',{query:'Ambiguous A'}),tool('b','find_papers',{query:'Ambiguous B'})]};
    forgedError=toolResults(messages)[0].error;return {content:'done'};
  }};
  const result=await sendImportMessage(session.id,'导入 Ambiguous A 和 Ambiguous B','forged-candidate-request',deps);
  assert.match(forgedError,/实际查到/);assert.equal(downloadCalls,0);
  await assert.rejects(actOnImportItem(session.id,result.items[0].id,result.items[1].candidates[0].candidateId,deps),/候选不属于/);
  await assert.rejects(actOnImportItem(session.id,result.items[0].id,'invented-id',deps),/候选不属于/);
  assert.equal(downloadCalls,0);assert.equal((await readImportSession(session.id)).busy,false);
});

test('missing PDFs and empty searches have distinct statuses without download calls',async()=>{
  const session=await newImportSession();
  const result=await sendImportMessage(session.id,'导入 Closed Paper 和 Missing Paper','unavailable-paper-request',{
    search:async query=>query==='Closed Paper'?[paper(query,{isOa:false,oaPdfUrl:undefined})]:[],
    download:async()=>assert.fail('unavailable papers cannot download'),model:conversation(['Closed Paper','Missing Paper']),
  });
  assert.deepEqual(result.items.map(i=>i.status),['unavailable','not_found']);
  assert.ok(result.items.every(i=>!i.result));
});

test('an expired interrupted lease marks unfinished work failed and preserves completed results',async()=>{
  const session=await newImportSession();
  const entries=JSON.parse(await readFile(path.join(dir,'paper-import-chat.json'),'utf8'));
  const stored=entries.find(s=>s.id===session.id);
  stored.busy=true;stored.operationId='expired-operation';stored.leaseUntil=Date.now()-1000;
  stored.items=[{id:'done',query:'Done',status:'imported',candidates:[],result:{slug:'done',title:'Done',pages:2,imported:true},updatedAt:new Date().toISOString()},
    {id:'interrupted',query:'Interrupted',status:'importing',candidates:[],updatedAt:new Date().toISOString()}];
  await writeFile(path.join(dir,'paper-import-chat.json'),JSON.stringify(entries));
  const recovered=await readImportSession(session.id);
  assert.equal(recovered.busy,false);assert.equal(recovered.items[0].status,'imported');assert.equal(recovered.items[0].result.slug,'done');
  assert.equal(recovered.items[1].status,'failed');assert.match(recovered.items[1].error,/中断/);
  assert.equal((await snapshot(session.id)).busy,false);
});

test('repeated automatic tool calls cannot retry a failed download before an explicit user retry',async()=>{
  const session=await newImportSession();let round=0,attempts=0;
  const deps={
    search:async query=>[paper(query)],
    download:async options=>{if(++attempts===1)throw Error('transient download failure');return downloaded(options);},
    model:async messages=>{
      if(++round===1)return {tool_calls:[tool('find','find_papers',{query:'Retry Guard Paper'})]};
      if(round===2){
        const candidateId=toolResults(messages)[0].selectedId;
        return {tool_calls:[tool('first-import','import_paper',{candidateId}),tool('repeated-import','import_paper',{candidateId})]};
      }
      return {content:'done'};
    },
  };
  const result=await sendImportMessage(session.id,'导入 Retry Guard Paper','repeated-failure-request',deps);
  assert.equal(attempts,1,'a second model tool call must not retry a failed download');
  assert.equal(result.items[0].status,'failed');assert.equal(result.items[0].result,undefined);
  const retry=await actOnImportItem(session.id,result.items[0].id,undefined,deps);
  assert.equal(attempts,2);assert.equal(retry.items[0].status,'imported');
});

test('a model-expanded exact title cannot bypass an abbreviated user request and ambiguous search',async()=>{
  const session=await newImportSession();let round=0,downloads=0,importResponse;
  const exact=paper('Full Transformer Study'),other=paper('Another Transformer Study');
  const deps={
    search:async query=>query==='Transformer'?[exact,other]:[exact],
    download:async options=>{downloads++;return downloaded(options);},
    model:async messages=>{
      if(++round===1)return {tool_calls:[tool('abbreviation','find_papers',{query:'Transformer'})]};
      if(round===2)return {tool_calls:[tool('expanded-title','find_papers',{query:'Full Transformer Study'})]};
      if(round===3){
        const expanded=toolResults(messages).at(-1);
        return {tool_calls:[tool('bypass-attempt','import_paper',{candidateId:expanded.candidates[0].candidateId})]};
      }
      importResponse=toolResults(messages).at(-1);return {content:'done'};
    },
  };
  const result=await sendImportMessage(session.id,'帮我导入 Transformer 那篇论文','abbreviated-title-request',deps);
  assert.equal(downloads,0,'the model cannot authorize its own guessed full title');
  assert.equal(importResponse.needsChoice,true);
  assert.ok(result.items.every(i=>i.status==='choice'&&!i.result));
  const item=result.items.find(i=>i.query==='Full Transformer Study')??result.items[0];
  const candidate=item.candidates.find(c=>c.title==='Full Transformer Study');
  assert.equal(candidate.automatic,false);
  const confirmed=await actOnImportItem(session.id,item.id,candidate.candidateId,deps);
  assert.equal(downloads,1);assert.equal(confirmed.items.find(i=>i.id===item.id).status,'imported');
});

test('structured clarification is persisted and a later user-provided exact title resumes the import',async()=>{
  const session=await newImportSession();let round=0,downloads=0;
  const first=await sendImportMessage(session.id,'导入那篇 Transformer 论文','clarification-first-request',{
    search:async()=>assert.fail('clarification alone does not search'),
    download:async()=>assert.fail('clarification alone does not download'),
    model:async()=>++round===1?{tool_calls:[tool('clarify','ask_for_paper_details',{fields:['title','author','year','identifier'],reference:'Transformer 论文'})]}:{content:'虚构已导入 999 篇'},
  });
  assert.deepEqual(first.items,[]);assert.equal(first.busy,false);
  const clarification=first.messages.at(-1).content;
  assert.match(clarification,/Transformer/);
  assert.match(clarification,/标题/);assert.match(clarification,/作者/);assert.match(clarification,/年份/);assert.match(clarification,/DOI|arXiv/);
  assert.doesNotMatch(clarification,/999|虚构已导入/);
  assert.equal((await snapshot(session.id)).messages.at(-1).content,clarification);
  const resumed=await sendImportMessage(session.id,'完整标题是 Full Transformer Study，请导入','clarification-second-request',{
    search:async query=>[paper(query)],download:async options=>{downloads++;return downloaded(options);},model:conversation(['Full Transformer Study']),
  });
  assert.equal(downloads,1);assert.equal(resumed.items[0].status,'imported');
  assert.equal(resumed.messages.filter(m=>m.role==='user').length,2);
  assert.ok(resumed.messages.some(m=>m.role==='assistant'&&m.content===clarification));
});

test('a 31-query batch persists a visible limit notice while retaining the first 30 results',async()=>{
  const session=await newImportSession(),queries=Array.from({length:31},(_,i)=>'Batch Paper '+(i+1)),searched=[];
  const result=await sendImportMessage(session.id,'请导入以下论文：\n'+queries.join('\n'),'query-limit-request',{
    search:async query=>{searched.push(query);return [];},
    download:async()=>assert.fail('empty search results cannot download'),
    model:conversation(queries,{importCandidates:false}),
  });
  assert.deepEqual(searched,queries.slice(0,30));
  assert.equal(result.items.length,30);assert.ok(result.items.every(i=>i.status==='not_found'));
  assert.equal(result.busy,false);
  assert.match(result.error,/30/);assert.match(result.error,/继续|下一批/);
  assert.match(result.messages.at(-1).content,/30/);assert.match(result.messages.at(-1).content,/继续|下一批/);
  assert.equal((await snapshot(session.id)).error,result.error);
});

test('after selecting an unavailable candidate the user can choose another candidate and import it',async()=>{
  const session=await newImportSession(),downloads=[];
  const deps={
    search:async()=>[paper('Closed Candidate',{id:'closed',isOa:false,oaPdfUrl:undefined}),paper('Available Candidate',{id:'available'})],
    download:async options=>{downloads.push(options.title);return downloaded(options);},
    model:conversation(['Requested Study']),
  };
  const found=await sendImportMessage(session.id,'帮我导入 Requested Study','alternate-candidate-request',deps);
  const item=found.items[0];assert.equal(item.status,'choice');assert.equal(downloads.length,0);
  const unavailable=await actOnImportItem(session.id,item.id,item.candidates[0].candidateId,deps);
  assert.equal(unavailable.items[0].status,'unavailable');assert.equal(unavailable.items[0].result,undefined);
  assert.equal(unavailable.items[0].candidates.length,2);assert.equal(downloads.length,0);
  const imported=await actOnImportItem(session.id,item.id,item.candidates[1].candidateId,deps);
  assert.equal(imported.items[0].status,'imported');assert.equal(imported.items[0].result.title,'Available Candidate');
  assert.equal(imported.items[0].selectedId,item.candidates[1].candidateId);
  assert.deepEqual(downloads,['Available Candidate']);assert.equal(imported.busy,false);
});

test('a model-chosen DOI cannot resolve same-title ambiguity without the user supplying that identifier',async()=>{
  const session=await newImportSession();let round=0,downloads=0,importResponse;
  const first=paper('Shared Study Title',{id:'same-title-a',doi:'10.1234/shared-a'});
  const second=paper('Shared Study Title',{id:'same-title-b',doi:'10.1234/shared-b'});
  const result=await sendImportMessage(session.id,'请导入 Shared Study Title','same-title-doi-request',{
    search:async query=>query==='Shared Study Title'?[first,second]:[first],
    download:async options=>{downloads++;return downloaded(options);},
    model:async messages=>{
      if(++round===1)return {tool_calls:[tool('ambiguous-title','find_papers',{query:'Shared Study Title'})]};
      if(round===2)return {tool_calls:[tool('model-picked-doi','find_papers',{query:'10.1234/shared-a'})]};
      if(round===3){
        const candidateId=toolResults(messages).at(-1).candidates[0].candidateId;
        return {tool_calls:[tool('import-picked-doi','import_paper',{candidateId})]};
      }
      importResponse=toolResults(messages).at(-1);return {content:'done'};
    },
  });
  assert.equal(downloads,0,'a DOI chosen by the model does not disambiguate the user’s title');
  assert.equal(importResponse.needsChoice,true);
  assert.ok(result.items.every(item=>item.status==='choice'&&!item.result));
  assert.ok(result.items.every(item=>item.candidates.every(candidate=>!candidate.automatic)));
});

test('an explicit user arxiv version cannot authorize a different version through versioned or base queries',async()=>{
  for(const query of ['1706.03762v7','1706.03762']){
    const session=await newImportSession();let downloads=0;
    const result=await sendImportMessage(session.id,'请导入 arXiv:1706.03762v6','arxiv-version-request-'+query.replace(/\W/g,'-'),{
      search:async()=>[paper('Attention Is All You Need',{id:'https://arxiv.org/abs/1706.03762v7',arxivId:'1706.03762v7',oaPdfUrl:'https://arxiv.org/pdf/1706.03762v7'})],
      download:async options=>{downloads++;return downloaded(options);},
      model:conversation([query]),
    });
    assert.equal(downloads,0,`query ${query} must not authorize version 7 for a version 6 request`);
    assert.equal(result.items[0].status,'choice');assert.equal(result.items[0].result,undefined);
    assert.equal(result.items[0].candidates[0].automatic,false);
  }
});

test('annotated numbered batch persists every queued paper, searches names only, and assigns the requested group',{timeout:5000},async()=>{
  const s=await newImportSession(),entered=deferred(),release=deferred(),queries=[],groups=[];
  const running=sendImportMessage(s.id,'1.DroneFINE 目标检测和VLM微调 2.SkyReg 像素级匹配 3.MissingFly 找不到原文，都导入进UAV文件夹','annotated-batch-request',{
    preprocess:async()=>({action:'import',targetGroup:'UAV',items:[{name:'DroneFINE',context:'目标检测和VLM微调',original:'DroneFINE 目标检测和VLM微调'},{name:'SkyReg',context:'像素级匹配',original:'SkyReg 像素级匹配'},{name:'MissingFly',context:'找不到原文',original:'MissingFly 找不到原文'}]}),
    model:async()=>{throw Error('A numbered list must not depend on an LLM issuing every tool call');},
    search:async q=>{queries.push(q);if(q==='DroneFINE'){entered.resolve();await release.promise;}return q==='MissingFly'?[]:[paper(q+': UAV Navigation Study')];},
    download:async o=>downloaded(o),assignGroup:async(slug,group)=>{groups.push({slug,group});},
  });
  await entered.promise;
  const progress=await snapshot(s.id);assert.equal(progress.items.length,3);assert.equal(progress.items[2].status,'queued');assert.equal(progress.targetGroup,'UAV');
  release.resolve();const result=await running;
  assert.deepEqual([...queries].sort(),['DroneFINE','SkyReg','MissingFly'].sort());
  assert.deepEqual(result.items.map(i=>i.status),['imported','imported','not_found']);
  assert.equal(groups.length,2);assert.ok(groups.every(g=>g.group==='UAV'));
  assert.equal(result.items[0].result.group,'UAV');assert.match(result.items[0].context,/目标检测/);
});

test('mixed tool query is normalized and group failure retries assignment without downloading the PDF again',async()=>{
  const s=await newImportSession();let downloads=0,assigns=0;
  const deps={preprocess:async()=>({action:'import',targetGroup:'UAV',items:[{name:'DroneFINE',context:'目标检测论文',original:'DroneFINE 目标检测论文'}]}),search:async q=>{assert.equal(q,'DroneFINE');return [paper('DroneFINE: Detection for Drones')];},model:conversation(['DroneFINE 无人机 目标检测 VLM']),download:async o=>{downloads++;return downloaded(o);},assignGroup:async()=>{if(++assigns===1)throw Error('group unavailable');}};
  const result=await sendImportMessage(s.id,'导入 DroneFINE 目标检测论文，放到「UAV」分组','group-repair-request',deps);
  assert.equal(result.items[0].status,'imported');assert.ok(result.items[0].result);assert.match(result.items[0].groupError,/group unavailable/);
  const repaired=await actOnImportItem(s.id,result.items[0].id,undefined,deps);
  assert.equal(downloads,1);assert.equal(assigns,2);assert.equal(repaired.items[0].result.group,'UAV');assert.equal(repaired.items[0].groupError,undefined);
});

test('bulk retry repairs legacy mixed queries, fills omitted list entries and retains successful receipts',async()=>{
  const s=await newImportSession();
  const all=JSON.parse(await readFile(path.join(dir,'paper-import-chat.json'),'utf8'));
  const stored=all.find(x=>x.id===s.id);
  stored.messages=[{id:'original-request',role:'user',content:'1.DroneFINE 目标检测 2.SkyReg 像素匹配 3.WorldVLN 预测未来，都导入进UAV文件夹',createdAt:new Date().toISOString()}];
  stored.items=[{id:'old-failure',query:'DroneFINE 目标检测 VLM',status:'unavailable',candidates:[],updatedAt:new Date().toISOString()},{id:'done',query:'SkyReg',status:'imported',candidates:[],result:{slug:'skyreg',title:'SkyReg',pages:10,imported:true,group:'UAV'},updatedAt:new Date().toISOString()}];
  await writeFile(path.join(dir,'paper-import-chat.json'),JSON.stringify(all));
  const queries=[],downloads=[];
  const result=await retryPendingImports(s.id,{preprocess:async()=>({action:'import',targetGroup:'UAV',items:['DroneFINE','SkyReg','WorldVLN'].map(name=>({name,context:'',original:name}))}),model:async()=>{throw Error('no further model needed');},search:async q=>{queries.push(q);return [paper(q+': A UAV Study')];},download:async o=>{downloads.push(o.title);return downloaded(o);},assignGroup:async()=>{}});
  assert.deepEqual([...queries].sort(),['DroneFINE','WorldVLN']);assert.equal(downloads.length,2);assert.equal(result.items.length,3);
  assert.equal(result.items.find(i=>i.id==='done').result.slug,'skyreg');assert.ok(result.items.every(i=>i.status==='imported'&&i.result.group==='UAV'));
});

test('AI-prepared distinct titles sharing a prefix remain separate queue items',async()=>{
  const s=await newImportSession(),names=['World Models for Autonomous Driving','World Models'];
  const result=await sendImportMessage(s.id,'导入 World Models for Autonomous Driving 和 World Models','prefix-queue-request',{
    preprocess:async()=>({action:'import',items:names.map(name=>({name,context:'',original:name}))}),
    search:async()=>[],download:async()=>{throw Error('no PDF expected');},model:async()=>({}),
  });
  assert.deepEqual(result.items.map(i=>i.query),names);
});

test('a continuation group instruction reaches existing pending items',async()=>{
  const s=await newImportSession(),groups=[];
  const deps={search:async()=>[],download:async o=>downloaded(o),model:async()=>({}),assignGroup:async(slug,group)=>{groups.push(group);},preprocess:async()=>({action:'import',items:[{name:'DroneFINE',context:'',original:'DroneFINE'}]})};
  await sendImportMessage(s.id,'导入 DroneFINE','pending-no-group-request',deps);
  deps.preprocess=async()=>({action:'continue',items:[],targetGroup:'UAV'});deps.search=async()=>[paper('DroneFINE: UAV detection')];
  const result=await sendImportMessage(s.id,'继续处理，放到 UAV 文件夹','continue-group-request',deps);
  assert.equal(result.items[0].targetGroup,'UAV');assert.equal(result.items[0].result.group,'UAV');assert.deepEqual(groups,['UAV']);
});

test('linked table creates all groups before resolving sources and assigns each PDF to its row group',async()=>{
  const {normalizeImportRequest}=await import('../src/lib/paper-import-request.ts');
  const text=await readFile(new URL('./fixtures/paper-import-table.txt',import.meta.url),'utf8');
  const names=[...text.matchAll(/^\|\s*\[([^\]]+)\]\(/gm)].map(m=>m[1]);
  const request=normalizeImportRequest({action:'import',items:names.map(name=>({name,context:'',original:name}))},text);
  const s=await newImportSession(),created=[],resolved=[],assigned=[];
  const result=await sendImportMessage(s.id,text,'table-source-groups-request',{
    preprocess:async()=>request,model:async()=>({}),
    createGroup:async group=>{created.push(group);},
    resolveSource:async(url,name)=>{assert.equal(created.length,3);resolved.push(url);return [paper('Full title of '+name)];},
    search:async()=>assert.fail('explicit links must work without an index'),
    download:async o=>downloaded(o),assignGroup:async(slug,group)=>{assigned.push(group);},
  });
  assert.equal(result.error,undefined);assert.equal(result.items.length,16);assert.equal(resolved.length,16);
  assert.deepEqual(created,request.groups);assert.deepEqual(result.groups,request.groups);
  assert.deepEqual(created.map(group=>assigned.filter(x=>x===group).length),[5,5,6]);
  assert.ok(result.items.every(i=>i.status==='imported'&&i.result.group===i.targetGroup&&i.sourceUrl));
});

test('source errors, product pages and ambiguous linked papers remain distinct while groups still exist',async()=>{
  const s=await newImportSession(),created=[];
  const names=['Broken','Product','Several'];
  const result=await sendImportMessage(s.id,names.join(' '),'source-outcomes-request',{
    preprocess:async()=>({action:'import',groups:['Requested group'],items:names.map(name=>({name,original:name,context:'',sourceUrl:'https://example.org/'+name,targetGroup:'Requested group'}))}),
    createGroup:async g=>{created.push(g);},model:async()=>({}),search:async()=>assert.fail('no unrelated search'),download:async()=>assert.fail('no downloadable selection'),
    resolveSource:async(url,name)=>{if(name==='Broken')throw Error('Source HTTP 404');if(name==='Product')return [paper('Product documentation',{oaPdfUrl:undefined})];return [paper('First study'),paper('Second study')];},
  });
  assert.deepEqual(created,['Requested group']);assert.deepEqual(result.items.map(i=>i.status),['failed','unavailable','choice']);
  assert.ok(result.items.every(i=>!i.result));assert.match(result.items[0].error,/404/);
});

test('new sessions can complete while an older session is busy and history preserves both',async()=>{
  const {listImportSessions}=await import('../src/lib/paper-import.ts');
  const old=await newImportSession(),entered=deferred(),release=deferred();
  const deps={preprocess:async()=>({action:'import',items:[{name:'Old Study',original:'Old Study',context:''}]}),model:async()=>({}),search:async()=>{entered.resolve();await release.promise;return [];},download:async()=>assert.fail('no PDF')};
  const pending=sendImportMessage(old.id,'Old Study','old-concurrent-request',deps);
  try{
    await entered.promise;const fresh=await newImportSession();
    const done=await sendImportMessage(fresh.id,'New Study','new-concurrent-request',{...deps,preprocess:async()=>({action:'import',items:[{name:'New Study',original:'New Study',context:''}]}),search:async()=>[]});
    assert.equal(done.busy,false);
    const history=await listImportSessions();assert.equal(history.find(s=>s.id===old.id).busy,true);assert.equal(history.find(s=>s.id===fresh.id).title,'New Study');
  }finally{release.resolve();await pending;}
  assert.equal((await readImportSession(old.id)).busy,false);
});

test('a slow source does not block other queued papers and bulk concurrency stays bounded',async()=>{
  const s=await newImportSession(),release=deferred(),progress=deferred();let active=0,maximum=0,completed=0;
  const names=Array.from({length:6},(_,i)=>'Concurrent Paper '+i);
  const pending=sendImportMessage(s.id,names.join('\n'),'bounded-batch-request',{
    preprocess:async()=>({action:'import',items:names.map(name=>({name,context:'',original:name}))}),model:async()=>({}),download:async o=>downloaded(o),
    search:async name=>{active++;maximum=Math.max(active,maximum);if(name===names[0])await release.promise;active--;if(++completed===3)progress.resolve();return [];},
  });
  try{await Promise.race([progress.promise,new Promise((_,reject)=>setTimeout(()=>reject(Error('slow first item blocked the queue')),1500))]);assert.ok(maximum<=3);}
  finally{release.resolve();await pending;}
  assert.equal(completed,6);
});

test('retrying an unavailable linked source resolves it again when a PDF becomes available',async()=>{
  const s=await newImportSession();let attempts=0;
  const deps={model:async()=>({}),preprocess:async()=>({action:'import',items:[{name:'Study',context:'',original:'Study',sourceUrl:'https://example.org/study'}]}),search:async()=>assert.fail('no index'),resolveSource:async()=>[paper('Study',{oaPdfUrl:++attempts===1?undefined:'https://example.org/paper.pdf'})],download:async o=>downloaded(o)};
  const first=await sendImportMessage(s.id,'Study','source-recheck-request',deps);assert.equal(first.items[0].status,'unavailable');
  const result=await actOnImportItem(s.id,first.items[0].id,undefined,deps);assert.equal(result.items[0].status,'imported');assert.equal(attempts,2);
});
