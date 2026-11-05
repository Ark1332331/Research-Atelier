'use client';

import {useEffect,useRef,useState,type DragEvent,type InputHTMLAttributes} from 'react';
import Link from 'next/link';
import {useRouter,useSearchParams} from 'next/navigation';
import PageHead from './page-head';
import DetailDrawer from './detail-drawer';
import type {StudyNode} from '@/lib/study-library-types';
import '@/app/study-library.css';

type Editor={kind:'create'|'rename'|'move'|'delete';node?:StudyNode;parentId?:string|null};
const sortNodes=(nodes:StudyNode[])=>[...nodes].sort((a,b)=>a.order-b.order||a.name.localeCompare(b.name,'zh-CN',{numeric:true}));
const kindLabel=(node:StudyNode)=>node.kind==='library'?'资料库':node.kind==='folder'?'文件夹':'Markdown';
function within(nodes:StudyNode[],id:string,parent:string):boolean{
  const visited=new Set<string>();let item=nodes.find(n=>n.id===id);
  while(item&&!visited.has(item.id)){if(item.id===parent)return true;visited.add(item.id);item=nodes.find(n=>n.id===item!.parentId);}return false;
}
function nodePath(nodes:StudyNode[],id:string):string{
  const parts:string[]=[],seen=new Set<string>();let item=nodes.find(n=>n.id===id);
  while(item&&!seen.has(item.id)){seen.add(item.id);parts.unshift(item.name);item=nodes.find(n=>n.id===item!.parentId);}return parts.join(' / ');
}
async function jsonRequest(body:object){
  const response=await fetch('/api/study-library',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  const data=await response.json();if(!response.ok)throw Error(data.error||'操作失败，请重试');return data as {nodes:StudyNode[];createdId?:string};
}

export default function StudyLibrary(){
  const router=useRouter(),params=useSearchParams(),selectedId=params.get('folder');
  const [nodes,setNodes]=useState<StudyNode[]>([]),[loading,setLoading]=useState(true),[error,setError]=useState('');
  const [pending,setPending]=useState(false),[editor,setEditor]=useState<Editor|null>(null),[importing,setImporting]=useState(false);
  const [collapsed,setCollapsed]=useState<string[]>([]),[search,setSearch]=useState(''),[notice,setNotice]=useState('');
  const [dragging,setDragging]=useState<string|null>(null);
  const serial=useRef(0),busy=useRef(false);
  const selected=nodes.find(n=>n.id===selectedId),parent=selected?.kind==='document'?selected.parentId:selected?.id??null;
  const siblings=sortNodes(nodes.filter(n=>n.parentId===selected?.parentId)),index=siblings.findIndex(n=>n.id===selected?.id);
  const canImport=nodes.some(n=>n.kind==='library');
  async function reload(){const token=++serial.current;try{const r=await fetch('/api/study-library',{cache:'no-store'}),d=await r.json();if(!r.ok)throw Error(d.error||'资料加载失败');if(token===serial.current){setNodes(d.nodes);setError('');}}catch(e){if(token===serial.current)setError(e instanceof Error?e.message:'资料加载失败');}finally{if(token===serial.current)setLoading(false);}}
  useEffect(()=>{let gone=false;const version=serial;queueMicrotask(()=>{if(!gone)void reload();});return()=>{gone=true;version.current++;};},[]);
  function select(id:string|null){setSearch('');router.push(id?`/?view=study&folder=${encodeURIComponent(id)}`:'/?view=study',{scroll:false});}
  function accepted(next:StudyNode[]){serial.current++;setNodes(next);setError('');}
  async function move(id:string,parentId:string|null,beforeId?:string){
    if(busy.current)return;busy.current=true;setPending(true);setError('');
    try{const d=await jsonRequest({action:'move',id,parentId,...(beforeId?{beforeId}:{})});accepted(d.nodes);setNotice('目录已更新，文档链接和阅读记录已保留。');}
    catch(e){setError(e instanceof Error?e.message:'移动失败');}finally{busy.current=false;setPending(false);setDragging(null);}
  }
  function drop(event:DragEvent,parentId:string|null,beforeId?:string){event.preventDefault();event.stopPropagation();const id=event.dataTransfer.getData('application/x-study-node');if(id&&id!==beforeId)void move(id,parentId,beforeId);}
  function tree(parentId:string|null,depth=0){return sortNodes(nodes.filter(n=>n.parentId===parentId)).map(node=><li key={node.id}>
    {dragging&&<div className="study-drop-line" onDragOver={e=>e.preventDefault()} onDrop={e=>drop(e,parentId,node.id)} aria-hidden="true"/>}
    <div className={'study-tree-row'+(selectedId===node.id?' is-selected':'')} draggable={!pending} onDragStart={e=>{e.dataTransfer.setData('application/x-study-node',node.id);e.dataTransfer.effectAllowed='move';setDragging(node.id);}} onDragEnd={()=>setDragging(null)} onDragOver={e=>{if(node.kind!=='document')e.preventDefault();}} onDrop={e=>{if(node.kind!=='document')drop(e,node.id);}} style={{paddingLeft:8+depth*14}}>
      {node.kind!=='document'?<button type="button" className="study-tree-toggle" aria-label={`${collapsed.includes(node.id)?'展开':'收起'} ${node.name}`} aria-expanded={!collapsed.includes(node.id)} onClick={()=>setCollapsed(ids=>ids.includes(node.id)?ids.filter(id=>id!==node.id):[...ids,node.id])}>{collapsed.includes(node.id)?'›':'⌄'}</button>:<span className="study-doc-mark" aria-hidden="true">·</span>}
      <button type="button" className="study-tree-name" aria-current={selectedId===node.id?'true':undefined} onClick={()=>select(node.id)} title={node.name}>{node.name}</button>
    </div>
    {node.kind!=='document'&&!collapsed.includes(node.id)&&<ul>{tree(node.id,depth+1)}</ul>}
  </li>);}
  const visible=search.trim()?sortNodes(nodes.filter(n=>n.name.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()))):sortNodes(nodes.filter(n=>n.parentId===(selected?.kind==='document'?selected.parentId:selected?.id??null)));
  const breadcrumbs:StudyNode[]=[];let crumb=selected;while(crumb&&!breadcrumbs.some(n=>n.id===crumb!.id)){breadcrumbs.unshift(crumb);crumb=nodes.find(n=>n.id===crumb!.parentId);}
  return <section className="study-library">
    <PageHead num="02" name="学习" title="学习资料" desc="把教材、讲义和习题放在一起，按自己的目录慢慢读。" meta={`${nodes.filter(n=>n.kind==='library').length} 个资料库 · ${nodes.filter(n=>n.kind==='document').length} 篇文档`}/>
    <div className="study-library-top"><button className="btn btn--accent" onClick={()=>setImporting(true)} disabled={loading||pending}>导入资料</button><button className="btn" onClick={()=>setEditor({kind:'create',parentId:null})} disabled={loading||pending}>新建资料库</button><label className="study-search"><span className="sr-only">搜索学习资料</span><input className="field" type="search" placeholder="搜索文档或文件夹…" value={search} onChange={e=>setSearch(e.target.value)}/></label></div>
    {error&&<p className="study-alert" role="alert">{error} <button className="text-button" onClick={()=>void reload()}>重新加载</button></p>}
    {notice&&<p className="study-notice" role="status">{notice}</p>}
    {loading?<p className="study-empty">正在打开学习资料…</p>:<div className="study-library-layout">
      <aside className="study-library-sidebar" aria-label="学习资料目录"><button className={'study-all'+(!selected?' is-selected':'')} onClick={()=>select(null)}>全部资料库</button><ul className="study-tree">{tree(null)}</ul><p className="study-tree-hint">拖到文件夹内可移动；拖到条目之间可排序。也可选中后使用管理按钮。</p></aside>
      <div className="study-library-main">
        <nav className="study-breadcrumbs" aria-label="目录位置"><button onClick={()=>select(null)}>学习资料</button>{breadcrumbs.map(n=><span key={n.id}> / <button onClick={()=>select(n.id)}>{n.name}</button></span>)}</nav>
        <div className="study-directory-head"><div><h2>{search?'搜索结果':selected?.name??'我的资料库'}</h2><p>{selected?kindLabel(selected):'一本教材或一组资料，一个资料库'}</p></div>{parent&&<button className="btn" onClick={()=>setEditor({kind:'create',parentId:parent})} disabled={pending}>新建文件夹</button>}</div>
        {selected&&<div className="study-manage-actions" aria-label="管理选中条目">
          {selected.kind==='document'&&<Link className="btn btn--primary" href={`/study/${selected.id}`}>开始阅读</Link>}
          {selected.kind!=='document'&&<button className="btn" onClick={()=>setImporting(true)} disabled={pending}>导入到这里</button>}
          <button className="text-button" onClick={()=>setEditor({kind:'rename',node:selected})} disabled={pending}>重命名</button>
          {selected.kind!=='library'&&<button className="text-button" onClick={()=>setEditor({kind:'move',node:selected})} disabled={pending}>移动到…</button>}
          <button className="text-button" onClick={()=>void move(selected.id,selected.parentId,siblings[index-1]?.id)} disabled={pending||index<=0}>上移</button>
          <button className="text-button" onClick={()=>void move(selected.id,selected.parentId,siblings[index+2]?.id)} disabled={pending||index<0||index>=siblings.length-1}>下移</button>
          <button className="text-button study-danger" onClick={()=>setEditor({kind:'delete',node:selected})} disabled={pending}>删除</button>
        </div>}
        {!visible.length?<div className="study-empty"><h3>{search?'没有找到匹配资料':selected?'这个目录还是空的':'从一本教材开始'}</h3><p>{search?'换个关键词再试试。':'可以直接粘贴 Markdown，也可以导入文件或包含图片的资料文件夹。'}</p>{!search&&<button className="btn" onClick={()=>setImporting(true)}>选择资料</button>}</div>:<ul className="study-file-list">{visible.map(node=><li key={node.id}>
          {dragging&&<div className="study-drop-line" onDragOver={e=>e.preventDefault()} onDrop={e=>drop(e,node.parentId,node.id)} aria-hidden="true"/>}
          <div className={'study-file-row'+(selectedId===node.id?' is-selected':'')} draggable={!pending} onDragStart={e=>{e.dataTransfer.setData('application/x-study-node',node.id);setDragging(node.id);}} onDragEnd={()=>setDragging(null)} onDragOver={e=>{if(node.kind!=='document')e.preventDefault();}} onDrop={e=>{if(node.kind!=='document')drop(e,node.id);}}>
            <span className="study-file-kind" aria-hidden="true">{node.kind==='document'?'MD':node.kind==='library'?'库':'夹'}</span>
            <div className="study-file-copy">{node.kind==='document'?<Link href={`/study/${node.id}`}>{node.name}</Link>:<button onClick={()=>select(node.id)}>{node.name}</button>}<small>{search?nodePath(nodes,node.id):node.kind==='document'?'Markdown 文档':`${nodes.filter(n=>n.parentId===node.id).length} 个条目`}</small></div>
            <button className="text-button" aria-label={`管理 ${node.name}`} onClick={()=>select(node.id)}>管理</button>
          </div>
        </li>)}</ul>}
      </div>
    </div>}
    {editor&&<NodeEditor key={`${editor.kind}:${editor.node?.id??editor.parentId}`} editor={editor} nodes={nodes} close={()=>setEditor(null)} saved={(next,id)=>{accepted(next);setEditor(null);if(id!==undefined)select(id);setNotice('目录已保存。');}}/>}
    {importing&&<StudyImport nodes={nodes} initialParent={parent??nodes.find(n=>n.kind==='library')?.id??''} preferNew={!canImport} close={()=>{setImporting(false);void reload();}} saved={(next,id,message)=>{accepted(next);select(id);setImporting(false);setNotice(message);}}/>}
  </section>;
}

function NodeEditor({editor,nodes,close,saved}:{editor:Editor;nodes:StudyNode[];close:()=>void;saved:(nodes:StudyNode[],selected?:string|null)=>void}){
  const [name,setName]=useState(editor.node?.name??''),[target,setTarget]=useState(editor.node?.parentId??''),[busy,setBusy]=useState(false),[error,setError]=useState('');const running=useRef(false);
  const title=editor.kind==='create'?(editor.parentId?'新建文件夹':'新建资料库'):editor.kind==='rename'?'重命名':editor.kind==='move'?'移动到目录':'删除资料';
  const targets=nodes.filter(n=>n.kind!=='document'&&(!editor.node||!within(nodes,n.id,editor.node.id)));
  async function save(){if(running.current)return;running.current=true;setBusy(true);setError('');try{
    const body=editor.kind==='create'?{action:'create',kind:editor.parentId?'folder':'library',name,parentId:editor.parentId??null}:editor.kind==='rename'?{action:'rename',id:editor.node!.id,name}:editor.kind==='move'?{action:'move',id:editor.node!.id,parentId:target}:{action:'delete',id:editor.node!.id};
    const result=await jsonRequest(body);saved(result.nodes,editor.kind==='delete'?editor.node!.parentId:result.createdId);
  }catch(e){setError(e instanceof Error?e.message:'保存失败');}finally{running.current=false;setBusy(false);}}
  return <DetailDrawer title={title} onClose={close} busy={busy}><form className="study-form" onSubmit={e=>{e.preventDefault();void save();}}>
    {(editor.kind==='create'||editor.kind==='rename')&&<label>名称<input autoFocus className="field" aria-label="名称" maxLength={160} value={name} onChange={e=>setName(e.target.value)} required disabled={busy}/></label>}
    {editor.kind==='move'&&<label>目标目录<select className="field" aria-label="目标目录" value={target} onChange={e=>setTarget(e.target.value)} disabled={busy} required>{targets.map(n=><option key={n.id} value={n.id}>{nodePath(nodes,n.id)}</option>)}</select></label>}
    {editor.kind==='delete'&&<p>从学习资料中移除「{editor.node!.name}」{editor.node!.kind!=='document'?`及其下的 ${nodes.filter(n=>n.id!==editor.node!.id&&within(nodes,n.id,editor.node!.id)).length} 个条目`:''}？已有笔记仍保留摘录，但不能再定位到已删除原文。</p>}
    {error&&<p className="study-alert" role="alert">{error}</p>}<div className="study-form-actions"><button className="btn btn--primary" type="submit" disabled={busy||((editor.kind==='create'||editor.kind==='rename')&&!name.trim())}>{busy?'保存中…':editor.kind==='delete'?'确认删除':'保存'}</button><button type="button" className="btn" disabled={busy} onClick={close}>取消</button></div>
  </form></DetailDrawer>;
}

function StudyImport({nodes,initialParent,preferNew,close,saved}:{nodes:StudyNode[];initialParent:string;preferNew:boolean;close:()=>void;saved:(nodes:StudyNode[],id:string,message:string)=>void}){
  const [files,setFiles]=useState<File[]>([]),[target,setTarget]=useState(preferNew?'new':initialParent),[name,setName]=useState(''),[folder,setFolder]=useState(false),[stripRoot,setStripRoot]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const [mode,setMode]=useState<'files'|'paste'>('files'),[markdown,setMarkdown]=useState(''),[title,setTitle]=useState('');
  const titleEdited=useRef(false);
  const input=useRef<HTMLInputElement>(null),directory=useRef<HTMLInputElement>(null),running=useRef(false);
  const valid=files.filter(f=>/\.(?:md|markdown|png|jpe?g|webp|gif)$/i.test(f.name));
  const docs=valid.filter(f=>/\.(?:md|markdown)$/i.test(f.name));
  function choose(values:FileList|null,isFolder:boolean){const next=Array.from(values??[]);setFiles(next);setFolder(isFolder);setError('');if(!name&&next.length)setName(isFolder?next[0].webkitRelativePath.split('/')[0]:next.length===1?next[0].name.replace(/\.(md|markdown)$/i,''):'学习资料');}
  async function upload(){if(running.current)return;running.current=true;setBusy(true);setError('');let parentId=target;try{
    let uploads=valid;
    let integrity: {bytes:number;sha256:string}[]|undefined;
    if(mode==='paste'){
      if(!markdown.trim())throw Error('请粘贴 Markdown 正文');
      if(!title.trim()||/[\\/:\u0000-\u001f\u007f]/.test(title))throw Error('请填写文档标题，标题不能包含 /、\\、: 或控制字符');
      if(markdown.includes('\0'))throw Error('正文包含无效字符，请移除后重试');
      const file=new File([markdown],/\.(?:md|markdown)$/i.test(title.trim())?title.trim():title.trim()+'.md',{type:'text/markdown;charset=utf-8'});
      if(file.size>16*1024*1024)throw Error('单篇 Markdown 不能超过 16 MiB');uploads=[file];
      const bytes=await file.arrayBuffer();
      if(!crypto.subtle)throw Error('当前地址无法校验粘贴内容，请通过 localhost 或 HTTPS 打开后重试');
      const digest=await crypto.subtle.digest('SHA-256',bytes);
      integrity=[{bytes:bytes.byteLength,sha256:Array.from(new Uint8Array(digest),byte=>byte.toString(16).padStart(2,'0')).join('')}];
    }
    if(target==='new'){const result=await jsonRequest({action:'create',kind:'library',name,parentId:null});if(!result.createdId)throw Error('资料库创建失败');parentId=result.createdId;setTarget(parentId);setStripRoot(mode==='files'&&folder);}
    const data=new FormData();data.set('parentId',parentId);const paths=uploads.map(f=>{const path=mode==='files'&&folder?f.webkitRelativePath:f.name;return mode==='files'&&folder&&(target==='new'||stripRoot)?path.split('/').slice(1).join('/'):path;});data.set('paths',JSON.stringify(paths));for(const file of uploads)data.append('files',file);
    if(integrity)data.set('integrity',JSON.stringify(integrity));
    const response=await fetch('/api/study-library/import',{method:'POST',body:data}),result=await response.json();if(!response.ok)throw Error(result.error||'资料导入失败');
    saved(result.nodes,parentId,`已导入 ${result.documentIds.length} 篇文档。${result.warnings?.join('；')??''}`);
  }catch(e){setError(e instanceof Error?e.message:'导入失败，请重试');}finally{running.current=false;setBusy(false);}}
  return <DetailDrawer title="导入学习资料" onClose={close} busy={busy}><form className="study-form" onSubmit={e=>{e.preventDefault();void upload();}}>
    <div className="study-import-modes" role="group" aria-label="导入方式"><button type="button" aria-pressed={mode==='files'} disabled={busy} onClick={()=>{setMode('files');setError('');}}>文件 / 文件夹</button><button type="button" aria-pressed={mode==='paste'} disabled={busy} onClick={()=>{setMode('paste');setError('');}}>粘贴 Markdown</button></div>
    {mode==='files'?<><p>选择外部工具转换好的 Markdown；有插图时，请选择包含图片的整个资料文件夹。</p>
    <div className="study-form-actions"><button className="btn" type="button" disabled={busy} onClick={()=>input.current?.click()}>选择 Markdown</button><button className="btn" type="button" disabled={busy} onClick={()=>directory.current?.click()}>选择资料文件夹</button></div>
    <input ref={input} type="file" hidden multiple accept=".md,.markdown" aria-label="Markdown 文件" onChange={e=>choose(e.target.files,false)}/>
    <input ref={directory} type="file" hidden multiple {...({webkitdirectory:''} as InputHTMLAttributes<HTMLInputElement>)} aria-label="资料文件夹" onChange={e=>choose(e.target.files,true)}/>
    {files.length>0&&<p className="study-import-summary" role="status">{docs.length} 篇 Markdown · {valid.length-docs.length} 张图片{files.length>valid.length?` · 已忽略 ${files.length-valid.length} 个其他文件`:''}</p>}</>:<>
      <p>把 Markdown 原文粘贴到这里，标题、公式、表格和代码块会按原格式保存。</p>
      <label>文档标题<input className="field" aria-label="文档标题" placeholder="例如：条件期望练习" value={title} maxLength={160} required disabled={busy} onChange={e=>{titleEdited.current=true;setTitle(e.target.value);}}/></label>
      <label>Markdown 正文<textarea className="field study-paste-content" aria-label="Markdown 正文" placeholder={'# 标题\n\n在这里粘贴 Markdown 文字…'} rows={12} value={markdown} required disabled={busy} spellCheck={false} onChange={e=>{
        const value=e.target.value;setMarkdown(value);
        if(!titleEdited.current){const heading=value.match(/^ {0,3}#{1,6}\s+(.+?)(?:\s+#+)?\s*$/m)?.[1];setTitle(heading?.replace(/[\\/:\u0000-\u001f\u007f]/g,'-').slice(0,160)??'');}
        if(!name)setName('学习资料');
      }}/></label>
      {markdown&&<div className="study-import-summary" role="status"><p>已接收 {Array.from(markdown).length.toLocaleString('zh-CN')} 个字符 · {markdown.split(/\r\n?|\n/).length} 行</p><details><summary>核对正文末尾</summary><pre style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere',maxHeight:160,overflow:'auto',marginTop:8}}>{markdown.trimEnd().slice(-280)}</pre></details><small>请确认末尾包含最后一道题；若这里已经不完整，请从原资料重新复制。</small></div>}
      <small>正文里的本地图片需要一同导入；含本地插图的资料可切换到“文件 / 文件夹”。</small>
    </>}
    <label>导入到<select className="field" aria-label="导入到" value={target} disabled={busy} onChange={e=>setTarget(e.target.value)}><option value="new">新建资料库…</option>{nodes.filter(n=>n.kind!=='document').map(n=><option key={n.id} value={n.id}>{nodePath(nodes,n.id)}</option>)}{target!=='new'&&!nodes.some(n=>n.id===target)&&<option value={target}>{name}</option>}</select></label>
    {target==='new'&&<label>资料库名称<input className="field" aria-label="资料库名称" value={name} maxLength={160} required disabled={busy} onChange={e=>setName(e.target.value)}/></label>}
    {mode==='files'&&<small>支持 MD、PNG、JPG、WebP、GIF。导入后保留目录与图片引用，可继续移动、改名和排序。</small>}
    {error&&<p className="study-alert" role="alert">{error}</p>}<button className="btn btn--accent" type="submit" disabled={busy||(mode==='paste'?(!markdown.trim()||!title.trim()):!docs.length)||!target||target==='new'&&!name.trim()}>{busy?'正在导入…':'开始导入'}</button>
  </form></DetailDrawer>;
}
