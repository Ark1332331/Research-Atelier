"use client";

export default function ReproStageReady({
  title, analysis, goalIntent,
}: {
  title: string;
  analysis?: { summary?: { paperFacts: number; repoFacts: number; mappings: number; gaps: number; blocking: number } };
  goalIntent?: string;
}) {
  const s = analysis?.summary;
  const goalLabel = {
    run_first: "先把官方代码跑起来",
    main_result: "复现论文里的一个主结果",
    figure: "复现指定图表",
    full: "完整复现实验",
    unknown: "待系统建议（尚未确认）",
  }[goalIntent ?? "unknown"] ?? "未设定";

  return (
    <div className="repro-stage">
      <div className="repro-stage-title">复现准备摘要</div>
      <p className="mono-label" style={{ opacity: 0.7 }}>
        这是当前可交给执行的准备状态摘要。环境解析与执行任务拆分将在后续版本接入后，这里会变成真正的「交给 Codex」。
      </p>

      <div className="repro-brief">
        <div className="repro-brief-row"><b>目标</b><span>{goalLabel}</span></div>
        <div className="repro-brief-row"><b>论文</b><span>{title}</span></div>
        {s && (
          <>
            <div className="repro-brief-row"><b>论文事实</b><span>{s.paperFacts} 项</span></div>
            <div className="repro-brief-row"><b>代码事实</b><span>{s.repoFacts} 项</span></div>
            <div className="repro-brief-row"><b>论文↔代码对应</b><span>{s.mappings} 处</span></div>
            <div className="repro-brief-row"><b>待处理问题</b><span>{s.gaps} 个（阻塞 {s.blocking}）</span></div>
          </>
        )}
      </div>

      <p className="mono-label" style={{ opacity: 0.6, marginTop: "0.6rem" }}>
        （环境为「检测到本机环境」，环境兼容性解析尚未接入；执行任务清单将在后续版本生成。）
      </p>
    </div>
  );
}
