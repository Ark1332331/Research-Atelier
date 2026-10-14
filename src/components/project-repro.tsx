"use client";

import { useEffect, useRef, useState } from "react";
import type { PaperProject } from "@/lib/project";
import EnvironmentsPanel from "@/components/environments-panel";
import SystemPanel from "@/components/system-panel";
import ProjectAI from "@/components/project-ai";

declare global {
  interface Window { desktop?: { pickDirectory: () => Promise<{ canceled?: boolean; path?: string }> } }
}

type Context = "ai" | "environment" | "sessions" | "notes" | "history" | null;

export default function ProjectRepro({ projectId, onBack }: { projectId: string; onBack: () => void }) {
  const [project, setProject] = useState<PaperProject | null>(null);
  const [context, setContext] = useState<Context>(null);
  const [workspace, setWorkspace] = useState("");
  const [sessionLink, setSessionLink] = useState("");
  const [note, setNote] = useState("");
  const [handoff, setHandoff] = useState("");
  const [message, setMessage] = useState("");
  const [syncing, setSyncing] = useState(false);
  const [rebuildingHistory, setRebuildingHistory] = useState(false);
  const [importingPdf, setImportingPdf] = useState(false);
  const pdfInput = useRef<HTMLInputElement>(null);
  const load = async () => {
    const response = await fetch("/api/projects?id=" + encodeURIComponent(projectId));
    const data = await response.json();
    if (response.ok) { setProject(data.project); setWorkspace(data.project.workspace?.repoPath ?? ""); }
  };
  useEffect(() => { void load(); void fetch("/api/projects", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "setLastModule", id: projectId, module: "repro" }) }); }, [projectId]);
  const post = async (url: string, body: Record<string, unknown>) => {
    const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const data = await response.json(); if (!response.ok) throw new Error(data.error ?? "操作失败"); return data;
  };
  const saveWorkspace = async () => {
    try { await post("/api/projects", { action: "setWorkspace", id: projectId, repoPath: workspace }); setMessage("已关联项目代码目录。"); await load(); } catch (error) { setMessage(error instanceof Error ? error.message : "保存失败"); }
  };
  const pickWorkspace = async () => {
    try {
      const selected = window.desktop ? await window.desktop.pickDirectory() : await post("/api/fs/pick", { startDir: workspace || undefined });
      if (selected.path) { setWorkspace(selected.path); setMessage("已选择代码目录；确认后点击“关联代码目录”。"); }
    } catch {
      setMessage("未能打开目录选择器，请直接输入路径。");
    }
  };
  const bindSession = async () => {
    try { await post("/api/execution-sessions", { action: "bind", projectId, deepLink: sessionLink }); setSessionLink(""); setMessage("执行会话已绑定。"); await load(); } catch (error) { setMessage(error instanceof Error ? error.message : "绑定失败"); }
  };
  const addNote = async () => {
    if (!note.trim()) return;
    try { await post("/api/notes", { action: "save", projectId, title: note.trim().slice(0, 40), content: note.trim() }); setNote(""); await load(); } catch (error) { setMessage(error instanceof Error ? error.message : "保存失败"); }
  };
  const getHandoff = async () => {
    try {
      const data = await post("/api/handoff", { projectId });
      const prompt = data.prompt ?? "";
      setHandoff(prompt);
      try { await navigator.clipboard.writeText(prompt); setMessage("交接内容已复制；可在下方打开绑定的 Codex 会话继续。"); }
      catch { setMessage("交接内容已生成；请用下方“复制交接内容”按钮复制。 "); }
    } catch (error) { setMessage(error instanceof Error ? error.message : "生成失败"); }
  };
  const syncLatest = async () => {
    setSyncing(true); setMessage("");
    try {
      const collected = await post("/api/sync", { action: "collect", projectId });
      const pending = collected.pending;
      if (pending?.hasEvidence) {
        await post("/api/sync", { action: "explain", projectId });
        setMessage("同步完成：新增证据已写入当前状态和历史。");
        await load();
      } else {
        setMessage(pending?.evidence?.code?.message ?? "已完成同步检查，暂无新增会话或 Git 变更；当前状态保持不变。");
      }
    } catch (error) { setMessage(error instanceof Error ? error.message : "同步失败"); }
    finally { setSyncing(false); }
  };
  const importPdf = async (file: File) => {
    setImportingPdf(true); setMessage("");
    try {
      const form = new FormData(); form.append("file", file); form.append("projectId", projectId);
      const response = await fetch("/api/paper", { method: "POST", body: form });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "PDF 导入失败");
      setMessage(data.duplicate ? "这份 PDF 已在本机论文库中，现已关联到当前项目。" : "PDF 已导入并关联到当前项目；可点击“阅读论文”查看全文。");
      await load();
    } catch (error) { setMessage(error instanceof Error ? error.message : "PDF 导入失败"); }
    finally { setImportingPdf(false); if (pdfInput.current) pdfInput.current.value = ""; }
  };
  if (!project) return <section className="v1-page"><p className="v1-empty">正在读取项目…</p></section>;
  const state = project.reproState;
  return (
    <section className="v1-page">
      <header className="v1-head"><div><button className="tlink mono-label" onClick={onBack}>← 返回项目</button><p className="mono-label">REPRODUCTION / {project.paperSlug ?? "NO PDF"}</p><h1>{project.title}</h1></div><div className="v1-inline">{!project.paperSlug && <><input ref={pdfInput} type="file" accept="application/pdf,.pdf" hidden onChange={(event) => { const file = event.target.files?.[0]; if (file) void importPdf(file); }} /><button className="btn btn--primary" disabled={importingPdf} onClick={() => pdfInput.current?.click()}>{importingPdf ? "导入中…" : "导入 PDF"}</button></>}{project.paperSlug && <a className="btn btn--ghost" href={"/read/" + project.paperSlug}>阅读论文</a>}</div></header>
      <div className="v1-context-tabs">
        {([["ai", "项目 AI"], ["environment", "当前环境"], ["sessions", "执行会话"], ["notes", "笔记"], ["history", "历史"]] as [Context, string][]).map(([key, label]) => <button key={key} className={"btn btn--ghost" + (context === key ? " is-active" : "")} onClick={() => setContext(context === key ? null : key)}>{label}</button>)}
      </div>
      {context === "ai" && <ProjectAI projectId={projectId} />}
      {context === "environment" && <div className="v1-environment">
        <SystemPanel />
        <EnvironmentsPanel />
        <div className="v1-context">
          <label>项目代码目录<input className="field" value={workspace} placeholder="/absolute/path/to/repository" onChange={(event) => setWorkspace(event.target.value)} /></label>
          <div className="v1-inline"><button className="btn btn--ghost" onClick={() => void pickWorkspace()}>选择文件夹…</button><button className="btn btn--primary" onClick={() => void saveWorkspace()}>关联代码目录</button></div>
          <p className="mono-label">桌面版会弹出系统原生目录选择器；浏览器模式则使用系统选择对话框。关联后可维护 Research Atelier 的 AGENTS.md 规范，且不会覆盖已有内容。</p>
        </div>
      </div>}
      {context === "sessions" && <div className="v1-context"><label>Codex 深度链接或 DSH JSONL<input className="field" value={sessionLink} placeholder="codex://threads/…" onChange={(event) => setSessionLink(event.target.value)} /></label><button className="btn btn--primary" onClick={() => void bindSession()}>绑定执行会话</button>{project.executionSessions.map((session) => <p key={session.id} className="v1-row">{session.provider.toUpperCase()} · {session.deepLink}</p>)}</div>}
      {context === "notes" && <div className="v1-context"><div className="v1-inline"><input className="field" value={note} placeholder="记录一条项目笔记…" onChange={(event) => setNote(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void addNote(); }} /><button className="btn btn--primary" onClick={() => void addNote()}>保存</button></div>{project.notes.map((item) => <p key={item.id} className="v1-row"><strong>{item.title}</strong><br />{item.content}</p>)}</div>}
      {context === "history" && <div className="v1-context">{project.history.length ? project.history.map((item) => { const explanation = item.explanation as { stage?: string; result?: string; meaning?: string; limitation?: string; nextStep?: string } | undefined; return <details className="v1-row" key={item.id}><summary><strong>{explanation?.stage || "AI 同步讲解"}</strong> · {explanation?.result || "已同步研究证据"}</summary><p>{explanation?.meaning || "这轮记录尚未生成完整讲解。"}</p><p>还不能说明：{explanation?.limitation || "未提供"}</p><p>下一步：{explanation?.nextStep || "未提供"}</p></details>; }) : <p className="mono-label">还没有已讲解的同步记录。</p>}</div>}
      {message && <p className="v1-message">{message}</p>}
      <div className="v1-mainline">
        <div><p className="mono-label">当前</p><h2>{state.current}</h2><p>{state.why || "还没有同步解释；先连接执行会话或关联代码目录。"} </p></div>
        <div><p className="mono-label">下一步</p><h2>{state.nextStep || "建立可追踪的执行会话"}</h2><p>{state.whyNow || state.why || "让项目获得来自代码、执行对话和环境的真实证据。"} </p></div>
      </div>
      <div className="v1-actions"><button className="btn btn--primary" onClick={() => void getHandoff()}>交给 AI 继续</button><button className="btn btn--ghost" disabled={syncing} onClick={() => void syncLatest()}>{syncing ? "同步中…" : "同步最新进展"}</button></div>
      {handoff && <div className="v1-context"><textarea className="field v1-prompt" readOnly value={handoff} onFocus={(event) => event.currentTarget.select()} /><div className="v1-inline"><button className="btn btn--ghost" onClick={() => void navigator.clipboard.writeText(handoff).then(() => setMessage("交接内容已复制。 ")).catch(() => setMessage("复制失败，请在文本框中手动复制。"))}>复制交接内容</button>{project.executionSessions.filter((session) => session.provider === "codex").map((session) => <a className="btn btn--primary" key={session.id} href={session.deepLink}>在 Codex 中继续</a>)}</div></div>}
    </section>
  );
}
