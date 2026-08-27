/**
 * Repo Analyzer（Step 3）：给定已登记的本地 repo，安全、确定性地产出 Repository Snapshot。
 * POST /api/repo-analyzer { root } → { snapshot }（buildRepositorySnapshot 输出）
 *  - root 必须已登记在 code-roots.json（与 code-read 同一权限模型，防任意盘漫游）；
 *    用 rootId 也可（解析到登记路径）。
 *  - 只做结构事实（entrypoints/training/eval/datasets/configs/dependencies/checkpoints/scripts/docs）
 *    + repo revision（commit/branch/url/dirty）+ omitted（跳过原因）+ categoryStats（截断透明）。
 *  - 不抽取科学事实（batch_size/optimizer/… 是 Step 4），不做通用代码理解。
 * 依据：node_modules/next/dist/docs/01-app/01-getting-started/15-route-handlers.md
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { buildRepositorySnapshot } from "@/lib/code-reader";
import { readStore, writeStore } from "@/lib/store";

interface RootConfig { id: string; name: string; root: string }

async function readRoots(): Promise<RootConfig[]> {
  const raw = await readStore("code-roots.json");
  if (raw) {
    try { const d = JSON.parse(raw); return Array.isArray(d.roots) ? d.roots : []; } catch { /* */ }
  }
  const projectRoot = process.env.RA_DEFAULT_CODE_ROOT ?? path.resolve(process.cwd(), "..");
  return [{ id: "project", name: "项目根（allinone）", root: projectRoot }];
}

export async function POST(request: Request) {
  let body: { root?: string; rootId?: string };
  try { body = await request.json(); } catch { return Response.json({ error: "请求体必须是 JSON" }, { status: 400 }); }

  const roots = await readRoots();
  const byId = body.rootId ? roots.find((r) => r.id === body.rootId) : undefined;
  const byPath = body.root ? roots.find((r) => path.resolve(r.root) === path.resolve(String(body.root))) : undefined;
  const cfg = byId ?? byPath;
  if (!cfg) {
    return Response.json({
      error: "该 repo root 未登记。请先在 data/code-roots.json 登记（或传入已登记的 rootId），与 code-read 使用同一权限模型。",
      registeredRoots: roots.map((r) => ({ id: r.id, root: r.root })),
    }, { status: 403 });
  }

  const root = path.resolve(cfg.root);
  try {
    const st = await fs.stat(root);
    if (!st.isDirectory()) return Response.json({ error: "root 不是目录" }, { status: 400 });
  } catch {
    return Response.json({ error: "root 不可读或不存在" }, { status: 404 });
  }

  try {
    const snapshot = await buildRepositorySnapshot(root);
    return Response.json({ root, rootId: cfg.id, snapshot });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "分析失败" }, { status: 500 });
  }
}
