"use client";

import { useEffect, useState } from "react";

interface Gap {
  id: string; key: string; type: string; blocksReady: boolean;
  description: string; paperValue?: unknown; repoValue?: unknown;
  paperFacts: { id: string; value?: unknown; status: string }[];
  repoFacts: { id: string; value?: unknown; status: string }[];
}
interface Decision { id: string; gapId?: string; status: string; choice?: { kind: string; factId?: string; value?: unknown } }

export default function ReproStageDecisions({
  slug, onDone, onRescan,
}: {
  slug: string;
  onDone: () => void;
  onRescan: () => void;
}) {
  const [needDecision, setNeedDecision] = useState<Gap[]>([]);
  const [needScan, setNeedScan] = useState<Gap[]>([]);
  const [decisions, setDecisions] = useState<Decision[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [customInput, setCustomInput] = useState<Record<string, string>>({});
  const [customOpen, setCustomOpen] = useState<string | null>(null);

  async function load() {
    try {
      const d = await (await fetch("/api/reproduction/gaps", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ slug, action: "detect" }) })).json();
      const eff = (d.effectiveGaps ?? []) as Gap[];
      setNeedDecision(eff.filter((g) => ["value_conflict", "source_conflict", "not_found", "uncomparable"].includes(g.type)));
      setNeedScan(eff.filter((g) => g.type === "not_scanned"));
      const dd = await (await fetch("/api/reproduction/gaps", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ slug, action: "decisions" }) })).json();
      setDecisions(dd.decisions ?? []);
    } catch { /* */ }
  }
  useEffect(() => { void load(); }, [slug]);

  async function act(body: Record<string, unknown>) {
    const d = await (await fetch("/api/reproduction/gaps", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })).json();
    return d;
  }

  async function choose(gap: Gap, choice: Decision["choice"]) {
    setBusyId(gap.id);
    try {
      // 已有该 gap 的 pending decision → accept；否则 propose 再 accept
      let dec = decisions.find((x) => x.gapId === gap.id);
      if (!dec) {
        const p = await act({ slug, action: "proposeDecision", gapId: gap.id });
        dec = p.decision;
      }
      if (dec) await act({ slug, action: "acceptDecision", id: dec.id, choice });
      await load();
    } finally { setBusyId(null); }
  }

  const unresolved = needDecision.filter((g) => !decisions.some((d) => d.gapId === g.id && d.status === "accepted"));

  return (
    <div className="repro-stage">
      <div className="repro-stage-title">需要你决定 · {unresolved.length}</div>
      <p className="mono-label" style={{ opacity: 0.7 }}>
        下面每一项都是「论文和代码确实不一致 / 缺失」，只有你拍板后系统才能继续。已解决的不会出现。
      </p>

      {needScan.length > 0 && (
        <div className="repro-need-scan">
          <span className="mono-label">⚠ {needScan.length} 项需要系统继续查证（当前不可决定）：</span>
          <ul>
            {needScan.map((g) => (
              <li key={g.id} className="mono-label" style={{ opacity: 0.75 }}>· {g.description}</li>
            ))}
          </ul>
          <button className="btn btn--ghost btn--quiet" onClick={onRescan}>重新扫描（补充证据）</button>
        </div>
      )}

      <div className="repro-decisions">
        {unresolved.length === 0 ? (
          <div className="repro-decisions-empty">
            <p className="mono-label">没有需要你决定的问题了。</p>
            <button className="btn btn--primary" onClick={onDone}>生成复现准备摘要 →</button>
          </div>
        ) : unresolved.map((gap, i) => (
          <div key={gap.id} className="repro-decision">
            <div className="repro-decision-head">
              <span className="chip chip--dark">问题 {i + 1}/{unresolved.length}</span>
              <span className="mono-label">{gap.key}</span>
            </div>
            <p className="repro-decision-desc">{gap.description}</p>
            <div className="repro-decision-evidence">
              <div className="mono-label">论文证据</div>
              {gap.paperFacts.length ? gap.paperFacts.map((f) => (
                <div key={f.id} className="mono-label">{JSON.stringify(f.value)}</div>
              )) : <div className="mono-label" style={{ opacity: 0.6 }}>（论文侧缺失）</div>}
              <div className="mono-label">代码证据</div>
              {gap.repoFacts.length ? gap.repoFacts.map((f) => (
                <div key={f.id} className="mono-label">{JSON.stringify(f.value)}</div>
              )) : <div className="mono-label" style={{ opacity: 0.6 }}>（代码侧缺失）</div>}
            </div>
            <div className="repro-decision-actions">
              {gap.paperFacts.filter((f) => f.status !== "missing").map((f) => (
                <button key={f.id} className="btn btn--ghost" disabled={busyId === gap.id} onClick={() => void choose(gap, { kind: "fact", factId: f.id })}>
                  按论文 {JSON.stringify(f.value)}
                </button>
              ))}
              {gap.repoFacts.filter((f) => f.status !== "missing").map((f) => (
                <button key={f.id} className="btn btn--ghost" disabled={busyId === gap.id} onClick={() => void choose(gap, { kind: "fact", factId: f.id })}>
                  按官方代码 {JSON.stringify(f.value)}
                </button>
              ))}
              {customOpen === gap.id ? (
                <span className="repro-custom-inline">
                  <input className="field field--mini" placeholder="输入你要用的值" value={customInput[gap.id] ?? ""} onChange={(e) => setCustomInput((c) => ({ ...c, [gap.id]: e.target.value }))} />
                  <button className="btn btn--ghost" disabled={busyId === gap.id || !(customInput[gap.id] ?? "").trim()} onClick={() => void choose(gap, { kind: "custom", value: (customInput[gap.id] ?? "").trim() })}>确定</button>
                </span>
              ) : (
                <button className="btn btn--ghost" onClick={() => setCustomOpen(gap.id)}>自定义…</button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
