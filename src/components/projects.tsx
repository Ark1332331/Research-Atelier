"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from 'next/link';
import PaperActions from './paper-actions';
import PaperImportChat from './paper-import-chat';
import {announcePaperChange,watchPaperChanges} from '@/lib/paper-events';
import type { PaperProject } from "@/lib/project";

export default function Projects({ onOpen }: { onOpen: (project: PaperProject) => void }) {
  const [projects, setProjects] = useState<PaperProject[]>([]);
  const [groups, setGroups] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [importChatOpen,setImportChatOpen]=useState(false),[importChatVisited,setImportChatVisited]=useState(false);
  const [loading,setLoading]=useState(true),[importing,setImporting]=useState(false);
  const fileInput=useRef<HTMLInputElement>(null),loadVersion=useRef(0),uploading=useRef(false);
  const [newGroup, setNewGroup] = useState("");
  const [activeGroup, setActiveGroup] = useState("全部");
  const [error, setError] = useState("");
  const [savingGroup, setSavingGroup] = useState<string | null>(null);
  const load = useCallback(async (signal?:AbortSignal) => {
    const version=++loadVersion.current;
    try {
      const response = await fetch("/api/projects?fresh=" + Date.now(), { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "项目列表读取失败");
      if(version!==loadVersion.current||signal?.aborted)return;
      setProjects(data.projects ?? []);
      setGroups(data.groups ?? []);
      setError("");
    } catch (reason) {
      if(version===loadVersion.current&&!signal?.aborted)setError(reason instanceof Error ? reason.message : "项目列表读取失败");
    } finally { if(version===loadVersion.current&&!signal?.aborted)setLoading(false); }
  }, []);
  useEffect(() => {const controller=new AbortController();const refresh=()=>{if(!controller.signal.aborted)void load(controller.signal);};queueMicrotask(refresh);const stop=watchPaperChanges(refresh);return()=>{controller.abort();stop();}; }, [load]);
  const importPdf = async (file: File) => {
    if(uploading.current)return;uploading.current=true;setImporting(true);setError('');
    try {
      const form=new FormData();form.append('file',file);
      const response=await fetch('/api/paper',{method:'POST',body:form});const data=await response.json();
      if(!response.ok)throw Error(data.error||'导入失败');
      announcePaperChange();if(data.project)onOpen(data.project);else await load();
    }catch(e){setError(e instanceof Error?e.message:'导入失败，请重试');}
    finally{uploading.current=false;setImporting(false);if(fileInput.current)fileInput.current.value='';}
  };
  const allGroups = useMemo(() => [...new Set([...groups, ...projects.map((project) => project.group ?? "").filter(Boolean)])], [groups, projects]);
  const visibleProjects = useMemo(() => projects.filter(project => (activeGroup === "全部" || (activeGroup === "未分类" ? !project.group : project.group === activeGroup)) && project.title.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())), [activeGroup, projects, search]);
  const saveGroup = async (project: PaperProject, value: string) => {
    const group = value.trim();
    if (group === (project.group ?? "")) return;
    setSavingGroup(project.id); setError("");
    try {
      const response = await fetch("/api/projects", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "setGroup", id: project.id, group }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "保存分类失败");
      await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "保存分类失败"); }
    finally { setSavingGroup(null); }
  };
  const createGroup = async () => {
    const name = newGroup.trim();
    if (!name) { setError("请填写分组名称。"); return; }
    try {
      const response = await fetch("/api/projects", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "createGroup", name }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "无法新建分组");
      setGroups(data.groups ?? []); setNewGroup(""); setActiveGroup(name); setError("");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "无法新建分组"); }
  };
  return (
    <section className="v1-page">
      <header className="v1-head">
        <div><p className="mono-label">RESEARCH ATELIER / PROJECTS</p><h1>我的论文库</h1><p>一篇 PDF，一个论文项目。阅读、笔记与研究进展放在一起。</p></div>
        <button className="btn btn--ghost btn--quiet" onClick={() => void load()}>刷新</button>
      </header>
      <div className="v1-create">
        <input className="field" type="search" aria-label="搜索论文" placeholder="搜索论文名称…" value={search} onChange={event=>setSearch(event.target.value)} />
        <input ref={fileInput} type="file" accept="application/pdf,.pdf" hidden onChange={event=>{const file=event.target.files?.[0];if(file)void importPdf(file);}} />
        <button className="btn btn--ghost" disabled={importing} onClick={()=>fileInput.current?.click()}>{importing?'正在导入 PDF…':'导入 PDF'}</button>
        <button className="btn btn--primary" onClick={()=>{setImportChatVisited(true);setImportChatOpen(true);}}>对话导入</button>
      </div>
      <section className="v1-library-groups" aria-label="论文分组">
        <div className="v1-group-tabs"><button className={"btn btn--ghost" + (activeGroup === "全部" ? " is-active" : "")} onClick={() => setActiveGroup("全部")}>全部 {projects.length}</button><button className={"btn btn--ghost" + (activeGroup === "未分类" ? " is-active" : "")} onClick={() => setActiveGroup("未分类")}>未分类 {projects.filter((project) => !project.group).length}</button>{allGroups.map((group) => <button className={"btn btn--ghost" + (activeGroup === group ? " is-active" : "")} key={group} onClick={() => setActiveGroup(group)}>{group} {projects.filter((project) => project.group === group).length}</button>)}</div>
        <div className="v1-new-group"><input className="field" value={newGroup} placeholder="新建分组，例如：世界模型" onChange={(event) => setNewGroup(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.nativeEvent.isComposing) void createGroup(); }} /><button className="btn btn--ghost" onClick={() => void createGroup()}>新建分组</button></div>
      </section>
      {error && <p className="v1-error" role="alert">{error}</p>}{loading&&<p role="status">正在读取论文库…</p>}
      <section className="v1-group"><h2>{activeGroup}<span>{visibleProjects.length} 篇</span></h2><div className="v1-grid">{visibleProjects.map((project) => (
        <article className="v1-project-card" key={project.id}>
          <button className="v1-project-open" onClick={() => onOpen(project)}>
            <span className="mono-label">{[project.venue, project.year].filter(Boolean).join(" · ") || "论文项目"}</span>
            <strong>{project.title}</strong>{(!project.paperSlug||project.pdfAvailable===false)&&<span className="legacy-paper-badge">旧记录 · 待补充 PDF</span>}
            <span className="v1-current">{project.reproState.current || "尚未同步执行进展。"}</span>
            <span className="mono-label">{project.notes.length} 条笔记 · {project.environmentRefs.length ? "已关联环境" : "未关联环境"}</span>
          </button>
          <div className="paper-card-actions">{project.paperSlug&&project.pdfAvailable!==false?<Link className="btn btn--ghost" href={`/read/${encodeURIComponent(project.paperSlug)}?project=${encodeURIComponent(project.id)}`}>阅读 PDF</Link>:<button className="btn btn--ghost" onClick={()=>onOpen(project)}>补充 PDF</button>}<PaperActions title={project.title} projectId={project.id} slug={project.paperSlug}/></div>
          <label className="v1-card-group">分组<select value={project.group ?? ""} disabled={savingGroup === project.id} onChange={(event) => void saveGroup(project, event.target.value)}><option value="">未分类</option>{allGroups.map((group) => <option value={group} key={group}>{group}</option>)}</select></label>
        </article>
      ))}</div>{!loading&&projects.length>0&&!visibleProjects.length && <p className="v1-empty">没有匹配的论文。试试其他名称或分组，也可以导入 PDF。</p>}</section>
      {!loading&&!projects.length&&!error&&<p className="v1-empty">导入第一篇 PDF，即可开始阅读、划线追问和记录笔记。</p>}
      {importChatVisited&&<PaperImportChat open={importChatOpen} onClose={()=>setImportChatOpen(false)}/>}
    </section>
  );
}
