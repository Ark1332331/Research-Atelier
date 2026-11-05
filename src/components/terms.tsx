"use client";
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import Markdown from './markdown';
import { termsForPaper, type Term } from '@/lib/terms';
export const STATUS_COLOR:Record<string,string>={'未接触':'var(--muted-foreground)','有直觉':'var(--amber)','能解释':'var(--ok)','能对应论文':'var(--ok)','能实现':'var(--ok)'};
const manual=(t:Term)=>t.collection==='manual'||t.source==='手动建卡';
export default function Terms({initialId,initialPaper=''}:{initialId?:string;initialPaper?:string}={}) {
  const [terms,setTerms]=useState<Term[]>([]);
  const [selected,setSelected]=useState<string|null>(null);
  const [paper,setPaper]=useState(initialPaper);
  const [papers,setPapers]=useState<{slug:string;title:string}[]>([]);
  const [search,setSearch]=useState('');
  const [legacy,setLegacy]=useState(false);
  const [form,setForm]=useState<Partial<Term>|null>(null);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [notice,setNotice]=useState('');
  const readVersion=useRef(0);
  useEffect(()=>{
    let gone=false;const serial=readVersion;
    const load=async(initial=false)=>{const version=++serial.current;try{const r=await fetch('/api/terms');const d=await r.json();if(!r.ok)throw Error(d.error);if(gone||version!==serial.current)return;setTerms(d.terms);if(initial){const target=d.terms.find((t:Term)=>t.id===initialId||t.legacyIds?.includes(initialId??''));setSelected(target?.id??null);setLegacy(target?!manual(target):false);}}catch(e){if(!gone)setError(e instanceof Error?e.message:'读取失败');}};
    void load(true);const changed=()=>void load();window.addEventListener('reading-terms-changed',changed);
    fetch('/api/paper').then(r=>r.json()).then(d=>{if(!gone)setPapers(d.papers??[]);}).catch(()=>{});
    return()=>{gone=true;serial.current++;window.removeEventListener('reading-terms-changed',changed);};
  },[initialId]);
  const scoped=paper?termsForPaper(terms,paper,papers.find(p=>p.slug===paper)?.title):terms;
  const filtered=scoped.filter(t=>(legacy?!manual(t):manual(t))&&`${t.name} ${t.meaning??""} ${t.note}`.toLowerCase().includes(search.toLowerCase()));
  const term=filtered.find(t=>t.id===selected)??filtered[0];
  const sourceUrl=term?`/?view=terms&term=${encodeURIComponent(term.id)}${paper?'&paper='+encodeURIComponent(paper):''}`:undefined;
  async function post(body:object) {
    setBusy(true);setError('');setNotice('');
    try{const r=await fetch('/api/terms',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const d=await r.json();if(!r.ok)throw Error(d.error);readVersion.current++;setTerms(d.terms);window.dispatchEvent(new Event('reading-terms-changed'));if(d.saved){setSelected(d.saved.id);setLegacy(false);}setForm(null);setNotice('已保存');}
    catch(e){setError(e instanceof Error?e.message:'保存失败');}finally{setBusy(false);}
  }
  return <section className="companion-page terms-workspace">
    <header className="companion-heading"><h1>术语卡片</h1><p>留下你主动选择的科研概念、理解与出处。普通英文词语放进生词本。</p></header>
    {error&&<p className="v1-error" role="alert">{error}</p>}{notice&&<p role="status">{notice}</p>}
    <div className="study-filter">
      <input disabled={busy} className="field" aria-label="搜索术语" placeholder="搜索我收藏的术语…" value={search} onChange={e=>setSearch(e.target.value)}/>
      <select disabled={busy} className="field" aria-label="术语论文范围" value={paper} onChange={e=>{setPaper(e.target.value);setSelected(null);setForm(null);}}><option value="">全部论文</option>{papers.map(p=><option key={p.slug} value={p.slug}>{p.title}</option>)}</select>
      <button disabled={busy} className="btn btn--primary" onClick={()=>setForm({name:'',note:'',source:'手动建卡'})}>新建卡片</button>
      <button disabled={busy} className="text-button" onClick={()=>{setLegacy(v=>!v);setSelected(null);setForm(null);}}>{legacy?'返回我的收藏':`历史卡片 · ${scoped.filter(t=>!manual(t)).length}`}</button>
    </div>
    {legacy&&<p className="soft-copy">改版前的卡片保留在这里，不再自动新增。选择有价值的卡片加入我的收藏。</p>}
    <div className="concept-layout"><aside className="concept-list" aria-label="术语列表"><p className="soft-copy">{filtered.length} 张{legacy?'历史卡片':'手动收藏'}</p>{filtered.map(t=><button disabled={busy} className={`concept-item${term?.id===t.id?' is-active':''}`} key={t.id} onClick={()=>{setSelected(t.id);setForm(null);}}><strong>{t.name}</strong><small>{t.meaning||t.note||t.excerpts?.[0]?.label||'还没有写下自己的理解'}</small></button>)}{!filtered.length&&<p className="empty-study">在论文、译文或 AI 回答里划选科研术语并翻译，再选择“加入术语卡片”。也可以直接新建。</p>}</aside>
    <main className="surface-card concept-detail">{form?<><h2>{form.id?'编辑卡片':'新建术语卡片'}</h2>{[['name','术语名称'],['meaning','释义'],['note','我的理解'],['mechanism','原理与机制（可选）'],['example','例子（可选）'],['source','来源']].map(([key,label])=><label className="field-label" key={key}>{label}<textarea disabled={busy} className="field" rows={key==='name'?1:3} value={String(form[key as keyof Term]??'')} onChange={e=>setForm({...form,[key]:e.target.value})}/></label>)}<div className="inline-actions"><button className="btn btn--primary" disabled={busy||!form.name?.trim()} onClick={()=>void post({term:form})}>保存卡片</button><button disabled={busy} className="btn" onClick={()=>setForm(null)}>取消</button></div></>:term?<>
      <div className="section-top"><span className="pill">{manual(term)?'我的收藏':'历史卡片'}</span><button disabled={busy} className="text-button" onClick={()=>setForm({...term})}>编辑卡片</button></div><h2 className="concept-title">{term.name}</h2>
      {legacy&&<button className="btn btn--primary" disabled={busy} onClick={()=>void post({term:{id:term.id,name:term.name}})}>加入我的收藏</button>}
      <h3>释义</h3><Markdown sourceUrl={sourceUrl} sourceKey={`term-meaning:${term.id}`} label={`术语释义 · ${term.name}`}>{term.meaning||term.contexts?.find(c=>c.meaning)?.meaning||term.excerpts?.find(a=>a.meaning)?.meaning||'这张历史卡片还没有释义，可以编辑补充。'}</Markdown>
      <h3>我的理解</h3>
      <Markdown sourceUrl={sourceUrl} sourceKey={`term:${term.id}`} label={`术语卡片 · ${term.name}`}>{term.note||'尚未添加理解笔记。'}</Markdown>
      {term.mechanism&&<><h3>原理与机制</h3><Markdown sourceUrl={sourceUrl}>{term.mechanism}</Markdown></>}{term.example&&<><h3>例子</h3><Markdown sourceUrl={sourceUrl}>{term.example}</Markdown></>}
      <h3>收藏时的上下文</h3>{term.excerpts?.map((a,i)=><div className="term-excerpt" key={i}><small>{a.label}</small><blockquote>{a.context}</blockquote>{a.meaning&&<Markdown sourceUrl={sourceUrl}>{a.meaning}</Markdown>}{a.scope.startsWith('/')&&!a.scope.startsWith('//')&&<Link className="text-button" href={a.scope}>回到来源 →</Link>}</div>)}
      {term.contexts?.map((c,i)=><div className="term-excerpt" key={i}><strong>{c.title}{c.page?` · 第 ${c.page} 页`:''}</strong>{c.meaning&&<Markdown sourceUrl={sourceUrl}>{c.meaning}</Markdown>}{c.quote&&<blockquote>{c.quote}</blockquote>}<Link className="text-button" href={`/read/${c.slug}`}>打开论文 →</Link></div>)}
      {!term.excerpts?.length&&!term.contexts?.length&&<p className="soft-copy">{term.source||'手动建卡'}</p>}
      {(term.reviews?.length||term.legacyCards?.length)?<details className="quiet-details"><summary>旧版学习记录</summary>{term.reviews?.map((r,i)=><blockquote key={i}>{r.answer}<small>{r.at} · {r.status}</small></blockquote>)}{term.legacyCards?.map((t,i)=><p key={i}>{t.name}：{t.note}</p>)}</details>:null}
      <button className="text-button danger-text" disabled={busy} onClick={()=>{if(confirm(`删除“${term.name}”这张卡片？`))void post({deleteId:term.id});}}>删除卡片</button>
    </>:<p className="empty-study">只留下你觉得有价值的概念。</p>}</main></div>
  </section>;
}
