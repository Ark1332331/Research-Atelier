"use client";
import {useId,useRef,useState} from 'react';
import {announcePaperChange} from '@/lib/paper-events';

/** The same identity controls are used in the library, project, and reader. */
export default function PaperActions({title,slug,projectId,onRenamed,onDeleted,compact=false}:{
  title:string;slug?:string;projectId?:string;onRenamed?:(title:string)=>void;onDeleted?:()=>void;compact?:boolean;
}) {
  const dialogId=useId();
  const [mode,setMode]=useState<'rename'|'delete'|null>(null),[name,setName]=useState(title),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const dialog=useRef<HTMLDialogElement>(null),sending=useRef(false);
  function open(next:'rename'|'delete'){setMode(next);setName(title);setError('');dialog.current?.showModal();}
  function close(){if(sending.current)return;dialog.current?.close();setMode(null);}
  async function submit(){
    if(!mode||sending.current)return;sending.current=true;setBusy(true);setError('');
    try {
      const response=await fetch(projectId?'/api/projects':'/api/paper',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:mode,id:projectId,slug,title:name.trim()})});
      const data=await response.json();if(!response.ok)throw Error(data.error||'操作失败，请重试');
      dialog.current?.close();setMode(null);
      if(mode==='rename')onRenamed?.(name.trim());else onDeleted?.();
      announcePaperChange();
    }catch(e){setError(e instanceof Error?e.message:'操作失败，请重试');}
    finally{sending.current=false;setBusy(false);}
  }
  return <div className={`paper-actions${compact?' is-compact':''}`}>
    <button className="text-button" onClick={()=>open('rename')} aria-label={`重命名《${title}》`}>重命名</button>
    <button className="text-button paper-delete" onClick={()=>open('delete')} aria-label={`删除《${title}》`}>删除</button>
    <dialog ref={dialog} className="paper-action-dialog" aria-labelledby={dialogId} onCancel={e=>{if(busy)e.preventDefault();else setMode(null);}} onClick={e=>{if(e.target===dialog.current){const r=dialog.current.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)close();}}}>
      <form onSubmit={e=>{e.preventDefault();void submit();}}>
        <h2 id={dialogId}>{mode==='rename'?'重命名论文项目':'删除论文项目'}</h2>
        {mode==='rename'?<label>论文名称<input autoFocus className="field" value={name} maxLength={200} disabled={busy} onChange={e=>setName(e.target.value)} required/><small>项目、论文库和阅读器将显示同一名称，已有高光和对话继续保留。</small></label>:<p>删除《{title}》及其 PDF、译文、项目笔记和项目对话？此操作无法撤销。独立收藏的术语、生词和划线追问会保留。</p>}
        {error&&<p className="v1-error" role="alert">{error}</p>}
        <div className="inline-actions"><button type="button" className="btn btn--ghost" disabled={busy} onClick={close}>取消</button><button className={`btn ${mode==='delete'?'btn--danger':'btn--primary'}`} disabled={busy||(mode==='rename'&&!name.trim())}>{busy?'处理中…':mode==='rename'?'保存名称':'确认删除'}</button></div>
      </form>
    </dialog>
  </div>;
}
