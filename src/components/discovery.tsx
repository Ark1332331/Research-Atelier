"use client";

import { useEffect, useState } from "react";

/**
 * Literature Discovery · Phase A 入口 UI（v1.1）：
 * 单主任务卡片（一次只推一个 recommendedNow），其余数据库折叠；
 * Return Path 由状态机驱动（ready-to-search → external-opened → awaiting-import），
 * session 持久化，刷新/回来后继续「把论文带回来」，不重新生成计划。
 */
const STAGE_LABEL: Record<string, string> = {
  planning: "待开始",
  "ready-to-search": "去搜索",
  "external-opened": "搜索中…",
  "awaiting-import": "带论文回来",
};

export default function Discovery() {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [session, setSession] = useState<any>(null);
  const [nextStep, setNextStep] = useState<any>(null);
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  // 刷新恢复：session 已持久化，回来继续当前步骤
  useEffect(() => {
    const id = localStorage.getItem("ra-session-id");
    if (!id) return;
    fetch("/api/literature/session?id=" + encodeURIComponent(id))
      .then((r) => r.json())
      .then((d) => {
        if (d && d.session) { setSessionId(d.session.id); setSession(d.session); setNextStep(d.nextStep); }
      })
      .catch(() => {});
  }, []);

  async function genPlan() {
    if (!question.trim()) return;
    setBusy(true); setError(""); setCopied(false);
    try {
      const res = await fetch("/api/literature/plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question, sessionId }),
      });
      const d = await res.json();
      if (!res.ok) { setError((d.error ?? "失败") + (d.hint ? " — " + d.hint : "")); return; }
      localStorage.setItem("ra-session-id", d.session.id);
      setSessionId(d.session.id); setSession(d.session); setNextStep(d.nextStep);
    } finally { setBusy(false); }
  }

  async function act(action: string) {
    if (!sessionId) return;
    setBusy(true);
    try {
      const res = await fetch("/api/literature/action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, action }),
      });
      const d = await res.json();
      if (res.ok) { setSession(d.session); setNextStep(d.nextStep); }
      else setError(d.error ?? "操作失败");
    } finally { setBusy(false); }
  }

  async function copyAndOpen(db: any) {
    const query = db.recommendedFirst ?? db.queries?.[0];
    try { await navigator.clipboard.writeText(query); setCopied(true); } catch { /* 剪贴板不可用时忽略 */ }
    // v1.1.2：deepLinkUrl（带 query 直达）或 landingUrl（入口页，如 WoS Advanced Search）必有其一，
    // 只有真实打开页面后才记录 opened / 进入 external-opened
    const url = db.deepLinkUrl ?? db.landingUrl;
    if (url) window.open(url, "_blank");
    await act("open-external");
  }

  const stage: string = session?.stage ?? "planning";
  const plan = session?.plan;
  const primary = (plan?.databases ?? []).find((d: any) => d.recommendedNow) ?? plan?.databases?.[0];
  const others = (plan?.databases ?? []).filter((d: any) => d !== primary);

  return (
    <div style={{ maxWidth: 720, padding: "1.5rem 1.5rem 3rem", display: "flex", flexDirection: "column", gap: "1.1rem" }}>
      <div>
        <h2 style={{ margin: 0, fontSize: "1.05rem", fontWeight: 600 }}>文献发现 · 第一步：把我带到真实数据库</h2>
        <p style={{ margin: "0.3rem 0 0", fontSize: "0.8rem", color: "var(--muted-foreground)" }}>
          我不替你搜；我告诉你怎么搜，搜完回来我帮你筛。
        </p>
      </div>

      {error && <div style={{ color: "#c0392b", fontSize: "0.8rem" }}>{error}</div>}

      {(!session || stage === "planning") && (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.6rem" }}>
          <label className="mono-label" htmlFor="discovery-q">你的研究问题</label>
          <textarea
            id="discovery-q"
            className="field prompt-textarea"
            rows={3}
            placeholder={"例如：我想了解 world model 在 embodied AI 和 robotics 里最近几年的发展"}
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
          />
          <button className="btn btn--primary" style={{ alignSelf: "flex-start" }} disabled={busy || !question.trim()} onClick={() => void genPlan()}>
            {busy ? "编译检索策略中…" : "生成检索计划"}
          </button>
        </div>
      )}

      {session && stage !== "planning" && primary && (
        <>
          <div style={{ borderTop: "1px solid var(--border)", paddingTop: "0.8rem", display: "flex", flexDirection: "column", gap: "0.2rem" }}>
            <p className="mono-label" style={{ color: "var(--muted-foreground)" }}>研究目标 · {session.question}</p>
            <p className="mono-label" style={{ color: "var(--muted-foreground)" }}>
              当前阶段 · {STAGE_LABEL[stage] ?? stage}　下一步 · {nextStep?.action ?? "—"}
            </p>
          </div>

          {stage === "awaiting-import" ? (
            <div style={{ padding: "1rem", border: "1px solid var(--border)", borderRadius: 8 }}>
              <p style={{ margin: 0, fontWeight: 600 }}>当前步骤：把刚才搜到的论文带回来</p>
              <p style={{ margin: "0.5rem 0 0", fontSize: "0.8rem", color: "var(--muted-foreground)" }}>
                导入（Phase B-lite）即将接入；你的位置已保存——刷新页面也不会丢。
              </p>
            </div>
          ) : (
            <div style={{ padding: "1rem", border: "1px solid var(--border)", borderRadius: 8 }}>
              <p style={{ margin: 0, fontWeight: 600 }}>第一步 · {dbName(primary.id)}（推荐现在做）</p>
              <p className="mono-label" style={{ marginTop: "0.5rem" }}>{primary.recommendedFirst ?? primary.queries?.[0]}</p>
              <p style={{ margin: "0.4rem 0 0", fontSize: "0.8rem", color: "var(--muted-foreground)" }}>{primary.why}</p>
              <div style={{ marginTop: "0.8rem", display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
                <button className="btn btn--primary" disabled={busy} onClick={() => void copyAndOpen(primary)}>
                  {copied ? "已复制 · 已打开" : (primary.deepLinkUrl ? "复制并打开 " : "复制检索式并打开入口 ") + dbName(primary.id)}
                </button>
                <button className="btn btn--ghost" disabled={busy} onClick={() => void act("returned-import")}>
                  我搜完了，开始导入论文
                </button>
              </div>
            </div>
          )}

          <div>
            <p className="mono-label" style={{ color: "var(--muted-foreground)" }}>这一轮任务</p>
            <ol style={{ margin: "0.4rem 0 0 1.1rem", fontSize: "0.8rem", color: "var(--muted-foreground)" }}>
              {(plan?.returnPath ?? []).map((t: string, i: number) => <li key={i} style={{ margin: "0.15rem 0" }}>{t}</li>)}
            </ol>
          </div>

          {stage !== "awaiting-import" && others.length > 0 && (
            <details style={{ fontSize: "0.82rem" }}>
              <summary className="mono-label" style={{ cursor: "pointer", color: "var(--muted-foreground)" }}>之后可以（折叠）</summary>
              <ul style={{ margin: "0.5rem 0 0 1.1rem", display: "flex", flexDirection: "column", gap: "0.4rem" }}>
                {others.map((db: any) => (
                  <li key={db.id}>
                    <strong>{dbName(db.id)}</strong> — {db.why}
                    <div className="mono-label" style={{ color: "var(--muted-foreground)" }}>{db.queries?.[0]}</div>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </>
      )}
    </div>
  );
}

function dbName(id: string): string {
  const map: Record<string, string> = {
    "google-scholar": "Google Scholar",
    "web-of-science": "Web of Science",
    "semantic-scholar": "Semantic Scholar",
    arxiv: "arXiv",
    openalex: "OpenAlex",
  };
  return map[id] ?? id;
}

