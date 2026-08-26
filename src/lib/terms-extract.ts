/**
 * 术语抽查：导入论文后自动从论文文本抽取核心专业术语，生成术语卡并入 glossary.json。
 * 与导入解耦——放到后台异步执行（不阻塞导入）；已存在的术语跳过；数量不限（需要的才抽）。
 * 数据层复用 src/lib/store.ts（本地 data/glossary.json；生产（Vercel）自动切 KV）。
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { DATA_DIR, readStore, writeStore } from "@/lib/store";

const ROLE_OPTIONS = [
  "感知/传感器", "状态估计/对齐", "场景表示/建图", "补全/学习机制",
  "控制/决策", "训练机制", "评估指标", "工程/部署", "领域背景",
];
const REUSE_OPTIONS = ["通用", "论文特有", "论文内特殊含义"];

const EXTRACT_SYSTEM =
  "你是学术论文术语卡抽取引擎。从用户给的论文文本里，抽取这篇论文中核心的、学习者可能需要了解的专业术语（英文为主，中文术语也可）。\n" +
  "要求：\n" +
  "1. 抽" + "这篇论文真正需要的、阅读中会卡住的术语；数量不限，论文需要多少就抽多少，但只抽真正相关、会在文中反复出现或属于本领域核心的，不要抽无关的普通词。\n" +
  "2. 每个术语输出一个 JSON 对象（严格，不要输出 JSON 以外的任何文字）：{\"name\":\"英文术语名\",\"role\":\"从这些里选一个：感知/传感器, 状态估计/对齐, 场景表示/建图, 补全/学习机制, 控制/决策, 训练机制, 评估指标, 工程/部署, 领域背景\",\"reuse\":\"通用或论文特有或论文内特殊含义\",\"note\":\"当前先理解为（一句话中文）\"}\n" +
  "3. 把全部术语作为 JSON 数组输出，例如：[{\"name\":\"point cloud\",\"role\":\"感知/传感器\",\"reuse\":\"通用\",\"note\":\"环境的离散三维点集\"}]。不要用 markdown 代码块包裹，只要纯 JSON 数组。";

interface ExtractedTerm { name: string; role?: string; reuse?: string; note?: string }

/** 从文本调 DeepSeek 抽取术语（带重试），返回术语数组 */
async function extractTerms(text: string): Promise<ExtractedTerm[]> {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) return [];
  let d: { choices?: { message?: { content?: string } }[] } | null = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    if (attempt > 1) await new Promise((r) => setTimeout(r, 600 * 2 ** (attempt - 2)));
    try {
      const res = await fetch("https://api.deepseek.com/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model: "deepseek-chat",
          messages: [
            { role: "system", content: EXTRACT_SYSTEM },
            { role: "user", content: text.slice(0, 15000) },
          ],
          stream: false,
          max_tokens: 4000,
        }),
        signal: AbortSignal.timeout(90000),
      });
      if (res.ok) { d = await res.json(); break; }
      if (res.status < 500 && res.status !== 429) break;
    } catch { /* 重试 */ }
  }
  const content = d?.choices?.[0]?.message?.content ?? "";
  const arr = parseJsonArray(content);
  return Array.isArray(arr) ? arr.filter((t) => t && typeof t.name === "string") : [];
}

/** 从模型输出里取 JSON 数组（容忍 ```json 包裹 / 前后文字） */
function parseJsonArray(s: string): unknown {
  const cleaned = s.replace(/```(?:json)?/g, "").trim();
  const start = cleaned.indexOf("[");
  const end = cleaned.lastIndexOf("]");
  if (start < 0 || end < start) return null;
  try { return JSON.parse(cleaned.slice(start, end + 1)); } catch { return null; }
}

/** 把抽取到的术语 upsert 进术语卡 glossary.json（已存在的 name 跳过） */
async function saveTermsToGlossary(terms: ExtractedTerm[], sourceTitle: string): Promise<void> {
  const raw = await readStore("glossary.json");
  let arr: Record<string, unknown>[] = [];
  try {
    const d = raw ? JSON.parse(raw) : [];
    if (Array.isArray(d)) arr = d;
  } catch { /* 忽略坏数据 */ }
  const existing = new Set(arr.map((t) => String((t as { name?: string })?.name ?? "")));
  const now = new Date().toISOString();
  let added = 0;
  for (const t of terms) {
    const name = (t.name ?? "").trim();
    if (!name || existing.has(name)) continue;
    arr.push({
      id: `t${Date.now().toString(36)}${Math.floor(Math.random() * 1000).toString(36)}`,
      name,
      role: ROLE_OPTIONS.includes(t.role ?? "") ? t.role : "领域背景",
      status: "未接触",
      reuse: REUSE_OPTIONS.includes(t.reuse ?? "") ? t.reuse : "通用",
      note: t.note ?? "",
      source: sourceTitle,
      links: "",
      updatedAt: now,
    });
    existing.add(name);
    added++;
  }
  if (added > 0) await writeStore("glossary.json", JSON.stringify(arr, null, 2));
}

/** 导入论文后调用：后台从页文本抽术语并记入术语卡（失败不影响导入） */
export function extractTermsInBackground(pages: string[], sourceTitle: string): void {
  if (!pages || pages.length === 0) return;
  void (async () => {
    try {
      const terms = await extractTerms(pages.join("\n\n"));
      if (terms.length) await saveTermsToGlossary(terms, sourceTitle);
    } catch { /* 术语抽取失败不影响导入 */ }
  })();
}

/** 读取某论文目录下的每页原文（page_01.txt...） */
async function readPageTexts(dir: string): Promise<string[]> {
  try {
    const files = (await fs.readdir(dir)).filter((f) => /^page_\d+\.txt$/.test(f)).sort();
    const out: string[] = [];
    for (const f of files) out.push(await fs.readFile(path.join(dir, f), "utf-8"));
    return out;
  } catch {
    return [];
  }
}

/** 为所有已导入论文补抽术语（后台逐篇），返回将要补抽的篇数 */
export async function backfillTermsForAllPapers(): Promise<{ scanned: number }> {
  const papersDir = path.join(DATA_DIR, "papers");
  const dirs = await fs.readdir(papersDir).catch(() => [] as string[]);
  let scanned = 0;
  for (const d of dirs) {
    const dir = path.join(papersDir, d);
    try {
      if (!(await fs.stat(dir)).isDirectory()) continue;
    } catch {
      continue;
    }
    let title = d;
    try {
      const meta = JSON.parse(await fs.readFile(path.join(dir, "meta.json"), "utf-8"));
      if (meta?.title) title = meta.title;
    } catch { /* 无 meta 用目录名 */ }
    const pages = await readPageTexts(dir);
    if (pages.length) {
      extractTermsInBackground(pages, title);
      scanned++;
    }
  }
  return { scanned };
}
