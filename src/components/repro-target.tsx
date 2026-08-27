"use client";

import { useState } from "react";

export type Scope = "table" | "figure" | "metric" | "full" | "custom";
export interface TargetMetric { name: string; expected?: number | string; tolerance?: number; unit?: string }
export interface Target { scope: Scope; name: string; metrics: TargetMetric[] }
export interface Constraints { hardware?: { gpu?: string; memoryGb?: number }; timeBudgetHours?: number; modificationPolicy: "none" | "minimal" | "allowed"; computeBudget?: number; dataPolicy?: string }
export interface Criterion { id: string; text: string; kind: "metric" | "behavior" | "artifact"; satisfied?: boolean }
export interface Acceptance { criteria: Criterion[] }

/** 系统按目标类型推荐的候选复现目标（Step 4 接论文结构抽取后自动生成，这里先给通用候选） */
const SCOPE_CANDIDATES: Record<Scope, { name: string; metrics: TargetMetric[] }[]> = {
  table: [
    { name: "Table 2 — Main results", metrics: [{ name: "Accuracy", expected: "—", unit: "%" }, { name: "F1", expected: "—" }] },
    { name: "Table 3 — Generalization", metrics: [{ name: "指标 1", expected: "—" }] },
  ],
  figure: [
    { name: "Figure 4 — Ablation", metrics: [{ name: "Ablation 指标", expected: "—" }] },
  ],
  metric: [
    { name: "主指标", metrics: [{ name: "主指标", expected: "—" }] },
  ],
  full: [
    { name: "完整论文复现", metrics: [{ name: "主实验指标", expected: "—" }] },
  ],
  custom: [{ name: "自定义目标", metrics: [{ name: "指标", expected: "—" }] }],
};

/** 系统推荐的验收标准（用户确认，而非自己设计） */
function recommendedCriteria(metrics: TargetMetric[]): Criterion[] {
  const out: Criterion[] = [
    { id: `ac-${Date.now().toString(36)}-0`, text: "官方数据集版本一致", kind: "behavior" },
    { id: `ac-${Date.now().toString(36)}-1`, text: "评估协议一致（与论文同一指标定义/后处理）", kind: "behavior" },
    ...metrics.filter((m) => m.name).map((m, i) => ({
      id: `ac-${Date.now().toString(36)}-${i + 2}`,
      text: `主指标 ${m.name} 达到 ${m.expected ?? "论文报告值"}${m.tolerance ? ` ± ${m.tolerance}` : ""}`,
      kind: "metric" as const,
    })),
    { id: `ac-${Date.now().toString(36)}-9`, text: "未为得到结果修改模型结构（Level 2 改动须记录）", kind: "behavior" },
  ];
  return out;
}

export default function ReproTarget({
  target, constraints, acceptance, onSave,
}: {
  target?: Target;
  constraints?: Constraints;
  acceptance?: Acceptance;
  onSave: (t: Target, c: Constraints, a: Acceptance) => Promise<void>;
}) {
  const [scope, setScope] = useState<Scope>(target?.scope ?? "table");
  const [name, setName] = useState(target?.name ?? "");
  const [metrics, setMetrics] = useState<TargetMetric[]>(target?.metrics?.length ? target.metrics : SCOPE_CANDIDATES.table[0].metrics);
  const [candidateIdx, setCandidateIdx] = useState(0);
  const [gpu, setGpu] = useState(constraints?.hardware?.gpu ?? "");
  const [timeKnown, setTimeKnown] = useState(constraints?.timeBudgetHours !== undefined);
  const [timeH, setTimeH] = useState(constraints?.timeBudgetHours ?? 12);
  const [policy, setPolicy] = useState<Constraints["modificationPolicy"]>(constraints?.modificationPolicy ?? "minimal");
  const [dataPolicy, setDataPolicy] = useState(constraints?.dataPolicy ?? "");
  const [showAccept, setShowAccept] = useState(false);
  const [acceptEdit, setAcceptEdit] = useState(false);
  const [criteria, setCriteria] = useState<Criterion[]>(acceptance?.criteria?.length ? acceptance.criteria : []);
  const [busy, setBusy] = useState(false);

  function applyCandidate(i: number) {
    const c = SCOPE_CANDIDATES[scope][i] ?? SCOPE_CANDIDATES[scope][0];
    setCandidateIdx(i);
    setName(c.name);
    setMetrics(c.metrics);
  }

  function setScopeAnd(s: Scope) {
    setScope(s);
    setCandidateIdx(0);
    const c = SCOPE_CANDIDATES[s][0];
    setName(c.name);
    setMetrics(c.metrics);
  }

  function pickCandidate() {
    setCriteria(recommendedCriteria(metrics));
    setShowAccept(true);
  }

  async function save() {
    if (!name.trim()) return;
    setBusy(true);
    const t: Target = { scope, name: name.trim(), metrics: metrics.filter((m) => m.name.trim()) };
    const c: Constraints = {
      hardware: gpu.trim() ? { gpu: gpu.trim() } : undefined,
      timeBudgetHours: timeKnown ? timeH : undefined,
      modificationPolicy: policy,
      dataPolicy: dataPolicy.trim() || undefined,
    };
    const a: Acceptance = { criteria: criteria.length ? criteria : recommendedCriteria(t.metrics) };
    try { await onSave(t, c, a); } finally { setBusy(false); }
  }

  const done = Boolean(target && constraints && acceptance && acceptance.criteria.length > 0);

  return (
    <div className={`repro-target${done ? " is-done" : ""}`}>
      <div className="repro-sec-head">
        <span className="mono-label">① 你想复现什么</span>
        {done && <span className="chip chip--dark">已定义</span>}
      </div>

      {done && !showAccept && (
        <div className="repro-target-summary">
          <div><b>{target?.name}</b> · {target?.metrics.map((m) => `${m.name}${m.expected ? "=" + m.expected : ""}`).join(" / ")}</div>
          <div className="mono-label" style={{ opacity: 0.7 }}>
            修改政策 {constraints?.modificationPolicy === "none" ? "不允许" : constraints?.modificationPolicy === "minimal" ? "最小修改" : "可以"} ·
            {constraints?.timeBudgetHours ? ` 上限 ${constraints.timeBudgetHours}h` : " 不设时间上限"} ·
            验收 {acceptance?.criteria.length} 条
          </div>
          <button className="btn btn--ghost btn--quiet" onClick={() => setShowAccept(true)}>调整目标 / 验收</button>
        </div>
      )}

      {(!done || showAccept) && (
        <div className="repro-target-form">
          <div className="repro-target-q">
            <div className="mono-label">你这次想做到哪一步？</div>
            <div className="repro-target-scopes">
              {([
                ["table", "复现论文里的一个核心结果", "例如 Table 2 / Figure 4 / 主指标"],
                ["full", "完整复现实验", "主实验 + 消融 + 主要图表"],
                ["custom", "我有自己的目标", "自定义指标与目标名"],
                ["figure", "复现一张图", "例如 Figure 4 — Ablation"],
              ] as [Scope, string, string][]).map(([s, label, desc]) => (
                <label key={s} className={`repro-target-opt${scope === s ? " is-on" : ""}`}>
                  <input type="radio" checked={scope === s} onChange={() => setScopeAnd(s)} />
                  <span><b>{label}</b><small>{desc}</small></span>
                </label>
              ))}
            </div>
          </div>

          <div className="repro-target-q">
            <div className="mono-label">论文里适合作为复现目标的结果（系统建议，可换）</div>
            <div className="repro-target-cands">
              {SCOPE_CANDIDATES[scope].map((c, i) => (
                <button key={c.name} className={`chip${i === candidateIdx ? " chip--on" : ""}`} onClick={() => applyCandidate(i)}>
                  {c.name}
                </button>
              ))}
            </div>
            <div className="repro-target-metrics">
              <label className="mono-label">目标名 <input className="field field--mini" value={name} onChange={(e) => setName(e.target.value)} /></label>
              {metrics.map((m, i) => (
                <div key={i} className="repro-target-metric">
                  <input className="field field--mini" placeholder="指标名（Accuracy / F1 / MAE）" value={m.name} onChange={(e) => setMetrics((arr) => arr.map((x, j) => j === i ? { ...x, name: e.target.value } : x))} />
                  <input className="field field--mini" placeholder="期望值（论文报告值）" value={m.expected ?? ""} onChange={(e) => setMetrics((arr) => arr.map((x, j) => j === i ? { ...x, expected: e.target.value || undefined } : x))} />
                  <input className="field field--mini" placeholder="±容差" value={m.tolerance ?? ""} onChange={(e) => setMetrics((arr) => arr.map((x, j) => j === i ? { ...x, tolerance: e.target.value ? Number(e.target.value) : undefined } : x))} />
                  <button className="btn btn--ghost btn--quiet" onClick={() => setMetrics((arr) => arr.filter((_, j) => j !== i))}>×</button>
                </div>
              ))}
              <button className="btn btn--ghost btn--quiet" onClick={() => setMetrics((arr) => [...arr, { name: "", expected: "" }])}>+ 指标</button>
            </div>
          </div>

          <div className="repro-target-q">
            <div className="mono-label">执行约束</div>
            <div className="repro-target-cons">
              <label className="mono-label">GPU <input className="field field--mini" value={gpu} onChange={(e) => setGpu(e.target.value)} placeholder="RTX 5070 Laptop（可不填）" /></label>
              <label className="mono-label">修改官方实现
                <select className="field field--mini" value={policy} onChange={(e) => setPolicy(e.target.value as Constraints["modificationPolicy"])}>
                  <option value="none">不允许</option><option value="minimal">最小修改</option><option value="allowed">可以</option>
                </select>
              </label>
              <label className="mono-label">最大实验时间
                {timeKnown ? (
                  <span className="repro-inline"><input className="field field--mini" type="number" value={timeH} onChange={(e) => setTimeH(Number(e.target.value))} /><button className="btn btn--ghost btn--quiet" onClick={() => setTimeKnown(false)}>我不知道</button></span>
                ) : (
                  <button className="btn btn--ghost btn--quiet" onClick={() => setTimeKnown(true)}>我不知道，让系统建议</button>
                )}
              </label>
              <label className="mono-label">数据策略 <input className="field field--mini" value={dataPolicy} onChange={(e) => setDataPolicy(e.target.value)} placeholder="如：仅用官方 train split" /></label>
            </div>
            {!timeKnown && <p className="mono-label" style={{ opacity: 0.6 }}>建议：先不设硬上限；Smoke Test 控制在 10 分钟内，正式训练再按实际估。</p>}
          </div>

          <div className="repro-target-q">
            <div className="mono-label">验收标准（系统按目标推荐，可调整）</div>
            {!showAccept ? (
              <button className="btn btn--primary btn--sm" onClick={pickCandidate}>生成建议的验收标准</button>
            ) : (
              <div className="repro-target-accept">
                {!acceptEdit ? (
                  <>
                    <ul>
                      {criteria.map((c) => <li key={c.id} className="mono-label">✓ {c.text}</li>)}
                    </ul>
                    <button className="btn btn--ghost btn--quiet" onClick={() => setAcceptEdit(true)}>查看并调整</button>
                  </>
                ) : (
                  <div className="repro-target-accept-edit">
                    {criteria.map((c, i) => (
                      <div key={c.id} className="repro-target-accept-row">
                        <input className="field field--mini" value={c.text} onChange={(e) => setCriteria((arr) => arr.map((x, j) => j === i ? { ...x, text: e.target.value } : x))} />
                        <select className="field field--mini" value={c.kind} onChange={(e) => setCriteria((arr) => arr.map((x, j) => j === i ? { ...x, kind: e.target.value as Criterion["kind"] } : x))}>
                          <option value="metric">指标</option><option value="behavior">行为</option><option value="artifact">产物</option>
                        </select>
                        <button className="btn btn--ghost btn--quiet" onClick={() => setCriteria((arr) => arr.filter((_, j) => j !== i))}>×</button>
                      </div>
                    ))}
                    <button className="btn btn--ghost btn--quiet" onClick={() => setCriteria((arr) => [...arr, { id: `ac-${Date.now().toString(36)}-${arr.length}`, text: "", kind: "behavior" }])}>+ 标准</button>
                  </div>
                )}
              </div>
            )}
          </div>

          <button className="btn btn--primary" disabled={busy || !name.trim()} onClick={() => void save()}>
            {busy ? "保存中…" : "保存目标与验收"}
          </button>
        </div>
      )}
    </div>
  );
}
