"use client";

import { useState } from "react";

export default function ReproStageAnalyzing({
  title, goalIntent, analysis, hasTarget, onAnalyze, onConfirmTarget, onProceed,
}: {
  title: string;
  goalIntent?: string;
  analysis?: { status: string; summary?: { paperFacts: number; repoFacts: number; mappings: number; gaps: number; blocking: number }; error?: string };
  hasTarget: boolean;
  onAnalyze: () => Promise<void>;
  onConfirmTarget: (accept: boolean) => Promise<void>;
  onProceed: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const done = analysis?.status === "done";
  const failed = analysis?.status === "failed";
  const needScan = (analysis?.summary?.gaps ?? 0) - (analysis?.summary?.blocking ?? 0) > 0;
  const needConfirmTarget = goalIntent === "unknown" && !hasTarget;

  async function run() {
    setBusy(true);
    try { await onAnalyze(); } finally { setBusy(false); }
  }

  return (
    <div className="repro-stage">
      <div className="repro-stage-title">系统正在替你分析《{title}》</div>
      <p className="mono-label" style={{ opacity: 0.7 }}>
        不需要你理解内部细节——下面每一行都是系统已经帮你完成的。完成后只会把真正需要你决定的问题留给你。
      </p>

      {!done && !failed && (
        <div className="repro-analyzing-cta">
          <p className="mono-label">点击开始后，系统将一次性完成：论文解析 → 代码扫描 → 事实抽取 → 论文↔代码对应 → 问题检测。</p>
          <button className="btn btn--primary" disabled={busy} onClick={() => void run()}>
            {busy ? "分析中（约 1–2 分钟）…" : "开始分析"}
          </button>
        </div>
      )}

      {failed && (
        <div className="repro-analyzing-cta">
          <p className="mono-label" style={{ color: "var(--danger, #b00)" }}>分析失败：{analysis?.error ?? "未知错误"}</p>
          <button className="btn btn--primary" disabled={busy} onClick={() => void run()}>重试分析</button>
        </div>
      )}

      {done && analysis?.summary && (
        <div className="repro-analysis-summary">
          <div className="repro-analysis-grid">
            <div className="repro-analysis-item"><b>论文</b><span>已解析 · {analysis.summary.paperFacts} 项事实</span></div>
            <div className="repro-analysis-item"><b>代码</b><span>已扫描 · {analysis.summary.repoFacts} 项事实</span></div>
            <div className="repro-analysis-item"><b>对应关系</b><span>已建立 {analysis.summary.mappings} 处</span></div>
            <div className="repro-analysis-item"><b>待处理</b><span>{analysis.summary.gaps} 个问题（{analysis.summary.blocking} 个阻塞）</span></div>
          </div>

          {/* ⑥ needScan 尚存时不用完成式文案 */}
          {needScan ? (
            <p className="mono-label" style={{ opacity: 0.7 }}>
              分析完成，但仍有一些事实尚未覆盖（需系统进一步查证）。下面进入需要你决定的部分。
            </p>
          ) : (
            <p className="mono-label" style={{ opacity: 0.7 }}>分析完成，所有可判定问题已整理。</p>
          )}

          {/* ⑤ unknown goal：系统建议目标 → 用户确认 */}
          {needConfirmTarget && (
            <div className="repro-target-suggest">
              <span className="mono-label">你选择了「让系统建议」——根据论文分析，系统建议这次复现：</span>
              <div className="repro-target-suggest-card">
                <b>复现论文里的一个主结果（主实验指标）</b>
                <span className="mono-label" style={{ opacity: 0.7 }}>论文实验章节定位到主结果表；具体指标值待你在执行阶段与代码对齐。</span>
              </div>
              <div style={{ display: "flex", gap: "0.4rem" }}>
                <button className="btn btn--primary btn--sm" onClick={() => void onConfirmTarget(true)}>接受这个目标</button>
                <button className="btn btn--ghost btn--quiet" onClick={() => void onConfirmTarget(false)}>我另有目标</button>
              </div>
            </div>
          )}

          <button className="btn btn--primary" onClick={onProceed}>
            {analysis.summary.blocking > 0 ? "查看需要处理的问题 →" : "生成复现准备摘要 →"}
          </button>
        </div>
      )}
    </div>
  );
}
