"use client";

import { useState } from "react";
import Dashboard from "@/components/dashboard";
import Terms from "@/components/terms";
import Network from "@/components/network";
import Repro from "@/components/repro";
import Journal from "@/components/journal";
import ChatPanel from "@/components/chat-panel";
import PageHead from "@/components/page-head";
import { papers, researchPhases } from "@/lib/data-atelier";

type Page = "overview" | "screen" | "explain" | "terms" | "network" | "repro" | "journal";

/** 左侧视图清单：总览 + 01–06（Linear 式 workspace 导航） */
const VIEWS: { id: Page; label: string; num: string | null }[] = [
  { id: "overview", label: "总览", num: null },
  { id: "screen", label: "论文筛选", num: "01" },
  { id: "explain", label: "精读讲解", num: "02" },
  { id: "terms", label: "术语卡", num: "03" },
  { id: "network", label: "知识网络", num: "04" },
  { id: "repro", label: "实验复现", num: "05" },
  { id: "journal", label: "研究日志", num: "06" },
];

/** 真实的"今天"日期戳 */
function todayStamp() {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export default function App() {
  const [page, setPage] = useState<Page>("overview");
  const current = papers[0];
  const activePhase = researchPhases.find((p) => p.active);

  return (
    <div className="shell">
      {/* 顶部状态条：品牌 + 今日状态 + 当前阶段 + AI 状态 + 最近活动 */}
      <header className="topbar">
        <div className="topbar-inner">
          <div className="topbar-brand">
            <span className="topbar-word">Research Atelier<span className="dot">.</span></span>
            <span className="topbar-sub">个人研究操作系统</span>
          </div>
          <span className="chip chip--red">{current.status}</span>
          {activePhase && <span className="chip chip--sage">阶段 {activePhase.phase}</span>}
          <span className="chip chip--green">AI 伴侣在线</span>
          <div className="topbar-meta">
            <span className="mono-label">最近活动 08/21 · R6 实证</span>
            <span className="mono-label">{todayStamp()}</span>
            <span className="mono-label">v0.4</span>
          </div>
        </div>
      </header>

      <div className="app-body">
        {/* 左侧固定导航（Linear/IDE 选中态） */}
        <nav className="rail" aria-label="工作区导航">
          <div className="rail-head">
            <p className="rail-head-title">工作台</p>
            <span className="mono-label">今日 · {todayStamp()}</span>
          </div>
          <div className="rail-nav">
            {VIEWS.map((v) => (
              <button
                key={v.id}
                className={`rail-item${page === v.id ? " is-active" : ""}`}
                onClick={() => setPage(v.id)}
                aria-current={page === v.id ? "page" : undefined}
              >
                <span className="ri-num">{v.num ?? "⌂"}</span>
                <span>{v.label}</span>
                {v.id === "overview" && <span className="ri-tag">今天</span>}
              </button>
            ))}
          </div>
          <div className="rail-foot">
            <span className="rail-status">研究伴侣 · 在线</span>
            <span className="rail-meta">
              档案持续更新中<br />
              数据均在 data/ 目录 · 随 git
            </span>
          </div>
        </nav>

        {/* 工作区 */}
        <main className="workspace">
          {page === "overview" && <Dashboard onNavigate={(p) => setPage(p as Page)} />}

          {page === "screen" && (
            <>
              <PageHead
                num="01" name="论文筛选"
                title="论文筛选"
                desc="判断一篇论文是否值得读、读多深：入口澄清 → 收集 5–10 篇 → 六维评分 → 停在筛选笔记。"
                meta="单篇 10–20 分钟 · 产出 → data/notes/screening.md"
              />
              <ChatPanel
                toolKey="p0"
                hint="第一条消息直接给领域 + 目标 + 子问题 + 时间预算，例如：“我想了解 world model 最近为什么火；预算 60 分钟”。"
                intro={[
                  "判断一篇论文是否值得读、读多深：入口澄清 → 收集 5–10 篇 → 六维评分 → 停在筛选笔记。",
                  "拿到新论文/新领域、读论文途中冒出相关方向时。",
                  "输入领域和目标，它会先做入口澄清（目标/子问题/预算），再收集筛选；完成点“保存为筛选笔记”。",
                  "筛选笔记（data/notes/screening.md），每条带来源可核实。",
                ]}
                saveLabel="保存为筛选笔记" saveKind="screening"
              />
            </>
          )}

          {page === "explain" && (
            <>
              <PageHead
                num="02" name="精读讲解"
                title="精读讲解"
                desc="把方法段从功能比喻降到操作支架：先答你的问题 → 最小操作支架 → 最小数据轨迹 → 验收复述。"
                meta="8 步固定流程 · 产出 → 你的理解"
              />
              <ChatPanel
                toolKey="p3"
                hint="贴一段论文的方法/实现文字（或你的问题），它会按 8 步讲解流程带你读懂。"
                intro={[
                  "把方法段从功能比喻降到操作支架：先答你的问题 → 最小操作支架 → 最小数据轨迹 → 框架机制 → 训练闭环 → 配置证据链 → 挂回论文 → 验收复述。",
                  "读到方法/实现段卡住、神经网络操作看不懂时。",
                  "贴段落或提问题；它按固定 8 步带读，最后让你复述“输入→计算→输出”验收。",
                  "你的理解（复述通过 = 掌握）。",
                ]}
              />
            </>
          )}

          {page === "terms" && <Terms />}
          {page === "network" && <Network onNavigate={(p) => setPage(p as Page)} />}
          {page === "repro" && <Repro />}
          {page === "journal" && <Journal />}
        </main>
      </div>
    </div>
  );
}
