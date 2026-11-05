import { withToolObservation } from "@/lib/learning/tool-observation";
/**
 * 论文导入与翻译接口（"丢 PDF 给工具"的核心）
 * POST /api/paper  multipart: file=<PDF> → 保存 data/papers/<slug>/original.pdf，
 *   提取每页文本（pdfjs-dist），把全文按段落组织翻译成一篇 Markdown（deepseek-chat），
 *   存档 page_XX.txt（每页原文）/ translation.md（整篇中文翻译）/ meta.json（含内容 sha256）
 *   （扫描版无文本层会 422；视觉翻译留作后续）
 *   去重：同一 PDF（内容 sha256 相同）重复上传不重复入库，返回 { duplicate: true }。
 * POST /api/paper  JSON:
 *   { action:"delete", slug }   → 删 data/papers/<slug> + 清理论文库记录
 *   { action:"translate", slug }→ 重新生成整篇中文翻译（后台进行；失败写 translation.error.txt 可见）
 * GET  /api/paper?slug=<slug> → { meta, pages: [{n, original, zh}], translation, translationError }
 * GET  /api/paper            → 已导入论文列表
 * 存储：本地 data/papers/；生产（Vercel）由 store 适配器同层扩展（云服务器直接用文件）
 * 依据：node_modules/next/dist/docs/01-app/01-getting-started/15-route-handlers.md
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { DATA_DIR } from "@/lib/store";
import { translateDocument } from "@/lib/translate";
import {
  saveTranslationResult, readTranslationError,
  translationRunning, markTranslationRunning, clearTranslationRunning,
} from "@/lib/translate-store";
import { getProject, listProjects } from "@/lib/project";

import {paperDirectory,removePaper,renamePaper,findPaperByHash,registerPaper} from '@/lib/paper-management';
import {withProjectLock} from '@/lib/project-lock';
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
  sha256?: string;
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

/** 后台生成整篇中文翻译：成功写 translation.md，失败写 translation.error.txt（阅读页可见、可重试） */
async function translateInBackground(dir: string, pages: string[]): Promise<void> {
  try {
    await saveTranslationResult(dir, await translateDocument(pages));
  } catch (e) {
    await saveTranslationResult(dir, `（翻译失败：${e instanceof Error ? e.message : String(e)}）`).catch(() => {});
  } finally {
    await clearTranslationRunning(dir);
  }
}

async function observedPOST(request: Request) {
  // JSON 动作：delete（从精读页删除）/ translate（重新生成中文翻译）
  const contentType = request.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    let body: { action?: string; slug?: string; title?: unknown };
    try { body = await request.json(); } catch { return Response.json({ error: "请求体必须是 JSON" }, { status: 400 }); }
    if ((body?.action === "delete" || body?.action === "rename") && body.slug) {
      try { return Response.json(body.action === 'delete' ? await removePaper(body.slug) : await renamePaper(body.slug, body.title)); }
      catch (error) { return Response.json({error:error instanceof Error ? error.message : '操作失败，请重试'}, {status:400}); }
    }
    if (body?.action === "translate" && body.slug) {
      try {
        const dir = paperDirectory(body.slug);
        const meta: PaperMeta = JSON.parse(await fs.readFile(path.join(dir, "meta.json"), "utf-8"));
        const pages: string[] = [];
        for (let i = 1; i <= meta.pages; i++) {
          pages.push(await fs.readFile(path.join(dir, `page_${String(i).padStart(2, "0")}.txt`), "utf-8").catch(() => ""));
        }
        if (pages.length === 0 || pages.every((p) => !p.trim())) {
          return Response.json({ error: "页面原文缺失，无法翻译" }, { status: 422 });
        }
        const alreadyRunning = await translationRunning(dir);
        if (!alreadyRunning) {
          await markTranslationRunning(dir);
          void translateInBackground(dir, pages);
        }
        return Response.json({ ok: true, running: alreadyRunning });
      } catch {
        return Response.json({ error: "论文不存在" }, { status: 404 });
      }
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
  const projectId = String(form.get("projectId") ?? "").trim();
  if (projectId && !(await getProject(projectId))) {
    return Response.json({ error: "目标项目不存在，请返回项目列表后重试" }, { status: 404 });
  }

  if (projectId) {
    const target = await getProject(projectId);
    if (target?.paperSlug && await fs.stat(path.join(paperDirectory(target.paperSlug), 'original.pdf')).then(() => true).catch(() => false)) {
      return Response.json({error:'这个项目已有 PDF，请从论文库直接导入新论文'}, {status:409});
    }
  }
  const buf = new Uint8Array(await file.arrayBuffer());
  const sha256 = crypto.createHash("sha256").update(buf).digest("hex");

  // 内容级去重：同一份 PDF 之前导入过 → 不再重复入库（旧记录含时间戳 slug，按文件名判断不住）
  const dup = await findPaperByHash(sha256);
  if (dup) {
    try {
      const project = await registerPaper(dup,projectId||undefined);
      return Response.json({ ok: true, duplicate: true, slug: dup.slug, title: dup.title, project });
    } catch (error) {
      return Response.json({ error: error instanceof Error ? error.message : "无法关联论文项目" }, { status: 409 });
    }
  }

  const slug = slugify(file.name);
  const dir = path.join(PAPERS_DIR, slug);
  await fs.mkdir(dir, { recursive: true });

  const pdfPath = path.join(dir, "original.pdf");
  await fs.writeFile(pdfPath, buf);

  let pages: string[];
  try {
    pages = await extractText(pdfPath);
  } catch (e) {
    await fs.rm(paperDirectory(slug), {recursive:true,force:true});
    return Response.json({ error: `PDF 解析失败：${e instanceof Error ? e.message : String(e)}` }, { status: 422 });
  }

  // 无文本层（扫描版）→ 报错并说明；视觉翻译（DeepSeek 视觉端点）留作后续支持
  const textChars = pages.reduce((s, p) => s + p.trim().length, 0);
  if (!pages.length || textChars < pages.length * 100) {
    await fs.rm(paperDirectory(slug), {recursive:true,force:true});
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
    sha256,
  };
  await fs.writeFile(path.join(dir, "meta.json"), JSON.stringify(meta, null, 2), "utf-8");

  // 写进论文库 library.json，让「论文库」视图能看到这篇（否则只存在于 data/papers，精读页能看、库里看不到）
  let project;
  try {
    project = await registerPaper(meta,projectId||undefined);
  } catch (error) {
    await fs.rm(paperDirectory(slug),{recursive:true,force:true});
    return Response.json({ error: error instanceof Error ? error.message : "无法关联论文项目" }, { status: 409 });
  }

  // 整篇中文翻译后台生成（分钟级，不等它；导入立即完成，稍后精读页即可见 translation.md）
  void translateInBackground(dir, pages);

  // 术语卡片仅由用户主动收藏，导入不再自动抽取。

  return Response.json({ ok: true, meta, project });
}

async function observedGET(request: Request) {
  const url = new URL(request.url);
  const slug = url.searchParams.get("slug");

  if (!slug) {
    try {
      const dirs = await fs.readdir(PAPERS_DIR);
      const list: PaperMeta[] = [];
      for (const d of dirs) {
        try {
          const meta = JSON.parse(await fs.readFile(path.join(PAPERS_DIR, d, "meta.json"), "utf-8"));
          if((await fs.stat(path.join(PAPERS_DIR,d,"original.pdf"))).isFile())list.push(meta);
        } catch { /* 跳过不完整目录 */ }
      }
      const projects=await listProjects();
      return Response.json({ papers: list.map(p=>({...p,projectId:projects.find(project=>project.paperSlug===p.slug)?.id})) });
    } catch {
      return Response.json({ papers: [] });
    }
  }

  try {
    const dir = paperDirectory(slug);
    const meta: PaperMeta = JSON.parse(await fs.readFile(path.join(dir, "meta.json"), "utf-8"));
    const pages = [];
    for (let i = 1; i <= meta.pages; i++) {
      const n = String(i).padStart(2, "0");
      const original = await fs.readFile(path.join(dir, `page_${n}.txt`), "utf-8").catch(() => "");
      const zh = await fs.readFile(path.join(dir, `page_${n}.zh.md`), "utf-8").catch(() => "");
      pages.push({ n: i, original, zh });
    }
    // 整篇中文翻译 + 失败原因（旧论文可能都没有）
    const translation = await fs.readFile(path.join(dir, "translation.md"), "utf-8").catch(() => "");
    const translationError = await readTranslationError(dir);
    return Response.json({ meta, pages, translation, translationError });
  } catch {
    return Response.json({ error: "论文不存在" }, { status: 404 });
  }
}

export const POST=withToolObservation({source:"论文阅读与导入",scene:"paper",conversation:false},request => withProjectLock(() => observedPOST(request)));

export const GET=withToolObservation({source:"论文阅读与导入",scene:"paper",conversation:false},observedGET);
