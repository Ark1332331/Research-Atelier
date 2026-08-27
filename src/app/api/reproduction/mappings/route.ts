/**
 * Paper ↔ Code Mapping 接口（Step 5）
 * POST /api/reproduction/mappings
 *   { slug, action: "propose", rootId? } → { mappings }（DeepSeek 提议，校验 codeRef 在 snapshot 内，status=proposed）
 *   { slug, action: "list" }             → { mappings }
 *   { slug, action: "save", mappings }   → { mappings }（merge 保存）
 *   { slug, action: "confirm", id }      → { mappings }（确认 → status=confirmed）
 *   { slug, action: "reject", id }       → { mappings }（驳回 → 移除）
 * 说明：AI 只提议，用户确认后才 confirmed（UX Contract：用户只处理 exception）。
 */
import path from "node:path";
import { readStore } from "@/lib/store";
import { getReproduction, upsertReproduction } from "@/lib/reproduction";
import { proposeMappings, normalizeMappings, confirmMapping, rejectMapping } from "@/lib/mapping";
import { buildRepositorySnapshot } from "@/lib/code-reader";

interface RootConfig { id: string; name: string; root: string }
async function readRoots(): Promise<RootConfig[]> {
  const raw = await readStore("code-roots.json");
  if (raw) {
    try { const d = JSON.parse(raw); return Array.isArray(d.roots) ? d.roots : []; } catch { /* */ }
  }
  return [{ id: "project", name: "项目根", root: path.resolve(process.cwd(), "..") }];
}

export async function POST(request: Request) {
  let body: { slug?: string; action?: string; rootId?: string; mappings?: unknown[]; id?: string };
  try { body = await request.json(); } catch { return Response.json({ error: "请求体必须是 JSON" }, { status: 400 }); }

  const slug = body.slug;
  if (!slug) return Response.json({ error: "slug 必填" }, { status: 400 });
  const rec = await getReproduction(slug);
  if (!rec) return Response.json({ error: "记录不存在" }, { status: 404 });

  const action = body.action;

  if (action === "list") {
    return Response.json({ mappings: rec.mappings ?? [] });
  }

  if (action === "propose") {
    const roots = await readRoots();
    const cfg = body.rootId ? roots.find((r) => r.id === body.rootId) : roots[0];
    if (!cfg) return Response.json({ error: "未登记 repo root" }, { status: 403 });
    const snap = await buildRepositorySnapshot(cfg.root);
    const mappings = await proposeMappings({ facts: rec.facts ?? [], snapshot: snap });
    return Response.json({ root: cfg.id, mappings });
  }

  if (action === "save") {
    if (!Array.isArray(body.mappings)) return Response.json({ error: "mappings 必须是数组" }, { status: 400 });
    const normalized = normalizeMappings(body.mappings as never[]);
    // merge：按 id 更新，新增追加
    const byId = new Map(rec.mappings?.map((m) => [m.id, m]) ?? []);
    for (const m of normalized) byId.set(m.id, m);
    rec.mappings = [...byId.values()];
    await upsertReproduction(rec);
    return Response.json({ mappings: rec.mappings, saved: normalized.length });
  }

  if (action === "confirm") {
    if (!body.id) return Response.json({ error: "id 必填" }, { status: 400 });
    rec.mappings = confirmMapping(rec.mappings ?? [], body.id);
    await upsertReproduction(rec);
    return Response.json({ mappings: rec.mappings });
  }

  if (action === "reject") {
    if (!body.id) return Response.json({ error: "id 必填" }, { status: 400 });
    rec.mappings = rejectMapping(rec.mappings ?? [], body.id);
    await upsertReproduction(rec);
    return Response.json({ mappings: rec.mappings });
  }

  return Response.json({ error: `未知 action：${action}` }, { status: 400 });
}
