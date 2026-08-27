/**
 * Gap Detector + Decision Ledger 接口（Step 6）
 * POST /api/reproduction/gaps
 *   { slug, action: "detect" }                     → { gaps, blockingGaps, resolvableGaps }（完全确定性，LLM 不参与冲突判定）
 *   { slug, action: "decisions" }                  → { decisions }（现有 ledger）
 *   { slug, action: "proposeDecision", gapId }     → { decision }（为该 gap 生成待决 Decision；not_scanned 拒绝）
 *   { slug, action: "acceptDecision", id, chosen, rationale? } → { decisions }（采纳 → status=accepted, blocksReady=false）
 *   { slug, action: "rejectDecision", id }         → { decisions }（移除）
 * 规则：
 *   - Decision 引用 gapId + paperFactIds/repoFactIds（真实 id），不存裸值；
 *   - not_scanned 的 gap 不可通过 Decision 消解（先扫描）；
 *   - required unresolved gap / pending blocking decision 进 Ready Gate blocker。
 */
import { getReproduction, upsertReproduction, idFor } from "@/lib/reproduction";
import { detectGaps, blockingGaps, resolvableGaps, decisionForGap } from "@/lib/gap-detector";
import type { Gap } from "@/lib/reproduction-spec";

export async function POST(request: Request) {
  let body: { slug?: string; action?: string; gapId?: string; id?: string; chosen?: unknown; rationale?: string };
  try { body = await request.json(); } catch { return Response.json({ error: "请求体必须是 JSON" }, { status: 400 }); }

  const slug = body.slug;
  if (!slug) return Response.json({ error: "slug 必填" }, { status: 400 });
  const rec = await getReproduction(slug);
  if (!rec) return Response.json({ error: "记录不存在" }, { status: 404 });

  const action = body.action;
  const gaps = detectGaps(rec.facts ?? []);

  if (action === "detect") {
    return Response.json({ gaps, blocking: blockingGaps(gaps), resolvable: resolvableGaps(gaps) });
  }

  if (action === "decisions") {
    return Response.json({ decisions: rec.decisions ?? [] });
  }

  if (action === "proposeDecision") {
    const gap = gaps.find((g: Gap) => g.id === body.gapId);
    if (!gap) return Response.json({ error: `gap 不存在：${body.gapId}` }, { status: 404 });
    if (gap.type === "not_scanned") {
      return Response.json({ error: "not_scanned 的 gap 不可通过 Decision 消解（未扫描≠不存在，请先扫描相关代码/论文）" }, { status: 400 });
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
    d.status = "accepted";
    d.chosen = body.chosen;
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
