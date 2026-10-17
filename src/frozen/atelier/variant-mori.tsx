"use client";

import { useState } from "react";
import { papers, turningPoints } from "@/lib/data-atelier";

const T = {
  bg: "#EDE8DF",
  surface: "#E6E0D5",
  ink: "#1E1B17",
  inkMid: "#5A5450",
  inkFaint: "#9A9189",
  rule: "#D8D2C8",
  red: "#7A2030",
  green: "#2A5E48",
};

export default function VariantMori({ onSwitch }: { onSwitch: (v: string) => void }) {
  const [open, setOpen] = useState<string | null>("01");

  return (
    <div style={{ minHeight: "100vh", background: T.bg, color: T.ink }}>

      {/* Variant switcher — minimal strip */}
      <div style={{
        position: "fixed", top: 0, right: 0, zIndex: 50,
        display: "flex", gap: 0,
        borderLeft: `1px solid ${T.rule}`, borderBottom: `1px solid ${T.rule}`,
        background: T.bg,
      }}>
        {["Atelier", "Mori", "OS"].map((v) => (
          <button key={v} onClick={() => onSwitch(v)} style={{
            fontFamily: "'DM Mono', monospace", fontSize: "0.58rem",
            letterSpacing: "0.1em", textTransform: "uppercase",
            padding: "0.5rem 0.9rem",
            background: v === "Mori" ? T.surface : "transparent",
            border: "none", borderRight: `1px solid ${T.rule}`,
            color: v === "Mori" ? T.ink : T.inkFaint, cursor: "pointer",
          }}>{v}</button>
        ))}
      </div>

      {/* Header — very quiet */}
      <header style={{ padding: "3rem 4rem 0" }}>
        <p style={{
          fontFamily: "'DM Mono', monospace",
          fontSize: "0.6rem", letterSpacing: "0.18em",
          textTransform: "uppercase", color: T.inkFaint,
        }}>
          我的研究档案 · 2026
        </p>
      </header>

      {/* Hero — a single breath */}
      <section style={{ padding: "5rem 4rem 4rem", maxWidth: "52rem" }}>
        <p style={{
          fontFamily: "'DM Mono', monospace",
          fontSize: "0.58rem", letterSpacing: "0.14em",
          textTransform: "uppercase", color: T.inkFaint,
          marginBottom: "2.5rem",
        }}>
          今日 · 八月二十二日
        </p>

        <h1 style={{
          fontFamily: "'Lora', serif",
          fontSize: "clamp(1.6rem, 3vw, 2.2rem)",
          fontWeight: 500, lineHeight: 1.22,
          letterSpacing: "-0.01em",
          color: T.ink,
          marginBottom: "0.6rem",
          maxWidth: "30rem",
        }}>
          {papers[0].title}
        </h1>

        <p style={{
          fontFamily: "'Inter', sans-serif",
          fontSize: "0.72rem", color: T.inkMid,
          marginBottom: "3rem",
        }}>
          {papers[0].authors} · {papers[0].venue} {papers[0].year}
        </p>

        {/* The current insight — large, isolated */}
        <p style={{
          fontFamily: "'Lora', serif",
          fontStyle: "italic",
          fontSize: "1.05rem", lineHeight: 1.8,
          color: T.ink,
          maxWidth: "36rem",
          marginBottom: "1.5rem",
        }}>
          “{papers[0].insights[papers[0].insights.length - 1].text}”
        </p>

        {/* AI companion — appears like a pencil note */}
        <p style={{
          fontFamily: "'DM Mono', monospace",
          fontSize: "0.6rem", color: T.inkFaint,
          fontStyle: "italic", lineHeight: 1.7,
          maxWidth: "28rem",
          borderLeft: `1px solid ${T.rule}`,
          paddingLeft: "1rem",
        }}>
          {papers[0].aiNote}
        </p>
      </section>

      {/* Divider — single rule with label */}
      <div style={{
        margin: "0 4rem",
        borderTop: `1px solid ${T.rule}`,
        display: "flex", alignItems: "center",
        gap: "1.5rem", paddingTop: "0",
      }}>
        <span style={{
          fontFamily: "'DM Mono', monospace",
          fontSize: "0.55rem", letterSpacing: "0.14em",
          textTransform: "uppercase", color: T.inkFaint,
          background: T.bg, paddingRight: "1rem",
          marginTop: "-0.55rem",
        }}>研究记忆</span>
      </div>

      {/* Two-column layout: papers left, context right */}
      <div style={{
        display: "grid",
        gridTemplateColumns: "1fr 260px",
        gap: 0,
        margin: "0 4rem",
        paddingTop: "2.5rem",
        paddingBottom: "6rem",
      }}>

        {/* Papers — journal entries */}
        <div style={{ paddingRight: "4rem" }}>
          {papers.map((p) => {
            const isOpen = open === p.id;
            const latest = p.insights[p.insights.length - 1];
            return (
              <article
                key={p.id}
                onClick={() => setOpen(isOpen ? null : p.id)}
                style={{
                  borderBottom: `1px solid ${T.rule}`,
                  padding: "2rem 0",
                  cursor: "pointer",
                }}
              >
                {/* Date stamp + status — very small, top */}
                <div style={{ display: "flex", gap: "1.5rem", marginBottom: "0.8rem" }}>
                  <span style={{
                    fontFamily: "'DM Mono', monospace",
                    fontSize: "0.58rem", color: T.inkFaint,
                    letterSpacing: "0.06em",
                  }}>
                    {p.lastEngaged}
                  </span>
                  <span style={{
                    fontFamily: "'DM Mono', monospace",
                    fontSize: "0.58rem",
                    color: p.statusColor,
                    letterSpacing: "0.06em",
                  }}>
                    {p.status}
                  </span>
                </div>

                {/* Title — quiet weight */}
                <p style={{
                  fontFamily: "'Lora', serif",
                  fontSize: "0.92rem", fontWeight: 500,
                  lineHeight: 1.4, color: T.ink,
                  marginBottom: "0.3rem",
                }}>
                  {p.title}
                </p>
                <p style={{
                  fontFamily: "'Inter', sans-serif",
                  fontSize: "0.68rem", color: T.inkFaint,
                  marginBottom: "1rem",
                }}>
                  {p.authors} · {p.year}
                </p>

                {/* Latest insight — always visible */}
                <p style={{
                  fontFamily: "'Lora', serif",
                  fontStyle: "italic",
                  fontSize: "0.8rem", lineHeight: 1.65,
                  color: T.inkMid,
                }}>
                  {latest.text}
                </p>

                {/* Expanded: trace */}
                {isOpen && p.insights.length > 1 && (
                  <div style={{ marginTop: "1.5rem", display: "flex", flexDirection: "column", gap: "1.2rem" }}>
                    {p.insights.slice(0, -1).map((ins, i) => (
                      <div key={i} style={{
                        display: "grid", gridTemplateColumns: "40px 1fr",
                        gap: "0.8rem", opacity: 0.45,
                      }}>
                        <span style={{
                          fontFamily: "'DM Mono', monospace",
                          fontSize: "0.55rem", color: T.inkFaint,
                          paddingTop: 2,
                        }}>{ins.date}</span>
                        <p style={{
                          fontFamily: "'Lora', serif", fontStyle: "italic",
                          fontSize: "0.75rem", lineHeight: 1.6,
                          color: T.inkMid, margin: 0,
                        }}>{ins.text}</p>
                      </div>
                    ))}

                    {p.aiNote && (
                      <p style={{
                        fontFamily: "'DM Mono', monospace",
                        fontSize: "0.58rem", color: T.inkFaint,
                        fontStyle: "italic", lineHeight: 1.65,
                        borderTop: `1px solid ${T.rule}`,
                        paddingTop: "1rem", marginTop: "0.3rem",
                      }}>
                        — {p.aiNote}
                      </p>
                    )}
                  </div>
                )}
              </article>
            );
          })}
        </div>

        {/* Right: phases + turning points — text only, no decoration */}
        <div style={{
          borderLeft: `1px solid ${T.rule}`,
          paddingLeft: "2.5rem",
          paddingTop: "0.5rem",
        }}>
          {/* Phases */}
          <div style={{ marginBottom: "3rem" }}>
            <p style={{
              fontFamily: "'DM Mono', monospace",
              fontSize: "0.55rem", letterSpacing: "0.14em",
              textTransform: "uppercase", color: T.inkFaint,
              marginBottom: "1.5rem",
            }}>阶段</p>
            {[
              { p: "P1", l: "背景建立", active: false, done: true },
              { p: "P2", l: "方法理解", active: true, done: false },
              { p: "P3", l: "实验复现", active: false, done: false },
              { p: "P4", l: "方向探索", active: false, done: false },
            ].map((ph) => (
              <div key={ph.p} style={{ display: "flex", gap: "0.8rem", marginBottom: "0.9rem", alignItems: "baseline" }}>
                <span style={{
                  fontFamily: "'DM Mono', monospace",
                  fontSize: "0.55rem", color: ph.active ? T.red : T.inkFaint,
                  letterSpacing: "0.06em",
                }}>{ph.p}</span>
                <span style={{
                  fontFamily: "'Inter', sans-serif",
                  fontSize: "0.72rem",
                  color: ph.active ? T.ink : ph.done ? T.inkMid : T.inkFaint,
                  fontWeight: ph.active ? 500 : 400,
                }}>{ph.l}</span>
              </div>
            ))}
          </div>

          {/* Turning points */}
          <div>
            <p style={{
              fontFamily: "'DM Mono', monospace",
              fontSize: "0.55rem", letterSpacing: "0.14em",
              textTransform: "uppercase", color: T.inkFaint,
              marginBottom: "1.5rem",
            }}>理解的转折</p>
            {turningPoints.map((tp, i) => (
              <div key={i} style={{ marginBottom: "1.4rem", opacity: i === 0 ? 1 : 0.5 }}>
                <span style={{
                  fontFamily: "'DM Mono', monospace",
                  fontSize: "0.55rem", color: T.inkFaint,
                  display: "block", marginBottom: "0.3rem",
                }}>{tp.date}</span>
                <p style={{
                  fontFamily: "'Lora', serif", fontStyle: "italic",
                  fontSize: "0.72rem", lineHeight: 1.65,
                  color: T.inkMid, margin: 0,
                }}>{tp.shift}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
