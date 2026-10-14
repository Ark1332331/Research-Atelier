"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import type { LearningState, Memory, Scene } from "@/lib/learning/core";
import ObservationFeed from "./observation-feed";
import LearningAdvanced from "./learning-advanced";
const scenes: Record<Scene, string> = { general: "所有讲解", paper: "读论文", code: "读代码", repro: "做实验" };
export default function LearningCenter() {
  const [state, setState] = useState<LearningState | null>(null);
  const [error, setError] = useState(""); const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false); const [text, setText] = useState(""); const [scene, setScene] = useState<Scene>("general");
  const [advanced, setAdvanced] = useState(false); const [showAll, setShowAll] = useState(false);
  const [editing, setEditing] = useState(false); const [draft, setDraft] = useState("");
  useEffect(() => { let cancelled=false;
    const refresh=async()=>{try{const r=await fetch("/api/learning");const d=await r.json();if(!r.ok)throw Error(d.error);if(!cancelled)setState(d);}catch(e){if(!cancelled)setError(e instanceof Error?e.message:String(e));}};
    void refresh();const timer=setInterval(()=>{if(document.visibilityState!=="hidden")void refresh();},4000);return()=>{cancelled=true;clearInterval(timer);};
  },[advanced]);
  async function refreshState(){const r=await fetch("/api/learning");if(r.ok)setState(await r.json());}

  async function act(body: Record<string, unknown>, message: string) {
    setBusy(true); setError(""); setNotice("");
    try { const r = await fetch("/api/learning", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); const d = await r.json(); if (!r.ok) throw Error(d.error); setState(d.state ?? d); setNotice(d.queued ? "已进入后台观察，稍后会显示检查理由和新改法。" : body.action === "analyze" && !d.proposed ? "这段反馈没有明确的新偏好。试着说清：哪里不合适、希望怎么讲。" : message); setEditing(false); if (body.action === "analyze") setText(""); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  }
  function relevance(m:Memory) { return (m.evidence.some(e => !e.source.includes("历史材料") && !e.source.includes("草案")) ? 100 : 0) + (/讲解|代码导读|小数组|具体|例子|数据合同|输入输出/.test(m.text) ? 10 : 0) - (/agent 无关|文件里|设计原则|第二套工作流/.test(m.text) ? 20 : 0); }
  const pending = state?.memories.filter(m => m.status === "pending").sort((a,b) => relevance(b)-relevance(a) || a.createdAt.localeCompare(b.createdAt)) ?? [];
  const active = state?.memories.filter(m => m.status === "active") ?? [];
  const next = pending[0]; const recent = state?.runs.slice().reverse().find(r => r.outcome === "success");
  const manage = (m: Memory, action: string) => void act({ action, id: m.id, version: m.version }, action === "approve" ? "已记住。之后匹配场景的对话会参考这条改法。" : "已更新；你的当前要求始终优先。");
  return <section className="companion-page">
    <header className="companion-heading"><span className="eyebrow">YOUR LEARNING COMPANION</span><h1>助手如何懂我</h1><p>重点看提问中暴露的问题，不记录日常打开和点击。新改法由你决定是否采纳。</p></header>
    <div className="journey-strip"><div><b>01</b><strong>照常提问和追问</strong><span>普通消息也会检查，不需要触发口令。</span></div><div><b>02</b><strong>助手提出改法</strong><span>已有偏好已记住；新发现的改法才需要确认。</span></div><div><b>03</b><strong>下次换一种讲法</strong><span>回答下方能看见用到了哪些偏好。</span></div></div>
    {error && <p role="alert" className="v1-error">{error}</p>}{notice && <p className="success-note" role="status">{notice}</p>}
    {!state ? <p>正在读取…</p> : <>
      <div id="observations"><ObservationFeed state={state} onRefresh={()=>void refreshState()}/></div>
      <div className="companion-columns"><div className="surface-card"><span className="eyebrow">告诉助手</span><h2>希望它怎么教你？</h2><p className="soft-copy">这里随时补充，也可以直接在对话中纠正它。不会把“讲过了”当作“你会了”。</p><textarea className="field" aria-label="我的学习反馈" rows={3} value={text} onChange={e => setText(e.target.value)} placeholder="例如：我有 C 基础，不用解释基础运算；陌生的 NumPy 参数要用小数组演示。" /><div className="inline-actions"><select className="field" aria-label="反馈适用场景" value={scene} onChange={e => setScene(e.target.value as Scene)}>{Object.entries(scenes).map(([k,v]) => <option key={k} value={k}>{v}</option>)}</select><button className="btn btn--primary" disabled={busy || !text.trim() || !state.collecting} onClick={() => void act({ action: "analyze", text, scene }, "已整理成待确认的改法，请看看是否贴合你的意思。")}>{busy ? "整理中…" : "整理我的反馈"}</button></div>{!state.collecting && <p className="soft-copy">观察已暂停，在下方设置中恢复后可继续。</p>}</div>
      <div className="surface-card"><span className="eyebrow">只确认一件事</span><h2>{next ? "这样理解你，对吗？" : "暂时没有需要确认的改法"}</h2>{next ? <><p className="rule-focus">{next.text}</p><span className="pill">{scenes[next.scene]}</span><details className="quiet-details"><summary>为什么这样判断？</summary>{next.evidence.map((e,i) => <blockquote key={i}>{e.quote}<small>{e.source}</small></blockquote>)}</details>{editing && <textarea className="field" aria-label="修正改法" rows={3} value={draft} onChange={e => setDraft(e.target.value)} />}<div className="inline-actions"><button className="btn btn--primary" disabled={busy || (editing && !draft.trim())} onClick={() => editing ? void act({ action: "edit", id: next.id, version: next.version, text: draft }, "已修正，请再确认一次。") : manage(next,"approve")}>{editing ? "保存修正" : "对，记住这点"}</button><button className="btn btn--ghost" disabled={busy} onClick={() => { setDraft(next.text); setEditing(!editing); }}>{editing ? "取消" : "改一下"}</button><button className="btn btn--ghost" disabled={busy} onClick={() => manage(next,"reject")}>不符合我</button></div><p className="soft-copy">还有 {pending.length - 1} 条新发现的改法待确认。</p></> : <p className="soft-copy">继续阅读就好。使用中暴露的卡点会整理成新改法，再由你确认。</p>}</div></div>
      <div className="surface-card"><div className="section-top"><h2>它现在记住的讲法 <span className="pill">{active.length}</span></h2><button className="text-button" onClick={() => setShowAll(!showAll)}>{showAll ? "收起" : "查看全部"}</button></div>{!active.length ? <p className="soft-copy">尚未确认任何偏好。确认上方一条改法后，下次相关讲解就会参考它。</p> : (showAll ? active : active.slice(0,3)).map(m => <div className="preference-line" key={m.id}><span>{m.text}<small>{scenes[m.scene]}</small></span><button className="text-button" disabled={busy} onClick={() => manage(m,"pause")}>暂时停用</button></div>)}</div>
      <details className="surface-card quiet-details"><summary>最近一次回答，用到了什么？</summary>{recent ? <><p>{recent.query}</p>{recent.selected.length ? recent.selected.map(s => <p key={s.id} className="preference-line">{s.text}</p>) : <p className="soft-copy">这次没有应用已确认偏好。</p>}<p className="soft-copy">这里记录实际传入的规则；是否有帮助，以你的反馈为准。</p></> : <p>正常对话后，这里会显示真实的应用记录。</p>}</details>
      <details className="surface-card quiet-details"><summary>持续学习是怎么发生的？</summary><p>已有偏好直接生效。之后对话中的卡点、回答反馈和术语复述错误，会形成带原话证据的新改法，确认后才进入长期记忆。工具故障不等于你不会；模型的能力判断也只是待核对的观察。</p><p>每次回答保留实际使用的规则与版本；你反馈是否有帮助，再修正、停用或回退。没有使用反馈时，系统不会声称学习效果已提高。</p><p>已记录 {state.runs.length} 次回答，其中 {state.runs.filter(r=>r.feedback?.helpful===true).length} 次反馈有帮助、{state.runs.filter(r=>r.feedback?.helpful===false).length} 次需要换讲法、{state.runs.filter(r=>r.outcome==="failed").length} 次调用失败。完整证据在高级管理。</p></details>
      <details className="quiet-details settings-disclosure"><summary>学习设置与数据管理</summary><div className="learning-controls"><label><input type="checkbox" checked={state.collecting} disabled={busy} onChange={e => void act({ action: "settings", collecting: e.target.checked }, "已更新观察设置。")}/> 从对话观察学习方式</label><label><input type="checkbox" checked={state.applying} disabled={busy} onChange={e => void act({ action: "settings", applying: e.target.checked }, "已更新应用设置。")}/> 回答时参考已确认偏好</label></div><p className="soft-copy">历史、版本回滚、彻底遗忘、备份和同题对照都在高级管理中。</p><button className="btn" onClick={() => setAdvanced(!advanced)}>{advanced ? "收起高级管理" : "打开高级管理"}</button></details>
      {advanced && <LearningAdvanced key={state.revision} />}
      <p className="companion-footer">去 <Link href="/">论文库与研究工作台</Link> 继续学习，偏好会随对话一起使用。</p>
    </>}
  </section>;
}
