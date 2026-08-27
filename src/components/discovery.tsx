"use client";

import { useEffect, useMemo, useState } from "react";
import CandidateWorkbench from "@/components/candidate-workbench";

/**
 * Literature Discovery · Phase A + Phase B-lite UI（v1.2 + v1.6）：
 * A：Search Guide（单主任务卡片 + Academic Concept Map + Query Ladder + Return Path + session 持久化）
 * B-lite：显式 Candidate Rows（一行一篇 + 批量预览确认）→ 逐行 Resolution → 证据门控 →
 *         AI 初筛（只出建议，用户 Keep/Maybe/Exclude）→ 种子
 */
const STAGE_LABEL: Record<string, string> = {
  planning: "待开始",
  "ready-to-search": "去搜索",
  "external-opened": "搜索中…",
  "awaiting-import": "带论文回来",
  screening: "候选筛选",
};

export default function Discovery() {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [session, setSession] = useState<any>(null);
  const [nextStep, setNextStep] = useState<any>(null);
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

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

  async function post(path: string, body: any): Promise<any> {
    setBusy(true); setError("");
    try {
      const res = await fetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const d = await res.json();
      if (!res.ok) { setError((d.error ?? "失败") + (d.hint ? " — " + d.hint : "")); return null; }
      return d;
    } finally { setBusy(false); }
  }

  async function genPlan() {
    if (!question.trim()) return;
    const d = await post("/api/literature/plan", { question, sessionId });
    if (!d) return;
    localStorage.setItem("ra-session-id", d.session.id);
    setSessionId(d.session.id); setSession(d.session); setNextStep(d.nextStep);
  }

  async function act(action: string, extra: any = {}) {
    if (!sessionId) return;
    const d = await post("/api/literature/action", { sessionId, action, ...extra });
    if (d) { setSession(d.session); setNextStep(d.nextStep); }
  }

  async function copyAndOpen(db: any) {
    const query = db.recommendedFirst ?? db.queries?.[0];
    const url = db.deepLinkUrl ?? db.landingUrl;
    let opened: Window | null = null;
    try { opened = window.open(url, "_blank", "noopener,noreferrer"); } catch { opened = null; }
    if (!opened) {
      try { await navigator.clipboard.writeText(query); } catch { /* 剪贴板不可用 */ }
      setError("浏览器阻止了新窗口：已复制检索式，请手动粘贴打开 " + dbName(db.id));
      return;
    }
    try { await navigator.clipboard.writeText(query); setCopied(true); } catch { /* 剪贴板不可用时忽略 */ }
    await act("open-external");
  }

  const stage: string = session?.stage ?? "planning";
  const plan = session?.plan;
  const primary = (plan?.databases ?? []).find((d: any) => d.recommendedNow) ?? plan?.databases?.[0];
  const others = (plan?.databases ?? []).filter((d: any) => d !== primary);

  return (
    <div style={{ maxWidth: 760, padding: "1.5rem 1.5rem 3rem", display: "flex", flexDirection: "column", gap: "1.1rem" }}>
      <div>
        <h2 style={{ margin: 0, fontSize: "1.05rem", fontWeight: 600 }}>文献发现 · 把我带到真实数据库，再把论文带回来</h2>
        <p style={{ margin: "0.3rem 0 0", fontSize: "0.8rem", color: "var(--muted-foreground)" }}>
          我不替你搜；我告诉你怎么搜；你搜完把论文逐篇带回来，我帮你去重、解析身份、按证据筛选——每一步只在证据足够时推进。
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

      {session && stage !== "planning" && (
        <>
          <div style={{ borderTop: "1px solid var(--border)", paddingTop: "0.8rem", display: "flex", flexDirection: "column", gap: "0.2rem" }}>
            <p className="mono-label" style={{ color: "var(--muted-foreground)" }}>研究目标 · {session.question}</p>
            <p className="mono-label" style={{ color: "var(--muted-foreground)" }}>
              当前阶段 · {STAGE_LABEL[stage] ?? stage}　下一步 · {nextStep?.action ?? "—"}
            </p>
          </div>

          {/* A 部分：搜索指引（ready-to-search / external-opened） */}
          {(stage === "ready-to-search" || stage === "external-opened") && primary && (
            <>
              {plan?.conceptMap && <ConceptMapView map={plan.conceptMap} />}

              {plan?.ladder && (
                <div style={{ padding: "0.6rem 0.8rem", border: "1px solid var(--border)", borderRadius: 6, fontSize: "0.8rem" }}>
                  <p className="mono-label" style={{ margin: 0, color: "var(--muted-foreground)" }}>
                    检索阶梯：第 {Math.min(plan.ladder.activeTier + 1, plan.ladder.tiers.length)} / {plan.ladder.tiers.length} 层
                    — {plan.ladder.tiers[plan.ladder.activeTier]?.label ?? ""}
                  </p>
                  <p style={{ margin: "0.3rem 0 0", color: "var(--muted-foreground)" }}>
                    {plan.ladder.tiers[plan.ladder.activeTier]?.why ?? ""}
                  </p>
                </div>
              )}

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
                  {plan?.ladder && plan.ladder.activeTier < plan.ladder.tiers.length - 1 && (
                    <button className="btn btn--ghost" disabled={busy} onClick={() => void act("advance-tier")}>
                      进入下一层 · {plan.ladder.tiers[plan.ladder.activeTier + 1]?.label ?? ""}
                    </button>
                  )}
                </div>
              </div>

              <div>
                <p className="mono-label" style={{ color: "var(--muted-foreground)" }}>这一轮任务</p>
                <ol style={{ margin: "0.4rem 0 0 1.1rem", fontSize: "0.8rem", color: "var(--muted-foreground)" }}>
                  {(plan?.returnPath ?? []).map((t: string, i: number) => <li key={i} style={{ margin: "0.15rem 0" }}>{t}</li>)}
                </ol>
              </div>

              {(others.length > 0 || plan?.ladder?.tiers.length > 1) && (
                <details style={{ fontSize: "0.82rem" }}>
                  <summary className="mono-label" style={{ cursor: "pointer", color: "var(--muted-foreground)" }}>之后可以（折叠）</summary>
                  <ul style={{ margin: "0.5rem 0 0 1.1rem", display: "flex", flexDirection: "column", gap: "0.4rem" }}>
                    {plan?.ladder?.tiers.slice(plan.ladder.activeTier + 1).map((t: any, i: number) => (
                      <li key={i}>
                        <strong>第 {plan.ladder.activeTier + 2 + i} 层 · {t.label}</strong> — {t.why}
                        <div className="mono-label" style={{ color: "var(--muted-foreground)" }}>
                          {t.conceptGroups.map((g: string[]) => g.join(" OR ")).join(" AND ")}
                        </div>
                      </li>
                    ))}
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

          {/* B-lite：显式 Candidate Rows（v1.6） */}
          {(stage === "awaiting-import" || stage === "screening") && (
            <CandidateWorkbench session={session} onSession={setSession} />
          )}

          {/* v1.5：发现过程时间线（append-only 事件日志） */}
          {(session?.events ?? []).length > 0 && (
            <details style={{ fontSize: "0.82rem" }}>
              <summary className="mono-label" style={{ cursor: "pointer", color: "var(--muted-foreground)" }}>
                发现过程（{(session.events ?? []).length} 步）
              </summary>
              <ol style={{ margin: "0.5rem 0 0 1.1rem", display: "flex", flexDirection: "column", gap: "0.3rem" }}>
                {(session.events ?? []).map((ev: any, i: number) => (
                  <li key={i}>
                    <span className="mono-label" style={{ color: "var(--muted-foreground)" }}>{evLabel(ev.kind)}{evDetail(ev)}</span>
                  </li>
                ))}
              </ol>
            </details>
          )}
        </>
      )}
    </div>
  );
}

function ConceptMapView({ map }: { map: any }) {
  const bucket = (key: string, label: string) =>
    (map[key] ?? []).length > 0 ? (
      <p style={{ margin: "0.15rem 0" }}>
        <span className="mono-label" style={{ color: "var(--muted-foreground)" }}>{label}　</span>
        {(map[key] ?? []).map((c: any) => c.canonical ?? c.term).join("、")}
      </p>
    ) : null;
  return (
    <div style={{ padding: "0.6rem 0.8rem", border: "1px solid var(--border)", borderRadius: 6, fontSize: "0.8rem" }}>
      <p className="mono-label" style={{ margin: 0, color: "var(--muted-foreground)" }}>系统如何理解你的问题（学术术语映射）</p>
      {bucket("coreTasks", "核心任务")}
      {bucket("methods", "方法")}
      {bucket("broaderFields", "上位领域")}
      {bucket("applicationTerms", "应用场景")}
      {bucket("adjacentTerms", "邻近概念")}
      {(map.ambiguousTerms ?? []).length > 0 && (
        <p style={{ margin: "0.2rem 0 0", color: "#c0392b" }}>
          歧义/非标准表达（第一轮不锁定）：{(map.ambiguousTerms ?? []).map((a: any) => a.term + (a.suggestedCanonical ? " → " + a.suggestedCanonical : "")).join("、")}
        </p>
      )}
      {(map.applicationTerms ?? []).length > 0 && (
        <p style={{ margin: "0.2rem 0 0", color: "var(--muted-foreground)" }}>
          应用场景（如 {(map.applicationTerms ?? []).map((a: any) => a.canonical).join("、")}）第一轮不直接锁死——先建立上位领域/核心任务的候选池，再逐层收窄。
        </p>
      )}
    </div>
  );
}

function evLabel(kind: string): string {
  const m: Record<string, string> = {
    "plan-generated": "生成检索计划",
    "tier-advanced": "进入下一层",
    "external-opened": "打开外部数据库",
    "returned-import": "搜完回来",
    "batch-imported": "导入候选",
    "candidate-resolved": "解析候选",
    "candidate-pending": "候选待处理",
    calibration: "术语校准",
    "triage-computed": "AI 筛选",
    "seeds-selected": "选择种子",
  };
  return m[kind] ?? kind;
}

function evDetail(ev: any): string {
  const d = ev?.detail ?? {};
  switch (ev?.kind) {
    case "plan-generated": return "（第 " + (d.tier ?? 1) + "/" + (d.totalTiers ?? 1) + " 层 · " + (d.tierLabel ?? "") + "）";
    case "tier-advanced": return "（第 " + d.from + " → 第 " + d.to + " 层 · " + (d.toLabel ?? "") + "）";
    case "external-opened": return "（" + (d.database ?? "") + "）";
    case "batch-imported": return "（" + (d.rawItems ?? 0) + " 条 → 候选 " + (d.unique ?? 0) + " 篇）";
    case "candidate-resolved": return "（" + (d.title ?? "") + " · " + (d.confidence ?? "") + (d.merged ? " · 合并" : "") + "）";
    case "candidate-pending": return "（" + (d.status ?? "") + "）";
    case "calibration": return "（confirmed: " + ((d.confirmed ?? []).length) + " · suggested: " + ((d.suggested ?? []).length) + " · weakOrRare: " + ((d.weakOrRare ?? []).length) + "）";
    case "triage-computed": return "（" + (d.count ?? 0) + "/" + (d.total ?? 0) + " 篇有摘要可筛）";
    case "seeds-selected": return "（" + ((d.ids ?? []).length) + " 篇）";
    default: return "";
  }
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

