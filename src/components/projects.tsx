"use client";

import { useEffect, useMemo, useState } from "react";
import type { PaperProject } from "@/lib/project";

export default function Projects({ onOpen }: { onOpen: (project: PaperProject) => void }) {
  const [projects, setProjects] = useState<PaperProject[]>([]);
  const [groups, setGroups] = useState<string[]>([]);
  const [title, setTitle] = useState("");
  const [newGroup, setNewGroup] = useState("");
  const [activeGroup, setActiveGroup] = useState("全部");
  const [error, setError] = useState("");
  const [savingGroup, setSavingGroup] = useState<string | null>(null);
  const load = async () => {
    try {
      const response = await fetch("/api/projects?fresh=" + Date.now(), { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "项目列表读取失败");
      setProjects(data.projects ?? []);
      setGroups(data.groups ?? []);
      setError("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "项目列表读取失败");
    }
  };
  // 挂载/依赖变化时拉取数据；setState 在异步完成后执行，规则误报
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(); }, []);
  const create = async () => {
    const value = title.trim();
    if (!value) { setError("请先填写项目名称。"); return; }
    try {
      const response = await fetch("/api/projects", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "create", title: value }) });
      const data = await response.json();
      if (!response.ok) { setError(data.error ?? "无法创建项目"); return; }
      setTitle(""); setError(""); await load(); onOpen(data.project);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "无法连接项目服务，请刷新后重试。"); }
  };
  const allGroups = useMemo(() => [...new Set([...groups, ...projects.map((project) => project.group ?? "").filter(Boolean)])], [groups, projects]);
  const visibleProjects = useMemo(() => projects.filter((project) => activeGroup === "全部" || (activeGroup === "未分类" ? !project.group : project.group === activeGroup)), [activeGroup, projects]);
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
        <div><p className="mono-label">RESEARCH ATELIER / PROJECTS</p><h1>我的论文项目</h1><p>每篇导入的论文都是一个项目；从当前工作继续，而不是从工具菜单重新开始。</p></div>
        <button className="btn btn--ghost btn--quiet" onClick={() => void load()}>刷新</button>
      </header>
      <div className="v1-create">
        <input className="field" placeholder="输入项目名称" value={title} onChange={(event) => setTitle(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void create(); }} />
        <button className="btn btn--primary" onClick={() => void create()}>创建项目</button>
      </div>
      <section className="v1-library-groups" aria-label="论文分组">
        <div className="v1-group-tabs"><button className={"btn btn--ghost" + (activeGroup === "全部" ? " is-active" : "")} onClick={() => setActiveGroup("全部")}>全部 {projects.length}</button><button className={"btn btn--ghost" + (activeGroup === "未分类" ? " is-active" : "")} onClick={() => setActiveGroup("未分类")}>未分类 {projects.filter((project) => !project.group).length}</button>{allGroups.map((group) => <button className={"btn btn--ghost" + (activeGroup === group ? " is-active" : "")} key={group} onClick={() => setActiveGroup(group)}>{group} {projects.filter((project) => project.group === group).length}</button>)}</div>
        <div className="v1-new-group"><input className="field" value={newGroup} placeholder="新建分组，例如：世界模型" onChange={(event) => setNewGroup(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void createGroup(); }} /><button className="btn btn--ghost" onClick={() => void createGroup()}>新建分组</button></div>
      </section>
      {error && <p className="v1-error">{error}</p>}
      <section className="v1-group"><h2>{activeGroup}<span>{visibleProjects.length} 篇</span></h2><div className="v1-grid">{visibleProjects.map((project) => (
        <article className="v1-project-card" key={project.id}>
          <button className="v1-project-open" onClick={() => onOpen(project)}>
            <span className="mono-label">{[project.venue, project.year].filter(Boolean).join(" · ") || "论文项目"}</span>
            <strong>{project.title}</strong>
            <span className="v1-current">{project.reproState.current || "尚未同步执行进展。"}</span>
            <span className="mono-label">{project.notes.length} 条笔记 · {project.environmentRefs.length ? "已关联环境" : "未关联环境"}</span>
          </button>
          <label className="v1-card-group">分组<select value={project.group ?? ""} disabled={savingGroup === project.id} onChange={(event) => void saveGroup(project, event.target.value)}><option value="">未分类</option>{allGroups.map((group) => <option value={group} key={group}>{group}</option>)}</select></label>
        </article>
      ))}</div>{!visibleProjects.length && <p className="v1-empty">这个分组还没有项目。可在下方任意项目卡片的“分组”中移入。</p>}</section>
      {!projects.length && <p className="v1-empty">导入 PDF 后会自动出现在这里；也可以先新建一个项目。</p>}
    </section>
  );
}
