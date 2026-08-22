"use client";

import { useEffect, useMemo, useState } from "react";
import { papers as papersRaw, turningPoints } from "@/lib/data-atelier";
import type { Term } from "@/app/api/terms/route";
import { buildStages } from "@/components/stages";
import { STATUS_COLOR } from "@/components/terms";

/** data-atelier 里 connections 字面量推断为 never[]，消费端补上 string[] 类型（不改数据文件） */
type Paper = Omit<(typeof papersRaw)[number], "connections"> & { connections: string[] };
const papers = papersRaw as Paper[];

const current = papers[0];
const latestInsight = current.insights[current.insights.length - 1].text;

/** 从最新洞察里提取"下一步…。"（纯数据推导） */
function extractNextStep(text: string): string | null {
  const m = text.match(/下一步[^。]*。/);
  return m ? m[0] : null;
}
const nextStep = extractNextStep(latestInsight);

function engName(t: Term) {
  return t.name.split("/")[0].trim();
}

function buildGraph(terms: Term[]) {
  const nodes = terms.map((t) => ({ id: engName(t), label: engName(t), status: t.status }));
  const edges: [string, string][] = [];
  const seen = new Set<string>();
  const byName = new Map(nodes.map((n) => [n.id, n]));
  terms.forEach((t) => {
    t.links.split(/[；;、]/).map((s) => s.trim()).filter(Boolean).forEach((lk) => {
      if (byName.has(lk)) {
        const key = [engName(t), lk].sort().join("‖");
        if (!seen.has(key)) {
          seen.add(key);
          edges.push([engName(t), lk]);
        }
      }
    });
  });
  return { nodes, edges };
}

/** 迷你知识图 */




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
            stroke="rgba(17, 17, 17, 0.14)" strokeWidth="1.2" />
        );
      })}
      <g>
        <rect x={cx - 78} y={cy - 18} width={156} height={36} rx="10"
          fill="var(--panel-dark)" />
        <text x={cx} y={cy - 1} textAnchor="middle" fill="var(--panel-dark-text)"
          style={{ fontFamily: "var(--font-lora)", fontSize: 12, fontWeight: 600 }}>01 · NSR 论文</text>
        <text x={cx} y={cy + 12} textAnchor="middle" fill="var(--panel-dark-muted)"
          style={{ fontFamily: "var(--font-dm-mono)", fontSize: 8.5 }}>{current.status}</text>
      </g>
      {nodes.map((n) => {
        const p = pos.get(n.id);
        if (!p) return null;
        const c = STATUS_COLOR[n.status] ?? "var(--muted-foreground)";
        return (
          <g key={n.id} className="net-node-t" onClick={() => onNavigate?.("terms")} role="button"
            aria-label={`术语 ${n.label}`} style={{ cursor: "pointer" }}>
            <circle className="net-circle" cx={p.x} cy={p.y} r="5" fill={c}
              stroke="var(--card)" strokeWidth="2" />
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

/** 可收起模块（仪表盘通用） */
export function Mod({ num, title, count, defaultOpen = true, children }: {
  num: string; title: string; count?: string; defaultOpen?: boolean; children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className={`mod${open ? "" : " is-closed"}`}>
      <button className="mod-head" onClick={() => setOpen((v) => !v)}>
        <span className="mod-num">{num}</span>
        <h2 className="mod-title">{title}</h2>
        {count && <span className="mod-count">{count}</span>}
        <span className="mod-caret" aria-hidden="true">▾</span>
      </button>
      {open && <div className="mod-body">{children}</div>}
    </section>
  );
}

export default function Dashboard({ onNavigate }: { onNavigate?: (p: string) => void }) {
  const [terms, setTerms] = useState<Term[]>([]);
  const [screeningExists, setScreeningExists] = useState(false);
  const [profileMd, setProfileMd] = useState("");
  const [handoffMd, setHandoffMd] = useState("");
  const [reproMd, setReproMd] = useState("");
  const [openStep, setOpenStep] = useState<string | null>("P3");
  const [stageManualTick, setStageManualTick] = useState(0);

  useEffect(() => {
    const h = () => setStageManualTick((v) => v + 1);
    window.addEventListener("atelier-stage-manual", h);
    return () => window.removeEventListener("atelier-stage-manual", h);
  }, []);

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
    fetch("/api/memory?kind=profile")
      .then((r) => r.json())
      .then((d) => { if (!cancelled) setProfileMd(d.content ?? ""); })
      .catch(() => {});
    fetch("/api/memory?kind=handoff")
      .then((r) => r.json())
      .then((d) => { if (!cancelled) setHandoffMd(d.content ?? ""); })
      .catch(() => {});
    fetch("/api/context?kind=repro")
      .then((r) => r.json())
      .then((d) => { if (!cancelled) setReproMd(d.content ?? ""); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  /** 手动验收记录（localStorage）：在复现页「验收通过」后覆盖推导状态 */
  const [manual, setManual] = useState<Record<string, string>>({});
  useEffect(() => {
    try {
      const v = JSON.parse(localStorage.getItem("atelier-stage-manual") ?? "{}") as Record<string, string>;
      queueMicrotask(() => setManual(v));
    } catch { /* ignore */ }
  }, [stageManualTick]);

  const stages = useMemo(() => buildStages({
    screeningExists,
    domainMap: profileMd.includes("领域地图") || papers.some((p) => p.insights.some((i) => i.text.includes("领域地图"))),
    firstPass: papers.some((p) => p.insights.some((i) => i.text.includes("第一遍导读"))),
    deepReading: papers[0].status === "深度精读",
    reproStarted: Boolean(reproMd && reproMd.trim()),
    handoffDone: Boolean(handoffMd && handoffMd.trim()),
  }, manual), [screeningExists, profileMd, handoffMd, reproMd, manual]);
  const activeStage = stages.find((s) => s.status === "active") ?? stages.find((s) => s.status === "partial");
  const activeIdx = stages.findIndex((s) => s.id === (activeStage?.id ?? "P3"));

  return (
    <div className="dash-grid">
      <div className="dash-main">
        {/* 今日研究 · 黑卡（主视觉：我在哪 / 进入下一阶段交付什么） */}
        <section className="task-card" aria-label="今日研究">
          <div className="task-inner">
            <div>
              <div className="task-top">
                <span className="mono-label">今日研究任务</span>
                <span className="chip chip--active" style={{ fontSize: "0.56rem" }}>{current.status}</span>
                <span className="chip chip--dark" style={{ fontSize: "0.56rem" }}>NSR 论文</span>
              </div>
              <h1 className="task-title">{current.title}</h1>
              <div className="task-phase">
                <span className="task-phase-dot" aria-hidden="true" />
                <span className="task-phase-label">{activeStage?.id} · {activeStage?.name}</span>
                {activeStage && <span className="chip chip--active">{activeStage.statusLabel}</span>}
              </div>
              {activeStage && (
                <div className="task-deliver">
                  <b>进入下一阶段要交付：</b>{activeStage.deliver}
                </div>
              )}
              <div className="task-actions">
                <button className="btn btn--accent" onClick={() => onNavigate?.("explain")}>带正文去精读</button>
                <button className="btn" onClick={() => onNavigate?.("repro")}>实验复现</button>
                <button className="btn" onClick={() => onNavigate?.("terms")}>术语卡</button>
              </div>
            </div>
            <div style={{ marginTop: "0.5rem", maxWidth: 420 }}>
              <div className="task-progress" aria-hidden="true">
                {stages.map((s) => (
                  <i key={s.id} className={s.status === "done" ? "is-done" : s.status === "active" || s.status === "partial" ? "is-active" : ""} />
                ))}
              </div>
              <div className="task-progress-label">
                <span>P0 → P5</span>
                <span>第 {activeIdx + 1} / 6 步{nextStep ? ` · 上次停在这里：${nextStep}` : ""}</span>
              </div>
            </div>
          </div>
        </section>

        {/* 研究工作流：中央枢纽（任务/交付/验收 可展开） */}
        <Mod num="02" title="研究工作流" count="P0–P5 · 我的路线图">
          <div className="steps">
            {stages.map((s) => (
              <div key={s.id} className={`step is-${s.status === "active" ? "active" : s.status === "done" ? "done" : "pending"}${openStep === s.id ? " is-open" : ""}`}>
                <button className="step-head" onClick={() => setOpenStep(openStep === s.id ? null : s.id)}>
                  <span className="step-num">{s.id}</span>
                  <span style={{ minWidth: 0 }}>
                    <p className="step-name">{s.name}</p>
                    <p className="step-brief">{s.brief}</p>
                  </span>
                  <span className="step-state">{s.statusLabel}</span>
                  <span className="step-caret" aria-hidden="true">›</span>
                </button>
                {openStep === s.id && (
                  <div className="step-detail">
                    <div className="step-line">
                      <span className="sl-key">任务</span>
                      <span>{s.task}</span>
                    </div>
                    <div className="step-line">
                      <span className="sl-key">交付</span>
                      <span>{s.deliver}</span>
                    </div>
                    <div className="step-line">
                      <span className="sl-key">验收</span>
                      <span>{s.verify}</span>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </Mod>

      </div>

      {/* 侧列：学习时间 + 知识网络（收起待开） */}
      <aside className="dash-side">

        <Mod num="03" title="知识网络" count={`${terms.length} 术语 · ${turningPoints.length} 转折`} defaultOpen={false}>
          <KnowledgeGraph terms={terms} onNavigate={onNavigate} height={260} />
          <div className="net-legend">
            <span><i style={{ background: "var(--ok)" }} />已掌握</span>
            <span><i style={{ background: "var(--amber)" }} />进行中</span>
            <span><i style={{ background: "var(--muted-foreground)" }} />未接触</span>
          </div>
        </Mod>
      </aside>
    </div>
  );
}
