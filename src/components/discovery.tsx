"use client";

import { useEffect, useMemo, useState } from "react";

/**
 * Literature Discovery · Phase A + Phase B-lite UI（v1.2）：
 * A：Search Guide（单主任务卡片 + Return Path 状态机 + session 持久化）
 * B-lite：Candidate Inbox（大文本框混贴自动拆分）→ 统计 → 候选列表 →
 *         evidence-aware Triage（角色/深度/为什么，无总分）→ 选种子
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
  const [importRaw, setImportRaw] = useState("");
  const [importResult, setImportResult] = useState<any>(null);
  const [seedSel, setSeedSel] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  // 刷新恢复：session 已持久化（含 candidates/triage/seedPapers/importStats）
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

  async function runImport() {
    if (!sessionId || !importRaw.trim()) return;
    const d = await post("/api/literature/import", { sessionId, raw: importRaw });
    if (d) {
      setSession(d.session); setImportResult(d); setImportRaw("");
    }
  }

  async function runTriage() {
    if (!sessionId) return;
    const d = await post("/api/literature/triage", { sessionId });
    if (d) { setSession(d.session); setImportResult((r: any) => r); }
  }

  async function saveSeeds() {
    if (!sessionId || seedSel.length === 0) return;
    await act("select-seeds", { seedPaperIds: seedSel });
  }

  const stage: string = session?.stage ?? "planning";
  const plan = session?.plan;
  const primary = (plan?.databases ?? []).find((d: any) => d.recommendedNow) ?? plan?.databases?.[0];
  const others = (plan?.databases ?? []).filter((d: any) => d !== primary);
  const candidates: any[] = session?.candidates ?? [];
  const triage: any[] = session?.triage ?? [];
  const stats = session?.importStats;
  const groups = useMemo(() => groupTriage(triage), [triage]);

  return (
    <div style={{ maxWidth: 760, padding: "1.5rem 1.5rem 3rem", display: "flex", flexDirection: "column", gap: "1.1rem" }}>
      <div>
        <h2 style={{ margin: 0, fontSize: "1.05rem", fontWeight: 600 }}>文献发现 · 把我带到真实数据库，再把论文带回来</h2>
        <p style={{ margin: "0.3rem 0 0", fontSize: "0.8rem", color: "var(--muted-foreground)" }}>
          我不替你搜；我告诉你怎么搜；你搜完把论文贴回来，我帮你去重、补证据、筛出值得继续的。
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

              <div>
                <p className="mono-label" style={{ color: "var(--muted-foreground)" }}>这一轮任务</p>
                <ol style={{ margin: "0.4rem 0 0 1.1rem", fontSize: "0.8rem", color: "var(--muted-foreground)" }}>
                  {(plan?.returnPath ?? []).map((t: string, i: number) => <li key={i} style={{ margin: "0.15rem 0" }}>{t}</li>)}
                </ol>
              </div>

              {others.length > 0 && (
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

          {/* B-lite：Candidate Inbox（awaiting-import / screening） */}
          {(stage === "awaiting-import" || stage === "screening") && (
            <>
              <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                <label className="mono-label" htmlFor="inbox-paste">把你刚才找到的论文贴进来（混贴即可：标题 / DOI / arXiv URL / 论文 URL / BibTeX / RIS / WoS export）</label>
                <textarea
                  id="inbox-paste"
                  className="field prompt-textarea"
                  rows={8}
                  placeholder={"例如：\nDreamerV3: Mastering Diverse Domains through World Models\nhttps://arxiv.org/abs/2301.04104\n10.1038/s41586-023-06778-y\n\n@article{...}\n\nTY  - JOUR\nTI  - ...\nER  -"}
                  value={importRaw}
                  onChange={(e) => setImportRaw(e.target.value)}
                />
                <button className="btn btn--primary" style={{ alignSelf: "flex-start" }} disabled={busy || !importRaw.trim()} onClick={() => void runImport()}>
                  {busy ? "导入并去重中…" : "导入并去重"}
                </button>
              </div>

              {stats && (
                <div style={{ fontSize: "0.82rem", color: "var(--muted-foreground)" }}>
                  导入 {stats.rawItems} 条 → 识别 {stats.recognized} 条 → 合并重复 {stats.merged} 条 → 候选 {stats.unique} 篇
                  {stats.unknown > 0 && <span style={{ color: "#c0392b" }}>　（{stats.unknown} 条无法识别，见下方警告）</span>}
                </div>
              )}

              {importResult?.unparsed?.length > 0 && (
                <div style={{ fontSize: "0.8rem", color: "#c0392b" }}>
                  <p className="mono-label" style={{ margin: 0 }}>无法识别（未静默丢弃）：</p>
                  {importResult.unparsed.map((u: any, i: number) => (
                    <p key={i} style={{ margin: "0.2rem 0" }}>「{u.raw.slice(0, 60)}」 — {u.parseWarnings?.join("；") || "无法识别"}</p>
                  ))}
                </div>
              )}

              {importResult?.enrichWarnings?.length > 0 && (
                <div style={{ fontSize: "0.8rem", color: "var(--muted-foreground)" }}>
                  <p className="mono-label" style={{ margin: 0 }}>补证据未核实（不影响整批）：</p>
                  {importResult.enrichWarnings.map((w: any, i: number) => (
                    <p key={i} style={{ margin: "0.2rem 0" }}>{w.canonicalId.slice(0, 40)} — {w.warnings.join("；")}</p>
                  ))}
                </div>
              )}

              {candidates.length > 0 && (
                <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                  <p className="mono-label" style={{ color: "var(--muted-foreground)" }}>候选论文（{candidates.length} 篇）</p>
                  {candidates.map((c: any) => (
                    <div key={c.canonicalId} style={{ padding: "0.6rem 0.8rem", border: "1px solid var(--border)", borderRadius: 6, fontSize: "0.82rem" }}>
                      <div style={{ display: "flex", gap: "0.5rem", justifyContent: "space-between" }}>
                        <strong>{c.title}</strong>
                        {stage === "screening" && (
                          <label style={{ whiteSpace: "nowrap", display: "flex", alignItems: "center", gap: "0.3rem" }}>
                            <input type="checkbox" checked={seedSel.includes(c.canonicalId)} onChange={(ev) => setSeedSel((s) => ev.target.checked ? [...s, c.canonicalId].slice(0, 3) : s.filter((x) => x !== c.canonicalId))} />
                            种子
                          </label>
                        )}
                      </div>
                      <div className="mono-label" style={{ color: "var(--muted-foreground)", marginTop: "0.2rem" }}>
                        {c.year || "年份未核实"} · {c.venue || "venue 未核实"} · 导入: {c.importInfo?.detectedType ?? "?"}
                        {c.enrichment?.citations?.openAlex ? " · OpenAlex 引用 " + c.enrichment.citations.openAlex : ""}
                      </div>
                      {c.enrichment && (
                        <div className="mono-label" style={{ color: "var(--muted-foreground)", marginTop: "0.15rem", fontSize: "0.72rem" }}>
                          证据: title[{c.enrichment.title.join("+") || "未核实"}] abstract[{c.enrichment.abstract.join("+") || "未核实"}] venue[{c.enrichment.venue.join("+") || "未核实"}]
                        </div>
                      )}
                    </div>
                  ))}
                  <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
                    <button className="btn btn--accent" disabled={busy || candidates.length === 0} onClick={() => void runTriage()}>
                      {busy ? "AI 筛选中…" : "AI 筛选（证据感知）"}
                    </button>
                    <button className="btn btn--ghost" disabled={busy || seedSel.length === 0} onClick={() => void saveSeeds()}>
                      保存种子（{seedSel.length}/3）
                    </button>
                  </div>
                </div>
              )}

              {triage.length > 0 && (
                <div style={{ display: "flex", flexDirection: "column", gap: "0.8rem" }}>
                  <p className="mono-label" style={{ color: "var(--muted-foreground)" }}>筛选结果（角色 · 深度 · 为什么 — 无总分）</p>
                  {groups.read.length > 0 && (
                    <div>
                      <p style={{ margin: 0, fontWeight: 600 }}>建议先读</p>
                      {groups.read.map((t: any) => <TriageRow key={t.paperId} t={t} cand={candidates.find((c) => c.canonicalId === t.paperId)} />)}
                    </div>
                  )}
                  {groups.bg.length > 0 && (
                    <div>
                      <p style={{ margin: 0, fontWeight: 600 }}>建立背景</p>
                      {groups.bg.map((t: any) => <TriageRow key={t.paperId} t={t} cand={candidates.find((c) => c.canonicalId === t.paperId)} />)}
                    </div>
                  )}
                  {groups.later.length > 0 && (
                    <div>
                      <p style={{ margin: 0, fontWeight: 600 }}>可以暂缓</p>
                      {groups.later.map((t: any) => <TriageRow key={t.paperId} t={t} cand={candidates.find((c) => c.canonicalId === t.paperId)} />)}
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}

function TriageRow({ t, cand }: { t: any; cand: any }) {
  const depthLabel: Record<string, string> = { skip: "跳过", skim: "扫读", targeted: "定向阅读", deep: "精读" };
  return (
    <div style={{ padding: "0.5rem 0.8rem", border: "1px solid var(--border)", borderRadius: 6, fontSize: "0.82rem", marginTop: "0.4rem" }}>
      <div><strong>{cand?.title ?? t.paperId}</strong></div>
      <div className="mono-label" style={{ color: "var(--muted-foreground)", marginTop: "0.15rem" }}>
        角色 {t.role} · 阅读 {depthLabel[t.depth] ?? t.depth} · 与问题 {t.relationToQuestion} · 证据 {t.evidenceLevel}
      </div>
      {t.worthReading && <div style={{ marginTop: "0.2rem" }}>{t.worthReading}</div>}
      {t.roleEvidence?.length > 0 && (
        <div className="mono-label" style={{ color: "var(--muted-foreground)", fontSize: "0.72rem", marginTop: "0.15rem" }}>
          依据: {t.roleEvidence.map((e: any) => (e.detail || e.source || "")).filter(Boolean).join("；")}
        </div>
      )}
    </div>
  );
}

function groupTriage(triage: any[]) {
  const read: any[] = [], bg: any[] = [], later: any[] = [];
  for (const t of triage) {
    if (t.depth === "deep" || t.depth === "targeted") read.push(t);
    else if (t.role === "survey") bg.push(t);
    else later.push(t);
  }
  return { read, bg, later };
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

