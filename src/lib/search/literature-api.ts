/**
 * Literature Discovery API 处理器（Phase A）——三个真实子路由共享：
 *   /api/literature/plan    POST
 *   /api/literature/action  POST
 *   /api/literature/session GET
 * 存储：data/research-sessions/<id>.json（store 适配器；session 持久化，刷新不丢）
 * LLM 边界：plannerIntent 只产结构化 intent；WoS 串 / GS/arXiv URL 由代码确定性生成。
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

export async function handlePlan(body: Record<string, unknown>): Promise<Response> {
  const question = String(body.question ?? "").trim();
  if (!question) return Response.json({ error: "研究问题不能为空" }, { status: 400 });
  let session = body.sessionId ? await loadSession(String(body.sessionId)) : null;
  if (!session) session = createSession(question);
  try {
    // v1.4：RA_PLANNER_MOCK 走旧快捷路径；否则 用户问题 → 术语映射 → Query Ladder → 活跃层 intent → plan。
    // 非 mock 路径绝不把用户原词直接放进 intent.conceptGroups（A.5 核心约束）。
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
      // v1.5：Query Ladder 下一层（单按钮，非面板）；记录 tier-advanced
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
    } else {
      return Response.json({ error: "未知 action" }, { status: 400 });
    }
    await saveSession(session);
    return Response.json({ session, nextStep: deriveNextStep(session) });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 409 });
  }
}

/** v1.2 B-lite：粘贴导入 → parse → dedupe → enrich → screening。单篇 enrich 失败只记 warnings。 */
export async function handleImport(body: Record<string, unknown>): Promise<Response> {
  const sessionId = String(body.sessionId ?? "");
  const raw = String(body.raw ?? "");
  if (!raw.trim()) return Response.json({ error: "粘贴内容为空" }, { status: 400 });
  const session = await loadSession(sessionId);
  if (!session) return Response.json({ error: "会话不存在" }, { status: 404 });
  const items = parseCandidateBlob(raw);
  const unparsed = items.filter((it) => it.detectedType === "unknown");
  const recognized = items.filter((it) => it.detectedType !== "unknown");
  const { candidates: deduped, merged, versionNotes } = dedupeCandidates(recognized, session.candidates ?? []);
  const { papers, warnings } = await enrichAll(deduped);
  const stats = { rawItems: items.length, recognized: recognized.length, unknown: unparsed.length, merged, unique: papers.length };
  let updated = withImport(session, stats, raw);
  updated.candidates = papers;
  // v1.3：candidates/evidence 变化后，旧 triage/seeds 一律清空（防止旧筛选伪装成当前结果）
  updated.triage = [];
  updated.seedPapers = [];
  // v1.4：基于真实候选 title/abstract 的术语校准（只建议，不改研究目标）
  const conceptMap = updated.plan?.conceptMap;
  if (conceptMap && papers.length > 0) {
    updated.termCalibration = calibrateTerms(papers, conceptMap);
    const cal = updated.termCalibration;
    updated = recordEvent(updated, "calibration", {
      confirmed: cal.termsConfirmed.map((t) => t.term),
      suggested: cal.termsSuggested.map((t) => t.term),
      weakOrRare: cal.termsWeakOrRare.map((t) => t.term),
    });
  } else {
    updated.termCalibration = undefined;
  }
  updated = recordEvent(updated, "batch-imported", {
    rawItems: stats.rawItems, recognized: stats.recognized,
    unknown: stats.unknown, merged: stats.merged, unique: stats.unique,
  });
  await saveSession(updated);
  return Response.json({
    session: updated,
    stats,
    unparsed: unparsed.map((u) => ({ raw: u.raw, parseWarnings: u.parseWarnings })),
    versionNotes,
    enrichWarnings: warnings,
  });
}

/** v1.2 B-lite：evidence-aware Triage（LLM + 边界强制），结果持久化 */
export async function handleTriage(body: Record<string, unknown>): Promise<Response> {
  const sessionId = String(body.sessionId ?? "");
  const session = await loadSession(sessionId);
  if (!session) return Response.json({ error: "会话不存在" }, { status: 404 });
  if (!session.candidates?.length) return Response.json({ error: "还没有候选，先导入论文" }, { status: 400 });
  try {
    const triage = await runTriage(session.candidates, session.question);
    let updatedSession = session;
    updatedSession.triage = triage;
    updatedSession = recordEvent(updatedSession, "triage-computed", { count: triage.length });
    await saveSession(updatedSession);
    return Response.json({ session: updatedSession, triage });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return Response.json({ error: msg, hint: "Triage 编译失败，请稍后重试（可检查网络/代理）" }, { status: 502 });
  }
}

export async function handleSessionGet(id: string): Promise<Response> {
  if (!id) return Response.json({ error: "缺少 id" }, { status: 400 });
  const session = await loadSession(id);
  if (!session) return Response.json({ error: "会话不存在" }, { status: 404 });
  return Response.json({ session, nextStep: deriveNextStep(session) });
}

