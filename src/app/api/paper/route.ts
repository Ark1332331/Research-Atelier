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
import { DATA_DIR } from "@/lib/store";

const execFileAsync = promisify(execFile);

// 桌面壳（Electron）里 Next server 由 Electron 二进制以 ELECTRON_RUN_AS_NODE 模式拉起，
// 子进程 node 也要走同一二进制（环境变量 RA_NODE_BIN），避免依赖系统 node。
const NODE_BIN = process.env.RA_NODE_BIN ?? "node";

const PAPERS_DIR = path.join(DATA_DIR, "papers");

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

/* 全文翻译系统提示词：与 scripts/translate-full.mjs 保持一致（改这里要同步改那边） */
const TRANSLATE_SYSTEM =
  "你是学术论文翻译引擎。把用户发来的英文论文翻译成中文，并输出 Markdown。规则：\n" +
  "1. 保留原文的章节结构：论文标题用一级标题 #，各节标题用 ##，小节用 ###；原文没有标题的段落保持为普通段落；\n" +
  "2. 段落与原文一一对应：同一段落在原文中跨页的，请合并成一个完整段落；不要合并原文中不同的段落；\n" +
  "3. 公式、数字、变量名、引用编号 [x] 原样保留；图注/表注也要翻译；\n" +
  "4. 专业术语第一次出现时用「英文（中文）」格式（如 point cloud（点云）），之后直接用中文；\n" +
  "5. 不要输出任何前言、后语或说明，只输出译文正文；\n" +
  "6. 若输入注明是论文的某一部分（续段），直接续译，不要重复输出论文总标题。";

/* 疑似章节标题的行（用于分块时对齐边界）：ABSTRACT / I. INTRODUCTION / REFERENCES 之类 */
const HEADING_RE = /^(?:[ivxlcdm]+[.)]\s+)?[A-Z][A-Z\s&,'’-]{2,}$/i;

function isHeadingLine(line: string): boolean {
  const t = line.trim();
  if (!t || t.length > 70 || /^\d{1,3}$/.test(t)) return false;
  return HEADING_RE.test(t);
}

/** 全文按「章节标题边界」分块：块内不切碎段落，块与块在标题处断开。
    块大小取 14k/18k（输出约 5-6k token，在 8k 输出上限内），块数尽量少。 */
function chunkDocument(full: string): string[] {
  const TARGET = 14000, HARD = 18000;
  const chunks: string[] = [];
  const lines = full.split("\n");
  let acc = "";
  for (const line of lines) {
    if (acc.length >= TARGET && isHeadingLine(line)) {
      chunks.push(acc.replace(/\n+$/, ""));
      acc = "";
    } else if (acc.length >= HARD) {
      chunks.push(acc.replace(/\n+$/, ""));
      acc = "";
    }
    acc += line + "\n";
  }
  if (acc.trim()) chunks.push(acc.replace(/\n+$/, ""));
  return chunks;
}

const CONTINUE_NOTE =
  "这是同一篇论文的一部分（已按章节切分。请直接输出这一部分的译文，不要输出论文总标题，" +
  "也不要重复前面已翻译的内容；若开头是章节标题，用相应层级的 ## 标题）。";

/** 全文按段落组织翻译成一篇 Markdown（文本层方案；扫描版无文本层会报错） */
async function translateDocument(pages: string[]): Promise<string> {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) return "（未配置 DEEPSEEK_API_KEY，无法翻译）";

  // 带页码标记的全文；按章节边界分块，保证跨页段落有上下文可合并
  const full = pages.map((t, i) => `【第 ${i + 1} 页】\n${t}`).join("\n\n");
  const chunks = chunkDocument(full);

  // 并行请求全部块：总耗时 ≈ 单块耗时（块间无依赖，译文按块序拼接）。
  // DeepSeek 直连在部分网络下不稳定，对每个块做 2 次重试，避免一次抖动导致整段失败。
  const out = await Promise.all(chunks.map(async (chunk, i) => {
    let data: { choices?: { message?: { content?: string } }[]; error?: { message?: string } } | null = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
      if (attempt > 1) await new Promise((r) => setTimeout(r, 600 * 2 ** (attempt - 2)));
      try {
        const res = await fetch("https://api.deepseek.com/chat/completions", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
          body: JSON.stringify({
            model: "deepseek-chat",
            messages: [
              { role: "system", content: TRANSLATE_SYSTEM },
              { role: "user", content: i === 0 ? chunk : `${CONTINUE_NOTE}\n\n${chunk}` },
            ],
            stream: false,
            max_tokens: 8000,
          }),
          signal: AbortSignal.timeout(120000),
        });
        data = await res.json();
        if (res.ok) break;
        if (res.status < 500 && res.status !== 429) break; // 业务错误，重试无意义
      } catch { /* 网络层错误，重试 */ }
    }
    return data?.choices?.[0]?.message?.content ?? "（翻译失败：网络不稳定，请稍后重试导入）";
  }));
  return out.join("\n\n");
}

export async function POST(request: Request) {
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

  // 存每页原文 + 整篇按段落组织的中文翻译（translation.md）
  for (let i = 0; i < pages.length; i++) {
    await fs.writeFile(path.join(dir, `page_${String(i + 1).padStart(2, "0")}.txt`), pages[i], "utf-8");
  }
  const translation = await translateDocument(pages);
  await fs.writeFile(path.join(dir, "translation.md"), translation, "utf-8");

  const meta: PaperMeta = {
    slug,
    title: file.name.replace(/\.pdf$/i, ""),
    pages: pages.length,
    importedAt: new Date().toISOString(),
  };
  await fs.writeFile(path.join(dir, "meta.json"), JSON.stringify(meta, null, 2), "utf-8");

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
