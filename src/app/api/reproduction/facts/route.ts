/**
 * Fact 抽取与保存接口（Step 4）
 * POST /api/reproduction/facts
 *   { slug, action: "extractRepo", rootId }          → { facts }（沿 Step 3 snapshot 候选，确定性，不落库）
 *   { slug, action: "extractPaper" }                 → { facts }（DeepSeek 按 taxonomy 定向抽取论文正文）
 *   { slug, action: "save", facts: [...] }           → { facts }（归一化后写入 record.facts）
 *   { slug, action: "list" }                         → { facts }
 * 说明：
 *   - 抽取结果先返回给前端（用户确认），确认后才 save 落库；
 *   - key 必须来自有限 taxonomy（fact-taxonomy.ts），未知 key 在归一化时被拒绝；
 *   - repo 侧只沿 Step 3 snapshot 的 dependencies/configs 候选读取（不整仓扫）；
 *   - paper 侧按 taxonomy 定向抽取，observed/inferred/missing 严格区分，missing 带原因；
 *   - 不做 Gap Detector、不让 LLM 解决冲突（那是后续步骤）。
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { promises as fs } from "node:fs";
import { DATA_DIR, readStore } from "@/lib/store";
import { getReproduction, upsertReproduction } from "@/lib/reproduction";
import { normalizeFacts, extractRepoFacts, extractPaperFacts } from "@/lib/fact-extract";
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
  let body: { slug?: string; action?: string; rootId?: string; facts?: unknown[] };
  try { body = await request.json(); } catch { return Response.json({ error: "请求体必须是 JSON" }, { status: 400 }); }

  const slug = body.slug;
  if (!slug) return Response.json({ error: "slug 必填" }, { status: 400 });
  const rec = await getReproduction(slug);
  if (!rec) return Response.json({ error: "记录不存在" }, { status: 404 });

  const action = body.action;

  if (action === "list") {
    return Response.json({ facts: rec.facts ?? [] });
  }

  if (action === "extractRepo") {
    const roots = await readRoots();
    const cfg = body.rootId ? roots.find((r) => r.id === body.rootId) : roots[0];
    if (!cfg) return Response.json({ error: "未登记 repo root" }, { status: 403 });
    const snap = await buildRepositorySnapshot(cfg.root);
    // 只沿 snapshot 候选：dependencies + configs + datasets（代码）里的文件
    const candidateFiles = [
      ...(snap.dependencies as { path: string; commit?: string; workingTreeDirty?: boolean }[] ?? []),
      ...(snap.configs as { path: string; commit?: string; workingTreeDirty?: boolean }[] ?? []),
      ...(snap.datasets as { path: string; commit?: string; workingTreeDirty?: boolean }[] ?? []),
    ].filter((f) => f && typeof f.path === "string");
    const facts = await extractRepoFacts(candidateFiles, cfg.root);
    return Response.json({ root: cfg.id, facts });
  }

  if (action === "extractPaper") {
    // 读本记录对应论文的正文页（data/papers/<slug> 或 data/papers/<paperSlug>）
    let pages: string[] = [];
    const dirs = [slug, rec.title ? rec.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40) : ""].filter(Boolean);
    for (const d of dirs) {
      const base = path.join(DATA_DIR, "papers", d);
      try {
        const names = (await fs.readdir(base)).filter((n) => /^page_\d+\.txt$/.test(n)).sort();
        if (names.length) {
          pages = [];
          for (const n of names) pages.push(await readFile(path.join(base, n), "utf-8"));
          break;
        }
      } catch { /* 下一个候选目录 */ }
    }
    if (!pages.length) return Response.json({ error: `未找到论文正文页（data/papers/<slug>）`, hint: "请先导入论文 PDF" }, { status: 404 });
    const facts = await extractPaperFacts(pages);
    return Response.json({ facts });
  }

  if (action === "save") {
    if (!Array.isArray(body.facts)) return Response.json({ error: "facts 必须是数组" }, { status: 400 });
    const normalized = normalizeFacts(body.facts as never[]);
    rec.facts = normalized;
    await upsertReproduction(rec);
    return Response.json({ facts: normalized, saved: normalized.length });
  }

  return Response.json({ error: `未知 action：${action}` }, { status: 400 });
}
