"use client";

import { useState } from "react";
import type { Target, TargetMetric, Constraints, Acceptance, AcceptanceCriterion, TargetScope } from "@/lib/reproduction-spec";

/** 系统按目标类型推荐的候选复现目标（Step 4 接论文结构抽取后自动生成，这里先给通用候选）。
 *  未知期望值一律存 undefined（展示层显示「待从论文提取」），绝不存 "—" 之类的展示字符。 */
const SCOPE_CANDIDATES: Record<TargetScope, { name: string; metrics: TargetMetric[] }[]> = {
  table: [
    { name: "Table 2 — Main results", metrics: [{ name: "Accuracy", unit: "%" }, { name: "F1" }] },
    { name: "Table 3 — Generalization", metrics: [{ name: "指标 1" }] },
  ],
  figure: [
    { name: "Figure 4 — Ablation", metrics: [{ name: "Ablation 指标" }] },
  ],
  metric: [
    { name: "主指标", metrics: [{ name: "主指标" }] },
  ],
  full: [
    { name: "完整论文复现", metrics: [{ name: "主实验指标" }] },
  ],
  custom: [{ name: "自定义目标", metrics: [{ name: "指标" }] }],
};

/** 目标选项（用户层文案；「先把代码跑起来」= custom preset） */
const SCOPE_META: { scope: TargetScope; label: string; desc: string; runFirst?: boolean }[] = [
  { scope: "custom", label: "先把官方代码跑起来", desc: "先确认项目和环境可用，不追指标", runFirst: true },
  { scope: "table", label: "复现论文里的一个核心结果", desc: "例如 Table 2 / Figure 4 / 主指标" },
  { scope: "full", label: "完整复现实验", desc: "主实验 + 消融 + 主要图表" },
  { scope: "custom", label: "我有自己的目标", desc: "自定义指标与目标名" },
  { scope: "figure", label: "复现一张图", desc: "例如 Figure 4 — Ablation" },
];

/** 系统推荐的验收标准（用户确认，而非自己设计） */
function recommendedCriteria(metrics: TargetMetric[]): AcceptanceCriterion[] {
  const stamp = Date.now().toString(36);
  const out: AcceptanceCriterion[] = [
    { id: `ac-${stamp}-0`, text: "官方数据集版本一致", kind: "behavior" },
    { id: `ac-${stamp}-1`, text: "评估协议一致（与论文同一指标定义/后处理）", kind: "behavior" },
    ...metrics.filter((m) => m.name.trim()).map((m, i) => ({
      id: `ac-${stamp}-${i + 2}`,
      text: `主指标 ${m.name} 达到 ${m.expected === undefined ? "论文报告值（待从论文提取）" : m.expected}${m.tolerance !== undefined ? ` ± ${m.tolerance}` : ""}`,
      kind: "metric" as const,
    })),
    { id: `ac-${stamp}-9`, text: "未为得到结果修改模型结构（Level 2 改动须记录）", kind: "behavior" },
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
  const [scope, setScope] = useState<TargetScope>(target?.scope ?? "table");
  const [presetRunFirst, setPresetRunFirst] = useState(false);
  const [name, setName] = useState(target?.name ?? "");
  const [metrics, setMetrics] = useState<TargetMetric[]>(target?.metrics?.length ? target.metrics : SCOPE_CANDIDATES.table[0].metrics);
  const [candidateIdx, setCandidateIdx] = useState(0);
  const [gpu, setGpu] = useState(constraints?.hardware?.gpu ?? "");
  const [timeMode, setTimeMode] = useState<"known" | "unknown" | "suggested">(constraints?.timeBudgetHours !== undefined ? "known" : "unknown");
  const [timeH, setTimeH] = useState(constraints?.timeBudgetHours ?? 12);
  const [policy, setPolicy] = useState<Constraints["modificationPolicy"]>(constraints?.modificationPolicy ?? "minimal");
  const [dataPolicy, setDataPolicy] = useState(constraints?.dataPolicy ?? "");
  const [showAccept, setShowAccept] = useState(false);
  const [acceptEdit, setAcceptEdit] = useState(false);
  const [criteria, setCriteria] = useState<AcceptanceCriterion[]>(acceptance?.criteria?.length ? acceptance.criteria : []);
  const [busy, setBusy] = useState(false);

  function applyCandidate(i: number) {
    const c = SCOPE_CANDIDATES[scope][i] ?? SCOPE_CANDIDATES[scope][0];
    setCandidateIdx(i);
    setName(c.name);
    setMetrics(c.metrics);
  }

  function setScopeAnd(s: TargetScope) {
    setScope(s);
    setPresetRunFirst(false);
    setCandidateIdx(0);
    const c = SCOPE_CANDIDATES[s][0];
    setName(c.name);
    setMetrics(c.metrics);
  }

  function pickRunFirst() {
    // 先把官方代码跑起来：custom 目标、0 指标、最小修改政策
    setScope("custom");
    setPresetRunFirst(true);
    setName("官方代码最小可运行");
    setMetrics([]);
    setPolicy("minimal");
  }

  function pickCandidate() {
    setCriteria(recommendedCriteria(metrics));
    setShowAccept(true);
  }

  function adoptSuggestion() {
    // 「我不知道，让系统建议」→ 不设正式训练硬上限（Step 7 环境分析后再估）
    setTimeMode("suggested");
  }

  async function save() {
    if (!name.trim()) return;
    setBusy(true);
    const t: Target = { scope, name: name.trim(), metrics: metrics.filter((m) => m.name.trim()) };
    const c: Constraints = {
      hardware: gpu.trim() ? { gpu: gpu.trim() } : undefined,
      timeBudgetHours: timeMode === "known" ? timeH : undefined,
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
          <div><b>{target?.name}</b> · {target?.metrics.length ? target?.metrics.map((m) => `${m.name}${m.expected !== undefined ? "=" + m.expected : "（待从论文提取）"}`).join(" / ") : "先把代码跑起来，不追指标"}</div>
          <div className="mono-label" style={{ opacity: 0.7 }}>
            修改政策 {constraints?.modificationPolicy === "none" ? "不允许" : constraints?.modificationPolicy === "minimal" ? "最小修改" : "可以"} ·
            {constraints?.timeBudgetHours ? ` 上限 ${constraints.timeBudgetHours}h` : " 不设硬上限"} ·
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
              {SCOPE_META.map(({ scope: s, label, desc, runFirst }) => (
                <label key={label} className={`repro-target-opt${runFirst ? (presetRunFirst ? " is-on" : "") : scope === s ? " is-on" : ""}`}>
                  <input type="radio" checked={runFirst ? presetRunFirst : scope === s} onChange={() => { if (runFirst) pickRunFirst(); else setScopeAnd(s); }} />
                  <span><b>{label}</b><small>{desc}</small></span>
                </label>
              ))}
            </div>
          </div>

          <div className="repro-target-q">
            <div className="mono-label">{presetRunFirst ? "目标（先把代码跑起来）" : "论文里适合作为复现目标的结果（系统建议，可换）"}</div>
            {!presetRunFirst && (
              <div className="repro-target-cands">
                {SCOPE_CANDIDATES[scope].map((c, i) => (
                  <button key={c.name} className={`chip${i === candidateIdx ? " chip--on" : ""}`} onClick={() => applyCandidate(i)}>
                    {c.name}
                  </button>
                ))}
              </div>
            )}
            <div className="repro-target-metrics">
              <label className="mono-label">目标名 <input className="field field--mini" value={name} onChange={(e) => setName(e.target.value)} /></label>
              {!presetRunFirst && metrics.map((m, i) => (
                <div key={i} className="repro-target-metric">
                  <input className="field field--mini" placeholder="指标名（Accuracy / F1 / MAE）" value={m.name} onChange={(e) => setMetrics((arr) => arr.map((x, j) => j === i ? { ...x, name: e.target.value } : x))} />
                  <input className="field field--mini" placeholder="期望值：待从论文提取" value={m.expected ?? ""} onChange={(e) => setMetrics((arr) => arr.map((x, j) => j === i ? { ...x, expected: e.target.value || undefined } : x))} />
                  <input className="field field--mini" placeholder="±容差" value={m.tolerance ?? ""} onChange={(e) => setMetrics((arr) => arr.map((x, j) => j === i ? { ...x, tolerance: e.target.value ? Number(e.target.value) : undefined } : x))} />
                  <button className="btn btn--ghost btn--quiet" onClick={() => setMetrics((arr) => arr.filter((_, j) => j !== i))}>×</button>
                </div>
              ))}
              {!presetRunFirst && <button className="btn btn--ghost btn--quiet" onClick={() => setMetrics((arr) => [...arr, { name: "" }])}>+ 指标</button>}
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
                {timeMode === "known" ? (
                  <span className="repro-inline"><input className="field field--mini" type="number" value={timeH} onChange={(e) => setTimeH(Number(e.target.value))} /><button className="btn btn--ghost btn--quiet" onClick={() => setTimeMode("unknown")}>我不知道</button></span>
                ) : timeMode === "unknown" ? (
                  <button className="btn btn--ghost btn--quiet" onClick={adoptSuggestion}>我不知道，让系统建议</button>
                ) : (
                  <span className="mono-label">已采用系统建议：暂不设硬上限</span>
                )}
              </label>
              <label className="mono-label">数据策略 <input className="field field--mini" value={dataPolicy} onChange={(e) => setDataPolicy(e.target.value)} placeholder="如：仅用官方 train split" /></label>
            </div>
            {timeMode !== "known" && (
              <p className="mono-label" style={{ opacity: 0.6 }}>
                建议：先不设正式训练上限；Smoke Test ≤ 10 分钟。待 Repo Analyzer + 环境分析（Step 3/7）完成后再估正式实验时间。
              </p>
            )}
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
                        <select className="field field--mini" value={c.kind} onChange={(e) => setCriteria((arr) => arr.map((x, j) => j === i ? { ...x, kind: e.target.value as AcceptanceCriterion["kind"] } : x))}>
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
