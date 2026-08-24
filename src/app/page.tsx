"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import PaperLibrary from "@/components/paper-library";
import Terms from "@/components/terms";
import Repro from "@/components/repro";
import ChatPanel from "@/components/chat-panel";
import PageHead from "@/components/page-head";
import CodeReading from "@/components/code-reading";
import { papers as papersRaw, researchPhases } from "@/lib/data-atelier";
import type { Term } from "@/app/api/terms/route";

type Page = "overview" | "screen" | "explain" | "terms" | "repro" | "code";

type Paper = Omit<(typeof papersRaw)[number], "connections"> & { connections: string[] };
const papers = papersRaw as Paper[];

/** 左栏视图（图标为线性 path，同 stroke 风格） */
const VIEWS: { id: Page; label: string; num: string | null; icon: string }[] = [
  { id: "overview", label: "论文库", num: null, icon: "M2.5 2.5h4.5v4.5H2.5zM9 2.5h4.5v4.5H9zM2.5 9h4.5v4.5H2.5zM9 9h4.5v4.5H9z" },
  { id: "screen", label: "论文筛选", num: "01", icon: "M2 3.5h12M4.5 8h7M6.5 12.5h3" },
  { id: "explain", label: "精读讲解", num: "02", icon: "M4 2.5c2.7-.6 5.3 0 5.3 0v11s-2.4-.8-5.3 0zM12 2.5c-2.7-.6-2.7 0-2.7 0v11s2.4-.8 5.3 0" },
  { id: "terms", label: "术语卡", num: "03", icon: "M2.5 3h8v8h-8zM13.5 5.5v8h-8" },
  { id: "code", label: "代码导读", num: "04", icon: "M5 4.5 2 8l3 3.5M11 4.5 14 8l-3 3.5" },
  { id: "repro", label: "实验复现", num: "05", icon: "M6 2.5v4.5L2.8 13.5h10.4L10 7V2.5M4.8 2.5h6.4M4.5 10h7" },
];

function RailIcon({ d, size = 15 }: { d: string; size?: number }) {
  return (
    <svg className="rail-icon" width={size} height={size} viewBox="0 0 16 16" fill="none"
      stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
    </svg>
  );
}

function todayStamp() {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function studyDays() {
  const start = new Date(papers[0].firstEncounter);
  const diff = Math.max(1, Math.round((Date.now() - start.getTime()) / 86400000));
  return `${diff} 天`;
}

export default function App() {
  const router = useRouter();
  const [page, setPage] = useState<Page>("overview");
  const [terms, setTerms] = useState<Term[]>([]);
  const [q, setQ] = useState("");
  const [searchFocus, setSearchFocus] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/terms")
      .then((r) => r.json())
      .then((d) => { if (!cancelled) setTerms(d.terms ?? []); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const go = (p: Page) => { setPage(p); setQ(""); setSearchFocus(false); };

  // 精读讲解：直接进全屏阅读页（/read/<slug>，取库中第一篇导入的论文；内置 NSR 为兜底）
  const openReader = () => {
    fetch("/api/paper")
      .then((r) => r.json())
      .then((d) => { router.push(`/read/${d.papers?.[0]?.slug ?? "nsr-mt454tqk"}`); })
      .catch(() => { router.push("/read/nsr-mt454tqk"); });
  };

  const results = (() => {
    const query = q.trim().toLowerCase();
    if (!query) return [];
    const pageHits = VIEWS.filter((v) => v.id !== "overview" && v.label.toLowerCase().includes(query))
      .map((v) => ({ key: `p-${v.id}`, kind: "页面", label: v.label, act: () => (v.id === "explain" ? openReader() : go(v.id)) }));
    const paperHits = papers.filter((p) => p.title.toLowerCase().includes(query) || p.id.includes(query))
      .map((p) => ({ key: `paper-${p.id}`, kind: "论文", label: p.title.slice(0, 42), act: () => router.push("/read/nsr-mt454tqk") }));
    const termHits = terms.filter((t) => t.name.toLowerCase().includes(query))
      .map((t) => ({ key: `t-${t.id}`, kind: "术语", label: t.name, act: () => go("terms") }));
    return [...pageHits, ...paperHits, ...termHits].slice(0, 8);
  })();

  const activePhase = researchPhases.find((p) => p.active);

  return (
    <div className="shell">
      <header className="topbar">
        <div className="topbar-inner">
          <span className="topbar-word">Research Atelier<span className="dot">.</span></span>
          <div className="gsearch">
            <input
              className="gsearch-input"
              placeholder="搜索 论文 / 术语 / 页面…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onFocus={() => setSearchFocus(true)}
              onBlur={() => setTimeout(() => setSearchFocus(false), 150)}
              aria-label="全局搜索"
            />
            <span className="gsearch-hint">⌘K</span>
            {searchFocus && results.length > 0 && (
              <div className="gsearch-pop">
                {results.map((r) => (
                  <button key={r.key} className="gsearch-item" onMouseDown={(e) => e.preventDefault()} onClick={r.act}>
                    <span>{r.label}</span>
                    <span className="gi-kind">{r.kind}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="topbar-meta">
            <span className="mono-label">{todayStamp()}</span>
            <span className="avatar-dot" aria-hidden="true">我</span>
          </div>
        </div>
      </header>

      <div className="app-body">
        <nav className="rail" aria-label="工作区导航">
          <div className="rail-head">
            <p className="rail-title">我的研究<span className="dot">.</span></p>
            <p className="rail-sub">PRIVATE LAB · {todayStamp()}</p>
          </div>
          <div className="rail-nav">
            {VIEWS.map((v) => (
              <button
                key={v.id}
                className={`rail-item${page === v.id ? " is-active" : ""}`}
                onClick={() => (v.id === "explain" ? openReader() : go(v.id))}
                aria-current={page === v.id ? "page" : undefined}
              >
                <RailIcon d={v.icon} />
                <span>{v.label}</span>
                {v.id === "overview" && <span className="ri-tag">今天</span>}
              </button>
            ))}
          </div>
          <div className="rail-foot">
            <div className="rail-stat">
              <span className="rs-num">{studyDays()}</span>
              <span className="rs-label">持续研究</span>
            </div>
            <div className="rail-stat">
              <span className="rs-num">{terms.length || "·"}</span>
              <span className="rs-label">术语卡</span>
            </div>
            <span className="rail-status-line">AI 伴侣 · 观察中</span>
          </div>
        </nav>

        <main className="workspace">
          {page === "overview" && <PaperLibrary onNavigate={(p) => (p === "explain" ? openReader() : go(p as Page))} />}

          {page === "code" && <CodeReading />}

          {page === "screen" && (
            <>
              <PageHead
                num="01" name="论文筛选"
                title="论文筛选"
                desc="判断一篇论文是否值得读、读多深：入口澄清 → 收集 5–10 篇 → 六维评分 → 停在筛选笔记。筛完你确认，才进入导读。"
                meta="单篇 10–20 分钟 · 产出 → data/notes/screening.md"
              />
              <ChatPanel
                toolKey="p0"
                hint="第一条消息直接给领域 + 目标 + 子问题 + 时间预算，例如：“我想了解 world model 最近为什么火；预算 60 分钟”。"
                saveLabel="保存为筛选笔记" saveKind="screening"
                historyKey="p0"
              />
            </>
          )}

          {page === "terms" && <Terms />}
          {page === "repro" && <Repro />}

          <footer style={{ marginTop: "3rem", paddingTop: "1rem", borderTop: "1px solid var(--border)",
            display: "flex", justifyContent: "space-between", gap: "1rem", flexWrap: "wrap",
            fontFamily: "var(--font-dm-mono)", fontSize: "0.56rem", letterSpacing: "0.08em", color: "var(--muted-foreground)" }}>
            <span>RESEARCH ATELIER · {activePhase?.phase ?? "—"} {activePhase?.label ?? ""}</span>
            <span>AI 是研究伴侣 · 提示词可见可查</span>
          </footer>
        </main>
      </div>
    </div>
  );
}
