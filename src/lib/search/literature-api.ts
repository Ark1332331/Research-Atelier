/**
 * Literature Discovery API 处理器（Phase A + B-lite + v1.6 Candidate Screening 重定义）。
 * 路由：/plan /action /session /import /resolve /screen /preview
 * v1.6：
 *  - 显式 Candidate Rows：一行一篇（handleResolve 逐行解析；批量粘贴经 /preview → 确认后按 items 导入）
 *  - 先 Resolution 后 Screening：resolved 才进 candidates；ambiguous/unresolved 进 pending 等待用户
 *  - 证据门控：gate ≥ abstract 才可初筛；title-only/metadata 只能「可能相关」
 *  - AI screening 消费 session.question + conceptMap + abstract；只出 recommendation；用户 Keep/Maybe/Exclude
 *  - term calibration 证据门槛（≥8 篇有摘要才 ready）
 */
import { plannerIntent, conceptMapper } from "./planner.ts";
import { planFromIntent, deriveNextStep } from "./plan.ts";
import { buildLadderFromMap, intentForTier, calibrateTerms } from "./terms.ts";
import { createSession, withPlan, transitionStage, recordDatabaseAction, withImport, recordEvent } from "./session.ts";
import { loadSession, saveSession } from "./session-storage.ts";
import { parseCandidateBlob } from "./importer.ts";
import { dedupeCandidates } from "./inbox.ts";
import { enrichAll } from "./enrich.ts";
import { runTriage } from "./triage.ts";
import { resolveCandidate, mergeResolvedInto, gateForCandidate } from "./resolve.ts";
import type { ResearchSession, CandidateInput, PendingRow, ScreeningRecord, UserDecision } from "./types.ts";

/* ---------------- helpers ---------------- */

/** 一行一篇：row raw → parse → 取第一篇（多篇则警告）。返回空数组 = 无法识别。 */
function parseRowInput(o: Record<string, unknown>): CandidateInput[] {
  const raw = String(o.raw ?? "");
  const items = parseCandidateBlob(raw);
  if (items.length === 0) return [];
  const first = items[0];
  const warnings = [...(first.parseWarnings ?? [])];
  if (items.length > 1) warnings.push("该行识别出多篇，只取第一篇（请一行一篇）");
  const input: CandidateInput = {
    importId: String(o.importId ?? first.importId),
    raw,
    detectedType: first.detectedType,
    ...(first.title ? { title: first.title } : {}),
    ...(first.doi ? { doi: first.doi } : {}),
    ...(first.arxivId ? { arxivId: first.arxivId } : {}),
    ...(first.url ? { url: first.url } : {}),
    parseWarnings: warnings,
  };
  return [input];
}

/** 证据变化后统一收尾：清 stale screening/triage/seeds + 重算校准（含门槛）+ 记录事件 */
function afterEvidenceChange(s: ResearchSession): ResearchSession {
  let out: ResearchSession = { ...s, triage: [], screening: [], seedPapers: [], updatedAt: new Date().toISOString() };
  const map = out.plan?.conceptMap;
  if (map && (out.candidates ?? []).length > 0) {
    out.termCalibration = calibrateTerms(out.candidates, map);
    const cal = out.termCalibration;
    out = recordEvent(out, "calibration", {
      status: cal.status,
      confirmed: cal.termsConfirmed.map((t) => t.term),
      suggested: cal.termsSuggested.map((t) => t.term),
      weakOrRare: cal.termsWeakOrRare.map((t) => t.term),
    });
  } else {
    out.termCalibration = undefined;
  }
  return out;
}

/* ---------------- plan / action / session（保持） ---------------- */

export async function handlePlan(body: Record<string, unknown>): Promise<Response> {
  const question = String(body.question ?? "").trim();
  if (!question) return Response.json({ error: "研究问题不能为空" }, { status: 400 });
  let session = body.sessionId ? await loadSession(String(body.sessionId)) : null;
  if (!session) session = createSession(question);
  try {
    // v1.4：RA_PLANNER_MOCK 走旧快捷路径；否则 用户问题 → 术语映射 → Query Ladder → 活跃层 intent → plan。
    let intent;
    let plan;
    if (process.env.RA_PLANNER_MOCK) {
      intent = await plannerIntent(question);
      plan = planFromIntent(intent);
    } else {
      const map = await conceptMapper(question);
      const ladder = buildLadderFromMap(map);
      intent = intentForTier(map, ladder.activeTier);
      plan = planFromIntent(intent, undefined, { conceptMap: map, ladder });
    }
    session = withPlan(session, intent, plan);
    const ladder = plan.ladder;
    session = recordEvent(session, "plan-generated", {
      tier: ladder ? ladder.activeTier + 1 : 1,
      tierLabel: ladder?.tiers[ladder.activeTier]?.label ?? "single",
      totalTiers: ladder?.tiers.length ?? 1,
      primaryDb: plan.databases.find((d) => d.recommendedNow)?.id ?? "",
    });
    await saveSession(session);
    return Response.json({ session, nextStep: deriveNextStep(session) });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const hint = msg.includes("DEEPSEEK_API_KEY")
      ? "DEEPSEEK_API_KEY 未配置：复制 .env.local.example 为 .env.local 并填入你的 key"
      : "检索意图编译失败，请稍后重试（可检查网络/代理）。";
    return Response.json({ error: msg, hint }, { status: 502 });
  }
}

export async function handleAction(body: Record<string, unknown>): Promise<Response> {
  const sessionId = String(body.sessionId ?? "");
  const action = String(body.action ?? "");
  let session = await loadSession(sessionId);
  if (!session) return Response.json({ error: "会话不存在" }, { status: 404 });
  try {
    if (action === "open-external") {
      const primaryId = session.plan?.databases.find((d) => d.recommendedNow)?.id ?? "google-scholar";
      session = transitionStage(session, "external-opened");
      session = recordDatabaseAction(session, { database: primaryId, action: "opened", at: new Date().toISOString() });
      session = recordEvent(session, "external-opened", {
        database: primaryId,
        query: session.plan?.databases.find((d) => d.id === primaryId)?.queries?.[0] ?? "",
      });
    } else if (action === "returned-import") {
      session = transitionStage(session, "awaiting-import");
      session = recordEvent(session, "returned-import");
    } else if (action === "select-seeds") {
      const ids = Array.isArray(body.seedPaperIds) ? body.seedPaperIds.map(String) : [];
      const valid = ids.filter((id) => (session!.candidates ?? []).some((c) => c.canonicalId === id)).slice(0, 3);
      session = { ...session, seedPapers: valid, updatedAt: new Date().toISOString() };
      session = recordEvent(session, "seeds-selected", { ids: valid });
    } else if (action === "advance-tier") {
      const ladder = session.plan?.ladder;
      const map = session.plan?.conceptMap;
      if (!ladder || !map) return Response.json({ error: "当前计划没有检索阶梯" }, { status: 400 });
      if (ladder.activeTier >= ladder.tiers.length - 1) return Response.json({ error: "已在最后一层" }, { status: 400 });
      const from = ladder.activeTier;
      const to = from + 1;
      const nextIntent = intentForTier(map, to);
      const nextPlan = planFromIntent(nextIntent, undefined, { conceptMap: map, ladder: { tiers: ladder.tiers, activeTier: to } });
      session = { ...session, intent: nextIntent, plan: nextPlan, updatedAt: new Date().toISOString() };
      session = recordEvent(session, "tier-advanced", { from: from + 1, to: to + 1, toLabel: ladder.tiers[to]?.label ?? "" });
    } else if (action === "set-decision") {
      // v1.6：AI 只出 recommendation；用户最终 Keep/Maybe/Exclude
      const canonicalId = String(body.canonicalId ?? "");
      const decision = String(body.decision ?? "") as UserDecision;
      if (!["keep", "maybe", "exclude"].includes(decision)) return Response.json({ error: "未知 decision" }, { status: 400 });
      const screening = (session.screening ?? []).map((r) => (r.canonicalId === canonicalId ? { ...r, userDecision: decision } : r));
      session = { ...session, screening, updatedAt: new Date().toISOString() };
    } else if (action === "choose-identity") {
      // v1.6：ambiguous → 用户选择真实身份 → resolve → 进 candidates
      const inputId = String(body.inputId ?? "");
      const choiceIndex = Number(body.choiceIndex ?? 0);
      const row = (session.pending ?? []).find((p) => p.input.importId === inputId);
      if (!row) return Response.json({ error: "该行不在待处理列表" }, { status: 404 });
      const choice = row.resolution.choices?.[choiceIndex];
      if (!choice) return Response.json({ error: "选择越界" }, { status: 400 });
      const input: CandidateInput = {
        importId: row.input.importId, raw: row.input.raw, detectedType: "title",
        title: choice.title, doi: choice.doi, arxivId: choice.arxivId, parseWarnings: [],
      };
      const { resolution, canon } = await resolveCandidate(input);
      let updated = { ...session, pending: (session.pending ?? []).filter((p) => p.input.importId !== inputId) };
      if (resolution.status === "resolved" && canon) {
        const { candidates } = mergeResolvedInto(updated.candidates ?? [], canon);
        updated = { ...updated, candidates };
        updated = recordEvent(updated, "candidate-resolved", { canonicalId: canon.canonicalId, title: canon.title, confidence: resolution.matchConfidence });
      } else {
        updated = { ...updated, pending: [...(updated.pending ?? []), { input, resolution }] };
      }
      session = afterEvidenceChange(updated);
    } else if (action === "drop-pending") {
      const inputId = String(body.inputId ?? "");
      session = { ...session, pending: (session.pending ?? []).filter((p) => p.input.importId !== inputId), updatedAt: new Date().toISOString() };
    } else {
      return Response.json({ error: "未知 action" }, { status: 400 });
    }
    await saveSession(session);
    return Response.json({ session, nextStep: deriveNextStep(session) });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 409 });
  }
}

/* ---------------- v1.6：resolve / preview / import / screen ---------------- */

/** 逐行添加 → bibliographic resolution（一行一篇；用户控制边界） */
export async function handleResolve(body: Record<string, unknown>): Promise<Response> {
  const sessionId = String(body.sessionId ?? "");
  const session = await loadSession(sessionId);
  if (!session) return Response.json({ error: "会话不存在" }, { status: 404 });
  const rows = parseRowInput((body.input ?? {}) as Record<string, unknown>);
  if (rows.length === 0) return Response.json({ error: "这一行无法识别为论文（请粘贴标题/DOI/arXiv/URL）" }, { status: 400 });
  const row = rows[0];
  const { resolution, canon } = await resolveCandidate(row);
  let updated = session;
  if (resolution.status === "resolved" && canon) {
    const { candidates, merged } = mergeResolvedInto(session.candidates ?? [], canon);
    updated = { ...updated, candidates };
    updated = recordEvent(updated, "candidate-resolved", { canonicalId: canon.canonicalId, title: canon.title, confidence: resolution.matchConfidence, merged });
  } else {
    const pendingRow: PendingRow = { input: row, resolution };
    updated = { ...updated, pending: [...(updated.pending ?? []), pendingRow] };
    updated = recordEvent(updated, "candidate-pending", { inputId: row.importId, status: resolution.status });
  }
  updated = afterEvidenceChange(updated);
  await saveSession(updated);
  return Response.json({ session: updated, resolution, ...(canon ? { canon } : {}) });
}

/** 批量粘贴预览（次级入口；不改变状态） */
export async function handlePreview(body: Record<string, unknown>): Promise<Response> {
  const raw = String(body.raw ?? "");
  const items = parseCandidateBlob(raw);
  return Response.json({ recognized: items.length, items, unparsed: items.filter((i) => i.detectedType === "unknown") });
}

/** 导入：items（显式边界，来自批量预览确认）或 legacy raw → 逐行 resolve */
export async function handleImport(body: Record<string, unknown>): Promise<Response> {
  const sessionId = String(body.sessionId ?? "");
  const session = await loadSession(sessionId);
  if (!session) return Response.json({ error: "会话不存在" }, { status: 404 });
  let items: CandidateInput[] = Array.isArray(body.items) ? (body.items as CandidateInput[]) : [];
  let raw = String(body.raw ?? "");
  if (items.length === 0 && raw) {
    // legacy：raw 混贴 → parse（边界由 parse 决定；仅向后兼容，新 UI 不用）
    items = parseCandidateBlob(raw);
  }
  if (items.length === 0) return Response.json({ error: "没有可导入的条目" }, { status: 400 });
  let updated = session;
  let resolvedCount = 0, pendingCount = 0;
  for (const it of items) {
    const { resolution, canon } = await resolveCandidate(it);
    if (resolution.status === "resolved" && canon) {
      const { candidates } = mergeResolvedInto(updated.candidates ?? [], canon);
      updated = { ...updated, candidates };
      resolvedCount++;
    } else {
      updated = { ...updated, pending: [...(updated.pending ?? []), { input: it, resolution }] };
      pendingCount++;
    }
  }
  const stats = { rawItems: items.length, recognized: resolvedCount + pendingCount, unknown: 0, merged: 0, unique: (updated.candidates ?? []).length };
  updated = withImport(updated, stats, raw);
  updated = afterEvidenceChange(updated);
  updated = recordEvent(updated, "batch-imported", { rawItems: stats.rawItems, resolved: resolvedCount, pending: pendingCount, unique: stats.unique });
  await saveSession(updated);
  return Response.json({ session: updated, stats, pendingCount });
}

/** v1.6：AI Title+Abstract Screening —— 只出 recommendation；gate ≥ abstract 才可筛 */
export async function handleScreen(body: Record<string, unknown>): Promise<Response> {
  const sessionId = String(body.sessionId ?? "");
  const session = await loadSession(sessionId);
  if (!session) return Response.json({ error: "会话不存在" }, { status: 404 });
  const candidates = session.candidates ?? [];
  const screenable = candidates.filter((c) => { const g = gateForCandidate(c); return g === "abstract" || g === "fulltext"; });
  if (screenable.length === 0) {
    return Response.json(
      { error: "没有具备摘要的候选（" + candidates.length + " 篇中 0 篇有摘要），无法初筛——请先解析出摘要（DOI/arXiv 或补充标题解析）" },
      { status: 400 },
    );
  }
  const conceptMap = session.plan?.conceptMap;
  const ai = await runTriage(screenable, session.question, conceptMap);
  const aiBy = new Map(ai.map((t) => [t.paperId, t]));
  const screening: ScreeningRecord[] = candidates.map((c) => {
    const gate = gateForCandidate(c);
    const ok = gate === "abstract" || gate === "fulltext";
    return {
      canonicalId: c.canonicalId,
      screenable: ok,
      ...(ok ? { ai: aiBy.get(c.canonicalId) } : { reason: gate === "title-only" ? "仅标题：可能相关，需要摘要才能初筛" : "仅元数据：需要摘要才能初筛" }),
    };
  });
  const updated = { ...session, screening, triage: ai, updatedAt: new Date().toISOString() };
  const saved = recordEvent(updated, "triage-computed", { count: screenable.length, total: candidates.length });
  await saveSession(saved);
  return Response.json({ session: saved, screening, triage: ai });
}

/** 兼容旧 /triage 路由 */
export async function handleTriage(body: Record<string, unknown>): Promise<Response> {
  return handleScreen(body);
}

export async function handleSessionGet(id: string): Promise<Response> {
  if (!id) return Response.json({ error: "缺少 id" }, { status: 400 });
  const session = await loadSession(id);
  if (!session) return Response.json({ error: "会话不存在" }, { status: 404 });
  return Response.json({ session, nextStep: deriveNextStep(session) });
}

