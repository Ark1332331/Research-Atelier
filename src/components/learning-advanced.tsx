"use client";
import { useEffect, useState } from "react";
import type { LearningState, Memory, Scene, Selection } from "@/lib/learning/core";
import Markdown from "./markdown";
const statusNames = { pending: "待审核", active: "已确认", paused: "已停用", rejected: "已拒绝" };
const kindNames = { preference: "讲解偏好", gap: "知识缺口", skill: "能力证据", workflow: "协作规则" };
const sceneNames = { general: "通用", code: "代码导读", paper: "论文阅读", repro: "实验复现" };
export default function LearningCenter() {
  const [now, setNow] = useState(0);
  const [state, setState] = useState<LearningState | null>(null);
  const [error, setError] = useState(""); const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState("memories"); const [filter, setFilter] = useState("pending"); const [search, setSearch] = useState("");
  const [scene, setScene] = useState<Scene>("general"); const [projectId, setProjectId] = useState("");
  const [projects, setProjects] = useState<{ id: string; title: string }[]>([]);
  const [text, setText] = useState(""); const [quote, setQuote] = useState(""); const [kind, setKind] = useState("preference");
  const [expiry, setExpiry] = useState(""); const [query, setQuery] = useState(""); const [preview, setPreview] = useState<Selection[] | null>(null);
  const [editing, setEditing] = useState<string | null>(null); const [edited, setEdited] = useState("");
  const [feedback, setFeedback] = useState<Record<string, string>>({});
  async function load() {
    const response = await fetch("/api/learning", { cache: "no-store" }); const data = await response.json();
    if (!response.ok) throw new Error(data.error); setState(data); setNow(Date.now());
  }
  useEffect(() => {
    fetch("/api/learning", { cache: "no-store" }).then(async r => { const d = await r.json(); if (!r.ok) throw new Error(d.error); setState(d); setNow(Date.now()); }).catch(e => setError(String(e.message)));
    fetch("/api/projects").then(r => r.json()).then(d => setProjects(Array.isArray(d.projects) ? d.projects : [])).catch(() => {});
  }, []);
  async function act(body: Record<string, unknown>) {
    setBusy(true); setError("");
    try {
      const res = await fetch("/api/learning", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const d = await res.json(); if (!res.ok) throw new Error(d.error);
      setState(d.state ?? d); setEditing(null);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  }
  async function inspect() {
    setBusy(true); setError("");
    try { const res = await fetch(`/api/learning?query=${encodeURIComponent(query)}&scene=${scene}&projectId=${encodeURIComponent(projectId)}`); const d = await res.json(); if (!res.ok) throw new Error(d.error); setPreview(d.selected); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  }
  async function ask(useMemory = true) {
    if (!query.trim()) return; setBusy(true); setError("");
    try {
      const messages = [{ role: "system", content: "你是用户的长期研究与学习助手。给出具体、可验证的中文解释；知识掌握需要复述或任务证据，不能根据已讲解推断。" }, { role: "user", content: query }];
      const res = await fetch("/api/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ messages, scene, projectId: projectId || null, useMemory }) });
      const d = await res.json(); if (!res.ok) throw new Error(d.error); await load();
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  }
  const scope = <div className="learning-scope"><label>使用场景<select className="field" value={scene} onChange={e => { setScene(e.target.value as Scene); setPreview(null); }}>{Object.entries(sceneNames).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label><label>作用范围<select className="field" value={projectId} onChange={e => { setProjectId(e.target.value); setPreview(null); }}><option value="">全局 / 不指定项目</option>{projects.map(p => <option key={p.id} value={p.id}>{p.title}</option>)}</select></label></div>;
  const memoryAction = (m: Memory, action: string, extra = {}) => void act({ action, id: m.id, version: m.version, ...extra });
  const runs = state?.runs ?? [];
  const rated = runs.filter(r => r.feedback); const positive = rated.filter(r => r.feedback?.helpful).length;
  return <section className="learning-center">
    <div className="learning-heading"><div><p className="mono-label">EVIDENCE → REVIEW → APPLY → FEEDBACK</p><h1>我的 AI 如何学习</h1><p>学习的是有证据的记忆与协作规则。每次变化可审核，每次应用可追踪。</p></div><a className="btn" href="/api/learning?export=markdown">导出交接 Markdown</a><a className="btn" href="/api/learning?export=json">导出完整备份</a></div>
    {error && <p role="alert" className="v1-error">{error}</p>}
    {!state ? <p>正在读取学习库…</p> : <>
      <div className="learning-stats"><div><strong>{state.memories.filter(m => m.status === "pending").length}</strong><span>候选待审核</span></div><div><strong>{state.memories.filter(m => m.status === "active").length}</strong><span>已确认规则</span></div><div><strong>{runs.filter(r => r.selected.length).length}</strong><span>实际应用记录</span></div><div><strong>{rated.length ? `${positive}/${rated.length}` : "尚无"}</strong><span>有效反馈 / 已评价（非能力分数）</span></div></div>
      <label className="btn">导入 JSON 备份<input type="file" accept="application/json,.json" disabled={busy || !state.collecting} style={{ display: "none" }} onChange={async e => {
        const file = e.target.files?.[0]; if (!file) return;
        try { if (file.size > 5000000) throw new Error("导入文件不得超过 5 MB"); const data = JSON.parse(await file.text()); await act({ action: "import", memories: data.memories }); }
        catch (err) { setError(err instanceof Error ? err.message : String(err)); } e.target.value = "";
      }} /></label><span className="learning-note">导入条目均需重新审核</span>
      <div className="learning-controls"><label><input type="checkbox" checked={state.collecting} disabled={busy} onChange={e => void act({ action: "settings", collecting: e.target.checked })} /> 自动采集候选</label><label><input type="checkbox" checked={state.applying} disabled={busy} onChange={e => void act({ action: "settings", applying: e.target.checked })} /> 应用已确认记忆</label><button className="btn" disabled={busy} onClick={() => void load().catch(e => setError(e.message))}>刷新</button></div>
      <p className="learning-note">候选不会影响回答。确认表示同意使用这条规则，效果仍须验证。知识缺口不会因为 AI 讲过就变成已掌握；能力证据需包含你的复述或真实任务表现。</p>
      <div className="learning-tabs" role="tablist">{[["memories", "记忆与审核"], ["try", "检索与试用"], ["runs", "回答与效果"], ["audit", "变化记录"]].map(([k, v]) => <button key={k} role="tab" aria-selected={tab === k} className={"btn" + (tab === k ? " btn--primary" : "")} onClick={() => setTab(k)}>{v}</button>)}</div>
      {tab === "memories" && <>
        <details className="learning-card"><summary>提议新规则 / 分析反馈</summary>{scope}<label>类型<select className="field" value={kind} onChange={e => setKind(e.target.value)}>{Object.entries(kindNames).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label><label>观察或希望怎么讲<textarea className="field" rows={3} value={text} onChange={e => setText(e.target.value)} placeholder="例如：请先用一组小输入展示每一步数据变化" /></label><label>原文证据 / 能力验收表现<textarea className="field" rows={3} value={quote} onChange={e => setQuote(e.target.value)} placeholder="不能只写‘AI 已讲解’；填写实际反馈、复述或任务结果" /></label><label>到期时间（可选，用于环境等暂时信息）<input type="date" className="field" value={expiry} onChange={e => setExpiry(e.target.value)} /></label><div className="learning-actions"><button className="btn btn--primary" disabled={busy || !text.trim() || !quote.trim() || !state.collecting} onClick={() => void act({ action: "propose", text, quote, kind, scene, projectId, expiresAt: expiry ? new Date(expiry + "T23:59:59+08:00").toISOString() : null })}>提交候选，等待审核</button><button className="btn" disabled={busy || !text.trim() || !state.collecting} onClick={() => void act({ action: "analyze", text, scene, projectId })}>AI 分析这段反馈</button></div><p className="mono-label">AI 分析会将这段文本发送到已配置的 DeepSeek；提议须能对应原文，仍需你审核。</p></details>
        <div className="learning-scope"><select className="field" aria-label="状态筛选" value={filter} onChange={e => setFilter(e.target.value)}><option value="all">所有状态</option>{Object.entries(statusNames).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select><input className="field" aria-label="搜索记忆" placeholder="搜索规则、证据、项目…" value={search} onChange={e => setSearch(e.target.value)} /></div>
        {state.memories.filter(m => (filter === "all" || m.status === filter) && JSON.stringify(m).toLowerCase().includes(search.toLowerCase())).map(m => <article className="learning-card" key={m.id}>
          <div className="learning-card-head"><span className={"learning-badge learning-badge--" + m.status}>{statusNames[m.status]}</span><span>{kindNames[m.kind]} · {sceneNames[m.scene]} · {projects.find(p => p.id === m.projectId)?.title ?? m.projectId ?? "全局"} · v{m.version}</span></div>
          {editing === m.id ? <><textarea className="field" rows={4} value={edited} onChange={e => setEdited(e.target.value)} /><button className="btn" disabled={busy || !edited.trim()} onClick={() => memoryAction(m, "edit", { text: edited })}>保存修正，重新审核</button><button className="btn" onClick={() => setEditing(null)}>取消</button></> : <p className="learning-rule">{m.text}</p>}
          {m.expiresAt && <p>有效期至 {new Date(m.expiresAt).toLocaleDateString("zh-CN")}{Date.parse(m.expiresAt) <= now ? "（已到期，不再应用）" : ""}</p>}
          <details><summary>证据 {m.evidence.length} 条 · 来源与原文</summary>{m.evidence.map((e, i) => <blockquote key={i}><p>{e.quote}</p><small>{e.source} · {new Date(e.at).toLocaleString("zh-CN")}</small></blockquote>)}</details>
          <div className="learning-actions">{m.status !== "active" && <button className="btn btn--primary" disabled={busy} onClick={() => memoryAction(m, "approve")}>确认使用</button>}{m.status === "active" && <button className="btn" disabled={busy} onClick={() => memoryAction(m, "pause")}>停用</button>}<button className="btn" disabled={busy} onClick={() => { setEditing(m.id); setEdited(m.text); }}>修正</button>{m.status !== "rejected" && <button className="btn" disabled={busy} onClick={() => memoryAction(m, "reject")}>拒绝</button>}</div>
          <details><summary>版本与撤回</summary>{m.revisions.slice().reverse().map(r => <div className="learning-revision" key={r.version}><strong>v{r.version} · {statusNames[r.status]}</strong><p>{r.text}</p><small>{r.reason}</small>{r.version !== m.version && <button className="btn" disabled={busy} onClick={() => memoryAction(m, "rollback", { targetVersion: r.version })}>回退至此版本</button>}</div>)}<p>彻底遗忘会删除证据、历史版本以及包含该条目的回答记录。已导出的文件需要你另外删除。</p><button className="btn" disabled={busy} onClick={() => { if (window.confirm("彻底删除这条记忆及关联回答记录？此操作无法撤回。")) memoryAction(m, "forget"); }}>彻底遗忘</button></details>
        </article>)}
        {!state.memories.length && <p className="learning-empty">还没有观察记录。可先提议一条规则，或在试用中表达你的偏好和卡点。</p>}
      </>}
      {tab === "try" && <div className="learning-card">{scope}<label>输入当前问题 / 反馈<textarea className="field" rows={4} value={query} onChange={e => { setQuery(e.target.value); setPreview(null); }} placeholder="例如：我不理解 forward，请先给输入输出和实际执行轨迹" /></label><div className="learning-actions"><button className="btn" disabled={busy || !query.trim()} onClick={() => void inspect()}>预览会使用的记忆</button><button className="btn btn--primary" disabled={busy || !query.trim()} onClick={() => void ask()}>{busy ? "处理中…" : "让助手回答"}</button></div><button className="btn" disabled={busy || !query.trim()} onClick={() => void ask(false)}>同题基线回答（不注入记忆）</button><p>可对同一问题分别生成基线与个性化回答，再在效果页分别评价。此对照只验证当前问题，不宣称模型能力提升。</p><p>这里测试讲解方式；项目专属 AI 还会读取论文与代码证据。回答后到“回答与效果”查看实际记忆和评价。</p>{preview && <><h3>当前检索结果（未调用模型）</h3>{preview.length ? preview.map(s => <div className="learning-revision" key={s.id}><p>{s.text}</p><small>{s.reason}</small></div>) : <p>没有符合状态、场景、项目和有效期条件的记忆。</p>}</>}</div>}
      {tab === "runs" && <>{runs.slice().reverse().map(r => <article className="learning-card" key={r.id}><div className="learning-card-head"><strong>{sceneNames[r.scene]} · {r.mode === "baseline" ? "基线" : "个性化"} · {r.outcome === "success" ? "回答完成" : "调用失败"}</strong><small>{new Date(r.at).toLocaleString("zh-CN")}</small></div><p className="learning-rule">你：{r.query}</p>{r.error ? <p className="v1-error">{r.error}</p> : <Markdown>{r.answer}</Markdown>}<details><summary>实际注入 {r.selected.length} 条记忆（不等于模型一定遵循）</summary>{r.selected.map(s => <div className="learning-revision" key={s.id}><p>{s.text}</p><small>{s.reason} · ID {s.id}</small></div>)}</details>{r.outcome === "success" && <><textarea className="field" aria-label="效果反馈" rows={2} placeholder="哪里有帮助 / 怎么改才合适（无效反馈将成为待审核改法）" value={feedback[r.id] ?? r.feedback?.note ?? ""} onChange={e => setFeedback({ ...feedback, [r.id]: e.target.value })} /><div className="learning-actions"><button className="btn" disabled={busy} onClick={() => void act({ action: "feedback", runId: r.id, helpful: true, note: feedback[r.id] ?? "" })}>有帮助</button><button className="btn" disabled={busy} onClick={() => void act({ action: "feedback", runId: r.id, helpful: false, note: feedback[r.id] ?? "" })}>需改进</button>{r.feedback && <span>已评价：{r.feedback.helpful ? "有帮助" : "需改进"}</span>}</div></>}</article>)}{!runs.length && <p className="learning-empty">尚未调用助手。这里会记录实际注入的记忆版本、模型回答和效果反馈。</p>}</>}
      {tab === "audit" && <div className="learning-card"><p>只显示发生过的操作，不以记录数量宣称“更聪明”。</p>{state.audit.slice().reverse().map(a => <div className="learning-revision" key={a.id}><strong>{a.action}</strong><p>{a.detail}</p><small>{new Date(a.at).toLocaleString("zh-CN")} {a.memoryId ? `· ${a.memoryId}` : ""}</small></div>)}</div>}
    </>}
  </section>;
}
