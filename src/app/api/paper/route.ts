/**
 * 论文导入与翻译接口（"丢 PDF 给工具"的核心）
 * POST /api/paper  multipart: file=<PDF> → 保存 data/papers/<slug>/original.pdf，
 *   提取每页文本（pdfjs-dist），把全文按段落组织翻译成一篇 Markdown（deepseek-chat），
 *   存档 page_XX.txt（每页原文）/ translation.md（整篇中文翻译）/ meta.json
 *   （扫描版无文本层会 422；视觉翻译留作后续）
 * GET  /api/paper?slug=<slug> → { meta, pages: [{n, original, zh}], translation }
 * GET  /api/paper            → 已导入论文列表
 * 存储：本地 data/papers/；生产（Vercel）由 store 适配器同层扩展（云服务器直接用文件）
 * 依据：node_modules/next/dist/docs/01-app/01-getting-started/15-route-handlers.md
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { DATA_DIR, readStore, writeStore } from "@/lib/store";
import { translateDocument } from "@/lib/translate";
import { extractTermsInBackground } from "@/lib/terms-extract";

const execFileAsync = promisify(execFile);

// 桌面壳（Electron）里 Next server 由 Electron 二进制以 ELECTRON_RUN_AS_NODE 模式拉起，
// 子进程 node 也要走同一二进制（环境变量 RA_NODE_BIN），避免依赖系统 node。
const NODE_BIN = process.env.RA_NODE_BIN ?? "node";

const PAPERS_DIR = path.join(DATA_DIR, "papers");

/** 从论文库 data/library.json 中移除指定 slug 的论文记录（若存在） */
async function removeFromLibraryBySlug(slug: string): Promise<void> {
  const raw = await readStore("library.json");
  if (!raw) return;
  try {
    const lib = JSON.parse(raw);
    if (Array.isArray(lib?.papers)) {
      lib.papers = lib.papers.filter((p: { slug?: string }) => p?.slug !== slug);
      await writeStore("library.json", JSON.stringify(lib, null, 2));
    }
  } catch { /* 忽略 */ }
}

interface PaperMeta {
  slug: string;
  title: string;
  pages: number;
  importedAt: string;
}

function slugify(name: string): string {
  const base = name.replace(/\.pdf$/i, "").replace(/[^\w\u4e00-\u9fa5-]+/g, "-").slice(0, 60);
  return `${base}-${Date.now().toString(36)}`;
}

/** 把导入的论文写进论文库 data/library.json（去重：同 slug 不重复加）。
 *  与 src/lib/paper-tools.ts 的 addToLibrary 保持一致——手动上传（本路由）
 *  和联网下载（downloadPaper）都必须落到 library.json，否则「论文库」视图看不到。 */
async function addToLibraryBySlug(meta: PaperMeta): Promise<void> {
  const raw = await readStore("library.json");
  let lib: { groups: unknown[]; papers: any[] };
  try {
    lib = raw ? JSON.parse(raw) : { groups: [], papers: [] };
    if (!Array.isArray(lib.papers)) lib.papers = [];
    if (!Array.isArray(lib.groups)) lib.groups = [];
  } catch {
    lib = { groups: [], papers: [] };
  }
  if (lib.papers.some((p: { slug?: string }) => p?.slug === meta.slug)) return; // 已导入过
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

async function extractText(pdfFullPath: string): Promise<string[]> {
  // 独立脚本提取（绕开 Next 打包对 pdfjs worker 的干扰）
  const script = path.join(process.cwd(), "scripts", "extract-pdf.mjs");
  const childEnv: NodeJS.ProcessEnv = { ...process.env };
  if (process.env.RA_NODE_BIN) childEnv.ELECTRON_RUN_AS_NODE = "1"; // Electron 二进制当 node 用时必须带此开关
  const { stdout } = await execFileAsync(NODE_BIN, [script, pdfFullPath], {
    cwd: process.cwd(),
    env: childEnv,
    maxBuffer: 64 * 1024 * 1024,
  });
  // 容错：stdout 可能混入库警告，取第一个 { 之后的部分解析
  const jsonStart = stdout.indexOf("{");
  const parsed = JSON.parse(jsonStart >= 0 ? stdout.slice(jsonStart) : stdout);
  return Array.isArray(parsed.texts) ? parsed.texts : [];
}


export async function POST(request: Request) {
  // 支持 JSON { action:"delete", slug }：从精读页删除一篇导入论文（删 data/papers/<slug> + 清理论文库记录）
  const contentType = request.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    let body: { action?: string; slug?: string };
    try { body = await request.json(); } catch { return Response.json({ error: "请求体必须是 JSON" }, { status: 400 }); }
    if (body?.action === "delete" && body.slug) {
      await fs.rm(path.join(PAPERS_DIR, body.slug), { recursive: true, force: true }).catch(() => {});
      await removeFromLibraryBySlug(body.slug);
      return Response.json({ ok: true });
    }
    return Response.json({ error: "未知 action" }, { status: 400 });
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return Response.json({ error: "需要 multipart 表单" }, { status: 400 });
  }
  const file = form.get("file");
  if (!(file instanceof File) || !file.name.toLowerCase().endsWith(".pdf")) {
    return Response.json({ error: "请上传 PDF 文件" }, { status: 400 });
  }

  const slug = slugify(file.name);
  const dir = path.join(PAPERS_DIR, slug);
  await fs.mkdir(dir, { recursive: true });

  const buf = new Uint8Array(await file.arrayBuffer());
  const pdfPath = path.join(dir, "original.pdf");
  await fs.writeFile(pdfPath, buf);

  let pages: string[];
  try {
    pages = await extractText(pdfPath);
  } catch (e) {
    return Response.json({ error: `PDF 解析失败：${e instanceof Error ? e.message : String(e)}` }, { status: 422 });
  }

  // 无文本层（扫描版）→ 报错并说明；视觉翻译（DeepSeek 视觉端点）留作后续支持
  const textChars = pages.reduce((s, p) => s + p.trim().length, 0);
  if (textChars < pages.length * 100) {
    return Response.json(
      { error: "这个 PDF 没有文本层（可能是扫描版）。当前版本用文本层做全文翻译，扫描版请先 OCR，或等后续接入视觉翻译。" },
      { status: 422 },
    );
  }

  // 存每页原文（整篇中文翻译放到后台异步生成，避免上传导入卡在翻译上）
  for (let i = 0; i < pages.length; i++) {
    await fs.writeFile(path.join(dir, `page_${String(i + 1).padStart(2, "0")}.txt`), pages[i], "utf-8");
  }

  const meta: PaperMeta = {
    slug,
    title: file.name.replace(/\.pdf$/i, ""),
    pages: pages.length,
    importedAt: new Date().toISOString(),
  };
  await fs.writeFile(path.join(dir, "meta.json"), JSON.stringify(meta, null, 2), "utf-8");

  // 写进论文库 library.json，让「论文库」视图能看到这篇（否则只存在于 data/papers，精读页能看、库里看不到）
  await addToLibraryBySlug(meta);

  // 整篇中文翻译后台生成（分钟级，不等它；导入立即完成，稍后精读页即可见 translation.md）
  void (async () => {
    try {
      const translation = await translateDocument(pages);
      if (translation && !translation.startsWith("（未配置") && !translation.includes("（翻译失败")) {
        await fs.writeFile(path.join(dir, "translation.md"), translation, "utf-8");
      }
    } catch { /* 忽略 */ }
  })();

  // 术语抽查：导入后后台从全文抽核心术语，记入术语卡（数量不限，需要的才抽；已存在的跳过）
  extractTermsInBackground(pages, meta.title);

  return Response.json({ ok: true, meta });
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const slug = url.searchParams.get("slug");

  if (!slug) {
    try {
      const dirs = await fs.readdir(PAPERS_DIR);
      const list: PaperMeta[] = [];
      for (const d of dirs) {
        try {
          const meta = JSON.parse(await fs.readFile(path.join(PAPERS_DIR, d, "meta.json"), "utf-8"));
          list.push(meta);
        } catch { /* 跳过不完整目录 */ }
      }
      return Response.json({ papers: list });
    } catch {
      return Response.json({ papers: [] });
    }
  }

  try {
    const dir = path.join(PAPERS_DIR, slug);
    const meta: PaperMeta = JSON.parse(await fs.readFile(path.join(dir, "meta.json"), "utf-8"));
    const pages = [];
    for (let i = 1; i <= meta.pages; i++) {
      const n = String(i).padStart(2, "0");
      const original = await fs.readFile(path.join(dir, `page_${n}.txt`), "utf-8").catch(() => "");
      const zh = await fs.readFile(path.join(dir, `page_${n}.zh.md`), "utf-8").catch(() => "");
      pages.push({ n: i, original, zh });
    }
    // 整篇中文翻译（上传时生成；旧论文可能没有）
    const translation = await fs.readFile(path.join(dir, "translation.md"), "utf-8").catch(() => "");
    return Response.json({ meta, pages, translation });
  } catch {
    return Response.json({ error: "论文不存在" }, { status: 404 });
  }
}
