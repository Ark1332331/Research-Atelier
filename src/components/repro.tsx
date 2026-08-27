"use client";

import { useEffect, useState } from "react";
import PageHead from "@/components/page-head";
import EnvironmentsPanel from "@/components/environments-panel";
import SystemPanel from "@/components/system-panel";
import ReproCopilot from "@/components/repro-copilot";
import ReproStageTarget from "@/components/repro-stage-target";
import ReproStageMaterials from "@/components/repro-stage-materials";
import ReproStageAnalyzing from "@/components/repro-stage-analyzing";
import ReproStageDecisions from "@/components/repro-stage-decisions";
import ReproStageReady from "@/components/repro-stage-ready";
import type { GoalIntent, Target, Constraints, Acceptance } from "@/lib/reproduction-spec";

type Stat = "todo" | "doing" | "done";
interface Step { id: string; title: string; status: Stat; note?: string }
interface Pit { id: string; text: string; env: boolean; stage?: string; papers?: string[]; createdAt: string }
interface Analysis {
  status: string;
  summary?: { paperFacts: number; repoFacts: number; mappings: number; gaps: number; blocking: number };
  suggestedTarget?: Target | null;   // ⑤ 证据建议的目标（来自论文结构；null=暂时无法推荐）
  error?: string;
}
interface PaperArtifact { paperId: string; parsedPages: number; paperRevision?: string }
interface RepoArtifact { repoRootId: string; repoPath: string; commit?: string; dirty?: boolean }
interface Repr {
  slug: string; title: string; sourceUrl?: string; repoUrl?: string; note?: string;
  path: Step[]; pitfalls: Pit[]; target?: Target; constraints?: Constraints; acceptance?: Acceptance;
  goalIntent?: GoalIntent; analysis?: Analysis; paperArtifact?: PaperArtifact; repoArtifact?: RepoArtifact; updatedAt?: string;
}
interface Sum { slug: string; title: string; sourceUrl?: string; repoUrl?: string; pathCount: number; doneCount: number; pitfallCount: number }
interface LibPaper { id: string; title: string; slug?: string | null; status?: string; group?: string | null }

type Stage = "materials" | "target" | "analyzing" | "decisions" | "ready";

interface GapSummary { needDecision: number; needScan: number }

/** 阶段推导：依赖 effective gaps + target 确认（①）。decisions 必须可达。 */
function stageOf(rec: Repr | null, gaps?: GapSummary): Stage {
  if (!rec) return "materials";
  // Binding Gate：论文+仓库未绑定 → 材料未齐，绝不进分析/决策
  if (!rec.paperArtifact || !rec.paperArtifact.parsedPages || !rec.repoArtifact) return "materials";
  if (!rec.goalIntent) return "target";
  if (rec.analysis?.status !== "done") return "analyzing";
  // analysis done：
  //  - 有可决策问题 → decisions
  //  - goalIntent=unknown 且 target 未确认 → decisions（内含"系统建议目标→确认"）
  //  - 否则 → ready
  if (gaps && gaps.needDecision > 0) return "decisions";
  if (rec.goalIntent === "unknown" && !rec.target) return "decisions";
  return "ready";
}

export default function Repro() {
  const [list, setList] = useState<Sum[]>([]);
  const [slug, setSlug] = useState<string | null>(null);
  const [rec, setRec] = useState<Repr | null>(null);
  const [addTitle, setAddTitle] = useState("");
  const [libPapers, setLibPapers] = useState<LibPaper[]>([]);
  const [libPick, setLibPick] = useState("");
  const [prompt, setPrompt] = useState("");
  const [reviewLink, setReviewLink] = useState("");
  const [reviewNote, setReviewNote] = useState("");
  const [pitText, setPitText] = useState("");
  const [busy, setBusy] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [gapSummary, setGapSummary] = useState<GapSummary | undefined>(undefined);

  const act = async (body: Record<string, unknown>) => {
    await fetch("/api/reproduction", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  };
  const refreshList = async () => { const d = await (await fetch("/api/reproduction")).json(); setList(d.records ?? []); };
  const reopen = async (s: string) => { const d = await (await fetch(`/api/reproduction?slug=${encodeURIComponent(s)}`)).json(); setRec(d.record ?? null); };
  /** analysis done 后拉一次 effective gaps 摘要（决策阶段必须可达；②） */
  const refreshGaps = async (s: string) => {
    try {
      const d = await (await fetch("/api/reproduction/gaps", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ slug: s, action: "detect" }) })).json();
      const eff = (d.effectiveGaps ?? []) as { type: string }[];
      setGapSummary({
        needDecision: eff.filter((g) => ["value_conflict", "source_conflict", "not_found", "uncomparable"].includes(g.type)).length,
        needScan: eff.filter((g) => g.type === "not_scanned").length,
      });
    } catch { /* */ }
  };

  useEffect(() => {
    void refreshList();
    void (async () => {
      try {
        const d = await (await fetch("/api/library")).json();
        setLibPapers((d.papers ?? []).filter((p: LibPaper) => p.title));
      } catch { /* */ }
    })();
  }, []);

  async function create() {
    const t = addTitle.trim();
    if (!t) return;
    const s = "r-" + Date.now().toString(36);
    await act({ action: "create", slug: s, title: t });
    setAddTitle("");
    await refreshList();
    setSlug(s);
    await reopen(s);
  }
  async function createFromLibrary(paperId: string) {
    const p = libPapers.find((x) => x.id === paperId);
    if (!p) return;
    const s = "r-" + Date.now().toString(36);
    await act({ action: "create", slug: s, title: p.title });
    if (p.slug) await act({ action: "setSource", slug: s, sourceUrl: `/read/${p.slug}` });
    setLibPick("");
    await refreshList();
    setSlug(s);
    await reopen(s);
  }
  async function open(s: string) { setSlug(s); await reopen(s); setPrompt(""); setReviewNote(""); setShowAdvanced(false); await refreshGaps(s); }

  // —— 阶段①：目标（只存 goalIntent，不写假 Target）——
  const saveGoal = async (g: GoalIntent) => {
    if (!slug) return;
    await act({ action: "setGoalIntent", slug, goalIntent: g });
    await reopen(slug);
  };
  // —— 阶段②：分析（服务端 orchestrator）——
  const runAnalyze = async () => {
    if (!slug) return;
    try {
      await fetch("/api/reproduction/analyze", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ slug }) });
      await reopen(slug);
      await refreshGaps(slug);
    } catch { /* */ }
  };
  // 决策完成 / 分析完成 → 刷新 gaps 后由 stageOf 推导下一阶段
  const decisionsDone = async () => {
    await reopen(slug ?? "");
    if (slug) await refreshGaps(slug);
  };
  // ⑦ 诚实命名：没有 targeted/expanded scan，只有重新跑一轮分析
  const rescan = async () => { await runAnalyze(); };
  // Binding Gate：绑定论文与仓库
  const bindArtifacts = async (paperId: string, repoRootId: string, repoPath: string) => {
    if (!slug) return;
    await act({ action: "bindArtifacts", slug, paperId, repoRootId, repoPath });
    await reopen(slug);
  };
  // ⑤ unknown goal：**不硬编码 Target**；由分析结果给出证据建议，无法确定则明确"暂时无法推荐"
  const confirmTarget = async (accept: boolean) => {
    if (!slug) return;
    if (accept && rec?.analysis?.suggestedTarget) {
      await act({ action: "setTarget", slug, target: rec.analysis.suggestedTarget });
    }
    await reopen(slug);
    if (slug) await refreshGaps(slug);
  };

  // —— 旧功能（移入折叠区）——
  async function genPrompt(stepId?: string) {
    if (!slug) return;
    const d = await (await fetch("/api/reproduction/prompt", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ slug, stepId }) })).json();
    setPrompt(d.prompt ?? "");
  }
  async function copyPrompt() { if (prompt) { try { await navigator.clipboard.writeText(prompt); } catch { /* */ } } }
  async function review() {
    if (!slug || (!reviewLink.trim() && !reviewNote.trim())) return;
    setBusy(true);
    try {
      const d = await (await fetch("/api/reproduction/review", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ slug, link: reviewLink.trim() || undefined, text: reviewNote.trim() || undefined }) })).json();
      setReviewNote(d.error ? `已提炼：${d.error}` : `已提炼并归档 ${d.count ?? 0} 个坑点（环境类已标记）`);
      await reopen(slug);
      await refreshList();
    } catch { setReviewNote("提炼失败"); }
    setBusy(false);
  }
  async function addStep(title: string) { if (!slug || !title.trim()) return; await act({ action: "addStep", slug, title: title.trim() }); await reopen(slug); }
  const writeStepsFromCopilot = async (steps: { title: string; note?: string; status: "todo" | "done" | "doing" }[]) => {
    if (!slug) return;
    for (const s of steps) await act({ action: "addStep", slug, title: s.title, status: s.status, note: s.note });
    await reopen(slug);
  };
  async function setStepStatus(id: string, status: Stat) { if (!slug) return; await act({ action: "setStepStatus", slug, id, status }); await reopen(slug); }
  async function delStep(id: string) { if (!slug) return; await act({ action: "deleteStep", slug, id }); await reopen(slug); }
  async function setField(field: "sourceUrl" | "repoUrl", value: string) { if (!slug) return; await act({ action: field === "sourceUrl" ? "setSource" : "setRepo", slug, [field]: value }); await reopen(slug); }
  async function addPitfall() { if (!slug || !pitText.trim()) return; await act({ action: "addPitfall", slug, text: pitText.trim(), env: false }); setPitText(""); await reopen(slug); await refreshList(); }
  async function delPitfall(id: string) { if (!slug) return; await act({ action: "deletePitfall", slug, id }); await reopen(slug); await refreshList(); }
  async function delRecord() { if (!slug) return; if (!confirm("删除这篇复现记录？")) return; await act({ action: "delete", slug }); setSlug(null); setRec(null); await refreshList(); }

  const stage: Stage = stageOf(rec, gapSummary);

  return (
    <section>
      <PageHead num="05" name="复现" title="复现编译台" desc="选论文 → 系统分析 → 只决定关键问题 → 拿到复现准备摘要。" meta="Paper → Reproduction Spec → Codex 前置编译" />

      <div className="repro-layout">
        {/* 左：复现列表 */}
        <div className="repro-list">
          <div className="repro-list-head">
            <span className="mono-label">复现中的论文</span>
            <button className="btn btn--ghost btn--quiet" onClick={() => void refreshList()}>刷新</button>
          </div>
          <div className="repro-add">
            <input className="field field--mini" placeholder="输入要复现的论文标题，回车添加" value={addTitle} onChange={(e) => setAddTitle(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void create(); }} />
            <button className="btn btn--ghost btn--quiet" onClick={() => void create()}>添加</button>
          </div>
          {libPapers.length > 0 && (
            <div className="repro-add">
              <select className="field field--mini" value={libPick} onChange={(e) => { if (e.target.value) void createFromLibrary(e.target.value); }} style={{ flex: 1 }}>
                <option value="">从论文库选一篇加入复现…</option>
                {libPapers.map((p) => (
                  <option key={p.id} value={p.id}>{p.title}{p.status ? `（${p.status}）` : ""}</option>
                ))}
              </select>
            </div>
          )}
          {list.length === 0 && <p className="mono-label" style={{ padding: "0.8rem", opacity: 0.7 }}>还没有复现记录——从论文库挑一篇，或直接输入标题新建。</p>}
          {list.map((r) => (
            <button key={r.slug} className={`repro-row${slug === r.slug ? " is-active" : ""}`} onClick={() => void open(r.slug)}>
              <span className="repro-row-title">{r.title}</span>
              <span className="repro-row-meta">{r.pathCount ? `${r.doneCount}/${r.pathCount} 步` : "未定路径"} · {r.pitfallCount} 坑</span>
            </button>
          ))}
        </div>

        {/* 中：单篇阶段主面板 */}
        <div className="repro-main">
          {!rec ? (
            <p className="mono-label" style={{ padding: "2rem 0", textAlign: "center", opacity: 0.7 }}>在左侧选择一篇复现论文，开始工作。</p>
          ) : (
            <>
              {/* 阶段条 */}
              <div className="repro-stepper">
                {(["materials", "target", "analyzing", "decisions", "ready"] as Stage[]).map((s, i) => (
                  <div key={s} className={`repro-step-item${stage === s ? " is-active" : ""}${["materials", "target", "analyzing", "decisions"].includes(stage) && ["materials", "target", "analyzing", "decisions"].indexOf(s) < ["materials", "target", "analyzing", "decisions"].indexOf(stage) ? " is-done" : ""}`}>
                    <span className="repro-step-num">{i + 1}</span>
                    <span className="repro-step-name">{{ materials: "材料", target: "目标", analyzing: "分析", decisions: "决策", ready: "摘要" }[s]}</span>
                  </div>
                ))}
              </div>

              {/* 阶段主面板 */}
              {stage === "materials" && (
                <ReproStageMaterials
                  paperArtifact={rec.paperArtifact}
                  repoArtifact={rec.repoArtifact}
                  onBind={bindArtifacts}
                />
              )}
              {stage === "target" && (
                <ReproStageTarget goalIntent={rec.goalIntent} onSave={saveGoal} />
              )}
              {stage === "analyzing" && (
                <ReproStageAnalyzing
                  title={rec.title}
                  goalIntent={rec.goalIntent}
                  analysis={rec.analysis}
                  hasTarget={Boolean(rec.target)}
                  onAnalyze={runAnalyze}
                  onConfirmTarget={confirmTarget}
                  onProceed={() => void decisionsDone()}
                />
              )}
              {stage === "decisions" && slug && (
                <ReproStageDecisions slug={slug} onDone={() => void decisionsDone()} onRescan={() => void rescan()} />
              )}
              {stage === "ready" && (
                <>
                  <ReproStageReady title={rec.title} analysis={rec.analysis} goalIntent={rec.goalIntent} />
                  <div style={{ marginTop: "0.8rem" }}>
                    <button className="btn btn--ghost btn--quiet" onClick={() => void decisionsDone()}>重新检查待处理问题 →</button>
                  </div>
                </>
              )}

              {/* 折叠区：执行记录与高级工具 */}
              <div className="repro-advanced">
                <button className="btn btn--ghost btn--quiet repro-advanced-toggle" onClick={() => setShowAdvanced(!showAdvanced)}>
                  {showAdvanced ? "收起执行记录与高级工具" : "展开执行记录与高级工具（复盘 / 坑点 / 商定 / 路径 / 环境）"}
                </button>
                {showAdvanced && (
                  <div className="repro-advanced-body">
                    <div className="repro-paper">
                      <div className="repro-sec-head"><span className="mono-label">论文 / 仓库链接</span></div>
                      <div className="repro-fields">
                        <label className="mono-label">源码/论文来源 <input className="field field--mini" defaultValue={rec.sourceUrl} onBlur={(e) => void setField("sourceUrl", e.target.value)} placeholder="https://..." /></label>
                        <label className="mono-label">代码/仓库地址 <input className="field field--mini" defaultValue={rec.repoUrl} onBlur={(e) => void setField("repoUrl", e.target.value)} placeholder="github.com/..." /></label>
                      </div>
                    </div>

                    <div className="repro-path">
                      <div className="repro-sec-head">
                        <span className="mono-label">复现路径（历史分层：R1–R6 模板，非从本论文抽取；执行任务将由系统生成）</span>
                      </div>
                      <ul>
                        {rec.path.map((s) => (
                          <li key={s.id} className={`repro-step repro-step--${s.status}`}>
                            <select className="field field--mini" value={s.status} onChange={(e) => void setStepStatus(s.id, e.target.value as Stat)}>
                              <option value="todo">待办</option><option value="doing">进行中</option><option value="done">已完成</option>
                            </select>
                            <span className="repro-step-title">{s.title}</span>
                            {s.note && <span className="mono-label" style={{ opacity: 0.7 }}>{s.note}</span>}
                            <button className="btn btn--ghost btn--quiet" onClick={() => void genPrompt(s.id)}>per步提示词</button>
                            <button className="btn btn--ghost btn--quiet" onClick={() => void delStep(s.id)}>×</button>
                          </li>
                        ))}
                      </ul>
                      <AddStepLine onAdd={addStep} />
                      <button className="btn btn--ghost btn--quiet" onClick={() => void genPrompt()}>生成整篇提示词</button>
                      {prompt && (
                        <div className="repro-prompt">
                          <div style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}>
                            <button className="btn btn--primary btn--sm" onClick={() => void copyPrompt()}>复制整篇提示词</button>
                            <span className="mono-label">粘贴给 GPT / Codex</span>
                          </div>
                          <pre>{prompt}</pre>
                        </div>
                      )}
                    </div>

                    {slug && <ReproCopilot slug={slug} writeSteps={writeStepsFromCopilot} />}

                    <div className="repro-review">
                      <div className="repro-sec-head"><span className="mono-label">实验复盘（读本机 Codex/DSH 对话 → 提炼坑点）</span></div>
                      <div className="repro-review-input">
                        <input className="field field--mini" placeholder="codex://threads/<id>（读本机记录）" value={reviewLink} onChange={(e) => setReviewLink(e.target.value)} />
                        <textarea className="field" rows={3} placeholder="或直接粘贴对话/日志文本" value={reviewNote} onChange={(e) => setReviewNote(e.target.value)} />
                        <button className="btn btn--primary btn--sm" disabled={busy} onClick={() => void review()}>{busy ? "提炼中…" : "提炼并归档坑点"}</button>
                      </div>
                    </div>

                    <div className="repro-pitfalls">
                      <div className="repro-sec-head"><span className="mono-label">坑点（{rec.pitfalls.length} · 环境类已标）</span></div>
                      <ul>
                        {rec.pitfalls.map((p) => (
                          <li key={p.id} className="repro-pitfall">
                            <span className="chip chip--dark">{p.env ? "环境" : "复现"}{p.stage ? ` · ${p.stage}` : ""}</span>
                            <span>{p.text}</span>
                            <button className="btn btn--ghost btn--quiet" onClick={() => void delPitfall(p.id)}>×</button>
                          </li>
                        ))}
                      </ul>
                      <div style={{ display: "flex", gap: "0.4rem", marginTop: "0.4rem" }}>
                        <input className="field field--mini" placeholder="手动记一个坑点" value={pitText} onChange={(e) => setPitText(e.target.value)} />
                        <button className="btn btn--ghost btn--quiet" onClick={() => void addPitfall()}>记</button>
                      </div>
                    </div>

                    <button className="btn btn--ghost btn--quiet" style={{ marginTop: "1rem", color: "var(--muted-foreground)" }} onClick={() => void delRecord()}>删除这篇复现记录</button>
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        {/* 右：环境（折叠进高级工具后不再常驻；保留卡片供详情） */}
        <div className="repro-right">
          <SystemPanel />
          <EnvironmentsPanel />
        </div>
      </div>
    </section>
  );
}

/** 快速加一步复现路径 */
function AddStepLine({ onAdd }: { onAdd: (t: string) => void }) {
  const [t, setT] = useState("");
  return (
    <div style={{ display: "flex", gap: "0.4rem", marginTop: "0.5rem" }}>
      <input className="field field--mini" placeholder="加一步…" value={t} onChange={(e) => setT(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { onAdd(t); setT(""); } }} />
      <button className="btn btn--ghost btn--quiet" onClick={() => { onAdd(t); setT(""); }}>+ 步骤</button>
    </div>
  );
}
