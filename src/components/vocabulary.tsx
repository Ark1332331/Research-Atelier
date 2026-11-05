"use client";
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import MarkdownContent from './markdown-content';
import type { VocabularyEntry } from '@/lib/vocabulary';
export default function Vocabulary({initialPaper=""}:{initialPaper?:string}={}){
  const router=useRouter();
  const params=useSearchParams();
  const paper=params.get('paper')??initialPaper;
  const unassociated=!paper&&params.get('paperScope')==='unassociated';
  const scope=paper?`paper:${paper}`:unassociated?'unassociated':'';
  const [entries,setEntries]=useState<VocabularyEntry[]>([]),[search,setSearch]=useState(''),[error,setError]=useState('');
  const [papers,setPapers]=useState<{slug:string;title:string}[]>([]);
  const [paperError,setPaperError]=useState('');
  const readVersion=useRef(0);
  useEffect(()=>{let gone=false;const serial=readVersion;const load=async()=>{const version=++serial.current;try{const r=await fetch('/api/reading-collection');const d=await r.json();if(!r.ok)throw Error(d.error);if(!gone&&version===serial.current)setEntries(d.entries);}catch(e){if(!gone)setError(e instanceof Error?e.message:'加载失败');}};void load();window.addEventListener('reading-words-changed',load);return()=>{gone=true;serial.current++;window.removeEventListener('reading-words-changed',load);};},[]);
  async function remove(id:string){try{const r=await fetch('/api/reading-collection',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'delete-word',id})});const d=await r.json();if(!r.ok)throw Error(d.error);readVersion.current++;setEntries(items=>items.filter(e=>e.id!==id));window.dispatchEvent(new Event("reading-words-changed"));}catch(e){setError(e instanceof Error?e.message:'删除失败');}}
  useEffect(()=>{
    let gone=false;
    async function loadPapers(){
      try{
        const r=await fetch('/api/paper');
        const d=await r.json();
        if(!r.ok||!Array.isArray(d.papers))throw Error('论文列表暂不可用');
        if(!gone)setPapers(d.papers);
      }catch{
        if(!gone)setPaperError('论文名称暂时无法加载，仍可按已收藏生词的论文标识筛选。');
      }
    }
    void loadPapers();
    return()=>{gone=true;};
  },[]);

  function changeScope(value:string){
    const next=new URLSearchParams(params.toString());
    next.set('view','vocabulary');
    next.delete('paper');
    next.delete('paperScope');
    if(value.startsWith('paper:'))next.set('paper',value.slice(6));
    else if(value==='unassociated')next.set('paperScope','unassociated');
    router.push(`/?${next.toString()}`,{scroll:false});
  }

  const paperOptions=new Map(papers.map(p=>[p.slug,p.title||p.slug]));
  for(const entry of entries){if(entry.slug&&!paperOptions.has(entry.slug))paperOptions.set(entry.slug,entry.slug);}
  if(paper&&!paperOptions.has(paper))paperOptions.set(paper,paper);
  const filtered=entries.filter(e=>(paper?e.slug===paper:unassociated?!e.slug:true)&&`${e.text} ${e.meaning}`.toLowerCase().includes(search.toLowerCase()));

  return <section className="companion-page vocabulary-page">
    <header className="companion-heading"><h1>生词本</h1><p>阅读和对话中主动收藏的英文单词，连同当时的语境一起留下。</p></header>
    <div className="study-filter">
      <input className="field" aria-label="搜索生词" value={search} onChange={e=>setSearch(e.target.value)} placeholder="搜索单词或释义…"/>
      <select className="field" aria-label="生词论文范围" value={scope} onChange={e=>changeScope(e.target.value)}>
        <option value="">全部论文</option>
        <option value="unassociated">未关联论文</option>
        {Array.from(paperOptions,([slug,title])=><option key={slug} value={`paper:${slug}`}>{title}</option>)}
      </select>
    </div>
    {paperError&&<p className="soft-copy" role="status">{paperError}</p>}
    {error&&<p role="alert">{error}</p>}
    <p className="soft-copy">{filtered.length} 个词语</p>
    {filtered.map(w=><article className="surface-card vocabulary-item" key={w.id}>
      <h2>{w.text}</h2><MarkdownContent>{w.meaning}</MarkdownContent><small>{[w.lemma,w.partOfSpeech].filter(Boolean).join(' · ')}</small>
      <details><summary>原句与用法</summary><blockquote>{w.context}</blockquote><p>{w.usage}</p></details>
      <div className="inline-actions">
        {w.sourceAnchor?.scope.startsWith('/')&&!w.sourceAnchor.scope.startsWith('//')?<Link href={w.sourceAnchor.scope} className="text-button">回到来源 →</Link>:w.slug?<Link href={`/read/${w.slug}`} className="text-button">{w.page?`第 ${w.page} 页 · `:''}回到论文 →</Link>:null}
        <button className="text-button" onClick={()=>void remove(w.id)}>移除</button>
      </div>
    </article>)}
    {!filtered.length&&<p className="empty-study">{search?'没有匹配的词语，试试其他关键词。':scope?'这个范围还没有收藏的生词。':'划选词语并翻译，再选择“加入生词本”。'}</p>}
  </section>;
}
