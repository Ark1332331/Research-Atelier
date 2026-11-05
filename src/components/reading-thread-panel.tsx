"use client";
import {Activity,memo,useCallback,useEffect,useRef,useState} from 'react';
import type {ReadingAnchor,ReadingThread} from '@/lib/reading-memory';
import FloatingPanel from './floating-panel';
import {ReadingSurface,rangeAt} from './reading-memory';
import {readingQuoteMarkdown} from '@/lib/reading-highlight-layout';
import {scrollReadingSource} from '@/lib/scroll-reading-source';
import MarkdownContent from './markdown-content';
import LearningResponse from './learning-response';
import {readAnswer} from '@/lib/answer-stream';
import {watchAnswerProgress} from '@/lib/answer-deadline';
import {useAnswerScroll} from './use-answer-scroll';

export interface ReadingWindow {key:string;id?:string;anchor:ReadingAnchor;open:boolean;focus:number;slot:number;requests?:{id:string;question:string}[]}
// Composer input, the waiting clock and streamed tokens must not re-parse past answers.
const ThreadHistory=memo(function ThreadHistory({thread,anchor}:{thread?:ReadingThread;anchor:ReadingAnchor}){
  return <>{thread?.messages.map((m,i)=><article className={`reading-message reading-message--${m.role}`} key={`${thread.id}-${i}`}><small>{m.role==='user'?'你':'研究伙伴'}</small>{m.role==='assistant'?<ReadingSurface content={m.content} sourceKey={`memory:${thread.id}:${i}`} sourceUrl={anchor.scope} origin={{kind:'memory',threadId:thread.id}} label="追问回答" slug={anchor.slug} context={[anchor.text,anchor.context,...thread.messages.slice(Math.max(0,i-4),i).map(m=>m.content)].join('\n').slice(-10000)}><MarkdownContent>{m.content}</MarkdownContent></ReadingSurface>:<p>{m.content}</p>}{m.role==='assistant'&&m.learning&&<LearningResponse learning={m.learning}/>}</article>)}</>;
});
export async function memoryPost(body:object,signal?:AbortSignal){
  const r=await fetch('/api/reading-memory',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal});
  const d=await r.json();if(!r.ok)throw Error(d.error||'保存失败，请重试');return d;
}
export default function ReadingThreadPanel({window:win,thread,onUpdate,onClose,onDelete,onReload,onQuickConsumed,docked=false}:{
  window:ReadingWindow;thread?:ReadingThread;onUpdate:(thread:ReadingThread)=>void;onClose:()=>void;onDelete:()=>Promise<void>;onReload:()=>Promise<void>;onQuickConsumed:(id:string)=>void;docked?:boolean;
}){
  const [question,setQuestion]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const [sourceQuote,setSourceQuote]=useState(win.anchor.quoteMarkdown);
  const [pending,setPending]=useState<{question:string;text:string}|null>(null);
  const [elapsed,setElapsed]=useState(0);
  const request=useRef<AbortController|null>(null),startedAt=useRef(0);
  const sending=useRef(false),input=useRef<HTMLTextAreaElement>(null);
  useEffect(()=>{if(!busy)return;const timer=setInterval(()=>setElapsed(Math.floor((Date.now()-startedAt.current)/1000)),1000);return()=>clearInterval(timer);},[busy]);
  useEffect(()=>()=>request.current?.abort(),[]);
  const {bind:bindScroll,begin:beginScroll,onScroll,onWheel,onPointerDown,onKeyDown}=useAnswerScroll(`${thread?.messages.length}:${pending?.text??''}`,busy&&win.open);
  useEffect(()=>{
    if(!docked||!win.open||!win.anchor.sourceKey.startsWith('study:'))return;
    let frame=0,small=window.innerWidth<=700;
    const locate=()=>{cancelAnimationFrame(frame);frame=requestAnimationFrame(()=>{
      const el=Array.from(document.querySelectorAll<HTMLElement>('[data-reading-source]')).find(el=>el.dataset.readingSource===win.anchor.sourceKey);
      if(!el)return;const range=rangeAt(el,win.anchor.start,win.anchor.end);if(range?.toString()===win.anchor.text)scrollReadingSource(range);
    });};
    const resize=()=>{const next=window.innerWidth<=700;if(next!==small){small=next;locate();}};
    locate();window.addEventListener('resize',resize);return()=>{cancelAnimationFrame(frame);window.removeEventListener('resize',resize);};
  },[docked,win.open,win.focus,win.anchor]);
  useEffect(()=>{const el=input.current;if(el){el.style.height='0px';el.style.height=Math.min(112,Math.max(40,el.scrollHeight))+'px';}},[question]);
  function recoverQuote(){
    if(sourceQuote)return;
    const el=Array.from(document.querySelectorAll<HTMLElement>('[data-reading-source]')).find(el=>el.dataset.readingSource===win.anchor.sourceKey);
    if(!el)return;const range=rangeAt(el,win.anchor.start,win.anchor.end);
    if(range?.toString()===win.anchor.text)setSourceQuote(readingQuoteMarkdown(el,range));
  }
  const send=useCallback(async(text:string)=>{
    if(sending.current||!text.trim())return;sending.current=true;setBusy(true);setError('');beginScroll();setPending({question:text.trim(),text:''});
    const controller=new AbortController();request.current=controller;startedAt.current=Date.now();setElapsed(0);
    // The client fallback is longer than the server watchdog to allow its error
    // and final persistence response to arrive before cancelling the connection.
    const deadline=watchAnswerProgress(controller,{firstTextMs:210000,idleMs:120000});
    try{
      let current=thread;
      if(!current){current=(await memoryPost({action:'create',anchor:win.anchor},controller.signal)).thread as ReadingThread;onUpdate(current);}
      controller.signal.throwIfAborted();
      const response=await fetch('/api/reading-memory',{method:'POST',headers:{'Content-Type':'application/json',Accept:'application/x-ndjson'},body:JSON.stringify({action:'ask',id:current.id,question:text.trim(),revision:current.messages.length}),signal:controller.signal});
      const d=await readAnswer<{thread:ReadingThread}>(response,value=>{deadline.progress(value);setPending({question:text.trim(),text:value});});
      onUpdate(d.thread);setPending(null);setQuestion(current=>current.trim()===text.trim()?'':current);
    }catch(e){setError(controller.signal.aborted?(controller.signal.reason?.name==='TimeoutError'?controller.signal.reason.message:'已停止本次回答。问题和已有对话已保留；未完成的内容不作为完整回答保存。'):e instanceof Error?e.message:'请求失败，请重试');void onReload().catch(()=>{});}
    finally{deadline.dispose();request.current=null;sending.current=false;setBusy(false);}
  },[thread,win.anchor,onUpdate,onReload,beginScroll]);
  const claimedQuick=useRef(new Set<string>());
  useEffect(()=>{
    const request=win.requests?.[0];if(!request||busy||claimedQuick.current.has(request.id))return;
    let gone=false;
    queueMicrotask(()=>{
      if(gone||sending.current||claimedQuick.current.has(request.id))return;
      claimedQuick.current.add(request.id);setQuestion(value=>value||request.question);
      void send(request.question).finally(()=>onQuickConsumed(request.id));
    });
    return()=>{gone=true;};
  },[win.requests,busy,send,onQuickConsumed]);
  async function remove(){
    if(sending.current)return;
    if(win.id&&!window.confirm('删除这个对话及其高光？其他独立追问和随心笔记会保留。'))return;
    try{setError('');await onDelete();}catch(e){setError(e instanceof Error?e.message:'删除失败');}
  }
  return <FloatingPanel docked={docked} open={win.open} focusToken={win.focus} offset={win.slot*36} onClose={onClose} title="划线追问" subtitle={win.anchor.label} width={560} storageKey={`reading-memory-box:${win.id??win.key}`} className="reading-memory-panel" closeLabel="关闭追问" actions={<button className="floating-panel-delete" aria-label="删除对话及高光" title="删除对话及高光" disabled={busy} onClick={()=>void remove()}>删除</button>}>
    <div data-thread-id={thread?.id??win.key}>
      <div className="reading-memory-scroll" ref={bindScroll} onScroll={onScroll} onWheel={onWheel} onPointerDown={onPointerDown} onKeyDown={onKeyDown} style={{overflowAnchor:'none'}}>
        <details className="reading-source-details" onToggle={e=>{if(e.currentTarget.open)recoverQuote();}}>
          <summary><span>引用题目 / 原文</span><small>展开查看</small><svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="m5 6 3 3 3-3" fill="none" stroke="currentColor" strokeWidth="1.5"/></svg></summary>
          <div className="reading-source-body">{sourceQuote?<MarkdownContent>{sourceQuote}</MarkdownContent>:<p className="reading-source-plain">{win.anchor.text}</p>}
            <details className="reading-context"><summary>附带上下文</summary><p>{win.anchor.context}</p></details>
          </div>
        </details>
        {!thread?.messages.length&&!pending&&<div className="reading-thread-empty"><strong>从这里继续理解</strong><p>围绕选中的内容提问，回答会保留在原文高光中。</p></div>}
        <Activity mode={win.open?'visible':'hidden'}><ThreadHistory thread={thread} anchor={win.anchor}/></Activity>
        {pending&&<div data-answer-start><article className="reading-message reading-message--user"><p>{pending.question}</p></article>{pending.text&&<article className="reading-message reading-message--assistant is-provisional"><MarkdownContent>{pending.text}</MarkdownContent></article>}
          {busy&&<div className="reading-answer-progress" role="status"><span>{pending.text?'正在生成回答':'等待模型返回正文'} <span aria-live="off">· {elapsed} 秒</span></span>{!pending.text&&elapsed>=20&&<small>模型尚未返回正文。你可以继续等待，或点击输入框右侧停止。</small>}</div>}
        </div>}
      </div>
      {error&&<p role="alert" className="reading-error">{error}</p>}
      <footer className="reading-thread-composer"><div className="reading-thread-input"><textarea ref={input} aria-label="追问内容" placeholder={thread?.messages.length?'继续追问…':'想进一步理解哪里？'} rows={1} maxLength={5000} value={question} disabled={busy} onChange={e=>setQuestion(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.nativeEvent.isComposing){e.preventDefault();void send(question);}}}/><button aria-label={busy?'停止回答':'发送追问'} title={busy?'停止回答':'发送追问'} disabled={!busy&&!question.trim()} onClick={()=>{if(busy)request.current?.abort();else void send(question);}}>{busy?<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor"/></svg>:<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M12 19V5m-6 6 6-6 6 6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>}</button></div><small>{busy?'可随时停止本次回答':'Enter 发送 · Shift+Enter 换行'}</small></footer>
    </div>
  </FloatingPanel>;
}
