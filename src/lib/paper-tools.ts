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
import { DATA_DIR } from "@/lib/store";
import { translateDocument } from "@/lib/translate";
import { saveTranslationResult } from "@/lib/translate-store";
import { createHash,randomUUID } from 'node:crypto';
import {withProjectLock} from '@/lib/project-lock';
import {findPaperByHash,registerPaper,paperDirectory} from '@/lib/paper-management';

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
  sha256?: string;
  slug: string;
  title: string;
  source: string;
  pages: number;
  importedAt: string;
}

/** OpenAlex 的摘要倒排索引 → 可读文本 */
function rebuildAbstract(inv?: Record<string, number[]>): string {
  if (!inv || typeof inv !== "object" || Array.isArray(inv)) return "";
  const pos: [number, string][] = [];
  for (const [w, ps] of Object.entries(inv)) {
    if (Array.isArray(ps)) for (const p of ps) if (Number.isInteger(p) && p >= 0) pos.push([p, w]);
  }
  pos.sort((a, b) => a[0] - b[0]);
  return pos.map((x) => x[1]).join(" ").slice(0, 600);
}

/** OpenAlex works API 响应条目（只声明本文件实际消费的字段，缺省字段视为可选） */
type OpenAlexLocation = {
  is_oa?: unknown;
  pdf_url?: unknown;
  landing_page_url?: unknown;
  source?: { display_name?: unknown };
};
type OpenAlexWork = {
  id?: unknown;
  doi?: unknown;
  display_name?: unknown;
  publication_year?: unknown;
  open_access?: { is_oa?: unknown; oa_url?: unknown };
  primary_location?: OpenAlexLocation;
  best_oa_location?: OpenAlexLocation;
  locations?: OpenAlexLocation[];
  authorships?: { author?: { display_name?: unknown } }[];
  abstract_inverted_index?: Record<string, number[]>;
};

/** 用 OpenAlex 检索论文（带重试：网络波动/429 限流时指数退避重试） */
export async function searchPapers(query: string, max = 6): Promise<PaperHit[]> {
  const q = (query || "").trim();
  if (!q || q.length > 500) throw new Error("检索内容须为 1–500 个字符");
  const doi = q.replace(/^(?:https?:\/\/(?:dx\.)?doi\.org\/|doi:\s*)/i, "");
  const exactDoi = /^10\.\d{4,9}\/\S+$/i.test(doi);
  const url = new URL(exactDoi ? `https://api.openalex.org/works/https://doi.org/${encodeURIComponent(doi)}` : "https://api.openalex.org/works");
  if (!exactDoi) {
    url.searchParams.set("search", q);
    url.searchParams.set("per-page", String(Math.max(1, Math.min(max, 10))));
  }
  url.searchParams.set("select", "id,doi,display_name,publication_year,open_access,primary_location,best_oa_location,locations,authorships,abstract_inverted_index");
  if (process.env.OPENALEX_API_KEY) url.searchParams.set("api_key", process.env.OPENALEX_API_KEY);
  if (process.env.OPENALEX_MAILTO) url.searchParams.set("mailto", process.env.OPENALEX_MAILTO);
  let d: { results?: OpenAlexWork[] } & OpenAlexWork = {};
  let lastErr: unknown = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    if (attempt > 1) await new Promise((r) => setTimeout(r, 800 * 2 ** (attempt - 2)));
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(25000), headers: { "User-Agent": USER_AGENT } });
      if (res.status === 404 && exactDoi) return [];
      if (res.ok) { d = await res.json(); lastErr = null; break; }
      lastErr = new Error(`检索失败（HTTP ${res.status}）`);
      if (res.status < 500 && res.status !== 429) break; // 业务错误，重试无意义
    } catch (err) {
      lastErr = err; // 网络层错误 → 重试
    }
  }
  if (lastErr || !d || typeof d !== "object" || (!exactDoi && !Array.isArray(d.results))) {
    throw lastErr instanceof Error ? lastErr : new Error("检索失败：网络到 api.openalex.org 不稳定");
  }
  const httpUrl = (value: unknown): string | undefined => {
    if (typeof value !== "string") return undefined;
    try { const parsed = new URL(value); return ["http:", "https:"].includes(parsed.protocol) ? value : undefined; } catch { return undefined; }
  };
  return (exactDoi ? [d] : d.results ?? []).filter((p) => p && typeof p.id === "string" && p.id && typeof p.display_name === "string" && p.display_name.trim()).map((p) => {
    const authors = (Array.isArray(p.authorships) ? p.authorships.slice(0, 4) : []).map((a) => a?.author?.display_name).filter((name) => typeof name === "string").join(", ");
    const locations = Array.isArray(p.locations) ? p.locations : [];
    const oaPdf = [p.best_oa_location?.pdf_url, p.primary_location?.pdf_url, ...locations.filter((l) => l?.is_oa === true).map((l) => l.pdf_url)].map(httpUrl).find(Boolean);
    const isOa = Boolean(p?.open_access?.is_oa || oaPdf);
    const landing = httpUrl(p.primary_location?.landing_page_url) || httpUrl(p.doi) || "";
    const arxivMatch = [oaPdf, landing, ...locations.map((l) => l?.landing_page_url)].filter((u) => typeof u === "string").map((u) => String(u).match(/^https?:\/\/(?:www\.|export\.)?arxiv\.org\/(?:abs|pdf)\/(\d{4}\.\d{4,5}(?:v\d+)?|[a-z-]+(?:\.[A-Z]{2})?\/\d{7}(?:v\d+)?)(?:\.pdf)?(?:[?#].*)?$/i)).find(Boolean);
    return {
      id: String(p?.id || ""),
      arxivId: arxivMatch?.[1],
      title: String(p?.display_name || ""),
      authors,
      year: String(p?.publication_year || ""),
      abstract: rebuildAbstract(p?.abstract_inverted_index),
      doi: typeof p.doi === "string" ? p.doi.replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, "") : undefined,
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
  const arxivId = (opts.arxivId || "").trim().replace(/^https?:\/\/arxiv\.org\/(?:abs|pdf)\//, "").replace(/\.pdf$/, "");
  const title = (opts.title || "").trim().slice(0, 200);

  const isOaPdf = (u: string) => u.startsWith("http://") || u.startsWith("https://");

  if (!url && arxivId) url = `https://arxiv.org/pdf/${arxivId}`;
  if (!url || !isOaPdf(url)) {
    throw new Error("没有可自动下载的开放获取 PDF——该论文可能需要学校/出版社订阅。请在校内下载 PDF 后导入论文库。");
  }

  const {downloadPdfBytes}=await import('@/lib/paper-download');
  const buf = await downloadPdfBytes(url);
  if (buf.slice(0, 4).toString("latin1") !== "%PDF") {
    throw new Error("下载内容不是有效 PDF（可能需登录/未开放）");
  }

  return withProjectLock(async()=>{
  const sha256=createHash('sha256').update(buf).digest('hex');
  const duplicate=await findPaperByHash(sha256);
  if(duplicate){await registerPaper(duplicate);return {slug:duplicate.slug,title:duplicate.title,pages:duplicate.pages,url,imported:false};}
  const slug = makeSlug(title || arxivId || "paper", arxivId || undefined)+"-"+randomUUID().slice(0,8);
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
        // 失败写 translation.error.txt（阅读页可见、可重试），不再静默吞掉
        await saveTranslationResult(dir, await translateDocument(pageTexts));
      } catch (e) {
        await saveTranslationResult(dir, `（翻译失败：${e instanceof Error ? e.message : String(e)}）`).catch(() => {});
      }
    })();
  }

  const meta: PaperMeta = {
    slug, title: title || slug, source: "imported", pages, importedAt: new Date().toISOString(), sha256,
  };
  await fs.writeFile(path.join(dir, "meta.json"), JSON.stringify(meta, null, 2), "utf-8");
  try {await registerPaper(meta);}catch(error){await fs.rm(paperDirectory(slug),{recursive:true,force:true});throw error;}
  // 与手动导入一致：仅按用户主动收藏生成术语卡片。

  return { slug, title: meta.title, pages, url, imported: true };
  });
}
