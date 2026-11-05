"use client";

import {useCallback,useEffect,useRef,useState} from 'react';
import Link from 'next/link';
import FloatingPanel from './floating-panel';
import Markdown from './markdown';
import {announcePaperChange} from '@/lib/paper-events';
import type {ImportItem,ImportSession,ImportStatus,ImportSessionSummary} from '@/lib/paper-import-types';

const SESSION_KEY='paper-import-session';
const labels:Record<ImportStatus,string>={queued:'等待检索',searching:'正在检索',choice:'请选择论文',ready:'等待导入',importing:'正在导入 PDF',imported:'已导入',existing:'库中已有',not_found:'未找到匹配论文',unavailable:'暂无可用 PDF',failed:'处理失败'};
const example='帮我导入 Attention Is All You Need、BERT 和 2020 年的 DDPM，能直接获取的先导入。';
type Reply={session?:ImportSession|null;error?:string};
type Operation={message?:string;previousMessages:Set<string>;acknowledged?:boolean};
const notFound=(item:ImportItem)=>item.status==='not_found'||item.status==='unavailable'&&!item.candidates.length;

function publisherLink(value:string|undefined) {
  if(!value)return undefined;
  try {const url=new URL(value);return ['https:','http:'].includes(url.protocol)?url.href:undefined;}catch{return undefined;}
}

export default function PaperImportChat({open,onClose}:{open:boolean;onClose:()=>void}) {
  const [session,setSession]=useState<ImportSession|null>(null);
  const [draft,setDraft]=useState(''),[pending,setPending]=useState(false),[loading,setLoading]=useState(true),[error,setError]=useState('');
  const [candidateItems,setCandidateItems]=useState<string[]>([]);
  const [history,setHistory]=useState<ImportSessionSummary[]>([]),[creating,setCreating]=useState(false);
  const [selection,setSelection]=useState('');
  const current=useRef<ImportSession|null>(null),mounted=useRef(true),generation=useRef(0),readVersion=useRef(0),historyVersion=useRef(0),creatingRef=useRef(false),selectedId=useRef<string|undefined>(undefined);
  const operations=useRef(new Map<string,Operation>());
  const receipts=useRef(new Set<string>());

  const announceReceipts=useCallback((next:ImportSession|null)=>{
    let changed=false;
    for(const item of next?.items??[]) {
      if(!item.result||!['imported','existing'].includes(item.status))continue;
      const key=`${next!.id}:${item.id}:${item.result.slug}:${item.result.group??''}`;
      if(!receipts.current.has(key)){receipts.current.add(key);changed=true;}
    }
    if(changed)announcePaperChange();
  },[]);

  const refreshHistory=useCallback(async()=>{
    const version=++historyVersion.current;
    try{
      const response=await fetch('/api/paper-import?list=1',{cache:'no-store'});
      const data:{sessions?:ImportSessionSummary[]}=await response.json();
      if(response.ok&&mounted.current&&version===historyVersion.current&&Array.isArray(data.sessions))setHistory(data.sessions);
    }catch{/* A temporary history failure must not interrupt an active import. */}
  },[]);

  const accept=useCallback((next:ImportSession|null)=>{
    if(next&&current.current?.id===next.id&&next.updatedAt<current.current.updatedAt)return;
    current.current=next;selectedId.current=next?.id;setSelection(next?.id??'');setSession(next);
    setPending(Boolean(next&&operations.current.has(next.id)));
    try {if(next)localStorage.setItem(SESSION_KEY,next.id);else localStorage.removeItem(SESSION_KEY);}catch{/* Server also keeps the latest conversation. */}
    if(next){
      const operation=operations.current.get(next.id);
      if(operation?.message&&!operation.acknowledged&&next.messages.some(message=>message.role==='user'&&message.content===operation.message&&!operation.previousMessages.has(message.id))){
        operation.acknowledged=true;
        setDraft(value=>value.trim()===operation.message?'':value);
      }
      const summary={id:next.id,title:next.messages.find(message=>message.role==='user')?.content.slice(0,80)||'新对话',updatedAt:next.updatedAt,busy:next.busy,itemCount:next.items.length};
      setHistory(values=>[summary,...values.filter(value=>value.id!==next.id)]);
    }
    announceReceipts(next);
  },[announceReceipts]);

  const refresh=useCallback(async()=>{
    if(creatingRef.current)return;
    const epoch=generation.current,version=++readVersion.current;
    let id=selectedId.current??current.current?.id;
    if(!id)try{id=localStorage.getItem(SESSION_KEY)??undefined;}catch{}
    try {
      let response=await fetch(`/api/paper-import${id?`?sessionId=${encodeURIComponent(id)}`:''}`,{cache:'no-store'});
      if(response.status===404&&id)response=await fetch('/api/paper-import',{cache:'no-store'});
      let data:Reply=await response.json();
      if(response.ok&&!data.session&&id) {
        response=await fetch('/api/paper-import',{cache:'no-store'});
        data=await response.json();
      }
      if(!mounted.current||epoch!==generation.current||version!==readVersion.current)return;
      if(!response.ok)throw Error(data.error||'暂时无法读取导入进度。');
      accept(data.session??null);
    }catch(reason){
      if(mounted.current&&epoch===generation.current&&version===readVersion.current)setError(reason instanceof Error?reason.message:'读取导入进度失败，请稍后重新打开窗口。');
    }finally{
      if(mounted.current&&epoch===generation.current&&version===readVersion.current)setLoading(false);
    }
  },[accept]);

  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
  useEffect(()=>{
    if(!open)return;
    let cancelled=false;
    queueMicrotask(()=>{if(!cancelled){void refresh();void refreshHistory();}});
    return()=>{cancelled=true;};
  },[open,refresh,refreshHistory]);
  useEffect(()=>{
    if(!pending&&!session?.busy)return;
    const timer=setInterval(()=>{void refresh();},1500);
    return()=>clearInterval(timer);
  },[pending,session?.busy,refresh]);

  async function post(body:Record<string,unknown>,epoch:number) {
    const response=await fetch('/api/paper-import',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    const data:Reply=await response.json();
    // A background conversation still changes the library, but never the active view.
    if(data.session)announceReceipts(data.session);
    if(!mounted.current||epoch!==generation.current)return null;
    // Discard GETs started before this authoritative mutation response.
    readVersion.current++;
    if(data.session)accept(data.session);
    if(!response.ok)throw Error(data.error||'这次处理未完成，请查看已保存的进度。');
    if(!data.session)throw Error('服务器未返回对话记录，请重新打开窗口查看进度。');
    return data.session;
  }

  async function act(action:'message'|'choose'|'retry'|'retry_pending'|'new',details:Record<string,string>={}) {
    if(creatingRef.current||loading)return;
    if(action!=='new'&&(current.current?.busy||current.current&&operations.current.has(current.current.id)))return;
    const isNew=action==='new';
    if(isNew)generation.current++;
    const epoch=generation.current;
    const operation:Operation={message:action==='message'?details.message:undefined,previousMessages:new Set(current.current?.messages.map(message=>message.id)??[])};
    let operationSession:string|undefined;
    setError('');
    readVersion.current++;
    try {
      let active=current.current;
      if(isNew||!active) {
        creatingRef.current=true;setCreating(true);setLoading(true);
        active=await post({action:'new'},epoch);
        creatingRef.current=false;
        if(mounted.current&&epoch===generation.current){setCreating(false);setLoading(false);setCandidateItems([]);if(isNew)setDraft('');}
        if(isNew)return;
      }
      if(!active||!mounted.current||epoch!==generation.current)return;
      operationSession=active.id;operations.current.set(active.id,operation);setPending(true);
      await post({action,sessionId:active.id,...details,...(action==='message'?{requestId:crypto.randomUUID()}:{})},epoch);
    }catch(reason){
      if(mounted.current&&epoch===generation.current){
        creatingRef.current=false;setCreating(false);
        setError(reason instanceof Error?reason.message:'连接中断，正在恢复已保存的进度。请勿重复发送。');
        // A lost response can still mean the server accepted the operation.
        // Recover its snapshot; never replay the mutation automatically.
        await refresh();
      }
    }finally{
      if(operationSession&&operations.current.get(operationSession)===operation)operations.current.delete(operationSession);
      if(mounted.current){
        setPending(Boolean(current.current&&operations.current.has(current.current.id)));
        if(epoch===generation.current)setLoading(false);
        else if(operationSession===selectedId.current)void refresh();
        void refreshHistory();
      }
    }
  }

  function switchSession(id:string){
    if(creatingRef.current||id===selectedId.current)return;
    generation.current++;readVersion.current++;selectedId.current=id;current.current=null;
    setSession(null);setSelection(id);setDraft('');setCandidateItems([]);setError('');setLoading(true);setPending(operations.current.has(id));
    void refresh();void refreshHistory();
  }

  function send(message=draft) {
    const content=message.trim();
    if(!content||creatingRef.current||current.current&&operations.current.has(current.current.id)||session?.busy||loading)return;
    void act('message',{message:content});
  }

  const busy=pending||Boolean(session?.busy),disabled=busy||loading;
  const problems=error||session?.error;
  const items=session?.items??[];
  const targetGroups=Array.from(new Set([...(session?.groups??[]),session?.targetGroup,...items.map(item=>item.targetGroup)].filter((group):group is string=>Boolean(group))));
  const complete=items.filter(item=>item.status==='imported'||item.status==='existing').length;
  const waiting=items.filter(item=>['queued','searching','ready','importing'].includes(item.status)).length;
  const processed=items.length-waiting;
  const retryPending=!busy&&items.some(item=>notFound(item)||item.status==='failed'||item.groupError);
  const showContinue=!busy&&Boolean(problems||waiting);

  function renderItem(item:ImportItem) {
    const selected=item.candidates.find(candidate=>candidate.candidateId===item.selectedId)??item.candidates[0];
    const publisher=publisherLink(selected?.publisherUrl);
    const source=publisherLink(item.sourceUrl);
    const canReselect=!item.result&&['unavailable','failed'].includes(item.status)&&item.candidates.some(candidate=>candidate.candidateId!==item.selectedId);
    const expanded=candidateItems.includes(item.id);
    const showCandidates=item.status==='choice'||canReselect&&expanded;
    const context=item.original||item.context;
    const matchedTitle=item.result?.title||selected?.title;
    return <article className="paper-import-item" data-status={item.status} key={item.id}>
      <div className="paper-import-item-head"><strong>{item.query}</strong><span className="paper-import-status">{notFound(item)?labels.not_found:labels[item.status]}</span></div>
      {matchedTitle&&matchedTitle!==item.query&&<p>匹配论文：{matchedTitle}</p>}
      {context&&context!==item.query&&<details className="paper-import-context"><summary>查看原始说明</summary><p style={{whiteSpace:'pre-wrap'}}>{context}</p></details>}
      {item.error&&<p className="paper-import-error">{item.error}</p>}
      {item.groupError&&<p className="paper-import-error">{item.groupError}</p>}
      {item.targetGroup&&item.targetGroup!==item.result?.group&&<p>目标分组：{item.targetGroup}</p>}
      {item.result?.group&&<p>已归入：{item.result.group}</p>}
      {source&&<p><a href={source} target="_blank" rel="noreferrer">原始来源 ↗</a></p>}
      {item.result&&item.groupError&&<button type="button" className="btn btn--ghost" disabled={disabled} aria-label={`重试分组 ${item.query}`} onClick={()=>void act('retry',{itemId:item.id})}>重试归入{item.targetGroup?` ${item.targetGroup}`:'分组'}</button>}
      {item.result&&['imported','existing'].includes(item.status)&&<Link className="text-button" href={`/read/${encodeURIComponent(item.result.slug)}`} aria-label={`阅读 ${item.result.title}`}>阅读论文 →</Link>}
      {canReselect&&<button type="button" className="btn btn--ghost" disabled={disabled} aria-label={`重新选择 ${item.query}`} aria-expanded={expanded} aria-controls={`paper-import-candidates-${item.id}`} onClick={()=>setCandidateItems(current=>current.includes(item.id)?current.filter(id=>id!==item.id):[...current,item.id])}>{expanded?'收起候选论文':'重新选择论文'}</button>}
      {showCandidates&&<div className="paper-import-candidates" id={`paper-import-candidates-${item.id}`}>{item.candidates.map(candidate=>{
        const url=publisherLink(candidate.publisherUrl);
        return <div className="paper-import-candidate" key={candidate.candidateId}>
          <strong>{candidate.title}</strong><small>{[candidate.authors,candidate.year].filter(Boolean).join(' · ')}</small>
          <div className="inline-actions"><button type="button" className="btn btn--ghost" disabled={disabled||canReselect&&candidate.candidateId===item.selectedId} aria-label={`导入 ${candidate.title}`} onClick={()=>void act('choose',{itemId:item.id,candidateId:candidate.candidateId})}>{canReselect&&candidate.candidateId===item.selectedId?'当前选择':candidate.automatic?'导入这篇':'选择这篇'}</button>{url&&<a href={url} target="_blank" rel="noreferrer">查看来源 ↗</a>}</div>
        </div>;
      })}</div>}
      {item.status==='unavailable'&&!notFound(item)&&<><p>来源页面暂未提供可自动下载的 PDF。可以查看来源，获取文件后使用论文库的“导入 PDF”。{publisher&&<> <a href={publisher} target="_blank" rel="noreferrer">查看来源页面</a></>}</p><button type="button" className="btn btn--ghost" disabled={disabled} aria-label={`重新检查来源 ${item.query}`} onClick={()=>void act('retry',{itemId:item.id})}>重新检查来源</button></>}
      {notFound(item)&&<><p>尚未找到可靠匹配。可以补充英文标题、作者或 DOI 后继续对话，也可以重新检索。</p><button type="button" className="btn btn--ghost" disabled={disabled} aria-label={`重新检索 ${item.query}`} onClick={()=>void act('retry',{itemId:item.id})}>重新检索</button></>}
      {item.status==='failed'&&!(item.result&&item.groupError)&&<button type="button" className="btn btn--ghost" disabled={disabled} aria-label={`重试 ${item.query}`} onClick={()=>void act('retry',{itemId:item.id})}>重试这篇</button>}
    </article>;
  }

  return <FloatingPanel open={open} onClose={onClose} title="对话导入" subtitle="告诉我想读哪些论文，逐篇检索并导入" storageKey="paper-import-window" width={680} className="paper-import-panel" closeLabel="关闭对话导入" actions={<button type="button" disabled={creating||loading} onClick={()=>void act('new')}>新对话</button>} footer={<form className="paper-import-composer" onSubmit={event=>{event.preventDefault();send();}}>
    {(busy||items.length>0)&&<p className="paper-import-progress" role="status" aria-live="polite" style={{margin:'0 0 8px'}}>{busy?'正在处理 · ':''}已处理 {processed} / {items.length} 篇 · 已入库 {complete} / {items.length} 篇{busy?'。关闭窗口后会继续。':''}</p>}
    {(targetGroups.length>0||retryPending)&&<div className="paper-import-composer-actions">{targetGroups.length>0&&<small>目标分组：{targetGroups.join('、')}</small>}{retryPending&&<button type="button" className="btn btn--ghost" disabled={disabled} onClick={()=>void act('retry_pending')}>重试未完成</button>}</div>}
    <label className="sr-only" htmlFor="paper-import-message">导入需求</label>
    <textarea id="paper-import-message" rows={3} value={draft} maxLength={12000} placeholder="输入论文标题、作者、DOI 或 arXiv 链接，也可以列出多篇…" disabled={loading} onChange={event=>setDraft(event.target.value)} onKeyDown={event=>{if(event.key==='Enter'&&!event.shiftKey&&!event.nativeEvent.isComposing){event.preventDefault();send();}}}/>
    <div className="paper-import-composer-actions"><small>Enter 发送 · Shift+Enter 换行</small><button type="submit" className="btn btn--primary" disabled={disabled||!draft.trim()}>{busy?'正在处理…':'发送'}</button></div>
  </form>}>
    <div className="paper-import-body">
      {history.length>0&&<label className="paper-import-composer-actions"><span>历史对话</span><select aria-label="历史对话" value={selection} disabled={creating} style={{minWidth:0,maxWidth:'75%'}} onChange={event=>switchSession(event.target.value)}><option value="" disabled>选择对话</option>{history.map(entry=><option key={entry.id} value={entry.id}>{entry.busy?'处理中':'已完成'} · {entry.title}（{entry.itemCount} 篇）</option>)}</select></label>}
      {!session?.messages.length&&!items.length&&<div className="paper-import-intro"><h3>把想读的论文交给我</h3><p>可以发论文清单，也可以用自然语言描述想导入的论文。可获取的 PDF 会直接导入；同名候选会请你选择。</p><button type="button" className="paper-import-example" disabled={disabled} onClick={()=>setDraft(example)}>{example}</button></div>}
      {loading&&<p role="status">正在恢复对话…</p>}
      <div className="paper-import-messages" aria-label="导入对话记录">{session?.messages.map(message=><article key={message.id} className={`paper-import-message is-${message.role}`}><small>{message.role==='user'?'你':'导入助手'}</small>{message.role==='user'&&message.content.length>600?<details><summary>{message.content.slice(0,100).replace(/\s+/g,' ')}…（展开原始清单）</summary><Markdown interactive={false}>{message.content}</Markdown></details>:<Markdown interactive={false}>{message.content}</Markdown>}</article>)}</div>
      {items.length>0&&<section className="paper-import-queue" aria-label="逐篇导入进度">{items.map(renderItem)}</section>}
      {problems&&<p className="paper-import-error" role="alert">{problems}</p>}
      {showContinue&&<button type="button" className="btn btn--ghost" disabled={disabled} onClick={()=>send('继续处理')}>继续处理</button>}
    </div>
  </FloatingPanel>;
}
