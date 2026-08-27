"use client";

import { useEffect, useState } from "react";

/**
 * v1.6 Candidate Screening 重定义：
 *  - 显式 Candidate Rows：一行一篇（用户控制边界，系统不猜）；＋ 添加一篇论文
 *  - 批量粘贴 = 次级入口：先 preview「识别到 N 篇」→ 用户确认后才导入
 *  - 先 Resolution 后 Screening：resolved 才进 candidates；ambiguous 让用户选；unresolved 明确标记
 *  - 证据门控：gate ≥ abstract 才可初筛；title-only/metadata 只显示「可能相关」
 *  - AI 只出 recommendation；用户最终 Keep/Maybe/Exclude
 *  - term calibration 证据门槛（≥8 篇有摘要才 ready）
 */
const GATE_LABEL: Record<string, string> = {
  "title-only": "仅标题",
  metadata: "元数据",
  abstract: "有摘要",
  fulltext: "全文",
};

export default function CandidateWorkbench({ session, onSession }: { session: any; onSession: (s: any) => void }) {
  const [rows, setRows] = useState<{ inputId: string; raw: string; busy?: boolean; resolution?: any }[]>([{ inputId: "r" + Date.now().toString(36), raw: "" }]);
  const [batchRaw, setBatchRaw] = useState("");
  const [preview, setPreview] = useState<any>(null);
  const [seedSel, setSeedSel] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const candidates: any[] = session?.candidates ?? [];
  const pending: any[] = session?.pending ?? [];
  const screening: any[] = session?.screening ?? [];
  const calibration = session?.termCalibration;
  const withAbstract = candidates.filter((c: any) => c.abstract && c.abstract.trim()).length;

  async function post(path: string, body: any): Promise<any> {
    setBusy(true); setError("");
    try {
      const res = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const d = await res.json();
      if (!res.ok) { setError(d.error ?? "失败"); return null; }
      return d;
    } finally { setBusy(false); }
  }

  function sync(d: any) {
    if (d?.session) { onSession(d.session); }
    return d;
  }

  async function resolveRow(idx: number) {
    const row = rows[idx];
    if (!row.raw.trim()) return;
    setRows((rs) => rs.map((r, i) => (i === idx ? { ...r, busy: true } : r)));
    const d = await post("/api/literature/resolve", {
      sessionId: session.id,
      input: { raw: row.raw, importId: row.inputId },
    });
    setRows((rs) => rs.map((r, i) => (i === idx ? { ...r, busy: false, resolution: d?.resolution, raw: row.raw } : r)));
    if (d) sync(d);
  }

  function addRow() {
    setRows((rs) => [...rs, { inputId: "r" + Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36), raw: "" }]);
  }

  async function runPreview() {
    if (!batchRaw.trim()) return;
    const d = await post("/api/literature/preview", { raw: batchRaw });
    if (d) setPreview(d);
  }

  async function confirmBatch() {
    if (!preview?.items?.length) return;
    const d = await post("/api/literature/import", { sessionId: session.id, items: preview.items });
    if (d) { sync(d); setPreview(null); setBatchRaw(""); }
  }

  async function runScreen() {
    const d = await post("/api/literature/screen", { sessionId: session.id });
    if (d) sync(d);
  }

  async function decide(canonicalId: string, decision: string) {
    const d = await post("/api/literature/action", { sessionId: session.id, action: "set-decision", canonicalId, decision });
    if (d) sync(d);
  }

  async function chooseIdentity(inputId: string, choiceIndex: number) {
    const d = await post("/api/literature/action", { sessionId: session.id, action: "choose-identity", inputId, choiceIndex });
    if (d) sync(d);
  }

  async function dropPending(inputId: string) {
    const d = await post("/api/literature/action", { sessionId: session.id, action: "drop-pending", inputId });
    if (d) sync(d);
  }

  async function saveSeeds() {
    if (seedSel.length === 0) return;
    const d = await post("/api/literature/action", { sessionId: session.id, action: "select-seeds", seedPaperIds: seedSel });
    if (d) sync(d);
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
      {error && <div style={{ color: "#c0392b", fontSize: "0.8rem" }}>{error}</div>}

      {/* 显式 Candidate Rows */}
      <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
        <p className="mono-label" style={{ color: "var(--muted-foreground)" }}>添加论文（一行一篇，可粘贴 标题 / DOI / arXiv / URL）</p>
        {rows.map((row, idx) => (
          <div key={row.inputId} style={{ display: "flex", gap: "0.4rem", alignItems: "flex-start" }}>
            <input
              className="field"
              style={{ flex: 1, padding: "0.45rem 0.6rem", fontSize: "0.82rem" }}
              placeholder={"第 " + (idx + 1) + " 篇：如 DreamerV3: Mastering Diverse Domains… 或 10.48550/arXiv.2301.04104 或 https://arxiv.org/abs/2301.04104"}
              value={row.raw}
              onChange={(ev) => setRows((rs) => rs.map((r, i) => (i === idx ? { ...r, raw: ev.target.value } : r)))}
            />
            <button className="btn btn--ghost" disabled={busy || !row.raw.trim() || row.busy} onClick={() => void resolveRow(idx)}>
              {row.busy ? "解析中…" : "解析"}
            </button>
          </div>
        ))}
        <button className="btn btn--ghost" style={{ alignSelf: "flex-start" }} onClick={addRow}>＋ 添加一篇论文</button>
      </div>

      {/* 批量粘贴（次级入口：先预览 N 篇 → 确认） */}
      <details style={{ fontSize: "0.82rem" }}>
        <summary className="mono-label" style={{ cursor: "pointer", color: "var(--muted-foreground)" }}>批量粘贴（次级入口：先预览，确认后导入）</summary>
        <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem", marginTop: "0.5rem" }}>
          <textarea className="field prompt-textarea" rows={6} placeholder={"粘贴一批（标题/DOI/URL/BibTeX/RIS…）"} value={batchRaw} onChange={(ev) => setBatchRaw(ev.target.value)} />
          <div style={{ display: "flex", gap: "0.4rem" }}>
            <button className="btn btn--ghost" disabled={busy || !batchRaw.trim()} onClick={() => void runPreview()}>预览识别</button>
            {preview && (
              <button className="btn btn--primary" disabled={busy || !preview.items?.length} onClick={() => void confirmBatch()}>
                确认导入这 {preview.recognized ?? 0} 篇
              </button>
            )}
          </div>
          {preview && (
            <div style={{ fontSize: "0.8rem", color: "var(--muted-foreground)" }}>
              识别到 {preview.recognized} 篇{preview.unparsed?.length > 0 && <span style={{ color: "#c0392b" }}>（{preview.unparsed.length} 条无法识别，导入后会进入待处理）</span>}：
              {preview.items.map((it: any, i: number) => (
                <p key={i} style={{ margin: "0.15rem 0" }}>· [{it.detectedType}] {it.title ?? it.doi ?? it.arxivId ?? it.url ?? it.raw.slice(0, 50)}</p>
              ))}
            </div>
          )}
        </div>
      </details>

      {/* Pending：ambiguous 待选 / unresolved 待标 */}
      {pending.length > 0 && (
        <div style={{ fontSize: "0.82rem", border: "1px solid var(--border)", borderRadius: 6, padding: "0.6rem 0.8rem" }}>
          <p className="mono-label" style={{ margin: 0, color: "var(--muted-foreground)" }}>待处理行（{pending.length}）——不进入候选，需你确认</p>
          {pending.map((p: any, i: number) => (
            <div key={i} style={{ marginTop: "0.4rem", borderTop: "1px solid var(--border)", paddingTop: "0.4rem" }}>
              <div>{p.input.raw.slice(0, 120)}</div>
              {p.resolution.status === "ambiguous" ? (
                <div>
                  <div style={{ color: "#c0392b", fontSize: "0.75rem" }}>存在 {p.resolution.choices?.length ?? 0} 篇同名候选，请选择真实身份：</div>
                  {(p.resolution.choices ?? []).map((c: any, ci: number) => (
                    <button key={ci} className="btn btn--ghost" style={{ margin: "0.2rem 0.2rem 0 0" }} onClick={() => void chooseIdentity(p.input.importId, ci)}>
                      {c.title} {c.year ? "(" + c.year + ")" : ""}
                    </button>
                  ))}
                </div>
              ) : (
                <div>
                  <div style={{ color: "#c0392b", fontSize: "0.75rem" }}>未解析：{(p.resolution.warnings ?? []).join("；")}</div>
                  <button className="btn btn--quiet" style={{ marginTop: "0.2rem" }} onClick={() => void dropPending(p.input.importId)}>这不是论文，移除</button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* 候选列表：证据门控徽标 */}
      {candidates.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
          <p className="mono-label" style={{ color: "var(--muted-foreground)" }}>
            候选 {candidates.length} 篇 · 具备摘要 {withAbstract} / {candidates.length} {withAbstract > 0 ? "（可开始初筛）" : "（不足，无法初筛）"}
          </p>
          {candidates.map((c: any) => (
            <div key={c.canonicalId} style={{ padding: "0.5rem 0.7rem", border: "1px solid var(--border)", borderRadius: 6, fontSize: "0.8rem" }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: "0.5rem" }}>
                <strong>{c.title}</strong>
                <span className="mono-label" style={{ whiteSpace: "nowrap" }}>
                  [{GATE_LABEL[gateOf(c)] ?? "?"}]
                  {c.resolution?.matchConfidence ? " · 解析 " + c.resolution.matchConfidence : ""}
                </span>
              </div>
              <div className="mono-label" style={{ color: "var(--muted-foreground)", marginTop: "0.2rem" }}>
                {c.year || "年?"} · {c.venue || "venue?"}
                {c.authors?.length ? " · " + c.authors.slice(0, 3).join(", ") : ""}
                {c.doi ? " · " + c.doi : ""}
              </div>
              {c.abstract ? (
                <div style={{ marginTop: "0.2rem", color: "var(--muted-foreground)" }}>{c.abstract.slice(0, 220)}{c.abstract.length > 220 ? "…" : ""}</div>
              ) : (
                <div style={{ marginTop: "0.2rem", color: "#c0392b", fontSize: "0.75rem" }}>无摘要：仅可「可能相关」，不能进入正式筛选结论</div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* 初筛入口（证据门控） */}
      {candidates.length > 0 && withAbstract > 0 && (
        <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
          <button className="btn btn--accent" disabled={busy} onClick={() => void runScreen()}>
            {busy ? "筛选中…" : "开始初筛（" + withAbstract + "/" + candidates.length + " 篇有摘要）"}
          </button>
        </div>
      )}

      {/* 筛选结果：evidence boundary + AI recommendation + 用户决策 */}
      {screening.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
          <p className="mono-label" style={{ color: "var(--muted-foreground)" }}>筛选结果（AI 只做建议；你决定 Keep / Maybe / Exclude）</p>
          {screening.map((r: any) => {
            const c = candidates.find((x: any) => x.canonicalId === r.canonicalId);
            if (!c) return null;
            return (
              <div key={r.canonicalId} style={{ padding: "0.5rem 0.7rem", border: "1px solid var(--border)", borderRadius: 6, fontSize: "0.8rem" }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: "0.4rem" }}>
                  <strong>{c.title}</strong>
                  <span className="mono-label">{r.screenable ? "已初筛" : "未初筛"}</span>
                </div>
                {r.screenable && r.ai ? (
                  <>
                    <div className="mono-label" style={{ color: "var(--muted-foreground)", marginTop: "0.15rem" }}>
                      依据：{r.ai.evidenceLevel}（{r.ai.role} · 阅读 {r.ai.depth} · 与问题 {r.ai.relationToQuestion}）
                    </div>
                    {r.ai.worthReading && <div style={{ marginTop: "0.2rem" }}>{r.ai.worthReading}</div>}
                    {r.ai.keySections?.length > 0 && (
                      <div className="mono-label" style={{ color: "var(--muted-foreground)", marginTop: "0.15rem" }}>重点看：{r.ai.keySections.join("、")}</div>
                    )}
                  </>
                ) : (
                  <div style={{ marginTop: "0.2rem", color: "#c0392b", fontSize: "0.75rem" }}>{r.reason ?? "需要摘要才能初筛"}</div>
                )}
                <div style={{ marginTop: "0.4rem", display: "flex", gap: "0.3rem" }}>
                  {(["keep", "maybe", "exclude"] as const).map((d) => (
                    <button key={d} className={"btn " + (r.userDecision === d ? "btn--primary" : "btn--quiet")} onClick={() => void decide(r.canonicalId, d)}>
                      {d === "keep" ? "Keep 纳入" : d === "maybe" ? "Maybe" : "Exclude"}
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* 筛选完成后：选种子（≤3） */}
      {screening.length > 0 && candidates.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
          <p className="mono-label" style={{ color: "var(--muted-foreground)" }}>筛选完成 → 选出种子论文（≤3，供下一步展开）</p>
          {candidates.map((c: any) => (
            <label key={c.canonicalId} style={{ fontSize: "0.8rem", display: "flex", gap: "0.4rem", alignItems: "center" }}>
              <input type="checkbox" checked={seedSel.includes(c.canonicalId)} onChange={(ev) => setSeedSel((s) => ev.target.checked ? [...s, c.canonicalId].slice(0, 3) : s.filter((x) => x !== c.canonicalId))} />
              {c.title}
            </label>
          ))}
          <button className="btn btn--ghost" style={{ alignSelf: "flex-start" }} disabled={busy || seedSel.length === 0} onClick={() => void saveSeeds()}>
            保存种子（{seedSel.length}/3）
          </button>
        </div>
      )}

      {/* term calibration：证据门槛 */}
      {calibration && (
        <div style={{ fontSize: "0.82rem", border: "1px dashed var(--border)", borderRadius: 6, padding: "0.6rem 0.8rem" }}>
          {calibration.status === "insufficient" ? (
            <p className="mono-label" style={{ margin: 0, color: "var(--muted-foreground)" }}>术语校准：{calibration.reason ?? "证据不足，暂不校准"}</p>
          ) : (
            <>
              <p className="mono-label" style={{ margin: 0, color: "var(--muted-foreground)" }}>
                术语校准（基于本轮 {calibration.basedOn} 篇有摘要候选，仅建议，不改研究目标）
              </p>
              {calibration.termsConfirmed?.length > 0 && <p style={{ margin: "0.3rem 0 0" }}>confirmed：{calibration.termsConfirmed.map((t: any) => t.term).join("、")}</p>}
              {calibration.termsSuggested?.length > 0 && <p style={{ margin: "0.2rem 0 0", color: "var(--muted-foreground)" }}>suggested：{calibration.termsSuggested.map((t: any) => t.term).join("、")}</p>}
              {calibration.termsWeakOrRare?.length > 0 && (
                <p style={{ margin: "0.2rem 0 0", color: "#c0392b" }}>weakOrRare（建议下一轮换词）：{calibration.termsWeakOrRare.map((t: any) => t.term).join("、")}</p>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function gateOf(c: any): string {
  if (c.abstract && c.abstract.trim()) return "abstract";
  if (c.year !== undefined || c.venue || (c.authors?.length ?? 0) > 0 || c.doi || c.arxivId) return "metadata";
  return "title-only";
}

