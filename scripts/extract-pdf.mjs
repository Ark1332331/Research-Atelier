#!/usr/bin/env node
/**
 * PDF 文本提取脚本（独立运行，绕开 Next 打包对 pdfjs worker 的干扰）
 * 用法：node scripts/extract-pdf.mjs <pdf路径> [输出目录]
 * 输出：若给出输出目录，写入 page_01.txt...；stdout 只打印 JSON { pages: n, texts: [...] }
 *
 * 提取策略（v2）：不再把所有 item 拼成一行，而是按 baseline 聚成「行」、
 * 按水平中点把行分成左右两栏（同 pdf-alignment.ts 的 detectParagraphs 思路），
 * 栏内按从上到下输出，行间换行，连字符断词合并。这样翻译模型能拿到段落结构。
 */
// 抑制库警告污染 stdout（警告改走 stderr，stdout 只留 JSON）
const origLog = console.log.bind(console);
const origWarn = console.warn.bind(console);
console.log = (...a) => origLog("[pdf]", ...a);
console.warn = (...a) => origWarn("[pdf:warn]", ...a);

import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import path from "node:path";
import { readFile, mkdir, writeFile } from "node:fs/promises";

const workerPath = path.join(
  process.cwd(),
  "node_modules",
  "pdfjs-dist",
  "legacy",
  "build",
  "pdf.worker.mjs",
);
pdfjs.GlobalWorkerOptions.workerSrc = workerPath;

const [pdfPath, outDir] = process.argv.slice(2);
if (!pdfPath) {
  console.error("用法：node scripts/extract-pdf.mjs <pdf路径> [输出目录]");
  process.exit(1);
}

const data = new Uint8Array(await readFile(pdfPath));
const doc = await pdfjs.getDocument({ data }).promise;

/** 一页的 text items → 行 → 双栏拆分的纯文本（段落结构尽量保留） */
function itemsToText(items) {
  const its = items.filter((it) => it && typeof it.str === "string" && it.str.trim());
  if (!its.length) return "";

  // 1) 按 baseline 聚行（PDF 坐标系 y 向上：页顶 y 大）
  const rows = [];
  for (const it of its) {
    const y = it.transform[5];
    const h = Math.abs(it.transform[3]) || 10;
    let row = rows.find((r) => Math.abs(r.y - y) < Math.max(h, 10) * 0.5);
    if (!row) { row = { y, items: [] }; rows.push(row); }
    row.items.push(it);
  }
  for (const r of rows) r.items.sort((a, b) => a.transform[4] - b.transform[4]);
  rows.sort((a, b) => b.y - a.y); // 从上到下

  const lineOf = (list) =>
    list.map((i) => i.str).join(" ").replace(/\s+/g, " ").trim();

  // 2) 每行按「最大内部空隙」拆左右栏：
  //    双栏行在栏间有 20+pt 的沟槽 → 在最大空隙处切成两行；
  //    通栏行（标题/图注）空隙小 → 保持一行。
  const GUTTER = 8;
  const left = [], right = [];
  for (const r of rows) {
    if (!r.items.length) continue;
    let bestIdx = -1, bestGap = -1;
    for (let i = 0; i < r.items.length - 1; i++) {
      const aEnd = r.items[i].transform[4] + (r.items[i].width || 0);
      const gap = r.items[i + 1].transform[4] - aEnd;
      if (gap > bestGap) { bestGap = gap; bestIdx = i; }
    }
    if (bestGap > GUTTER) {
      const l = lineOf(r.items.slice(0, bestIdx + 1));
      const rr = lineOf(r.items.slice(bestIdx + 1));
      if (l) left.push(l);
      if (rr) right.push(rr);
    } else {
      const line = lineOf(r.items);
      if (line) left.push(line);
    }
  }

  // 3) 连字符断词合并（environ- + ment → environment）；数学负号不合并
  const mergeHyphens = (lines) => {
    const out = [];
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      const next = lines[i + 1] ?? "";
      if (/[A-Za-z]-\s*$/.test(l) && /^[a-z]/.test(next)) {
        out.push(l.replace(/-\s*$/, "") + next);
        i++;
      } else out.push(l);
    }
    return out;
  };
  const parts = [...mergeHyphens(left)];
  if (right.length) parts.push("", ...mergeHyphens(right));
  return parts.join("\n");
}

const pages = [];
for (let i = 1; i <= doc.numPages; i++) {
  const page = await doc.getPage(i);
  const content = await page.getTextContent();
  const text = itemsToText(content.items);
  pages.push(text);
  if (outDir) {
    await mkdir(outDir, { recursive: true });
    await writeFile(
      path.join(outDir, `page_${String(i).padStart(2, "0")}.txt`),
      text,
      "utf-8",
    );
  }
}

process.stdout.write(JSON.stringify({ pages: pages.length, texts: pages }));
