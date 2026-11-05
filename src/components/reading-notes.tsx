"use client";
import {createContext,Suspense,useCallback,useContext,useEffect,useRef,useState,type ReactNode} from 'react';
import {usePathname,useRouter,useSearchParams} from 'next/navigation';
import type {ReadingAnchor} from '@/lib/reading-memory';
import type {ReadingNote} from '@/lib/reading-notes';
import FloatingPanel from './floating-panel';
import {rangeAt} from './reading-memory';
import MarkdownContent from './markdown-content';
import {scrollReadingSource} from '@/lib/scroll-reading-source';

type NotesContext={notes:ReadingNote[];loading:boolean;error:string;capture:(anchor:ReadingAnchor)=>void;edit:(id:string)=>void;remove:(id:string)=>Promise<void>;locate:(id:string)=>void;reload:()=>Promise<void>};
const Notes=createContext<NotesContext|null>(null);
export const useReadingNotes=()=>useContext(Notes);
async function request(body:object){const r=await fetch('/api/reading-notes',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const d=await r.json();if(!r.ok)throw Error(d.error||'笔记保存失败');return d;}
export function ReadingNotesProvider({children}:{children:ReactNode}){
  const router=useRouter();
  const [notes,setNotes]=useState<ReadingNote[]>([]),[loading,setLoading]=useState(true),[error,setError]=useState('');
  const [editor,setEditor]=useState<{key:string;anchor:ReadingAnchor;id?:string;comment:string;open:boolean}|null>(null);
  const [target,setTarget]=useState({id:'',serial:0});
  const version=useRef(0);
  const deleted=useRef(new Set<string>());
  const reload=useCallback(async()=>{const token=++version.current;try{const r=await fetch('/api/reading-notes');const d=await r.json();if(!r.ok)throw Error(d.error||'笔记加载失败');if(token===version.current){setNotes(d.notes??[]);setError('');}}catch(e){if(token===version.current)setError(e instanceof Error?e.message:'笔记加载失败');throw e;}finally{if(token===version.current)setLoading(false);}},[]);
  useEffect(()=>{let gone=false;const serial=version;queueMicrotask(()=>{if(!gone)void reload().catch(()=>{});});return()=>{gone=true;serial.current++;};},[reload]);
  const edit=useCallback((id:string)=>{const n=notes.find(n=>n.id===id);if(n)setEditor({key:crypto.randomUUID(),id,anchor:n.anchor,comment:n.comment,open:true});},[notes]);
  const capture=useCallback((anchor:ReadingAnchor)=>{const n=notes.find(n=>n.anchor.scope===anchor.scope&&n.anchor.sourceKey===anchor.sourceKey&&n.anchor.start===anchor.start&&n.anchor.end===anchor.end&&n.anchor.text===anchor.text);setEditor({key:crypto.randomUUID(),id:n?.id,anchor,comment:n?.comment??'',open:true});window.getSelection()?.removeAllRanges();},[notes]);
  const remove=useCallback(async(id:string)=>{await request({action:'delete',id});deleted.current.add(id);version.current++;setNotes(items=>items.filter(n=>n.id!==id));setEditor(e=>e?.id===id?null:e);},[]);
  const locate=useCallback((id:string)=>{const n=notes.find(n=>n.id===id);if(!n)return;const url=new URL(n.anchor.scope,window.location.origin);if(url.origin!==window.location.origin)return;url.searchParams.set('note',id);router.push(url.pathname+url.search);setTarget(t=>({id,serial:t.serial+1}));},[notes,router]);
  return <Notes.Provider value={{notes,loading,error,capture,edit,remove,locate,reload}}>{children}
    {editor&&<NoteEditor key={editor.key} editor={editor} close={()=>setEditor(e=>e?{...e,open:false}:null)} saved={note=>{if(deleted.current.has(note.id))return;version.current++;setLoading(false);setNotes(items=>[note,...items.filter(n=>n.id!==note.id)]);setEditor(e=>e?.key===editor.key?{...e,id:note.id,open:false}:e);}}/>}
    <Suspense fallback={null}><NoteLocator notes={notes} target={target}/></Suspense>
  </Notes.Provider>;
}
function NoteEditor({editor,close,saved}:{editor:{id?:string;anchor:ReadingAnchor;comment:string;open:boolean};close:()=>void;saved:(note:ReadingNote)=>void}){
  const [comment,setComment]=useState(editor.comment),[busy,setBusy]=useState(false),[error,setError]=useState('');const sending=useRef(false);
  async function save(){if(sending.current||!comment.trim())return;sending.current=true;setBusy(true);setError('');try{const d=await request(editor.id?{action:'update',id:editor.id,comment}:{action:'save',anchor:editor.anchor,comment});saved(d.note);}catch(e){setError(e instanceof Error?e.message:'保存失败，请重试');}finally{sending.current=false;setBusy(false);}}
  return <FloatingPanel open={editor.open} onClose={close} title="随心笔记" subtitle="留下这段文字对你的意义" storageKey="reading-note-editor" className="reading-note-editor" width={460} closeLabel="关闭笔记">
    <div className="reading-note-content"><small>{editor.anchor.label}</small><blockquote>{editor.anchor.text}</blockquote><label>我的批注<textarea className="field" aria-label="我的批注" maxLength={2000} rows={4} value={comment} disabled={busy} onChange={e=>setComment(e.target.value)} placeholder="为什么想留下它？写一句自己的想法…"/></label>{error&&<p role="alert">{error}</p>}<div className="inline-actions"><button className="btn btn--primary" disabled={busy||!comment.trim()} onClick={()=>void save()}>{busy?'保存中…':'保存笔记'}</button><small>保留原文与来源位置</small></div></div>
  </FloatingPanel>;
}
function NoteLocator({notes,target}:{notes:ReadingNote[];target:{id:string;serial:number}}){
  const params=useSearchParams(),pathname=usePathname();
  const id=params.get('note'),note=notes.find(n=>n.id===id);
  const [preview,setPreview]=useState<{note:ReadingNote;translation:boolean}|null>(null);
  useEffect(()=>{
    if(!note)return;
    let finished=false,attempt=0;
    const a=note.anchor;
    const run=()=>{
      if(finished)return;
      attempt++;
      const element=Array.from(document.querySelectorAll<HTMLElement>('[data-reading-source]')).find(e=>e.dataset.readingSource===a.sourceKey&&e.checkVisibility());
      if(element){const range=rangeAt(element,a.start,a.end);if(range&&range.toString()===a.text){finished=true;scrollReadingSource(range);if(typeof Highlight!=='undefined'&&'highlights' in CSS)CSS.highlights.set('reading-focus',new Highlight(range));element.setAttribute('data-note-located',note.id);setPreview(null);return;}}
      if(a.rects&&a.docId){const reader=document.querySelector<HTMLElement>('[data-reader-docid]');const page=reader?.querySelector<HTMLElement>('[data-page="'+a.page+'"]');if(reader?.dataset.readerDocid===a.docId&&page&&page.checkVisibility()){const highlight=Array.from(page.querySelectorAll<HTMLElement>('[data-note-id]')).find(e=>e.dataset.noteId===note.id);if(highlight){scrollReadingSource(highlight);page.setAttribute('data-note-located',note.id);finished=true;setPreview(null);return;}scrollReadingSource(page);}}
      if([1,3,7,15].includes(attempt))window.dispatchEvent(new CustomEvent('reading-open-source',{detail:a}));
      if(a.origin?.kind==='translation'){setPreview({note,translation:true});finished=true;return;}
      if(attempt>=40){finished=true;setPreview({note,translation:false});}
    };
    const timer=setInterval(run,200);run();
    return()=>{finished=true;clearInterval(timer);if(typeof CSS!=='undefined'&&'highlights' in CSS)CSS.highlights.delete('reading-focus');};
  },[note,pathname,target.serial]);
  return preview?<FloatingPanel open onClose={()=>setPreview(null)} title={preview.translation?'当时的译文':'笔记来源'} subtitle={preview.note.anchor.label} storageKey="reading-note-source" width={520}>
    <div className="reading-note-content">{!preview.translation&&<p role="status">暂时无法定位原位置，来源可能已删除或发生变化。已保留当时的摘录与上下文。</p>}<strong>{preview.note.comment}</strong><blockquote>{preview.note.anchor.text}</blockquote>{preview.translation?<TranslationSnapshot note={preview.note}/>:<MarkdownContent>{preview.note.anchor.context}</MarkdownContent>}</div>
  </FloatingPanel>:null;
}
function TranslationSnapshot({note}:{note:ReadingNote}){
  const root=useRef<HTMLDivElement>(null);
  useEffect(()=>{const el=root.current;if(!el)return;const r=rangeAt(el,note.anchor.start,note.anchor.end);if(r&&r.toString()===note.anchor.text){el.dataset.noteLocated=note.id;scrollReadingSource(r);if(typeof Highlight!=='undefined'&&'highlights' in CSS)CSS.highlights.set('reading-focus',new Highlight(r));}return()=>{if(typeof CSS!=='undefined'&&'highlights' in CSS)CSS.highlights.delete('reading-focus');};},[note]);
  return <div ref={root} data-reading-source={note.anchor.sourceKey}><MarkdownContent>{note.anchor.origin?.kind==='translation'?note.anchor.origin.content:note.anchor.context}</MarkdownContent></div>;
}
