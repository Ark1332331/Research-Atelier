"use client";

/* 手动位置提取：从 pdf.js 的 getTextContent 里，用 transform + 真实字号 + 上缘，
   把每个 run 换算成 CSS px 框。这套算法在 node 渲染里验证过：术语框精确落在
   "point cloud / locomotion / voxel grid" 等词的字形上。 */

import type { Term } from "@/app/api/terms/route";

export function engName(t: Term) { return t.name.split("/")[0].trim(); }
export function norm(s: string) { return s.toLowerCase().replace(/[^a-z0-9]/g, ""); }

export interface TextItem { x: number; y: number; w: number; h: number; fs: number; baseline: number; text: string; }
export interface TermBox { x: number; y: number; w: number; h: number; term: Term; }
export interface ParaDot { x: number; y: number; text: string; }

const FOOTER_RE = /^(manuscript received|accepted|this paper was (recommended|supported)|this work was supported|the work was supported|correspondence:|©|\d+\s+(is with|affiliated)|\d+\s+.*affiliated)/i;
const CAPTION_RE = /^(fig\.|table\s)/i;
const HEADER_RE = /^IEEE ROBOTICS|^arXiv/i;
const MARKER_RE = /^[\u2022\u25aa\u25cf\u25e6\u00b7*\-\u2013\u2014\s]+$/;

// 读取页文本 + 每项真实 CSS px 框
export async function getPageItems(page: any, vp: any): Promise<TextItem[]> {
  const tc = await page.getTextContent();
  const out: TextItem[] = [];
  for (const raw of tc.items) {
    if (typeof raw !== "object" || raw === null || !("str" in raw) || !raw.str?.trim()) continue;
    const it = raw as { str: string; width: number; transform: number[]; fontName?: string };
    const [px, py] = vp.convertToViewportPoint(it.transform[4], it.transform[5]);
    const fs = Math.abs(it.transform[3]) * vp.scale;              // 真实字号（css px）
    const ar = tc.styles?.[it.fontName ?? ""]?.ascent ?? 0.75;
    out.push({ x: px, y: py - fs * ar, w: it.width * vp.scale, h: fs, fs, baseline: py, text: it.str });
  }
  return out;
}

// 聚成“行”（同基线 + 水平重叠归同一行），再聚成“段”
export function detectParagraphs(items: TextItem[], pageW: number): ParaDot[] {
  const XGAP = 40;
  const rows: { baseline: number; x: number; xMax: number; h: number; texts: string[] }[] = [];
  for (const it of items.slice().sort((a, b) => a.baseline - b.baseline)) {
    const r = rows.find((row) =>
      Math.abs(it.baseline - row.baseline) < Math.max(row.h, it.fs) * 0.5 &&
      (it.x + it.w > row.x - XGAP) && (it.x < row.xMax + XGAP)
    );
    if (r) {
      r.x = Math.min(r.x, it.x);
      r.xMax = Math.max(r.xMax, it.x + it.w);
      r.h = Math.max(r.h, it.fs);
      r.texts.push(it.text);
    } else {
      rows.push({ baseline: it.baseline, x: it.x, xMax: it.x + it.w, h: it.fs, texts: [it.text] });
    }
  }

  const freq: Record<number, number> = {};
  for (const r of rows) { const k = Math.round(r.h); freq[k] = (freq[k] || 0) + 1; }
  const bodyH = +Object.entries(freq).sort((a, b) => b[1] - a[1])[0][0] || 12;
  const bodyBand = (h: number) => h >= bodyH * 0.82 && h <= bodyH * 1.22;
  const leftFreq: Record<number, number> = {};
  for (const r of rows) if (bodyBand(r.h)) { const k = Math.round(r.x); leftFreq[k] = (leftFreq[k] || 0) + 1; }
  const leftMargin = +Object.entries(leftFreq).sort((a, b) => b[1] - a[1])[0][0] || 0;
  let bodyTop = -Infinity;
  for (const r of rows) if (bodyTop === -Infinity && Math.abs(r.x - leftMargin) < 18 && bodyBand(r.h)) bodyTop = r.baseline;
  if (bodyTop === -Infinity) bodyTop = 0;
  const colMid = (leftMargin + pageW) / 2;

  const ok = (r: typeof rows[number]) => {
    const t = r.texts.join(" ").trim();
    if (!t) return false;
    if (HEADER_RE.test(t)) return false;
    if (/^\d{1,2}$/.test(t) && r.baseline < r.h * 3) return false;
    if (r.baseline < bodyTop - 2) return false;
    if (CAPTION_RE.test(t)) return false;
    if (MARKER_RE.test(t) && t.length < 4) return false;
    if (r.h < bodyH * 0.88) return false;
    return true;
  };

  const cols: typeof rows[] = [[], []];
  for (const r of rows.filter(ok)) cols[(r.x + (r.xMax - r.x) / 2) < colMid ? 0 : 1].push(r);

  const dots: ParaDot[] = [];
  for (const col of cols) {
    col.sort((a, b) => a.baseline - b.baseline);
    if (!col.length) continue;
    let inFootnote = false;
    const mean = col.reduce((s, r) => s + r.h, 0) / col.length;
    let cur: { x: number; y: number; texts: string[] } | null = null;
    let prev: typeof col[number] | null = null;
    for (const r of col) {
      const t = r.texts.join(" ").trim();
      if (FOOTER_RE.test(t)) { inFootnote = true; continue; }
      if (inFootnote) continue;
      const gap = prev ? r.baseline - (prev.baseline + prev.h) : 0;
      if (!cur || gap > mean * 0.72) {
        if (cur) dots.push({ x: cur.x, y: cur.y, text: cur.texts.join(" ") });
        cur = { x: r.x, y: r.baseline - r.h / 2, texts: [t] };
      } else {
        cur.x = Math.min(cur.x, r.x);
        cur.texts.push(t);
      }
      prev = r;
    }
    if (cur) dots.push({ x: cur.x, y: cur.y, text: cur.texts.join(" ") });
  }
  dots.sort((a, b) => a.y - b.y);
  return dots;
}

// 匹配术语：整 run 精确命中或用框，短 run 内子串按字符比例定位
export function matchTerms(items: TextItem[], terms: Term[]): TermBox[] {
  const termList = terms
    .map((t) => ({ t, n: norm(engName(t)), eng: engName(t) }))
    .sort((a, b) => b.n.length - a.n.length);
  const boxes: TermBox[] = [];
  const seen = new Set<string>();
  for (const it of items) {
    const tnorm = norm(it.text);
    if (!tnorm || it.text.length > 160) continue;
    const exact = termList.find(({ n }) => n === tnorm);
    if (exact) {
      const key = `${exact.eng}|${Math.round(it.baseline)}|${Math.round(it.x)}`;
      if (!seen.has(key)) { seen.add(key); boxes.push({ x: it.x, y: it.y, w: it.w, h: it.h, term: exact.t }); }
      continue;
    }
    const sub = termList.find(({ n, eng }) => n.length >= 4 && tnorm.includes(n));
    if (sub && !seen.has(`${sub.eng}|${Math.round(it.baseline)}`)) {
      seen.add(`${sub.eng}|${Math.round(it.baseline)}`);
      const idx = it.text.toLowerCase().indexOf(sub.eng.toLowerCase());
      const fw = it.w / it.text.length;
      boxes.push({ x: it.x + idx * fw, y: it.y, w: Math.max(sub.eng.length * fw, 4), h: it.h, term: sub.t });
    }
  }
  return boxes;
}
