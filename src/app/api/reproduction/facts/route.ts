/**
 * Fact 抽取与保存接口（Step 4）
 * POST /api/reproduction/facts
 *   { slug, action: "extractRepo", rootId }              → { facts, scannedCategories }（沿 Step 3 snapshot 候选，确定性）
 *   { slug, action: "extractPaper" }                     → { facts, coveredPages, droppedChunks }（DeepSeek 完整论文 chunk 覆盖）
 *   { slug, action: "save", facts, mode? }               → { facts, saved }（mode: merge|replace-side|replace-all，默认 merge）
 *   { slug, action: "list" }                             → { facts }
 * 说明：
 *   - 抽取结果先返回给前端（用户确认），确认后才 save 落库；
 *   - save 默认 merge：不覆盖已有不同值的 Fact，不清掉另一侧；
 *   - key 必须来自有限 taxonomy，未知 key 在归一化时被拒绝；
 *   - repo 侧按 taxonomy category → snapshot category 定向读取（datasets/model/training/eval/config/deps）；
 *     某类没扫描到 → 该类 required key 判 missingType=not_scanned；
 *   - paper 侧整篇 chunk 覆盖；有 chunk 超预算被丢 → 相关 key 判 not_scanned（不假装 not_found）；
 *   - 不做 Gap Detector、不让 LLM 解决冲突。
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { promises as fs } from "node:fs";
import { DATA_DIR, readStore } from "@/lib/store";
import { getReproduction, upsertReproduction } from "@/lib/reproduction";
import { normalizeFacts, saveFacts, extractRepoFacts, extractPaperFacts } from "@/lib/fact-extract";
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
  let body: { slug?: string; action?: string; rootId?: string; facts?: unknown[]; mode?: string };
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
    const { facts, scannedCategories } = await extractRepoFacts(snap, cfg.root);
    return Response.json({ root: cfg.id, facts, scannedCategories: [...scannedCategories] });
  }

  if (action === "extractPaper") {
    let pages: string[] = [];
    const dirs = [slug, rec.title ? rec.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40) : ""].filter(Boolean);
    for (const d of dirs) {
      const base = path.join(DATA_DIR, "papers", d);
      try {
        const names = (await fs.readdir(base)).filter((n) => /^page_\d+\.txt$/.test(n));
        // 页码数字排序（page_2 在 page_10 前）
        names.sort((a, b) => {
          const na = Number((a.match(/page_(\d+)/) ?? [])[1] ?? 0);
          const nb = Number((b.match(/page_(\d+)/) ?? [])[1] ?? 0);
          return na - nb;
        });
        if (names.length) {
          pages = [];
          for (const n of names) pages.push(await readFile(path.join(base, n), "utf-8"));
          break;
        }
      } catch { /* 下一个候选目录 */ }
    }
    if (!pages.length) return Response.json({ error: `未找到论文正文页（data/papers/<slug>）`, hint: "请先导入论文 PDF" }, { status: 404 });
    const { facts, coveredPages, droppedChunks } = await extractPaperFacts(pages);
    return Response.json({ facts, coveredPages, droppedChunks });
  }

  if (action === "save") {
    if (!Array.isArray(body.facts)) return Response.json({ error: "facts 必须是数组" }, { status: 400 });
    const mode = body.mode === "replace-side" || body.mode === "replace-all" ? body.mode : "merge";
    const incoming = normalizeFacts(body.facts as never[]);
    const merged = saveFacts(rec.facts ?? [], incoming, mode);
    rec.facts = merged;
    await upsertReproduction(rec);
    return Response.json({ facts: merged, saved: incoming.length, mode });
  }

  return Response.json({ error: `未知 action：${action}` }, { status: 400 });
}
