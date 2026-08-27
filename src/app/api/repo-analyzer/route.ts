/**
 * Repo Analyzer（Step 3）：给定本地 repo 路径，安全、确定性地产出 Repository Snapshot。
 * POST /api/repo-analyzer { root } → { snapshot }（buildRepositorySnapshot 输出）
 *  - 只做结构事实（entrypoints/training/eval/datasets/configs/dependencies/checkpoints/scripts/docs）
 *    + repo revision（commit/branch/url/dirty）+ omitted（跳过原因）。
 *  - 不抽取科学事实（batch_size/optimizer/… 是 Step 4），不做通用代码理解。
 * 依据：node_modules/next/dist/docs/01-app/01-getting-started/15-route-handlers.md
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { buildRepositorySnapshot } from "@/lib/code-reader";

export async function POST(request: Request) {
  let body: { root?: string };
  try { body = await request.json(); } catch { return Response.json({ error: "请求体必须是 JSON" }, { status: 400 }); }

  const root = (body.root ?? "").trim();
  if (!root) return Response.json({ error: "root（本地 repo 绝对路径）必填" }, { status: 400 });

  const resolved = path.resolve(root);
  try {
    const st = await fs.stat(resolved);
    if (!st.isDirectory()) return Response.json({ error: "root 不是目录" }, { status: 400 });
  } catch {
    return Response.json({ error: "root 不可读或不存在" }, { status: 404 });
  }

  try {
    const snapshot = await buildRepositorySnapshot(resolved);
    return Response.json({ root: resolved, snapshot });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "分析失败" }, { status: 500 });
  }
}
