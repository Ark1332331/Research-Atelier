// 为已导入的论文生成整篇中文翻译 translation.md
// 用法：node scripts/translate-full.mjs <slug> [--force]
//   - 读取 data/papers/<slug>/page_XX.txt（上传时提取的每页原文）
//   - 全文按段落边界分块调 DeepSeek（deepseek-chat，文本层方案）
//   - 输出 Markdown 写到 data/papers/<slug>/translation.md
// 提示词与 src/app/api/paper/route.ts 的 TRANSLATE_SYSTEM 保持一致（改这里要同步改那边）。
import { promises as fs } from "node:fs";
import path from "node:path";

const slug = process.argv[2];
const force = process.argv.includes("--force");
if (!slug) {
  console.error("用法: node scripts/translate-full.mjs <slug> [--force]");
  process.exit(1);
}

const root = path.join(process.cwd(), "data", "papers", slug);
const meta = JSON.parse(await fs.readFile(path.join(root, "meta.json"), "utf-8"));
const outPath = path.join(root, "translation.md");
if (!force) {
  const existing = await fs.readFile(outPath, "utf-8").catch(() => "");
  if (existing.trim().length > 200) {
    console.log(`translation.md 已存在（${existing.length} 字符），跳过。要重新生成请加 --force。`);
    process.exit(0);
  }
}

// 读 API key（.env.local：DEEPSEEK_API_KEY=...）
let apiKey = process.env.DEEPSEEK_API_KEY ?? "";
if (!apiKey) {
  try {
    const env = await fs.readFile(path.join(process.cwd(), ".env.local"), "utf-8");
    const m = env.match(/^DEEPSEEK_API_KEY=(.+)$/m);
    if (m) apiKey = m[1].trim();
  } catch { /* ignore */ }
}
if (!apiKey) {
  console.error("找不到 DEEPSEEK_API_KEY（.env.local 或环境变量）。");
  process.exit(1);
}

const pages = [];
for (let i = 1; i <= meta.pages; i++) {
  const n = String(i).padStart(2, "0");
  pages.push(await fs.readFile(path.join(root, `page_${n}.txt`), "utf-8"));
}
const full = pages.map((t, i) => `【第 ${i + 1} 页】\n${t}`).join("\n\n");
console.log(`${meta.title}: ${meta.pages} 页，全文 ${full.length} 字符。`);

const TRANSLATE_SYSTEM =
  "你是学术论文翻译引擎。把用户发来的英文论文翻译成中文，并输出 Markdown。规则：\n" +
  "1. 保留原文的章节结构：论文标题用一级标题 #，各节标题用 ##，小节用 ###；原文没有标题的段落保持为普通段落；\n" +
  "2. 段落与原文一一对应：同一段落在原文中跨页的，请合并成一个完整段落；不要合并原文中不同的段落；\n" +
  "3. 公式、数字、变量名、引用编号 [x] 原样保留；图注/表注也要翻译；\n" +
  "4. 专业术语第一次出现时用「英文（中文）」格式（如 point cloud（点云）），之后直接用中文；\n" +
  "5. 不要输出任何前言、后语或说明，只输出译文正文；\n" +
  "6. 若输入注明是论文的某一部分（续段），直接续译，不要重复输出论文总标题。";

// 带页码标记的全文；按「章节标题边界」分块：块内不切碎段落，
// 块与块之间在标题处断开，模型每块都被告知是同一篇论文的续段
const HEADING_RE = /^(?:[ivxlcdm]+[.)]\s+)?[A-Z][A-Z\s&,'’-]{2,}$/i;
const isHeadingLine = (line) => {
  const t = line.trim();
  if (!t || t.length > 70 || /^\d{1,3}$/.test(t)) return false;
  return HEADING_RE.test(t);
};
const TARGET = 14000, HARD = 18000;
const chunks = [];
{
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
}
console.log(`分 ${chunks.length} 块请求 DeepSeek…`);

const CONTINUE_NOTE =
  "这是同一篇论文的一部分（已按章节切分。请直接输出这一部分的译文，不要输出论文总标题，" +
  "也不要重复前面已翻译的内容；若开头是章节标题，用相应层级的 ## 标题）。";

console.log(`并行请求 ${chunks.length} 块（总耗时 ≈ 单块耗时）…`);
const out = await Promise.all(chunks.map(async (chunk, i) => {
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
  });
  const data = await res.json();
  if (!res.ok) {
    console.error(`块 ${i + 1} 失败: ${data?.error?.message ?? JSON.stringify(data).slice(0, 200)}`);
    return "";
  }
  const content = data?.choices?.[0]?.message?.content ?? "";
  console.log(`  块 ${i + 1}/${chunks.length} 完成（${content.length} 字符）`);
  return content;
}))

const translation = out.join("\n\n");
await fs.writeFile(outPath, translation, "utf-8");
console.log(`已写入 ${outPath}（${translation.length} 字符）。`);
