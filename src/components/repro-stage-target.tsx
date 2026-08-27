"use client";

import { useState } from "react";
import type { GoalIntent } from "@/lib/reproduction-spec";

const GOALS: { value: GoalIntent; label: string; desc: string }[] = [
  { value: "run_first", label: "先把官方代码跑起来", desc: "确认项目和环境可用，不追指标" },
  { value: "main_result", label: "复现论文里的一个主结果", desc: "例如 Table 2 主实验 / 主指标" },
  { value: "figure", label: "复现指定图表", desc: "例如 Figure 4 — Ablation" },
  { value: "full", label: "完整复现实验", desc: "主实验 + 消融 + 主要图表" },
  { value: "unknown", label: "我不知道，让系统建议", desc: "系统分析论文后帮你确定具体目标" },
];

export default function ReproStageTarget({
  goalIntent, onSave,
}: {
  goalIntent?: GoalIntent;
  onSave: (g: GoalIntent) => Promise<void>;
}) {
  const [pick, setPick] = useState<GoalIntent | "">(goalIntent ?? "");
  const [busy, setBusy] = useState(false);

  async function save() {
    if (!pick) return;
    setBusy(true);
    try { await onSave(pick); } finally { setBusy(false); }
  }

  return (
    <div className="repro-stage">
      <div className="repro-stage-title">开始一次论文复现</div>
      <p className="mono-label" style={{ opacity: 0.7 }}>
        你只需要决定一件事：这次想复现到什么程度。论文解析、代码分析、事实核对都交给系统。
      </p>
      <div className="repro-goals">
        {GOALS.map((g) => (
          <label key={g.value} className={`repro-goal${pick === g.value ? " is-on" : ""}`}>
            <input type="radio" name="goal" checked={pick === g.value} onChange={() => setPick(g.value)} />
            <span><b>{g.label}</b><small>{g.desc}</small></span>
          </label>
        ))}
      </div>
      <button className="btn btn--primary" disabled={!pick || busy} onClick={() => void save()}>
        {busy ? "保存中…" : pick === "unknown" ? "开始分析（让系统建议目标）" : "开始分析 →"}
      </button>
      {pick === "unknown" && (
        <p className="mono-label" style={{ opacity: 0.6, marginTop: "0.4rem" }}>
          系统会先分析论文与代码，再给你一份建议目标供确认——不会替你擅自决定。
        </p>
      )}
    </div>
  );
}
