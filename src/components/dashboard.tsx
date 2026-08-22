"use client";

import { useEffect, useMemo, useState } from "react";
import { papers as papersRaw, researchPhases, turningPoints } from "@/lib/data-atelier";
import type { Term } from "@/app/api/terms/route";
import { STATUS_COLOR } from "@/components/terms";

/** data-atelier 里 connections 字面量推断为 never[]，消费端补上 string[] 类型（不改数据文件） */
type Paper = Omit<(typeof papersRaw)[number], "connections"> & { connections: string[] };
const papers = papersRaw as Paper[];

const current = papers[0];
const activePhase = researchPhases.find((p) => p.active);
const nextPhase = researchPhases.find((p) => !p.done && !p.active);
const latestInsight = current.insights[current.insights.length - 1].text;

/** 从最新洞察文本里提取"下一步…。"（纯数据推导，不虚构） */
function extractNextStep(text: string): string | null {
  const m = text.match(/下一步[^。]*。/);
  return m ? m[0] : null;
}
const nextStep = extractNextStep(latestInsight);

/** 术语 → 英文主名 */
function engName(t: Term) {
  return t.name.split("/")[0].trim();
}

/** 知识图：术语节点 + 术语关联边（links 字段真实建模） */
function buildGraph(terms: Term[]) {
  const nodes = terms.map((t) => ({ id: engName(t), label: engName(t), status: t.status, role: t.role }));
  const edges: [string, string][] = [];
  const byName = new Map(nodes.map((n) => [n.id, n]));
  terms.forEach((t) => {
    t.links.split(/[；;、]/).map((s) => s.trim()).filter(Boolean).forEach((lk) => {
      if (byName.has(lk)) edges.push([engName(t), lk]);
    });
  });
  return { nodes, edges: dedupeEdges(edges) };
}

function dedupeEdges(edges: [string, string][]) {
  const seen = new Set<string>();
  return edges.filter(([a, b]) => {
    const key = [a, b].sort().join("‖");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** 迷你知识图（SVG，供总览与知识网络页共用） */
export function KnowledgeGraph({
  terms, onNavigate, height = 300,
}: { terms: Term[]; onNavigate?: (p: string) => void; height?: number }) {
  const { nodes, edges } = useMemo(() => buildGraph(terms), [terms]);
  const W = 640, H = height;
  const cx = W / 2, cy = H / 2;
  const rx = W * 0.36, ry = H * 0.34;
  const pos = new Map<string, { x: number; y: number }>();
  nodes.forEach((n, i) => {
    const a = (i / nodes.length) * Math.PI * 2 - Math.PI / 2;
    pos.set(n.id, { x: cx + rx * Math.cos(a), y: cy + ry * Math.sin(a) });
  });
  return (
    <svg className="net-svg" viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="知识网络：术语关联图（连线来自术语卡的关联字段）">
      {edges.map(([a, b], i) => {
        const pa = pos.get(a), pb = pos.get(b);
        if (!pa || !pb) return null;
        return (
          <line key={i} x1={pa.x} y1={pa.y} x2={pb.x} y2={pb.y}
            stroke="rgba(117, 128, 107, 0.45)" strokeWidth="1.2" />
        );
      })}
      {/* 论文中心节点 */}
      <g>
        <rect x={cx - 78} y={cy - 18} width={156} height={36} rx="3"
          fill="var(--surface-deep)" stroke="var(--border-strong)" />
        <text x={cx} y={cy - 1} textAnchor="middle" fill="var(--foreground)"
          style={{ fontFamily: "var(--font-lora)", fontSize: 12, fontWeight: 600 }}>01 · NSR 论文</text>
        <text x={cx} y={cy + 12} textAnchor="middle" fill="var(--muted-foreground)"
          style={{ fontFamily: "var(--font-dm-mono)", fontSize: 8.5 }}>{current.status}</text>
      </g>
      {/* 术语节点 */}
      {nodes.map((n) => {
        const p = pos.get(n.id);
        if (!p) return null;
        const c = STATUS_COLOR[n.status] ?? "var(--muted-foreground)";
        return (
          <g key={n.id} className="net-node-t" onClick={() => onNavigate?.("terms")} role="button"
            aria-label={`术语 ${n.label}`} style={{ cursor: "pointer" }}>
            <circle className="net-circle" cx={p.x} cy={p.y} r="5" fill={c}
              stroke="var(--surface-soft)" strokeWidth="1.5" />
            <text x={p.x} y={p.y + 18} textAnchor="middle"
              style={{ fontFamily: "var(--font-dm-mono)", fontSize: 10, fill: "var(--foreground)" }}>
              {n.label.length > 18 ? n.label.slice(0, 17) + "…" : n.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

export default function Dashboard({ onNavigate }: { onNavigate?: (p: string) => void }) {
  const [terms, setTerms] = useState<Term[]>([]);
  const [screeningExists, setScreeningExists] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/terms")
      .then((r) => r.json())
      .then((d) => { if (!cancelled) setTerms(d.terms ?? []); })
      .catch(() => {});
    fetch("/api/memory?kind=screening")
      .then((r) => r.json())
      .then((d) => { if (!cancelled) setScreeningExists(Boolean(d.content && d.content.trim())); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  // 工作流 P0–P5（状态从真实数据推导；P0=筛选笔记存在性，P5=设计已定但未运行）
  const wf = researchPhases.map((p) => ({ id: p.phase, label: p.label, period: p.period, done: p.done, active: !!p.active }));
  const flow = [
    { id: "P0", label: "论文筛选", period: screeningExists ? "有筛选笔记" : "工具就绪", done: screeningExists, active: false, pending: !screeningExists },
    ...wf.filter((p) => p.id !== "P1").map((p) => ({ ...p, pending: !p.done && !p.active })),
    { id: "P5", label: "报告交接", period: "未启动", done: false, active: false, pending: true },
  ];
  const doneCount = flow.filter((f) => f.done).length;
  const donePhases = researchPhases.filter((p) => p.done).length;

  const stats = [
    { label: "首次接触", value: current.firstEncounter },
    { label: "最近接触", value: current.lastEngaged },
    { label: "理解记录", value: `${current.insights.length} 次` },
    { label: "术语卡片", value: terms.length > 0 ? `${terms.length} 张` : "…" },
    { label: "理解转折", value: `${turningPoints.length} 次` },
    { label: "复现阶段", value: `P${donePhases}/P4` },
  ];

  return (
    <div className="dash-grid">
      <div className="dash-main">
        {/* 第一区域 · 今日研究任务（主卡） */}
        <section className="task-card" aria-label="今日研究任务">
          <div className="task-inner">
            <div>
              <div style={{ display: "flex", alignItems: "baseline", gap: "0.7rem", marginBottom: "0.7rem" }}>
                <span className="mono-label">今日研究任务</span>
                <span className="chip chip--red" style={{ fontSize: "0.56rem" }}>{current.status}</span>
                {activePhase && <span className="chip chip--sage" style={{ fontSize: "0.56rem" }}>复现 {activePhase.phase}</span>}
              </div>
              <h1 className="task-title">{current.title}</h1>
              <p className="task-meta">{current.authors} · {current.venue} {current.year}</p>
              <blockquote className="task-quote">{latestInsight}</blockquote>
              <div className="task-next">
                <span className="tlabel">建议下一步</span>
                <span>{nextStep ?? "把当前进度与决策整理进研究日志。"}</span>
              </div>
              <div className="task-actions">
                <button className="btn btn--primary" onClick={() => onNavigate?.("explain")}>继续精读讲解</button>
                <button className="btn btn--ghost" onClick={() => onNavigate?.("repro")}>进入实验复现</button>
                <button className="btn btn--ghost" onClick={() => onNavigate?.("terms")}>查术语卡</button>
              </div>
            </div>
            <aside className="task-stats" aria-label="进度与状态">
              {stats.map((s) => (
                <div key={s.label} className="stat-row">
                  <span className="stat-label">{s.label}</span>
                  <span className="stat-value">{s.value}</span>
                </div>
              ))}
              <div style={{ marginTop: "0.6rem" }}>
                <div className="progress" aria-hidden="true">
                  {researchPhases.map((p) => (
                    <i key={p.phase} className={p.done ? "is-done" : p.active ? "is-active" : ""} />
                  ))}
                </div>
                <div className="progress-label">
                  <span>复现路线</span>
                  <span>{donePhases}/{researchPhases.length} 完成 · 进行中 {activePhase?.phase}</span>
                </div>
              </div>
            </aside>
          </div>
        </section>

        {/* 第二区域 · 研究工作流 */}
        <section className="mod">
          <header className="mod-head">
            <span className="mod-num">02</span>
            <h2 className="mod-title">研究工作流</h2>
            <span className="mod-count">P0–P5 · {doneCount}/6 就绪</span>
          </header>
          <div className="flow" role="list" aria-label="研究工作流 P0 到 P5">
            {flow.map((f) => (
              <div key={f.id} className={`flow-node is-${f.done ? "done" : f.active ? "active" : "pending"}`} role="listitem">
                <span className="flow-dot" aria-hidden="true" />
                <span className="flow-id">{f.id}</span>
                <span className="flow-name">{f.label}</span>
                <span className="flow-tag">{f.active ? "进行中" : f.done ? "完成" : f.period}</span>
              </div>
            ))}
          </div>
        </section>

        {/* 第三区域 · 知识网络（知识正在增长） */}
        <section className="mod">
          <header className="mod-head">
            <span className="mod-num">03</span>
            <h2 className="mod-title">知识网络</h2>
            <span className="mod-count">{terms.length} 术语 · {turningPoints.length} 转折</span>
          </header>
          <div className="mod-body">
            <div className="net-scroll"><KnowledgeGraph terms={terms} onNavigate={onNavigate} height={280} /></div>
            <div className="net-legend">
              <span><i style={{ background: "var(--ok)" }} />已掌握</span>
              <span><i style={{ background: "var(--accent)" }} />进行中</span>
              <span><i style={{ background: "var(--amber)" }} />有直觉</span>
              <span><i style={{ background: "var(--muted-foreground)" }} />未接触</span>
              <span style={{ marginLeft: "auto" }}>连线 = 术语关联字段</span>
            </div>
          </div>
        </section>
      </div>

      {/* 第四区域 · AI 助手窗口（不是聊天框） */}
      <aside className="dash-side">
        <div className="copilot" aria-label="AI 助手">
          <div className="copilot-head">
            <span className="copilot-dot" aria-hidden="true" />
            <h2 className="copilot-name">研究伴侣</h2>
            <span className="copilot-state">观察中 · 3 条记录</span>
          </div>
          <div className="copilot-body">
            <div className="copilot-block">
              <span className="copilot-label">我观察到</span>
              <p className="copilot-text"><em>— {current.aiNote}</em></p>
            </div>
            <div className="copilot-block">
              <span className="copilot-label">建议下一步</span>
              <p className="copilot-text">{nextStep ?? "整理当前进度并记录到研究日志。"}</p>
            </div>
            <div className="copilot-block">
              <span className="copilot-label">需要你确认</span>
              <p className="copilot-text">
                {nextPhase
                  ? `P3 收尾后是否开始「${nextPhase.phase} · ${nextPhase.label}」？`
                  : "所有阶段已推进，是否需要整理交接提示词？"}
              </p>
              <div className="copilot-actions">
                <button className="btn btn--ghost btn--quiet" onClick={() => onNavigate?.("explain")}>去讲解</button>
                <button className="btn btn--ghost btn--quiet" onClick={() => onNavigate?.("journal")}>看日志</button>
              </div>
            </div>
          </div>
        </div>

        {/* 最近活动 */}
        <div className="mod">
          <header className="mod-head">
            <span className="mod-num">04</span>
            <h2 className="mod-title" style={{ fontSize: "0.92rem" }}>最近活动</h2>
          </header>
          <div className="mod-body" style={{ paddingTop: "0.6rem", paddingBottom: "0.7rem" }}>
            {turningPoints.slice().reverse().map((tp, i) => (
              <div key={i} style={{ padding: "0.55rem 0", borderBottom: i === 0 ? "none" : "1px solid var(--border)" }}>
                <span className="mono-label">{tp.date}</span>
                <p className="copilot-text" style={{ fontSize: "0.78rem", marginTop: "0.2rem" }}>{tp.shift.slice(0, 46)}…</p>
              </div>
            ))}
          </div>
        </div>
      </aside>
    </div>
  );
}
