/**
 * 论文工具：给「论文筛选」对话接上真实联网 + 下载导入能力。
 * 让 AI（通过 function calling）能调用：
 *   - search_papers(query)     → OpenAlex 检索论文，每条候选带：
 *                                标题/作者/年份/摘要 + DOI 与出版社入口（学校订阅在校内/校园网可下载）
 *                                + 开放获取 PDF 直链（是否开放、能否自动导入）
 *   - download_paper(...)      → 下载开放获取 PDF → 提取文本 → 导入本地论文库（data/papers + data/library.json）
 *
 * 覆盖边界：能在 App 里自动下载并导入的，是「开放获取」的 PDF（arxiv 等直链）；
 *          非开放获取的（要学校/出版社订阅），返回 publisherUrl 让用户在校内浏览器下载后导入。
 * 数据层复用 src/lib/store.ts（本地 data/；生产（Vercel）自动切 KV）。
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { DATA_DIR, readStore, writeStore } from "@/lib/store";
import { translateDocument } from "@/lib/translate";
import { extractTermsInBackground } from "@/lib/terms-extract";

const execFileAsync = promisify(execFile);
const NODE_BIN = process.env.RA_NODE_BIN ?? "node";
const USER_AGENT = "Mozilla/5.0 (ResearchAtelier; scholarly paper tool)";

export interface PaperHit {
  id: string;            // OpenAlex id
  arxivId?: string;      // 若在 arXiv 上
  title: string;
  authors: string;
  year: string;
  abstract: string;
  doi?: string;
  isOa: boolean;         // 是否开放获取
  oaPdfUrl?: string;     // 可尝试自动下载的开放获取 PDF
  publisherUrl: string;  // 出版社 / DOI 页面（学校订阅在校内可下载）
  publisherName: string; // 出版社 / 期刊名
}

interface PaperMeta {
  slug: string;
  title: string;
  source: string;
  pages: number;
  importedAt: string;
}

/** OpenAlex 的摘要倒排索引 → 可读文本 */
function rebuildAbstract(inv?: Record<string, number[]>): string {
  if (!inv) return "";
  const pos: [number, string][] = [];
  for (const [w, ps] of Object.entries(inv)) for (const p of ps) pos.push([p, w]);
  pos.sort((a, b) => a[0] - b[0]);
  return pos.map((x) => x[1]).join(" ").slice(0, 600);
}

/** 用 OpenAlex 检索论文（带重试：网络波动/429 限流时指数退避重试） */
export async function searchPapers(query: string, max = 6): Promise<PaperHit[]> {
  const q = (query || "").trim();
  const url =
    `https://api.openalex.org/works?search=${encodeURIComponent(q)}&per-page=${Math.min(max, 10)}&mailto=research@atelier.local` +
    `&select=id,doi,display_name,publication_year,open_access,primary_location,authorships,abstract_inverted_index`;
  let d: { results?: unknown[] } = {};
  let lastErr: unknown = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    if (attempt > 1) await new Promise((r) => setTimeout(r, 800 * 2 ** (attempt - 2)));
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(25000), headers: { "User-Agent": USER_AGENT } });
      if (res.ok) { d = await res.json(); lastErr = null; break; }
      lastErr = new Error(`检索失败（HTTP ${res.status}）`);
      if (res.status < 500 && res.status !== 429) break; // 业务错误，重试无意义
    } catch (err) {
      lastErr = err; // 网络层错误 → 重试
    }
  }
  if (lastErr || !d?.results) {
    throw lastErr instanceof Error ? lastErr : new Error("检索失败：网络到 api.openalex.org 不稳定");
  }
  return ((d.results as any[]) ?? []).map((p) => {
    const authors = ((p.authorships as any[]) ?? []).slice(0, 4).map((a) => a?.author?.display_name).filter(Boolean).join(", ");
    const oaPdf = p?.open_access?.oa_url || p?.primary_location?.pdf_url || undefined;
    const isOa = Boolean(p?.open_access?.is_oa || oaPdf);
    const landing = p?.primary_location?.landing_page_url || p?.doi || "";
    const arxivMatch = String(oaPdf || landing || "").match(/arxiv\.org\/(?:abs|pdf)\/([^/#?]+)/);
    return {
      id: String(p?.id || ""),
      arxivId: arxivMatch?.[1],
      title: String(p?.display_name || ""),
      authors,
      year: String(p?.publication_year || ""),
      abstract: rebuildAbstract(p?.abstract_inverted_index),
      doi: String(p?.doi || "").replace(/^https?:\/\/doi\.org\//, ""),
      isOa,
      oaPdfUrl: isOa ? oaPdf : undefined,
      publisherUrl: String(landing),
      publisherName: String(p?.primary_location?.source?.display_name || ""),
    };
  });
}

function makeSlug(title: string, arxivId?: string): string {
  const base = (arxivId || title)
    .replace(/^https?:\/\/arxiv\.org\/(?:abs|pdf)\//, "")
    .replace(/\.pdf$/, "")
    .replace(/[^a-z0-9\u4e00-\u9fa5-]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return `${base || "paper"}-${Date.now().toString(36).slice(-4)}`;
}

/**
 * 下载一篇开放获取论文的 PDF 并导入本地论文库。
 * 传入 pdfUrl（开放获取直链）或 arxivId（回退到 arxiv pdf）。非开放获取会报错，提示用户校内下载后手动导入。
 */
export async function downloadPaper(opts: {
  pdfUrl?: string;
  arxivId?: string;
  title?: string;
}): Promise<{ slug: string; title: string; pages: number; url: string; imported: boolean }> {
  let url = (opts.pdfUrl || "").trim();
  let arxivId = (opts.arxivId || "").trim().replace(/^https?:\/\/arxiv\.org\/(?:abs|pdf)\//, "").replace(/\.pdf$/, "");
  const title = (opts.title || "").trim().slice(0, 200);

  const isOaPdf = (u: string) => u.startsWith("http://") || u.startsWith("https://");

  if (!url && arxivId) url = `https://arxiv.org/pdf/${arxivId}`;
  if (!url || !isOaPdf(url)) {
    throw new Error("没有可自动下载的开放获取 PDF——该论文可能需要学校/出版社订阅。请在校内下载 PDF 后导入论文库。");
  }

  const res = await fetch(url, {
    method: "GET",
    signal: AbortSignal.timeout(120000),
    headers: { "User-Agent": USER_AGENT },
    redirect: "follow",
  });
  if (!res.ok) throw new Error(`下载失败（HTTP ${res.status}）`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.slice(0, 4).toString("latin1") !== "%PDF") {
    throw new Error("下载内容不是有效 PDF（可能需登录/未开放）");
  }

  const slug = makeSlug(title || arxivId || "paper", arxivId || undefined);
  const dir = path.join(DATA_DIR, "papers", slug);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, "original.pdf"), buf);

  // 提取每页文本（复用 scripts/extract-pdf.mjs；扫描版无文本层则 pages=0，仍可导入）
  let pages = 0;
  const script = path.join(process.cwd(), "scripts", "extract-pdf.mjs");
  const childEnv: NodeJS.ProcessEnv = { ...process.env };
  if (process.env.RA_NODE_BIN) childEnv.ELECTRON_RUN_AS_NODE = "1";
  let pageTexts: string[] = [];
  try {
    const { stdout } = await execFileAsync(NODE_BIN, [script, path.join(dir, "original.pdf")], {
      cwd: process.cwd(), env: childEnv, maxBuffer: 64 * 1024 * 1024, timeout: 120000,
    });
    const start = stdout.indexOf("{");
    const parsed = start >= 0 ? JSON.parse(stdout.slice(start)) : null;
    pageTexts = Array.isArray(parsed?.texts) ? parsed.texts : [];
    for (let i = 0; i < pageTexts.length; i++) {
      await fs.writeFile(path.join(dir, `page_${String(i + 1).padStart(2, "0")}.txt`), pageTexts[i], "utf-8");
    }
    pages = pageTexts.length;
  } catch { /* 文本层提取失败：仍允许导入 */ }

  // 整篇中文翻译耗时较长（要多次调 DeepSeek）。放到后台进行、不阻塞下载导入的返回，
  // 以免筛选对话卡几分钟。导入完成后稍等，即可在精读页看到译文（translation.md）。
  if (pages > 0) {
    void (async () => {
      try {
        const translation = await translateDocument(pageTexts);
        if (translation && !translation.startsWith("（未配置") && !translation.includes("（翻译失败")) {
          await fs.writeFile(path.join(dir, "translation.md"), translation, "utf-8");
        }
      } catch { /* 后台翻译失败不影响导入；精读页会提示未生成 */ }
    })();
  }

  const meta: PaperMeta = {
    slug, title: title || slug, source: "imported", pages, importedAt: new Date().toISOString(),
  };
  await fs.writeFile(path.join(dir, "meta.json"), JSON.stringify(meta, null, 2), "utf-8");
  await addToLibrary(meta);
  // 术语抽查：导入后后台抽取术语记入术语卡（数量不限，需要的才抽；已存在的跳过）
  extractTermsInBackground(pageTexts, { slug, title: meta.title });

  return { slug, title: meta.title, pages, url, imported: true };
}

/** 把导入的论文写进论文库 data/library.json（去重：同 slug 不重复加） */
async function addToLibrary(meta: PaperMeta): Promise<void> {
  const raw = await readStore("library.json");
  let lib: { groups: unknown[]; papers: any[] };
  try {
    lib = raw ? JSON.parse(raw) : { groups: [], papers: [] };
    if (!Array.isArray(lib.papers)) lib.papers = [];
    if (!Array.isArray(lib.groups)) lib.groups = [];
  } catch {
    lib = { groups: [], papers: [] };
  }
  if (lib.papers.some((p) => p.slug === meta.slug)) return; // 已导入过

  lib.papers.push({
    id: `p-${Date.now().toString(36)}${Math.floor(Math.random() * 1000).toString(36)}`,
    title: meta.title,
    source: "imported",
    slug: meta.slug,
    status: "未读",
    group: null,
    current: false,
    firstEncounter: new Date().toISOString().slice(0, 10),
    lastEngaged: "",
  });
  await writeStore("library.json", JSON.stringify(lib, null, 2));
}
