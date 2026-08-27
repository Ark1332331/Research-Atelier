/**
 * Gap Detector + Decision Ledger 接口（Step 6 resolution hardening）
 * POST /api/reproduction/gaps
 *   { slug, action: "detect" }                          → { effectiveGaps, rawGaps, blocking, resolvable, staleDecisions }
 *     （Gap 检测基于 Raw Facts + 有效 Decisions：accepted 且非 stale 的 Decision 已应用 → effective gaps）
 *   { slug, action: "decisions" }                       → { decisions }
 *   { slug, action: "proposeDecision", gapId }          → { decision }（仅 value_conflict/source_conflict/not_found/uncomparable；
 *                                                              not_scanned 与 missing_required 拒绝）
 *   { slug, action: "acceptDecision", id, choice, rationale? } → { decisions }
 *     （choice: {kind:'fact',factId} 或 {kind:'custom',value}；必须有有效 choice；当前 gap 存在且 fingerprint 匹配）
 *   { slug, action: "rejectDecision", id }              → { decisions }
 * 规则：
 *   - Decision 引用 gapId + gapFingerprint + 真实 fact ids；
 *   - required not_scanned 是 Ready blocker，但不可 Decision 消解（只能补扫描）；
 *   - 证据变化后旧 Decision 标 stale，不得继续消解新 gap；
 *   - 同侧 source_conflict 解决后继续跨侧比较（effective view），避免假 Ready。
 */
import { getReproduction, upsertReproduction } from "@/lib/reproduction";
import { detectGaps, detectWithDecisions, blockingGaps, resolvableGaps, decisionForGap, isDecisionStale } from "@/lib/gap-detector";
import type { DecisionChoice } from "@/lib/reproduction-spec";

const PROPOSABLE = ["value_conflict", "source_conflict", "not_found", "uncomparable"];

export async function POST(request: Request) {
  let body: { slug?: string; action?: string; gapId?: string; id?: string; choice?: DecisionChoice; rationale?: string };
  try { body = await request.json(); } catch { return Response.json({ error: "请求体必须是 JSON" }, { status: 400 }); }

  const slug = body.slug;
  if (!slug) return Response.json({ error: "slug 必填" }, { status: 400 });
  const rec = await getReproduction(slug);
  if (!rec) return Response.json({ error: "记录不存在" }, { status: 404 });

  const action = body.action;
  const { effectiveGaps, rawGaps, staleDecisions } = detectWithDecisions(rec.facts ?? [], rec.decisions ?? []);

  if (action === "detect") {
    return Response.json({
      effectiveGaps, rawGaps,
      blocking: blockingGaps(effectiveGaps),
      resolvable: resolvableGaps(effectiveGaps),
      staleDecisions,
    });
  }

  if (action === "decisions") {
    return Response.json({ decisions: rec.decisions ?? [], stale: staleDecisions.map((d) => d.id) });
  }

  if (action === "proposeDecision") {
    const gap = rawGaps.find((g) => g.id === body.gapId);
    if (!gap) return Response.json({ error: `gap 不存在：${body.gapId}` }, { status: 404 });
    if (!PROPOSABLE.includes(gap.type)) {
      return Response.json({ error: `gap 类型 ${gap.type} 不可通过 Decision 消解（仅 value_conflict/source_conflict/not_found/uncomparable；not_scanned 需补扫描，missing_required 需补事实）` }, { status: 400 });
    }
    const decisions = rec.decisions ?? [];
    const existing = decisions.find((d) => d.gapId === gap.id);
    if (existing) return Response.json({ decision: existing });
    const d = decisionForGap(gap);
    decisions.push(d);
    rec.decisions = decisions;
    await upsertReproduction(rec);
    return Response.json({ decision: d });
  }

  if (action === "acceptDecision") {
    const decisions = rec.decisions ?? [];
    const d = decisions.find((x) => x.id === body.id);
    if (!d) return Response.json({ error: "decision 不存在" }, { status: 404 });
    // choice 必须有效
    const choice = body.choice;
    const validChoice = choice && (choice.kind === "fact" ? typeof choice.factId === "string" : choice.kind === "custom" && "value" in choice);
    if (!validChoice) return Response.json({ error: "accept 必须有有效 choice（{kind:'fact',factId} 或 {kind:'custom',value}）" }, { status: 400 });
    // 当前 gap 必须仍存在（未被证据变化抹掉）
    const gap = rawGaps.find((g) => g.id === d.gapId);
    if (!gap) return Response.json({ error: "该 decision 关联的 gap 已不存在（证据已变）" }, { status: 400 });
    // fingerprint 匹配：若已 stale 不得 accept
    if (isDecisionStale(d, rawGaps)) return Response.json({ error: "该 decision 已 stale（证据变化），需重新 propose" }, { status: 400 });
    // choice.kind=fact 时 factId 必须在参与 fact 里
    if (choice.kind === "fact") {
      const involved = new Set([...gap.paperFacts, ...gap.repoFacts].map((f) => f.id));
      if (!involved.has(choice.factId)) return Response.json({ error: "choice.factId 必须是参与该 gap 的真实 fact id" }, { status: 400 });
    }
    d.status = "accepted";
    d.choice = choice;
    if (typeof body.rationale === "string") d.rationale = body.rationale;
    d.blocksReady = false;
    d.resolvedAt = new Date().toISOString();
    rec.decisions = decisions;
    await upsertReproduction(rec);
    return Response.json({ decisions });
  }

  if (action === "rejectDecision") {
    rec.decisions = (rec.decisions ?? []).filter((x) => x.id !== body.id);
    await upsertReproduction(rec);
    return Response.json({ decisions: rec.decisions });
  }

  return Response.json({ error: `未知 action：${action}` }, { status: 400 });
}
