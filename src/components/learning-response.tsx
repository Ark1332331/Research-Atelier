"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import type { Memory, Selection } from "@/lib/learning/core";
export interface ResponseLearning { runId: string; observationId?:string; selected: Selection[]; proposedIds: string[]; note?: string }
export default function LearningResponse({ learning }: { learning: ResponseLearning }) {
  const [candidate, setCandidate] = useState<Memory | null>(null); const [adjusting, setAdjusting] = useState(false);
  const [note, setNote] = useState(""); const [status, setStatus] = useState(""); const [busy, setBusy] = useState(false);
  useEffect(()=>{let gone=false;let timer:ReturnType<typeof setInterval>|undefined;
    const refresh=async()=>{try{const r=await fetch(learning.observationId?`/api/learning/observations?id=${encodeURIComponent(learning.observationId)}`:"/api/learning");if(!r.ok)return;const d=await r.json();const ids=learning.observationId?d.observation?.candidateIds??[]:learning.proposedIds;if(!gone)setCandidate(d.memories?.find((m:Memory)=>ids.includes(m.id)&&m.status==="pending")??null);if(d.observation&&!["queued","analyzing"].includes(d.observation.status)&&timer)clearInterval(timer);}catch{/* Store availability is shown by the observation indicator */}};
    void refresh();if(learning.observationId)timer=setInterval(()=>void refresh(),4000);return()=>{gone=true;if(timer)clearInterval(timer);};
  },[learning]);

  async function act(body: object) {
    setBusy(true);
    try { const r = await fetch("/api/learning", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); const d = await r.json(); if (!r.ok) throw Error(d.error); setStatus("已记录你的反馈"); setAdjusting(false); setCandidate(d.memories?.find((m: Memory) => m.status === "pending" && m.evidence.some(e => e.source === `回答反馈 ${learning.runId}`)) ?? null); }
    catch (e) { setStatus(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  }
  return <div className="response-learning">
    {candidate && <div className="candidate-inline"><p>以后这样讲，适合你吗？<strong>{candidate.text}</strong></p><button className="btn btn--quiet" disabled={busy} onClick={() => void act({ action: "approve", id: candidate.id, version: candidate.version })}>记住这个改法</button><button className="text-button" disabled={busy} onClick={() => void act({ action: "reject", id: candidate.id, version: candidate.version })}>不符合我</button></div>}
    <div className="inline-actions"><button className="text-button" disabled={busy} onClick={() => void act({ action: "feedback", runId: learning.runId, helpful: true, note: "" })}>这个讲法有帮助</button><button className="text-button" onClick={() => setAdjusting(!adjusting)}>换个讲法</button>{learning.selected.length > 0 && <details><summary>参考了 {learning.selected.length} 条偏好</summary>{learning.selected.map(s => <p key={s.id}>{s.text}</p>)}</details>}</div>
    {adjusting && <div><textarea className="field" rows={2} aria-label="希望怎样调整讲法" placeholder="哪里卡住？希望它怎么改？例如：先用一个输入走完整个流程。" value={note} onChange={e => setNote(e.target.value)} /><button className="btn btn--quiet" disabled={busy || !note.trim()} onClick={() => void act({ action: "feedback", runId: learning.runId, helpful: false, note })}>提交改法</button></div>}
    {learning.observationId&&<Link href={`/learning?observation=${encodeURIComponent(learning.observationId)}#observations`} className="text-button">查看这次观察记录</Link>}
    {status && <small role="status">{status}</small>}{learning.note && <small>{learning.note}</small>}
  </div>;
}
