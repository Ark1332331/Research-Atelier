/**
 * Analyze orchestrator 接口（阶段②）
 * POST /api/reproduction/analyze
 *   { slug, rootId? } → { ok, analysis, paperRevision, repoRevision, summary, needScan, needDecision, error? }
 *  - 服务端一次性运行：paper extraction → repo analyzer → facts → mapping → gaps（固定本轮 revision）；
 *  - 自动持久化：facts（merge）、mappings（merge）、analysis state；
 *  - 返回摘要区分 need_scan（not_scanned，blocker 但不可 Decision）与 need_decision（可用户 Decision）。
 *  - root 必须已登记（code-roots.json，与 code-read/repo-analyzer 同一权限模型）。
 */
import path from "node:path";
import { readStore } from "@/lib/store";
import { getReproduction, upsertReproduction } from "@/lib/reproduction";
import { runAnalysis } from "@/lib/analyze";

interface RootConfig { id: string; name: string; root: string }
async function readRoots(): Promise<RootConfig[]> {
  const raw = await readStore("code-roots.json");
  if (raw) {
    try { const d = JSON.parse(raw); return Array.isArray(d.roots) ? d.roots : []; } catch { /* */ }
  }
  return [{ id: "project", name: "项目根", root: path.resolve(process.cwd(), "..") }];
}

export async function POST(request: Request) {
  let body: { slug?: string; rootId?: string };
  try { body = await request.json(); } catch { return Response.json({ error: "请求体必须是 JSON" }, { status: 400 }); }

  const slug = body.slug;
  if (!slug) return Response.json({ error: "slug 必填" }, { status: 400 });
  const rec = await getReproduction(slug);
  if (!rec) return Response.json({ error: "记录不存在" }, { status: 404 });

  // repo root：优先用已登记的 rootId；否则 fallback 到 record.repoUrl 无法映射 → 需要显式 rootId
  const roots = await readRoots();
  const cfg = body.rootId ? roots.find((r) => r.id === body.rootId) : roots[0];
  if (!cfg) return Response.json({ error: "未登记 repo root" }, { status: 403 });

  const result = await runAnalysis(rec, { root: cfg.root });
  if (result.ok) {
    await upsertReproduction(rec);
    return Response.json({ root: cfg.id, ...result });
  }
  // 失败也持久化 analysis state（status=failed），防下次半新半旧
  rec.analysis = result.analysis;
  await upsertReproduction(rec);
  return Response.json({ root: cfg.id, ...result }, { status: 500 });
}
