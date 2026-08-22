"use client";

import { useState } from "react";
import { papers, researchPhases, turningPoints } from "@/lib/data-atelier";

const T = {
  bg: "#111110",
  surface: "#1A1917",
  surfaceHover: "#1F1E1C",
  surfaceActive: "#252320",
  border: "#2A2825",
  borderStrong: "#353330",
  ink: "#E8E3DB",
  inkMid: "#8A857E",
  inkFaint: "#4A4642",
  red: "#C0392B",
  redDim: "#7A2030",
  green: "#2ECC71",
  greenDim: "#2D6A4F",
  yellow: "#D4A843",
};

const statusMap: Record<string, { color: string; dot: string }> = {
  "已掌握": { color: T.greenDim, dot: T.green },
  "深度精读": { color: T.red, dot: T.red },
  "方法理解": { color: T.yellow, dot: T.yellow },
  "快速浏览": { color: T.inkMid, dot: T.inkMid },
};

function SideNav({ onSwitch }: { onSwitch: (v: string) => void }) {
  const navItems = [
    { icon: "◈", label: "研究记忆", active: true },
    { icon: "◎", label: "知识图谱", active: false },
    { icon: "▷", label: "实验追踪", active: false },
    { icon: "◇", label: "研究日志", active: false },
    { icon: "⊞", label: "代码分析", active: false },
  ];
  return (
    <nav style={{
      width: 200, background: T.surface,
      borderRight: `1px solid ${T.border}`,
      display: "flex", flexDirection: "column",
      height: "100vh", position: "sticky", top: 0,
    }}>
      {/* Logo */}
      <div style={{
        padding: "1.2rem 1.2rem 0.8rem",
        borderBottom: `1px solid ${T.border}`,
      }}>
        <p style={{
          fontFamily: "'Lora', serif", fontSize: "0.85rem",
          fontWeight: 600, color: T.ink, letterSpacing: "0.01em",
        }}>我的研究档案</p>
        <p style={{
          fontFamily: "'DM Mono', monospace", fontSize: "0.55rem",
          color: T.inkFaint, letterSpacing: "0.06em", marginTop: 2,
        }}>NSR 复现</p>
      </div>

      {/* Phase badge */}
      <div style={{ padding: "0.8rem 1.2rem", borderBottom: `1px solid ${T.border}` }}>
        <div style={{
          display: "inline-flex", alignItems: "center", gap: "0.5rem",
          background: "#1F1207", border: `1px solid #3A2A10`,
          borderRadius: 3, padding: "0.25rem 0.6rem",
        }}>
          <span style={{ width: 5, height: 5, borderRadius: "50%", background: T.yellow, display: "inline-block" }} />
          <span style={{
            fontFamily: "'DM Mono', monospace", fontSize: "0.55rem",
            color: T.yellow, letterSpacing: "0.08em",
          }}>P2 · 方法理解</span>
        </div>
      </div>

      {/* Nav items */}
      <div style={{ flex: 1, padding: "0.5rem 0", overflowY: "auto" }}>
        {navItems.map((item) => (
          <button key={item.label} style={{
            display: "flex", alignItems: "center", gap: "0.6rem",
            width: "100%", padding: "0.45rem 1.2rem",
            background: item.active ? T.surfaceActive : "transparent",
            border: "none", cursor: "pointer",
            borderLeft: item.active ? `2px solid ${T.red}` : "2px solid transparent",
            transition: "background 0.1s",
          }}
          onMouseEnter={(e) => { if (!item.active) e.currentTarget.style.background = T.surfaceHover; }}
          onMouseLeave={(e) => { if (!item.active) e.currentTarget.style.background = "transparent"; }}
          >
            <span style={{
              fontFamily: "'DM Mono', monospace", fontSize: "0.65rem",
              color: item.active ? T.ink : T.inkFaint,
            }}>{item.icon}</span>
            <span style={{
              fontFamily: "'Inter', sans-serif", fontSize: "0.75rem",
              color: item.active ? T.ink : T.inkMid,
              fontWeight: item.active ? 500 : 400,
            }}>{item.label}</span>
          </button>
        ))}
      </div>

      {/* Variant switcher at bottom */}
      <div style={{ borderTop: `1px solid ${T.border}`, padding: "0.6rem" }}>
        <p style={{
          fontFamily: "'DM Mono', monospace", fontSize: "0.52rem",
          color: T.inkFaint, letterSpacing: "0.1em", textTransform: "uppercase",
          paddingLeft: "0.6rem", marginBottom: "0.4rem",
        }}>variant</p>
        <div style={{ display: "flex", gap: 0 }}>
          {["Atelier", "Mori", "OS"].map((v) => (
            <button key={v} onClick={() => onSwitch(v)} style={{
              flex: 1,
              fontFamily: "'DM Mono', monospace", fontSize: "0.52rem",
              letterSpacing: "0.06em",
              padding: "0.35rem 0",
              background: v === "OS" ? T.surfaceActive : "transparent",
              border: "none", borderRadius: 2,
              color: v === "OS" ? T.ink : T.inkFaint, cursor: "pointer",
            }}>{v}</button>
          ))}
        </div>
      </div>
    </nav>
  );
}

function PaperRow({ paper, expanded, onToggle }: {
  paper: (typeof papers)[0];
  expanded: boolean;
  onToggle: () => void;
}) {
  const s = statusMap[paper.status] || { color: T.inkMid, dot: T.inkFaint };

  return (
    <div
      onClick={onToggle}
      style={{
        borderBottom: `1px solid ${T.border}`,
        background: expanded ? T.surfaceActive : "transparent",
        cursor: "pointer",
        transition: "background 0.1s",
      }}
      onMouseEnter={(e) => { if (!expanded) e.currentTarget.style.background = T.surfaceHover; }}
      onMouseLeave={(e) => { if (!expanded) e.currentTarget.style.background = "transparent"; }}
    >
      {/* Compact row */}
      <div style={{
        display: "grid",
        gridTemplateColumns: "28px 32px 1fr 90px 80px 24px",
        gap: "0.8rem", alignItems: "center",
        padding: "0.7rem 1.5rem",
      }}>
        {/* Status dot */}
        <span style={{ width: 6, height: 6, borderRadius: "50%", background: s.dot, display: "inline-block", margin: "0 auto" }} />

        {/* ID */}
        <span style={{
          fontFamily: "'DM Mono', monospace", fontSize: "0.6rem",
          color: T.inkFaint, letterSpacing: "0.06em",
        }}>{paper.id}</span>

        {/* Title */}
        <span style={{
          fontFamily: "'Inter', sans-serif", fontSize: "0.78rem",
          color: T.ink, fontWeight: 400,
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        }}>{paper.title}</span>

        {/* Authors */}
        <span style={{
          fontFamily: "'DM Mono', monospace", fontSize: "0.58rem",
          color: T.inkFaint, letterSpacing: "0.02em",
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        }}>{paper.authors.split(" ")[0]}</span>

        {/* Status label */}
        <span style={{
          fontFamily: "'DM Mono', monospace", fontSize: "0.58rem",
          color: s.color, letterSpacing: "0.04em",
        }}>{paper.status}</span>

        {/* Expand toggle */}
        <span style={{
          fontFamily: "'DM Mono', monospace", fontSize: "0.6rem",
          color: T.inkFaint,
        }}>{expanded ? "−" : "+"}</span>
      </div>

      {/* Expanded detail */}
      {expanded && (
        <div style={{
          padding: "0 1.5rem 1.5rem",
          display: "grid", gridTemplateColumns: "1fr 280px",
          gap: "2rem",
        }}>
          {/* Left: insight trace */}
          <div>
            <p style={{
              fontFamily: "'DM Mono', monospace", fontSize: "0.55rem",
              letterSpacing: "0.12em", textTransform: "uppercase",
              color: T.inkFaint, marginBottom: "0.8rem",
            }}>理解轨迹</p>
            <div style={{ display: "flex", flexDirection: "column", gap: "0.9rem" }}>
              {paper.insights.map((ins, i) => (
                <div key={i} style={{
                  display: "grid", gridTemplateColumns: "36px 1fr",
                  gap: "0.8rem", opacity: i === paper.insights.length - 1 ? 1 : 0.4,
                }}>
                  <span style={{
                    fontFamily: "'DM Mono', monospace", fontSize: "0.55rem",
                    color: T.inkFaint, paddingTop: 2,
                  }}>{ins.date}</span>
                  <p style={{
                    fontFamily: "'Lora', serif", fontStyle: "italic",
                    fontSize: "0.78rem", lineHeight: 1.6,
                    color: i === paper.insights.length - 1 ? T.ink : T.inkMid,
                    borderLeft: `1px solid ${i === paper.insights.length - 1 ? T.redDim : T.border}`,
                    paddingLeft: "0.7rem", margin: 0,
                  }}>{ins.text}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Right: meta + AI note */}
          <div>
            {/* Meta */}
            <div style={{
              display: "grid", gridTemplateColumns: "1fr 1fr",
              gap: "0.5rem 1rem", marginBottom: "1rem",
            }}>
              {[
                { l: "Venue", v: paper.venue },
                { l: "Year", v: paper.year },
                { l: "First read", v: paper.firstEncounter },
                { l: "Last engaged", v: paper.lastEngaged },
              ].map((m) => (
                <div key={m.l}>
                  <span style={{
                    fontFamily: "'DM Mono', monospace", fontSize: "0.52rem",
                    color: T.inkFaint, letterSpacing: "0.1em",
                    textTransform: "uppercase", display: "block",
                  }}>{m.l}</span>
                  <span style={{
                    fontFamily: "'DM Mono', monospace", fontSize: "0.65rem",
                    color: T.inkMid,
                  }}>{m.v}</span>
                </div>
              ))}
            </div>

            {/* Tags */}
            <div style={{ display: "flex", flexWrap: "wrap", gap: "0.4rem", marginBottom: "1rem" }}>
              {paper.tags.map((t) => (
                <span key={t} style={{
                  fontFamily: "'DM Mono', monospace", fontSize: "0.55rem",
                  letterSpacing: "0.05em",
                  background: T.surface, border: `1px solid ${T.border}`,
                  color: T.inkMid, padding: "0.15rem 0.5rem", borderRadius: 2,
                }}>{t}</span>
              ))}
            </div>

            {/* Connections */}
            {paper.connections.length > 0 && (
              <div style={{ marginBottom: "1rem" }}>
                <p style={{
                  fontFamily: "'DM Mono', monospace", fontSize: "0.52rem",
                  letterSpacing: "0.1em", textTransform: "uppercase",
                  color: T.inkFaint, marginBottom: "0.4rem",
                }}>关联</p>
                {paper.connections.map((c) => (
                  <span key={c} style={{
                    fontFamily: "'DM Mono', monospace", fontSize: "0.6rem",
                    color: T.inkMid, display: "block", lineHeight: 1.8,
                    opacity: 0.7,
                  }}>→ {c}</span>
                ))}
              </div>
            )}

            {/* AI note */}
            {paper.aiNote && (
              <div style={{
                borderTop: `1px solid ${T.border}`,
                paddingTop: "0.8rem",
              }}>
                <p style={{
                  fontFamily: "'DM Mono', monospace", fontSize: "0.52rem",
                  letterSpacing: "0.1em", textTransform: "uppercase",
                  color: T.inkFaint, marginBottom: "0.4rem",
                }}>研究伴侣</p>
                <p style={{
                  fontFamily: "'Lora', serif", fontStyle: "italic",
                  fontSize: "0.72rem", lineHeight: 1.65,
                  color: T.inkMid,
                }}>{paper.aiNote}</p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default function VariantOS({ onSwitch }: { onSwitch: (v: string) => void }) {
  const [expanded, setExpanded] = useState<string | null>("01");

  return (
    <div style={{
      minHeight: "100vh", background: T.bg, color: T.ink,
      display: "flex",
    }}>
      <SideNav onSwitch={onSwitch} />

      {/* Main area */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>

        {/* Top bar */}
        <div style={{
          height: 44, borderBottom: `1px solid ${T.border}`,
          display: "flex", alignItems: "center",
          padding: "0 1.5rem", gap: "1rem", flexShrink: 0,
          background: T.surface,
        }}>
          <span style={{
            fontFamily: "'Inter', sans-serif", fontSize: "0.78rem",
            fontWeight: 500, color: T.ink,
          }}>研究记忆</span>
          <span style={{
            fontFamily: "'DM Mono', monospace", fontSize: "0.58rem",
            color: T.inkFaint,
          }}>/</span>
          <span style={{
            fontFamily: "'DM Mono', monospace", fontSize: "0.58rem",
            color: T.inkFaint, letterSpacing: "0.04em",
          }}>NSR 复现</span>

          <div style={{ marginLeft: "auto", display: "flex", gap: "1.5rem", alignItems: "center" }}>
            <span style={{
              fontFamily: "'DM Mono', monospace", fontSize: "0.55rem",
              color: T.inkFaint, letterSpacing: "0.08em",
            }}>AUG 22, 2026</span>
            <div style={{
              width: 24, height: 24, background: T.redDim,
              borderRadius: "50%", display: "flex",
              alignItems: "center", justifyContent: "center",
            }}>
              <span style={{ color: "#F7F4EF", fontSize: "0.55rem", fontFamily: "'DM Mono', monospace" }}>我</span>
            </div>
          </div>
        </div>

        {/* Body: two-column */}
        <div style={{ flex: 1, display: "grid", gridTemplateColumns: "1fr 280px", minHeight: 0 }}>

          {/* Paper list */}
          <div style={{ overflowY: "auto", borderRight: `1px solid ${T.border}` }}>
            {/* Column headers */}
            <div style={{
              display: "grid",
              gridTemplateColumns: "28px 32px 1fr 90px 80px 24px",
              gap: "0.8rem", padding: "0.5rem 1.5rem",
              borderBottom: `1px solid ${T.border}`,
              position: "sticky", top: 0,
              background: T.surface, zIndex: 1,
            }}>
              {["", "#", "标题", "作者", "状态", ""].map((h, i) => (
                <span key={i} style={{
                  fontFamily: "'DM Mono', monospace", fontSize: "0.52rem",
                  letterSpacing: "0.1em", textTransform: "uppercase",
                  color: T.inkFaint,
                }}>{h}</span>
              ))}
            </div>

            {papers.map((p) => (
              <PaperRow
                key={p.id}
                paper={p}
                expanded={expanded === p.id}
                onToggle={() => setExpanded(expanded === p.id ? null : p.id)}
              />
            ))}
          </div>

          {/* Right panel: structured context */}
          <div style={{ overflowY: "auto", background: T.surface }}>

            {/* Current focus */}
            <div style={{ padding: "1.5rem", borderBottom: `1px solid ${T.border}` }}>
              <p style={{
                fontFamily: "'DM Mono', monospace", fontSize: "0.52rem",
                letterSpacing: "0.12em", textTransform: "uppercase",
                color: T.inkFaint, marginBottom: "0.8rem",
              }}>当前焦点</p>
              <p style={{
                fontFamily: "'Lora', serif", fontSize: "0.82rem",
                fontWeight: 500, lineHeight: 1.4,
                color: T.ink, marginBottom: "0.4rem",
              }}>{papers[0].title}</p>
              <p style={{
                fontFamily: "'Lora', serif", fontStyle: "italic",
                fontSize: "0.72rem", lineHeight: 1.6,
                color: T.inkMid,
              }}>
                {papers[0].insights[papers[0].insights.length - 1].text}
              </p>
              <p style={{
                fontFamily: "'DM Mono', monospace", fontSize: "0.58rem",
                color: T.inkFaint, fontStyle: "italic",
                lineHeight: 1.6, marginTop: "0.8rem",
                borderTop: `1px solid ${T.border}`, paddingTop: "0.7rem",
                opacity: 0.7,
              }}>
                — {papers[0].aiNote}
              </p>
            </div>

            {/* Research phases */}
            <div style={{ padding: "1.5rem", borderBottom: `1px solid ${T.border}` }}>
              <p style={{
                fontFamily: "'DM Mono', monospace", fontSize: "0.52rem",
                letterSpacing: "0.12em", textTransform: "uppercase",
                color: T.inkFaint, marginBottom: "1rem",
              }}>阶段</p>
              {researchPhases.map((ph) => (
                <div key={ph.phase} style={{
                  display: "flex", alignItems: "center", gap: "0.6rem",
                  marginBottom: "0.6rem",
                }}>
                  <span style={{
                    width: 5, height: 5, borderRadius: "50%", flexShrink: 0,
                    background: ph.active ? T.yellow : ph.done ? T.greenDim : T.inkFaint,
                    display: "inline-block",
                  }} />
                  <span style={{
                    fontFamily: "'DM Mono', monospace", fontSize: "0.58rem",
                    color: ph.active ? T.yellow : ph.done ? T.inkMid : T.inkFaint,
                    letterSpacing: "0.04em",
                  }}>{ph.phase}</span>
                  <span style={{
                    fontFamily: "'Inter', sans-serif", fontSize: "0.72rem",
                    color: ph.active ? T.ink : ph.done ? T.inkMid : T.inkFaint,
                    fontWeight: ph.active ? 500 : 400,
                  }}>{ph.label}</span>
                  <span style={{
                    fontFamily: "'DM Mono', monospace", fontSize: "0.55rem",
                    color: T.inkFaint, marginLeft: "auto",
                  }}>{ph.period}</span>
                </div>
              ))}
            </div>

            {/* Turning points */}
            <div style={{ padding: "1.5rem" }}>
              <p style={{
                fontFamily: "'DM Mono', monospace", fontSize: "0.52rem",
                letterSpacing: "0.12em", textTransform: "uppercase",
                color: T.inkFaint, marginBottom: "1rem",
              }}>理解转折</p>
              {turningPoints.map((tp, i) => (
                <div key={i} style={{ marginBottom: "1.2rem", opacity: i === 0 ? 1 : 0.45 }}>
                  <span style={{
                    fontFamily: "'DM Mono', monospace", fontSize: "0.55rem",
                    color: T.inkFaint, display: "block", marginBottom: 3,
                  }}>{tp.date}</span>
                  <p style={{
                    fontFamily: "'Lora', serif", fontStyle: "italic",
                    fontSize: "0.7rem", lineHeight: 1.6,
                    color: T.inkMid, margin: 0,
                  }}>{tp.shift}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
