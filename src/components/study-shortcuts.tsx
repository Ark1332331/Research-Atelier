'use client';
import {useCallback,useEffect,useLayoutEffect,useRef,useState,type ReactNode} from 'react';
import DetailDrawer from './detail-drawer';
import {DEFAULT_STUDY_SHORTCUTS,validateStudyShortcuts,type StudyShortcut,type StudyShortcutSettings} from '@/lib/study-shortcuts';

export function ReadingSelectionToolbar({x,y,study,children}:{x:number;y:number;study:boolean;children:ReactNode}){
  const ref=useRef<HTMLDivElement>(null);
  useLayoutEffect(()=>{
    const el=ref.current;if(!el)return;
    const fit=()=>{const box=el.getBoundingClientRect();el.style.left=Math.max(8,Math.min(x,innerWidth-box.width-8))+'px';el.style.top=Math.max(8,Math.min(y,innerHeight-box.height-8))+'px';};
    fit();const resize=new ResizeObserver(fit);resize.observe(el);return()=>resize.disconnect();
  },[x,y]);
  return <div ref={ref} className={`reading-selection-actions${study?' is-study-menu':''}`} role="toolbar" aria-label="回答选区操作" style={{left:x,top:y}} onMouseDown={e=>e.preventDefault()}>{children}</div>;
}

export function useStudyShortcuts(enabled:boolean){
  const [settings,setSettings]=useState<StudyShortcutSettings>({revision:0,shortcuts:DEFAULT_STUDY_SHORTCUTS});
  const [editing,setEditing]=useState(false),[loading,setLoading]=useState(false),[error,setError]=useState('');
  const version=useRef(0);
  const load=useCallback(async()=>{
    const serial=++version.current;setLoading(true);setError('');
    try{const r=await fetch('/api/study-shortcuts',{cache:'no-store'});const data=await r.json();if(!r.ok)throw Error(data.error);if(serial===version.current)setSettings(data);}
    catch(e){if(serial===version.current)setError(e instanceof Error?e.message:'加载失败');}
    finally{if(serial===version.current)setLoading(false);}
  },[]);
  useEffect(()=>{if(enabled){let gone=false;const serial=version;queueMicrotask(()=>{if(!gone)void load();});return()=>{gone=true;serial.current++;};}},[enabled,load]);
  const configure=()=>{setEditing(true);void load();};
  return {
    items:settings.shortcuts.filter(item=>item.enabled),configure,
    editor:editing?(loading||error?<DetailDrawer title="自定义快捷提问" onClose={()=>setEditing(false)}><p role={error?'alert':'status'}>{error||'正在读取快捷指令…'}</p>{error&&<button className="btn" onClick={()=>void load()}>重新加载</button>}</DetailDrawer>:<ShortcutEditor settings={settings} onClose={()=>setEditing(false)} onSave={async shortcuts=>{
      const r=await fetch('/api/study-shortcuts',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({shortcuts,revision:settings.revision})});
      const data=await r.json();if(!r.ok)throw Error(data.error||'保存失败');version.current++;setSettings(data);setEditing(false);
    }}/>):null,
  };
}

function ShortcutEditor({settings,onClose,onSave}:{settings:StudyShortcutSettings;onClose:()=>void;onSave:(items:StudyShortcut[])=>Promise<void>}){
  const [items,setItems]=useState(()=>settings.shortcuts.map(item=>({...item}))),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  const saving=useRef(false);
  const edit=(id:string,patch:Partial<StudyShortcut>)=>setItems(values=>values.map(item=>item.id===id?{...item,...patch}:item));
  function move(index:number,delta:number){setItems(values=>{const next=[...values];[next[index],next[index+delta]]=[next[index+delta],next[index]];return next;});}
  async function save(){if(saving.current)return;try{const clean=validateStudyShortcuts(items);saving.current=true;setBusy(true);setError('');await onSave(clean);}catch(e){setError(e instanceof Error?e.message:'保存失败');}finally{saving.current=false;setBusy(false);}}
  return <DetailDrawer title="自定义快捷提问" onClose={onClose} busy={busy}>
    <div className="study-shortcuts-editor"><p className="study-shortcuts-intro">选中文字后，点击快捷项即可提问。选区、公式和上下文会自动带上，只需填写希望 AI 怎样回答。</p>
      <fieldset disabled={busy}><div className="study-shortcuts-list">{items.map((item,index)=><section className="study-shortcut-editor" key={item.id} aria-label={`快捷指令 ${index+1}`}>
        <div className="study-shortcut-editor-head"><label><input type="checkbox" checked={item.enabled} onChange={e=>edit(item.id,{enabled:e.target.checked})}/>启用</label><div><button type="button" aria-label={`上移${item.title}`} disabled={index===0} onClick={()=>move(index,-1)}>↑</button><button type="button" aria-label={`下移${item.title}`} disabled={index===items.length-1} onClick={()=>move(index,1)}>↓</button><button type="button" aria-label={`删除${item.title}`} onClick={()=>setItems(values=>values.filter(v=>v.id!==item.id))}>删除</button></div></div>
        <label>按钮名称<input value={item.title} maxLength={20} placeholder="例如：举个例子" onChange={e=>edit(item.id,{title:e.target.value})}/></label>
        <label>提问指令<textarea aria-label="提问指令" rows={3} maxLength={2000} value={item.prompt} placeholder="例如：用一个具体例子解释这段话。" onChange={e=>edit(item.id,{prompt:e.target.value})}/></label>
      </section>)}</div><div className="study-shortcuts-add"><button type="button" className="btn" disabled={items.length>=12} onClick={()=>setItems(values=>[...values,{id:crypto.randomUUID(),title:'',prompt:'',enabled:true}])}>＋ 新增快捷指令</button><small>{items.length} / 12</small></div></fieldset>
      {error&&<p role="alert" className="reading-error">{error}</p>}<div className="study-shortcuts-footer"><button className="btn" disabled={busy} onClick={onClose}>取消</button><button className="btn btn--primary" disabled={busy} onClick={()=>void save()}>{busy?'保存中…':'保存快捷指令'}</button></div>
    </div>
  </DetailDrawer>;
}
