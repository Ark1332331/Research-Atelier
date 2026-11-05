"use client";

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useReadingNotes } from './reading-notes';

export default function ReadingNotesLibrary(){
  const {notes,loading,error,edit,remove,locate,reload}=useReadingNotes()!;
  const router=useRouter();
  const params=useSearchParams();
  const paper=params.get('paper')??'';
  const unassociated=!paper&&params.get('paperScope')==='unassociated';
  const scope=paper?`paper:${paper}`:unassociated?'unassociated':'';
  const [search,setSearch]=useState('');
  const [papers,setPapers]=useState<{slug:string;title:string}[]>([]);
  const [paperError,setPaperError]=useState('');
  const [actionError,setActionError]=useState('');
  const [pending,setPending]=useState<string|null>(null);

  useEffect(()=>{
    let gone=false;
    async function loadPapers(){
      try{
        const response=await fetch('/api/paper');
        const data=await response.json();
        if(!response.ok||!Array.isArray(data.papers))throw Error('论文列表暂不可用');
        if(!gone)setPapers(data.papers);
      }catch{
        if(!gone)setPaperError('论文名称暂时无法加载，仍可按笔记的论文标识筛选。');
      }
    }
    void loadPapers();
    return()=>{gone=true;};
  },[]);

  function changeScope(value:string){
    const next=new URLSearchParams(params.toString());
    next.set('view','notes');
    next.delete('paper');
    next.delete('paperScope');
    if(value.startsWith('paper:'))next.set('paper',value.slice(6));
    else if(value==='unassociated')next.set('paperScope','unassociated');
    router.push(`/?${next.toString()}`,{scroll:false});
  }

  async function deleteNote(id:string){
    setPending(id);
    setActionError('');
    try{await remove(id);}
    catch(cause){setActionError(cause instanceof Error?cause.message:'删除笔记失败，请重试。');}
    finally{setPending(null);}
  }

  async function retry(){
    setActionError('');
    try{await reload();}
    catch(cause){setActionError(cause instanceof Error?cause.message:'读取笔记失败，请重试。');}
  }

  const paperOptions=new Map(papers.map(item=>[item.slug,item.title||item.slug]));
  for(const note of notes){
    const slug=note.anchor.slug;
    if(slug&&!paperOptions.has(slug))paperOptions.set(slug,slug);
  }
  if(paper&&!paperOptions.has(paper))paperOptions.set(paper,paper);
  const query=search.trim().toLowerCase();
  const filtered=notes.filter(note=>
    (paper?note.anchor.slug===paper:unassociated?!note.anchor.slug:true)&&
    `${note.comment} ${note.anchor.text}`.toLowerCase().includes(query)
  );

  return <section className="companion-page vocabulary-page reading-notes-library" aria-busy={loading}>
    <header className="companion-heading"><h1>随心笔记</h1><p>留下阅读时的想法，点击笔记回到原文。</p></header>
    <div className="study-filter">
      <input className="field" aria-label="搜索随心笔记" value={search} onChange={event=>setSearch(event.target.value)} placeholder="搜索笔记或原文…"/>
      <select className="field" aria-label="笔记论文范围" value={scope} onChange={event=>changeScope(event.target.value)}>
        <option value="">全部论文</option>
        <option value="unassociated">未关联论文</option>
        {Array.from(paperOptions,([slug,title])=><option key={slug} value={`paper:${slug}`}>{title}</option>)}
      </select>
    </div>
    {paperError&&<p className="soft-copy" role="status">{paperError}</p>}
    {error&&<div role="alert"><p>{error}</p><button className="text-button" disabled={loading} onClick={()=>void retry()}>重新加载</button></div>}
    {actionError&&<p role="alert">{actionError}</p>}
    {loading?<p className="soft-copy" role="status">正在加载笔记…</p>:<p className="soft-copy">{filtered.length} 条笔记</p>}
    {filtered.map(note=><article className="surface-card vocabulary-item reading-note-item" key={note.id}>
      <h2><button type="button" className="text-button" style={{display:'block',width:'100%',font:'inherit',color:'inherit',textAlign:'left',whiteSpace:'pre-wrap',overflowWrap:'anywhere'}} aria-label={`定位笔记：${note.comment}`} onClick={()=>locate(note.id)}>{note.comment}</button></h2>
      <blockquote style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{note.anchor.text}</blockquote>
      <small>{[note.anchor.label,...[note.anchor.slug?paperOptions.get(note.anchor.slug):null,note.anchor.page?'第 '+note.anchor.page+' 页':null].filter(part=>part&&!note.anchor.label.includes(part))].filter(Boolean).join(' · ')}</small>
      <div className="inline-actions">
        <button type="button" className="text-button" disabled={pending!==null} onClick={()=>edit(note.id)}>编辑笔记</button>
        <button type="button" className="text-button danger-text" disabled={pending!==null} onClick={()=>void deleteNote(note.id)}>{pending===note.id?'删除中…':'删除笔记'}</button>
      </div>
    </article>)}
    {!loading&&!error&&!filtered.length&&<p className="empty-study">{query?'没有匹配的笔记，试试其他关键词。':scope?'这个范围还没有笔记。':'划选阅读中的文字，选择“随心笔记”，写下自己的想法。'}</p>}
  </section>;
}
