"use client";

import { useState } from "react";
import { papers as papersRaw, researchPhases, turningPoints } from "@/lib/data-atelier";

type AtelierPaper = Omit<(typeof papersRaw)[number], "connections"> & { connections: string[] };
const papers = papersRaw as AtelierPaper[];

export type Variant = "Atelier" | "Mori" | "OS";

const statusColor: Record<string, string> = {
  "已掌握": "#2D6A4F",
  "深度精读": "#8B2635",
  "方法理解": "#4A3728",
  "快速浏览": "#6B6560",
};

function KnowledgeThread() {
  const nodes = papers.map((p, i) => ({
    id: p.id,
    x: 20 + i * 52,
    y: p.status === "已掌握" ? 18 : p.status === "深度精读" ? 30 : p.status === "方法理解" ? 42 : 52,
    mastered: p.status === "已掌握",
    active: p.status === "深度精读",
  }));
  // 连接线从数据的 connections 动态推导（如 "RSSM (03)" → 下标 2）
  const conns: [number, number][] = [];
  papers.forEach((p, i) => {
    p.connections.forEach((c) => {
      const m = c.match(/\((\d+)\)/);
      if (m) {
        const j = papers.findIndex((q) => q.id === m[1]);
        if (j >= 0 && j !== i) conns.push([i, j]);
      }
    });
  });
  return (
    <svg width="280" height="76" viewBox="0 0 280 76">
      {conns.map(([a, b], i) => (
        <line key={i} x1={nodes[a].x} y1={nodes[a].y} x2={nodes[b].x} y2={nodes[b].y}
          stroke="#D4CEC6" strokeWidth="1" strokeDasharray="3,3" />
      ))}
      {nodes.map((n) => (
        <g key={n.id}>
          <circle cx={n.x} cy={n.y} r={n.active ? 5 : 3.5}
            fill={n.mastered ? "#2D6A4F" : n.active ? "#8B2635" : "#D4CEC6"} opacity={n.active ? 1 : 0.8} />
          <text x={n.x} y={n.y + 14} textAnchor="middle" fontSize="7"
            fill="#6B6560" fontFamily="'DM Mono', monospace">{n.id}</text>
        </g>
      ))}
    </svg>
  );
}

function PaperEntry({ paper, expanded, onToggle }: {
  paper: (typeof papers)[0]; expanded: boolean; onToggle: () => void;
}) {
  const latest = paper.insights[paper.insights.length - 1];
  return (
    <article
      style={{ borderBottom: "1px solid var(--border)", paddingTop: "2rem",
        paddingBottom: expanded ? "2rem" : "1.5rem", cursor: "pointer", transition: "background 0.15s" }}
      onClick={onToggle}
    >
      <div style={{ display: "grid", gridTemplateColumns: "48px 1fr auto", gap: "1.5rem", alignItems: "start" }}>
        <div>
          <span style={{ fontFamily: "var(--font-dm-mono)", fontSize: "0.7rem",
            color: "var(--muted-foreground)", letterSpacing: "0.06em", display: "block" }}>{paper.id}</span>
          <span style={{ fontFamily: "var(--font-dm-mono)", fontSize: "0.58rem",
            color: statusColor[paper.status] || "var(--muted-foreground)", display: "block", marginTop: 4 }}>●</span>
        </div>
        <div>
          <p style={{ fontFamily: "var(--font-lora)", fontSize: "1rem", fontWeight: 500,
            lineHeight: 1.35, color: "var(--foreground)", marginBottom: "0.3rem" }}>{paper.title}</p>
          <p style={{ fontFamily: "var(--font-inter)", fontSize: "0.72rem",
            color: "var(--muted-foreground)", marginBottom: "0.8rem" }}>
            {paper.authors} · {paper.venue} {paper.year}
            <span style={{ marginLeft: "0.8rem", opacity: 0.4 }}>·</span>
            <span style={{ marginLeft: "0.8rem" }}>首次接触 {paper.firstEncounter}</span>
          </p>
          <blockquote style={{ fontFamily: "var(--font-lora)", fontStyle: "italic", fontSize: "0.85rem",
            lineHeight: 1.65, color: "var(--foreground)", borderLeft: "1.5px solid #8B2635",
            paddingLeft: "0.9rem", margin: 0, marginBottom: paper.aiNote && !expanded ? "0.6rem" : 0 }}>
            {latest.text}
          </blockquote>
          {paper.aiNote && !expanded && (
            <p style={{ fontFamily: "var(--font-dm-mono)", fontSize: "0.62rem",
              color: "var(--muted-foreground)", fontStyle: "italic", lineHeight: 1.6,
              marginTop: "0.6rem", opacity: 0.75 }}>— {paper.aiNote}</p>
          )}
          {expanded && (
            <div style={{ marginTop: "1.5rem" }}>
              {paper.insights.length > 1 && (
                <div style={{ marginBottom: "1.5rem" }}>
                  <p style={{ fontFamily: "var(--font-dm-mono)", fontSize: "0.58rem",
                    letterSpacing: "0.1em", textTransform: "uppercase",
                    color: "var(--muted-foreground)", marginBottom: "1rem" }}>理解轨迹</p>
                  <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
                    {paper.insights.map((ins, i) => (
                      <div key={i} style={{ display: "grid", gridTemplateColumns: "36px 1fr",
                        gap: "1rem", opacity: i === paper.insights.length - 1 ? 1 : 0.5 }}>
                        <span style={{ fontFamily: "var(--font-dm-mono)", fontSize: "0.58rem",
                          color: "var(--muted-foreground)", paddingTop: "0.15rem" }}>{ins.date}</span>
                        <p style={{ fontFamily: "var(--font-lora)", fontStyle: "italic",
                          fontSize: "0.82rem", lineHeight: 1.6, color: "var(--foreground)",
                          borderLeft: `1px solid ${i === paper.insights.length - 1 ? "#8B2635" : "var(--border)"}`,
                          paddingLeft: "0.8rem", margin: 0 }}>{ins.text}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {paper.aiNote && (
                <div style={{ borderTop: "1px solid var(--border)", paddingTop: "1rem" }}>
                  <p style={{ fontFamily: "var(--font-dm-mono)", fontSize: "0.58rem",
                    letterSpacing: "0.1em", textTransform: "uppercase",
                    color: "var(--muted-foreground)", marginBottom: "0.5rem", opacity: 0.6 }}>研究伴侣</p>
                  <p style={{ fontFamily: "var(--font-lora)", fontStyle: "italic",
                    fontSize: "0.8rem", lineHeight: 1.65, color: "var(--muted-foreground)" }}>{paper.aiNote}</p>
                </div>
              )}
              {paper.connections.length > 0 && (
                <div style={{ marginTop: "1rem" }}>
                  <p style={{ fontFamily: "var(--font-dm-mono)", fontSize: "0.58rem",
                    letterSpacing: "0.1em", textTransform: "uppercase",
                    color: "var(--muted-foreground)", marginBottom: "0.4rem" }}>知识关联</p>
                  <div style={{ display: "flex", gap: "0.8rem", flexWrap: "wrap" }}>
                    {paper.connections.map((c) => (
                      <span key={c} style={{ fontFamily: "var(--font-dm-mono)", fontSize: "0.6rem",
                        color: "var(--foreground)", opacity: 0.6 }}>→ {c}</span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
        <div style={{ textAlign: "right", minWidth: 120 }}>
          <span style={{ fontFamily: "var(--font-dm-mono)", fontSize: "0.62rem",
            letterSpacing: "0.06em", color: statusColor[paper.status] || "var(--muted-foreground)",
            display: "block", marginBottom: "0.5rem" }}>{paper.status}</span>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "0.25rem" }}>
            {paper.tags.slice(0, 2).map((t) => (
              <span key={t} style={{ fontFamily: "var(--font-dm-mono)", fontSize: "0.55rem",
                letterSpacing: "0.05em", color: "var(--muted-foreground)", opacity: 0.7 }}>{t}</span>
            ))}
          </div>
          <span style={{ fontFamily: "var(--font-dm-mono)", fontSize: "0.55rem",
            color: "var(--muted-foreground)", display: "block", marginTop: "0.8rem", opacity: 0.5 }}>
            {expanded ? "收起 ↑" : "展开 ↓"}
          </span>
        </div>
      </div>
    </article>
  );
}

export default function VariantAtelier({ onSwitch }: { onSwitch: (v: Variant) => void }) {
  const [expandedPaper, setExpandedPaper] = useState<string | null>("01");
  const current = papers[0];
  const tools = ["论文探索", "代码分析", "知识整理", "实验复现", "研究日志"];

  return (
    <div style={{ minHeight: "100vh", background: "var(--background)", color: "var(--foreground)",
      display: "grid", gridTemplateColumns: "1fr 300px", gridTemplateRows: "auto 1fr" }}>

      {/* Header */}
      <header style={{ gridColumn: "1 / -1", borderBottom: "1px solid var(--border)",
        padding: "1rem 2.5rem", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "1.5rem" }}>
          <span style={{ fontFamily: "var(--font-lora)", fontWeight: 600, fontSize: "0.92rem", letterSpacing: "0.02em" }}>
            Research Atelier</span>
          <span style={{ fontFamily: "var(--font-dm-mono)", fontSize: "0.65rem",
            color: "var(--muted-foreground)", borderLeft: "1px solid var(--border)",
            paddingLeft: "1.2rem", letterSpacing: "0.05em" }}>我的研究档案 · NSR 复现中</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "2rem" }}>
          {tools.map((t) => (
            <button key={t} style={{ background: "transparent", border: "none", cursor: "pointer",
              fontFamily: "var(--font-inter)", fontSize: "0.78rem",
              fontWeight: t === "论文探索" ? 500 : 400,
              color: t === "论文探索" ? "var(--foreground)" : "var(--muted-foreground)",
              borderBottom: t === "论文探索" ? "1px solid #8B2635" : "1px solid transparent",
              paddingBottom: "0.2rem" }}>{t}</button>
          ))}
          {/* Variant switcher */}
          <div style={{ display: "flex", borderLeft: "1px solid var(--border)", paddingLeft: "1rem", gap: 0 }}>
            {(["Atelier", "Mori", "OS"] as Variant[]).map((v) => (
              <button key={v} onClick={() => onSwitch(v)} style={{
                fontFamily: "var(--font-dm-mono)", fontSize: "0.55rem",
                letterSpacing: "0.08em", textTransform: "uppercase",
                padding: "0.25rem 0.6rem",
                background: v === "Atelier" ? "var(--secondary)" : "transparent",
                border: "1px solid var(--border)", borderRadius: 2, marginLeft: -1,
                color: v === "Atelier" ? "var(--foreground)" : "var(--muted-foreground)",
                cursor: "pointer",
              }}>{v}</button>
            ))}
          </div>
          <div style={{ width: 26, height: 26, background: "#8B2635", borderRadius: "50%",
            display: "flex", alignItems: "center", justifyContent: "center" }}>
            <span style={{ color: "#F7F4EF", fontSize: "0.6rem", fontFamily: "var(--font-dm-mono)" }}>我</span>
          </div>
        </div>
      </header>

      {/* Main */}
      <main style={{ padding: "3rem 2.5rem", overflowY: "auto", minWidth: 0 }}>
        <section style={{ marginBottom: "4rem" }}>
          <p style={{ fontFamily: "var(--font-dm-mono)", fontSize: "0.6rem", letterSpacing: "0.16em",
            textTransform: "uppercase", color: "var(--muted-foreground)", marginBottom: "1.2rem" }}>
            今日研究焦点 · Aug 22, 2026</p>
          <h1 style={{ fontFamily: "var(--font-lora)", fontSize: "clamp(1.8rem, 3.5vw, 2.6rem)",
            fontWeight: 600, lineHeight: 1.18, letterSpacing: "-0.015em",
            marginBottom: "0.8rem", maxWidth: "34rem" }}>{current.title}</h1>
          <p style={{ fontFamily: "var(--font-inter)", fontSize: "0.8rem",
            color: "var(--muted-foreground)", marginBottom: "2rem" }}>
            {current.authors} · {current.venue} {current.year}</p>
          <blockquote style={{ fontFamily: "var(--font-lora)", fontStyle: "italic",
            fontSize: "1rem", lineHeight: 1.7, borderLeft: "2px solid #8B2635",
            paddingLeft: "1.2rem", margin: 0, maxWidth: "38rem", color: "var(--foreground)" }}>
            {current.insights[current.insights.length - 1].text}
          </blockquote>
          <p style={{ fontFamily: "var(--font-dm-mono)", fontSize: "0.62rem",
            color: "var(--muted-foreground)", fontStyle: "italic", lineHeight: 1.65,
            marginTop: "1rem", paddingLeft: "1.4rem", maxWidth: "34rem", opacity: 0.7 }}>
            — {current.aiNote}</p>
        </section>

        <section>
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between",
            borderTop: "1px solid var(--border)", paddingTop: "1.5rem", marginBottom: 0 }}>
            <p style={{ fontFamily: "var(--font-lora)", fontSize: "1rem", fontWeight: 500, letterSpacing: "-0.01em" }}>
              研究记忆</p>
            <span style={{ fontFamily: "var(--font-dm-mono)", fontSize: "0.6rem",
              letterSpacing: "0.08em", color: "var(--muted-foreground)" }}>
              {papers.length} 篇 · 按最近接触排列</span>
          </div>
          {papers.map((p) => (
            <PaperEntry key={p.id} paper={p}
              expanded={expandedPaper === p.id}
              onToggle={() => setExpandedPaper(expandedPaper === p.id ? null : p.id)} />
          ))}
        </section>
      </main>

      {/* Right column */}
      <aside style={{ borderLeft: "1px solid var(--border)", display: "flex", flexDirection: "column", overflowY: "auto" }}>
        <div style={{ padding: "2.5rem 2rem", borderBottom: "1px solid var(--border)" }}>
          <p style={{ fontFamily: "var(--font-dm-mono)", fontSize: "0.58rem", letterSpacing: "0.14em",
            textTransform: "uppercase", color: "var(--muted-foreground)", marginBottom: "1.5rem" }}>研究阶段</p>
          <div style={{ display: "flex", flexDirection: "column", gap: "1.2rem" }}>
            {researchPhases.map((p) => (
              <div key={p.phase} style={{ display: "grid", gridTemplateColumns: "28px 1fr", gap: "0.8rem", alignItems: "start" }}>
                <span style={{ fontFamily: "var(--font-dm-mono)", fontSize: "0.6rem",
                  color: p.active ? "#8B2635" : p.done ? "#2D6A4F" : "var(--border)", letterSpacing: "0.06em" }}>{p.phase}</span>
                <div>
                  <p style={{ fontFamily: "var(--font-inter)", fontSize: "0.78rem",
                    fontWeight: p.active ? 500 : 400,
                    color: p.active ? "var(--foreground)" : p.done ? "var(--muted-foreground)" : "var(--border)",
                    lineHeight: 1, marginBottom: 3 }}>{p.label}</p>
                  <p style={{ fontFamily: "var(--font-dm-mono)", fontSize: "0.58rem",
                    color: "var(--muted-foreground)", letterSpacing: "0.04em", opacity: 0.6 }}>{p.period}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div style={{ padding: "2rem", borderBottom: "1px solid var(--border)" }}>
          <p style={{ fontFamily: "var(--font-dm-mono)", fontSize: "0.58rem", letterSpacing: "0.14em",
            textTransform: "uppercase", color: "var(--muted-foreground)", marginBottom: "1.2rem" }}>知识网络</p>
          <KnowledgeThread />
          <div style={{ display: "flex", gap: "1.2rem", marginTop: "0.8rem" }}>
            {[{ color: "#2D6A4F", label: "已掌握" }, { color: "#8B2635", label: "进行中" }, { color: "#D4CEC6", label: "接触过" }].map((l) => (
              <span key={l.label} style={{ display: "flex", alignItems: "center", gap: "0.35rem" }}>
                <span style={{ width: 6, height: 6, borderRadius: "50%", background: l.color, display: "inline-block" }} />
                <span style={{ fontFamily: "var(--font-dm-mono)", fontSize: "0.55rem", color: "var(--muted-foreground)" }}>{l.label}</span>
              </span>
            ))}
          </div>
        </div>

        <div style={{ padding: "2rem" }}>
          <p style={{ fontFamily: "var(--font-dm-mono)", fontSize: "0.58rem", letterSpacing: "0.14em",
            textTransform: "uppercase", color: "var(--muted-foreground)", marginBottom: "1.5rem" }}>理解转折点</p>
          <div style={{ display: "flex", flexDirection: "column", gap: "1.4rem" }}>
            {turningPoints.map((tp, i) => (
              <div key={i} style={{ display: "grid", gridTemplateColumns: "32px 1fr", gap: "0.8rem", alignItems: "start" }}>
                <span style={{ fontFamily: "var(--font-dm-mono)", fontSize: "0.58rem",
                  color: "var(--muted-foreground)", letterSpacing: "0.04em", paddingTop: "0.15rem", opacity: 0.7 }}>{tp.date}</span>
                <p style={{ fontFamily: "var(--font-lora)", fontStyle: "italic", fontSize: "0.75rem",
                  lineHeight: 1.6, color: i === 0 ? "var(--foreground)" : "var(--muted-foreground)",
                  borderLeft: i === 0 ? "1px solid var(--border)" : "none",
                  paddingLeft: i === 0 ? "0.6rem" : 0, margin: 0, opacity: i === 0 ? 1 : 0.7 }}>{tp.shift}</p>
              </div>
            ))}
          </div>
        </div>
      </aside>
    </div>
  );
}
