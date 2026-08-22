"use client";

import { useEffect, useState } from "react";
import PageHead from "@/components/page-head";
import { papers as papersRaw, researchPhases, turningPoints } from "@/lib/data-atelier";

/** data-atelier 里 connections 字面量推断为 never[]，消费端补上 string[] 类型（不改数据文件） */
type Paper = Omit<(typeof papersRaw)[number], "connections"> & { connections: string[] };
const papers = papersRaw as Paper[];

const statusColor: Record<string, string> = {
  "已掌握": "var(--ok)",
  "深度精读": "var(--accent)",
  "方法理解": "var(--amber)",
  "快速浏览": "var(--muted-foreground)",
};

const MEMORY_KINDS: { id: string; label: string; hint: string; file: string }[] = [
  { id: "profile", label: "知识水平记录", hint: "从 0 累积，不由你自评；每次学习会话后更新；AI 根据它决定讲解深度与筛选门槛。", file: "data/profile.md" },
  { id: "environment", label: "环境卡", hint: "三层地图（驱动/环境/项目）+ 已知坑点 + 分级验收；AI 每次会话先读它，不重复问你。", file: "data/environment.md" },
  { id: "handoff", label: "交接词", hint: "换会话/换模型时的自包含交接提示词（追加式，实验复现页可一键存入）。", file: "data/handoffs.md" },
];

function PaperRow({ paper, index, expanded, onToggle }: {
  paper: Paper; index: number; expanded: boolean; onToggle: () => void;
}) {
  const latest = paper.insights[paper.insights.length - 1];
  const color = statusColor[paper.status] ?? "var(--muted-foreground)";

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onToggle();
    }
  };

  return (
    <div className={`ix-row${expanded ? " is-open" : ""}`}>
      <div className="ix-toggle" role="button" tabIndex={0} aria-expanded={expanded}
        onClick={onToggle} onKeyDown={handleKey}>
        <span className="ix-num">{String(index + 1).padStart(2, "0")}</span>
        <div>
          <h3 className="ix-title">{paper.title}</h3>
          <p className="ix-sub">{paper.authors} · {paper.venue} {paper.year}</p>
          <p className="ix-quote">{latest.text}</p>
        </div>
        <span className="ix-cell-status" style={{ color }}>{paper.status}</span>
        <span className="ix-date">{paper.firstEncounter.slice(5)}<small>首读</small></span>
        <span className="ix-date">{paper.lastEngaged.slice(5)}<small>最近</small></span>
        <span className="ix-arrow" aria-hidden="true">→</span>
      </div>

      <div className={`reveal${expanded ? " open" : ""}`}>
        <div className="reveal-inner">
          <div className="ix-detail">
            {paper.insights.length > 1 && (
              <div>
                <p className="detail-label">理解轨迹 · 从第一遍导读至今</p>
                <div className="trajectory">
                  {paper.insights.map((ins, i) => (
                    <div key={i} className={`trajectory-item${i === paper.insights.length - 1 ? " is-latest" : ""}`}>
                      <span className="trajectory-date">{ins.date}</span>
                      <p className="trajectory-text">{ins.text}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {paper.aiNote && (
              <div className="detail-block">
                <p className="detail-label">研究伴侣 · AI 注</p>
                <p className="trajectory-text" style={{ borderLeft: "2px solid var(--sage)", color: "var(--sage-ink)" }}>{paper.aiNote}</p>
              </div>
            )}
            {paper.connections.length > 0 && (
              <div className="detail-block">
                <p className="detail-label">知识关联</p>
                <ul className="conn-list">
                  {paper.connections.map((c) => (<li key={c}>→ {c}</li>))}
                </ul>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function Journal() {
  const [expandedPaper, setExpandedPaper] = useState<string | null>("01");

  // 记忆层
  const [memKind, setMemKind] = useState("profile");
  const [memContent, setMemContent] = useState("");
  const [memLoading, setMemLoading] = useState(true);
  const [memSaved, setMemSaved] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/memory?kind=${memKind}`)
      .then((r) => r.json())
      .then((d) => { if (!cancelled) setMemContent(d.content ?? ""); })
      .catch(() => { if (!cancelled) setMemContent(""); })
      .finally(() => { if (!cancelled) setMemLoading(false); });
    return () => { cancelled = true; };
  }, [memKind]);

  async function saveMem() {
    const res = await fetch("/api/memory", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: memKind, content: memContent }),
    });
    if (res.ok) {
      setMemSaved(true);
      setTimeout(() => setMemSaved(false), 1500);
    }
  }

  const currentMem = MEMORY_KINDS.find((k) => k.id === memKind)!;

  return (
    <section>
      <PageHead
        num="06" name="研究日志"
        title="研究日志"
        desc="论文阅读的全部痕迹：理解轨迹、转折点、阶段路线与长期记忆文件——随时可打开看。"
        meta={`${papers.length} 篇论文 · ${turningPoints.length} 次转向`}
      />

      {/* 论文索引 */}
      <div className="ix-grid">
        <div className="ix-head" aria-hidden="true">
          <span>编号</span><span>论文</span><span>状态</span><span>首读</span><span>最近</span>
          <span style={{ textAlign: "right" }}>▸</span>
        </div>
        {papers.map((p, i) => (
          <PaperRow key={p.id} paper={p} index={i}
            expanded={expandedPaper === p.id}
            onToggle={() => setExpandedPaper(expandedPaper === p.id ? null : p.id)} />
        ))}
      </div>

      {/* 理解转折点 */}
      <section style={{ marginTop: "3rem" }}>
        <header className="mod-head" style={{ padding: "0.9rem 0 0.6rem", borderBottom: "none" }}>
          <span className="mod-num">02</span>
          <h2 className="mod-title">理解转折点</h2>
          <span className="mod-count">{turningPoints.length} 次转向</span>
        </header>
        <div className="turns-grid" style={{ marginTop: "0.4rem" }}>
          {turningPoints.map((tp, i) => (
            <div key={i} className="turn-item">
              <span className="turn-date">{tp.date}</span>
              <p className="turn-text">{tp.shift}</p>
            </div>
          ))}
        </div>
      </section>

      {/* 研究阶段 */}
      <section style={{ marginTop: "3rem" }}>
        <header className="mod-head" style={{ padding: "0.9rem 0 0.6rem", borderBottom: "none" }}>
          <span className="mod-num">03</span>
          <h2 className="mod-title">研究阶段</h2>
          <span className="mod-count">当前 {researchPhases.find((p) => p.active)?.phase}</span>
        </header>
        <div className="phase-strip">
          {researchPhases.map((p) => (
            <div key={p.phase} className={`phase-cell${p.active ? " is-active" : p.done ? " is-done" : " is-pending"}`}>
              <span className="phase-num">{p.phase}</span>
              <p className="phase-label">{p.label}</p>
              <p className="phase-period">{p.period}</p>
            </div>
          ))}
        </div>
      </section>

      {/* 记忆层 */}
      <section style={{ marginTop: "3rem" }}>
        <header className="mod-head" style={{ padding: "0.9rem 0 0.6rem", borderBottom: "none" }}>
          <span className="mod-num">04</span>
          <h2 className="mod-title">记忆层</h2>
          <span className="mod-count">纯 Markdown · 随 git</span>
        </header>
        <p className="turn-text" style={{ margin: "0.4rem 0 1.4rem", color: "var(--sage-ink)" }}>{currentMem.hint}</p>
        <div className="tabbar" role="tablist" aria-label="记忆文件类型">
          {MEMORY_KINDS.map((k) => (
            <button key={k.id} role="tab" aria-selected={memKind === k.id}
              className={memKind === k.id ? "is-active" : ""}
              onClick={() => { setMemKind(k.id); setMemSaved(false); }}>
              {k.label}
            </button>
          ))}
        </div>
        <p className="file-path">文件：<b>{currentMem.file}</b> · 每次保存覆盖写入</p>
        {memLoading ? (
          <p className="mono-label">读取中…</p>
        ) : (
          <>
            <textarea
              value={memContent}
              onChange={(e) => setMemContent(e.target.value)}
              rows={16}
              className="field field--paper mem-textarea"
              aria-label={`${currentMem.label} 内容（Markdown）`}
            />
            <div className="composer-row" style={{ marginTop: "0.8rem" }}>
              <span className="composer-hint" />
              <div className="composer-actions">
                {memSaved && <span className="chat-saved">✓ 已保存到文件</span>}
                <button className="btn btn--primary" onClick={() => void saveMem()}>保存</button>
              </div>
            </div>
          </>
        )}
      </section>
    </section>
  );
}
