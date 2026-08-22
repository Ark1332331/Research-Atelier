"use client";

import { useEffect, useState } from "react";
import ChatPanel from "@/components/chat-panel";
import Markdown from "@/components/markdown";
import PageHead from "@/components/page-head";

const TOOLS_META: { key: string; title: string; note: string; hint: string; intro: string[] }[] = [
  {
    key: "code",
    title: "代码导读",
    note: "读代码是可自由进入/退出的状态：完整导读 + 验收复述，不设深读上限。",
    hint: "给出代码文件路径 + 你的问题（或让它按导读协议带你读）。",
    intro: [
      "带你看懂代码：入口检查 → 文件顺序 → 数据合同 → 执行轨迹 → 你复述验收。",
      "读论文复现代码、新项目代码时；中断很久后重新接上时。",
      "直接说你在复现的哪一步（如 R5-b9），它会自动带上复现上下文，再带你读对应代码。",
      "你的理解（复述通过 = 掌握；不过就重讲）。",
    ],
  },
  {
    key: "env",
    title: "环境管理",
    note: "环境说不清、版本踩坑、每次重讲 → 一张长期复用的环境卡 + 三层定位诊断。",
    hint: "描述你的环境问题或报错（或让它先读环境卡）。",
    intro: [
      "环境诊断助手：三层定位法（驱动/环境/项目）+ 兼容问题日志 + 放行检查。",
      "报错看不懂、版本不兼容、要装新依赖、长训练前；系统/驱动/conda 变化后。",
      "描述问题或报错，它自动带上环境卡核对——描述与卡片不符时会主动提醒你更新。",
      "环境卡更新 + 问题日志（data/environment.md，含变更记录）。",
    ],
  },
  {
    key: "checklist",
    title: "放行检查",
    note: "任何 GPU / 长训练的复现，启动无人值守前必须过这张表。",
    hint: "描述你的训练/部署计划，让它执行放行检查。",
    intro: [
      "长训练放行检查表：运行时核验 / 资源预算 / 依赖风险 / 可观测性 / 分级验证 / 放行结论。",
      "启动无人值守长训练或大安装之前。",
      "描述你的计划，它逐项检查并给出“可以长跑”的证据或阻塞项。",
      "放行结论（写进实验记录）。",
    ],
  },
  {
    key: "handoff",
    title: "交接提示词",
    note: "上下文过长 / 换平台 / 换模型时，生成一段让下一个会话冷启动的提示词。",
    hint: "描述当前任务/阶段，让它生成自包含交接提示词。",
    intro: [
      "自包含交接词：任务 / 约束 / 已确认事实 / 已排除路线 / 当前步 / 下一步。",
      "上下文过长、换模型、换电脑、开新会话前。",
      "描述你现在的状态，它生成交接词；完成后点“保存交接词”存入记忆。",
      "data/handoffs.md（追加式）。",
    ],
  },
];

const TOOL_COLORS: Record<string, string> = {
  code: "var(--sage-ink)",
  env: "var(--amber)",
  checklist: "var(--accent)",
  handoff: "var(--ok)",
};

export default function Repro() {
  const [active, setActive] = useState<string | null>(null);
  const [ctx, setCtx] = useState("");
  const meta = TOOLS_META.find((t) => t.key === active);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/context?kind=repro")
      .then((r) => r.json())
      .then((d) => { if (!cancelled) setCtx(d.content ?? ""); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  if (meta) {
    return (
      <section>
        <PageHead
          num="05" name="实验复现"
          title={meta.title}
          desc={meta.note}
          meta="点开即用 · 提示词可查"
        />
        <ChatPanel
          toolKey={meta.key} hint={meta.hint} intro={meta.intro}
          contextKind={meta.key === "code" ? "repro" : meta.key === "env" ? "environment" : undefined}
          saveLabel={meta.key === "handoff" ? "保存交接词" : undefined}
          saveKind={meta.key === "handoff" ? "handoff" : undefined}
        />
        <button className="btn btn--ghost btn--quiet" style={{ marginTop: "2rem" }} onClick={() => setActive(null)}>
          ← 工具列表
        </button>
      </section>
    );
  }

  return (
    <section>
      <PageHead
        num="05" name="实验复现"
        title="实验复现"
        desc="复现的每一步：先读上下文 → 选工具直接执行；代码导读、环境诊断、放行检查、交接词。"
        meta={`${TOOLS_META.length} 个工具 · 上下文自动附带`}
      />

      {/* 复现状态上下文（只读预览，对话时自动附带） */}
      {ctx && (
        <div className="ctx-preview">
          <div className="ctx-preview-head">
            <span className="mono-label" style={{ color: "var(--sage-ink)" }}>复现状态上下文</span>
            <span className="mono-label">来自 data/repro-context.md · 对话自动附带</span>
          </div>
          <div className="md-body">
            <Markdown>{ctx}</Markdown>
          </div>
        </div>
      )}

      {/* 工具索引 */}
      <div className="tool-index">
        {TOOLS_META.map((t, i) => (
          <button
            key={t.key}
            className="tool-row"
            onClick={() => setActive(t.key)}
            aria-label={`打开 ${t.title}`}
          >
            <span className="tool-num" style={{ color: TOOL_COLORS[t.key] ?? "var(--muted-foreground)" }}>
              {String(i + 1).padStart(2, "0")}
            </span>
            <span>
              <span className="tool-title" style={{ display: "block" }}>{t.title}</span>
              <span className="tool-note" style={{ display: "block" }}>{t.note}</span>
              <span className="tool-first" style={{ display: "block" }}>{t.intro[0]}</span>
            </span>
            <span className="tool-arrow" aria-hidden="true">→</span>
          </button>
        ))}
      </div>
    </section>
  );
}
