"use client";

import {createContext,useCallback,useContext,useEffect,useMemo,useRef,useState,type ReactNode} from 'react';
import {createPortal} from 'react-dom';
import {usePathname} from 'next/navigation';
import {sourceFingerprint,readingPath,type ReadingAnchor,type ReadingThread,type ReadingOrigin} from '@/lib/reading-memory';
import FloatingPanel from './floating-panel';
import type {VocabularyEntry} from '@/lib/vocabulary';
import ReaderTranslation from './reader-translation';
import type {ReaderSelection} from '@/lib/reader-selection';
import ReadingThreadPanel,{memoryPost,type ReadingWindow} from './reading-thread-panel';
import {useReadingNotes} from './reading-notes';
import {readingHighlightBoxes,readingQuoteMarkdown,type HighlightBox} from '@/lib/reading-highlight-layout';
import {useStudyShortcuts,ReadingSelectionToolbar} from './study-shortcuts';
import type {StudyShortcut} from '@/lib/study-shortcuts';

type MemoryContext={closeCurrent:()=>void;threads:ReadingThread[];open:(anchor:ReadingAnchor,question?:string)=>void;show:(id:string)=>void;words:VocabularyEntry[];translate:(anchor:ReadingAnchor,x:number,y:number)=>void;setConversationDock:(element:HTMLDivElement|null)=>void;openConversationCount:number;conversationFocus:number;memoryCount:number;showLibrary:()=>void;shortcuts:StudyShortcut[];configureShortcuts:()=>void};
const Memory=createContext<MemoryContext|null>(null);
export const useReadingMemory=()=>useContext(Memory);
const sameAnchor=(a:ReadingAnchor,b:ReadingAnchor)=>a.scope===b.scope&&a.sourceKey===b.sourceKey&&a.start===b.start&&a.end===b.end&&a.text===b.text;
export function ReadingMemoryProvider({children}:{children:ReactNode}){
  const pathname=usePathname();
  const shortcuts=useStudyShortcuts(pathname.startsWith('/study/'));
  const [threads,setThreads]=useState<ReadingThread[]>([]),[words,setWords]=useState<VocabularyEntry[]>([]);
  const [windows,setWindows]=useState<ReadingWindow[]>([]),[library,setLibrary]=useState(false),[error,setError]=useState('');
  const [translation,setTranslation]=useState<{anchor:ReadingAnchor;selection:ReaderSelection}|null>(null);
  const [conversationDock,setConversationDock]=useState<HTMLDivElement|null>(null);
  const loadVersion=useRef(0),sequence=useRef(0),wordVersion=useRef(0);
  const update=useCallback((thread:ReadingThread,key:string)=>{try{if(key!==thread.id){for(const prefix of ['reading-memory-box:','study-canvas:reading-memory-box:']){const saved=localStorage.getItem(prefix+key);if(saved&&!localStorage.getItem(prefix+thread.id))localStorage.setItem(prefix+thread.id,saved);}}}catch{}loadVersion.current++;setThreads(items=>[...items.filter(t=>t.id!==thread.id),thread]);setWindows(items=>items.map(w=>w.key===key?{...w,id:thread.id}:w));},[]);
  const reload=useCallback(async()=>{const version=++loadVersion.current;const r=await fetch('/api/reading-memory');const d=await r.json();if(!r.ok)throw Error(d.error);if(version===loadVersion.current)setThreads(d.threads??[]);},[]);
  useEffect(()=>{let gone=false;const serial=wordVersion;void reload().catch(e=>{if(!gone)setError(e.message);});const refresh=()=>{const version=++wordVersion.current;fetch('/api/reading-collection').then(async r=>{const d=await r.json();if(r.ok&&!gone&&version===wordVersion.current)setWords(d.entries??[]);}).catch(()=>{});};refresh();window.addEventListener('reading-words-changed',refresh);return()=>{gone=true;serial.current++;window.removeEventListener('reading-words-changed',refresh);};},[reload]);
  useEffect(()=>{queueMicrotask(()=>{setWindows(items=>items.map(w=>({...w,open:false})));setLibrary(false);setTranslation(null);});},[pathname]);
  const reveal=useCallback((anchor:ReadingAnchor,id?:string,question?:string)=>{
    const focus=++sequence.current;
    const request=question?{id:crypto.randomUUID(),question}:null;
    // A reload can discover a saved anchor before its create response reaches the
    // window that owns the request. Reuse that owner, including its pending text.
    setWindows(items=>{const existing=(id?items.find(w=>w.id===id):undefined)??items.find(w=>(!id||!w.id)&&sameAnchor(w.anchor,anchor));if(existing)return items.map(w=>w===existing?{...w,id:w.id??id,open:true,focus,requests:request&&!w.requests?.some(r=>r.question===question)?[...(w.requests??[]),request]:w.requests}:w);return [...items,{key:id??crypto.randomUUID(),id,anchor,open:true,focus,slot:items.filter(w=>w.open).length%8,requests:request?[request]:[]}];});
    window.getSelection()?.removeAllRanges();
  },[]);
  const open=useCallback((anchor:ReadingAnchor,question?:string)=>{const existing=threads.find(t=>sameAnchor(t.anchor,anchor));reveal(anchor,existing?.id,question);},[threads,reveal]);
  const show=useCallback((id:string)=>{const thread=threads.find(t=>t.id===id);if(thread)reveal(thread.anchor,id);},[threads,reveal]);
  const closeCurrent=useCallback(()=>{
    setWindows(items=>items.map(w=>w.open&&readingPath(w.anchor.scope)===pathname?{...w,open:false}:w));
    window.getSelection()?.removeAllRanges();
  },[pathname]);
  useEffect(()=>{const locate=(event:Event)=>{const anchor=(event as CustomEvent<ReadingAnchor>).detail;const id=anchor?.origin?.kind==='memory'?anchor.origin.threadId:anchor?.sourceKey.match(/^memory:([^:]+):/)?.[1];if(id){const thread=threads.find(t=>t.id===id);if(thread)reveal(thread.anchor,id);}};window.addEventListener('reading-open-source',locate);return()=>window.removeEventListener('reading-open-source',locate);},[threads,reveal]);
  const collect=useCallback(async(anchor:ReadingAnchor,kind:'term'|'word',meaning:string)=>{const r=await fetch('/api/reading-collection',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({kind,anchor,meaning})});const d=await r.json();if(!r.ok)throw Error(d.error);if(kind==='word'&&d.saved){wordVersion.current++;setWords(items=>[...items.filter(w=>w.id!==d.saved.id),d.saved]);}window.dispatchEvent(new Event(kind==='term'?'reading-terms-changed':'reading-words-changed'));},[]);
  const translate=useCallback((anchor:ReadingAnchor,x:number,y:number)=>{setTranslation({anchor,selection:{text:anchor.text,context:anchor.context,page:anchor.page??0,rects:[],native:false,x,y}});window.getSelection()?.removeAllRanges();},[]);
  async function remove(win:ReadingWindow){if(win.id){await memoryPost({action:'delete',id:win.id});loadVersion.current++;setThreads(items=>items.filter(t=>t.id!==win.id));}setWindows(items=>items.filter(w=>w.key!==win.key));}
  const scoped=threads.filter(t=>readingPath(t.anchor.scope)===pathname||pathname==='/read/'+t.anchor.slug);
  const showLibrary=()=>{setLibrary(true);void reload().catch(e=>setError(e.message));};
  const docked=!!conversationDock&&pathname.startsWith('/study/');
  const panels=windows.map(win=><ReadingThreadPanel key={win.key} docked={docked} window={win} thread={threads.find(t=>t.id===win.id)} onUpdate={thread=>update(thread,win.key)} onQuickConsumed={id=>setWindows(items=>items.map(w=>w.key===win.key?{...w,requests:w.requests?.filter(r=>r.id!==id)}:w))} onClose={()=>{setWindows(items=>items.map(w=>w.key===win.key?{...w,open:false}:w));window.getSelection()?.removeAllRanges();}} onDelete={()=>remove(win)} onReload={reload}/>);
  return <Memory.Provider value={{threads,words,open,show,closeCurrent,translate,setConversationDock,openConversationCount:windows.filter(win=>win.open&&readingPath(win.anchor.scope)===pathname).length,conversationFocus:Math.max(0,...windows.map(win=>win.focus)),memoryCount:scoped.length,showLibrary,shortcuts:shortcuts.items,configureShortcuts:shortcuts.configure}}><style>{'::highlight(reading-focus){background-color:#ace4c5;color:#143c26}'}</style>{children}{shortcuts.editor}
    {scoped.length>0&&!docked&&<button className="reading-memory-launcher" onClick={showLibrary}>追问记忆 · {scoped.length}</button>}
    <FloatingPanel open={library} onClose={()=>setLibrary(false)} title="追问记忆" storageKey="reading-memory-library" className="reading-memory-library">{error&&<p role="alert">{error}</p>}{scoped.map(t=><button className="reading-memory-entry" key={t.id} onClick={()=>{show(t.id);setLibrary(false);}}><strong>{t.anchor.text}</strong><small>{t.anchor.label} · {t.messages.length/2} 轮追问</small></button>)}</FloatingPanel>
    {docked?createPortal(panels,conversationDock):panels}
    <ReaderTranslation selection={translation?.selection??null} scope={translation?translation.anchor.scope+':'+translation.anchor.sourceKey:''} sourceLabel={translation?.anchor.label} sourceSlug={translation?.anchor.slug} sourceUrl={translation?.anchor.scope} canSave onClose={()=>setTranslation(null)} onSave={async(_selection,meaning,kind)=>{if(translation)await collect(translation.anchor,kind,meaning);}}/>
  </Memory.Provider>;
}


export function rangeAt(root:HTMLElement,start:number,end:number):Range|null {
  const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);let offset=0;let node:Node|null;const range=document.createRange();let began=false;
  while((node=walker.nextNode())){const size=node.textContent?.length??0;
    if(!began&&start<offset+size){range.setStart(node,start-offset);began=true;}
    if(began&&end<=offset+size){range.setEnd(node,end-offset);return range;}offset+=size;
  }return null;
}
export function ReadingSurface({children,content,sourceKey,sourceUrl,label,context,slug,origin}:{children:ReactNode;content:string;sourceKey?:string;sourceUrl?:string;label:string;context?:string;slug?:string;origin?:ReadingOrigin}) {
  const memory=useReadingMemory();const pathname=usePathname();const root=useRef<HTMLDivElement>(null);
  const notes=useReadingNotes();
  const [selection,setSelection]=useState<{anchor:ReadingAnchor;x:number;y:number}|null>(null);
  const [wordId,setWordId]=useState<string|null>(null);
  const enabled=!!memory;
  const source=useMemo(()=>sourceKey?`${sourceKey}:${sourceFingerprint(content)}`:sourceFingerprint(content),[sourceKey,content]);
  const scoped=useMemo(()=>memory?.threads.filter(t=>readingPath(t.anchor.scope)===pathname&&t.anchor.sourceKey===source)??[],[memory?.threads,pathname,source]);
  const ranges=useRef<{thread:ReadingThread;range:Range}[]>([]);
  const scopedWords=useMemo(()=>memory?.words.filter(w=>w.sourceAnchor&&readingPath(w.sourceAnchor.scope)===pathname&&w.sourceAnchor.sourceKey===source)??[],[memory?.words,pathname,source]);
  const wordRanges=useRef<{word:VocabularyEntry;range:Range}[]>([]);
  const word=scopedWords.find(w=>w.id===wordId);
  const scopedNotes=useMemo(()=>notes?.notes.filter(n=>readingPath(n.anchor.scope)===pathname&&n.anchor.sourceKey===source)??[],[notes?.notes,pathname,source]);
  const noteRanges=useRef<{id:string;range:Range}[]>([]);
  const [highlights,setHighlights]=useState<(HighlightBox&{kind:'memory'|'word'|'note';id:string})[]>([]);
  useEffect(()=>{
    const el=root.current;if(!el)return;
    ranges.current=scoped.flatMap(thread=>{const a=thread.anchor;const r=rangeAt(el,a.start,a.end);return r&&r.toString()===a.text?[{thread,range:r}]:[];});
    wordRanges.current=scopedWords.flatMap(word=>{const a=word.sourceAnchor!;const r=rangeAt(el,a.start,a.end);return r&&r.toString()===a.text?[{word,range:r}]:[];});
    noteRanges.current=scopedNotes.flatMap(note=>{const a=note.anchor,r=rangeAt(el,a.start,a.end);return r&&r.toString()===a.text?[{id:note.id,range:r}]:[];});
    if(!ranges.current.length&&!wordRanges.current.length&&!noteRanges.current.length){
      const frame=requestAnimationFrame(()=>setHighlights(previous=>previous.length?[]:previous));
      return()=>cancelAnimationFrame(frame);
    }
    let frame=0,disposed=false;
    const schedule=()=>{cancelAnimationFrame(frame);frame=requestAnimationFrame(()=>{
      if(disposed)return;
      const groups=[...wordRanges.current.map(r=>({id:r.word.id,kind:'word' as const,range:r.range})),...ranges.current.map(r=>({id:r.thread.id,kind:'memory' as const,range:r.range})),...noteRanges.current.map(r=>({id:r.id,kind:'note' as const,range:r.range}))];
      const next=groups.flatMap(({id,kind,range})=>readingHighlightBoxes(el,range).map(box=>({...box,id,kind})));
      setHighlights(previous=>previous.length===next.length&&previous.every((box,i)=>{const b=next[i];return box.id===b.id&&box.kind===b.kind&&box.left===b.left&&box.top===b.top&&box.width===b.width&&box.height===b.height;})?previous:next);
    });};
    const resize=new ResizeObserver(schedule);resize.observe(el);
    const mutation=new MutationObserver(schedule);mutation.observe(el,{childList:true,subtree:true,characterData:true});
    el.addEventListener('load',schedule,true);el.addEventListener('scroll',schedule,true);
    window.addEventListener('resize',schedule);void document.fonts.ready.then(()=>{if(!disposed)schedule();});schedule();
    return()=>{disposed=true;cancelAnimationFrame(frame);resize.disconnect();mutation.disconnect();el.removeEventListener('load',schedule,true);el.removeEventListener('scroll',schedule,true);window.removeEventListener('resize',schedule);};
  },[scoped,scopedWords,scopedNotes,content]);
  const capture=useCallback(()=>{
    const native=window.getSelection(),el=root.current;if(!native?.rangeCount||native.isCollapsed||!el){setSelection(null);return;}
    const range=native.getRangeAt(0);if(!el.contains(range.startContainer)||!el.contains(range.endContainer)){setSelection(null);return;}
    const text=range.toString();if(!text.trim()||text.length>12000){setSelection(null);return;}
    const before=document.createRange();before.selectNodeContents(el);before.setEnd(range.startContainer,range.startOffset);
    const start=before.toString().length;const all=el.textContent??'';const rect=range.getBoundingClientRect();
    const nearby=all.slice(Math.max(0,start-1600),Math.min(all.length,start+text.length+1600));
    const url=new URL(sourceUrl??window.location.href,window.location.origin);url.searchParams.delete('note');
    setSelection({anchor:{scope:url.pathname+url.search,sourceKey:source,label,text,quoteMarkdown:readingQuoteMarkdown(el,range),context:[context?.slice(-10000),nearby].filter(Boolean).join('\n\n').slice(-18000),start,end:start+text.length,...(slug?{slug}:{}),...(origin?{origin}:{})},x:Math.max(8,Math.min(rect.left,window.innerWidth-420)),y:Math.max(8,Math.min(rect.bottom+8,window.innerHeight-100))});
  },[source,sourceUrl,label,context,slug,origin]);
  useEffect(()=>{if(!enabled)return;let timer:ReturnType<typeof setTimeout>;const change=()=>{clearTimeout(timer);timer=setTimeout(capture,120);};const clear=()=>setSelection(null);document.addEventListener('selectionchange',change);window.addEventListener('resize',clear);window.addEventListener('scroll',clear,true);return()=>{clearTimeout(timer);document.removeEventListener('selectionchange',change);window.removeEventListener('resize',clear);window.removeEventListener('scroll',clear,true);};},[capture,enabled]);
  return <div className="reading-surface">
    <div className="reading-marked-content">
    <div ref={root} data-reading-source={source} onMouseUp={()=>setTimeout(capture,0)} onKeyUp={capture} onClick={e=>{
      if(window.getSelection()?.toString())return;
      // These are the same boxes the user sees. Only the root offset changes on
      // outer scrolling; resize, font and inner-scroll observers refresh boxes.
      const origin=e.currentTarget.getBoundingClientRect(),x=e.clientX-origin.left,y=e.clientY-origin.top;
      const hit=(kind:'memory'|'note'|'word')=>highlights.find(b=>b.kind===kind&&x>=b.left&&x<=b.left+b.width&&y>=b.top-1&&y<=b.top+b.height+1);
      const memoryHit=hit('memory');if(memoryHit){e.stopPropagation();memory?.show(memoryHit.id);return;}
      const note=hit('note');if(note){e.stopPropagation();notes?.edit(note.id);return;}
      const word=hit('word');if(word){e.stopPropagation();setWordId(word.id);}
    }}>{children}</div>
    <div className="reading-highlight-layer" aria-hidden="true">{highlights.map((box,i)=><span key={`${box.kind}-${box.id}-${i}`} className={`reading-highlight reading-highlight--${box.kind}`} style={{left:box.left,top:box.top-1,width:box.width,height:box.height+2}}/>)}</div>
    </div>
    {word&&<div className="reading-word-note" role="status"><strong>{word.text}</strong><p>{word.meaning}</p><small>{word.usage}</small><button className="text-button" onClick={()=>setWordId(null)}>收起释义</button></div>}
    {scoped.length>0&&<div className="reading-memory-links" aria-label="这段回答的追问">{scoped.map((t,i)=><button key={t.id} onClick={()=>memory?.show(t.id)} title={t.anchor.text}>↳ 追问 {i+1} · {t.messages.length/2} 轮</button>)}</div>}
    {selection&&memory&&createPortal(<ReadingSelectionToolbar x={selection.x} y={selection.y} study={pathname.startsWith('/study/')}>
      {pathname.startsWith('/study/')&&<div className="reading-study-shortcuts">{memory.shortcuts.map(item=><button key={item.id} title={item.prompt} onClick={()=>{memory.open(selection.anchor,item.prompt);setSelection(null);}}>{item.title}</button>)}</div>}
      <button className="btn btn--primary" onClick={()=>{memory.open(selection.anchor);setSelection(null);}}>划线追问</button>
      <button className="text-button" onClick={()=>{memory.translate(selection.anchor,selection.x,selection.y);setSelection(null);}}>翻译 / 释义</button>
      {notes&&<button className="text-button" onClick={()=>{notes.capture(selection.anchor);setSelection(null);}}>随心笔记</button>}
      {pathname.startsWith('/study/')&&<button className="text-button" onClick={()=>{setSelection(null);window.getSelection()?.removeAllRanges();memory.configureShortcuts();}}>自定义快捷</button>}
      <button className="text-button" aria-label="关闭选区操作" onClick={()=>{setSelection(null);window.getSelection()?.removeAllRanges();}}>×</button>
    </ReadingSelectionToolbar>,document.body)}
  </div>;
}
