/**
 * Candidate Inbox 确定性解析器（B1/B2，v1.2）：**无 LLM**。
 * 混贴输入（标题 / DOI / arXiv URL / 论文 URL / BibTeX / RIS / WoS export）自动拆分；
 * 无法识别的条目进 unknown + parseWarnings，绝不静默丢失。
 */
import type { ImportedPaperCandidate, DetectedType } from "./types.ts";

let seq = 0;
function nextImportId(): string {
  seq += 1;
  return "imp-" + Date.now().toString(36) + "-" + seq.toString(36);
}

const DOI_RE = /10\.\d{4,9}\/[^\s"<>]+/gi;
const ARXIV_RE = /(?:arxiv\.org\/(?:abs|pdf)\/|arxiv:\s*)?(?<![\d.])(\d{4}\.\d{4,5}(?:v\d+)?)/gi;
const URL_RE = /https?:\/\/[^\s"'<>]+/gi;

function cleanToken(s: string): string {
  return String(s).replace(/[.,;:\)\]}>'"’]+$/g, "").trim();
}
function cap(s: string, n = 300): string { return String(s).length > n ? String(s).slice(0, n) + "…" : String(s); }

/* ---------- BibTeX ---------- */

interface BibFields { [k: string]: string; }

/** 提取 @xxx{...} 块（花括号配平），返回块与剩余文本 */
function extractBibtex(text: string): { entries: { full: string; fields: BibFields }[]; rest: string } {
  const entries: { full: string; fields: BibFields }[] = [];
  let rest = String(text);
  const re = /@\w+\s*\{/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(rest)) !== null) {
    const start = m.index;
    let depth = 0;
    let i = rest.indexOf("{", m.index);
    if (i < 0) break;
    for (; i < rest.length; i++) {
      if (rest[i] === "{") depth++;
      else if (rest[i] === "}") { depth--; if (depth === 0) break; }
    }
    if (depth !== 0) break;
    const full = rest.slice(start, i + 1);
    entries.push({ full, fields: parseBibFields(full) });
    rest = rest.slice(0, start) + " ".repeat(full.length) + rest.slice(i + 1);
    re.lastIndex = start;
  }
  return { entries, rest };
}

function parseBibFields(block: string): BibFields {
  const fields: BibFields = {};
  const re = /(\w+)\s*=\s*\{([^{}]*)\}|(\w+)\s*=\s*"([^"]*)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(block)) !== null) {
    const key = (m[1] || m[3] || "").toLowerCase();
    const val = (m[2] || m[4] || "").replace(/[{}]/g, "").trim();
    if (key && val) fields[key] = val;
  }
  return fields;
}

/* ---------- RIS ---------- */

function extractRis(text: string): { entries: { full: string; fields: BibFields }[]; rest: string } {
  const entries: { full: string; fields: BibFields }[] = [];
  let rest = String(text);
  const re = /^TY\s{1,2}-\s*[^\r\n]*/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(rest)) !== null) {
    const start = m.index;
    const endMatch = rest.slice(start).match(/^ER\s{1,2}-[^\r\n]*/m);
    if (!endMatch) break;
    const endIdx = start + (endMatch.index ?? 0) + endMatch[0].length;
    const full = rest.slice(start, endIdx);
    const fields: BibFields = {};
    const lineRe = /^([A-Z]{2})\s{1,2}-\s?(.*)$/gm;
    let lm: RegExpExecArray | null;
    while ((lm = lineRe.exec(full)) !== null) {
      const key = lm[1].toLowerCase();
      const val = lm[2].trim();
      if (!key || !val) continue;
      if (key === "ti" || key === "do" || key === "ur" || key === "py" || key === "ab") {
        fields[key] = fields[key] ? fields[key] + " " + val : val;
      } else if (key === "au") {
        fields.au = fields.au ? fields.au + "; " + val : val;
      }
    }
    entries.push({ full, fields });
    rest = rest.slice(0, start) + " ".repeat(full.length) + rest.slice(endIdx);
    re.lastIndex = start;
  }
  return { entries, rest };
}

/* ---------- WoS export（tag-value 与 TSV） ---------- */

function looksLikeWos(text: string): boolean {
  return /^PT\s+[A-Z]/m.test(text) || /^[A-Z]{2}\s{2,}\S/m.test(text) || /\t/.test(text);
}

function parseWos(text: string): { entries: { full: string; fields: BibFields }[] } {
  const entries: { full: string; fields: BibFields }[] = [];
  // TSV：首行表头含 TI/DI 列
  const lines = String(text).split(/\r?\n/);
  if (lines.length > 1 && lines[0].includes("\t") && /\b(TI|DI)\b/.test(lines[0])) {
    const header = lines[0].split("\t").map((h) => h.trim().toUpperCase());
    const idx = (name: string) => header.indexOf(name);
    for (const line of lines.slice(1)) {
      const cells = line.split("\t");
      if (cells.length < 2) continue;
      const g = (name: string) => { const i = idx(name); return i >= 0 && i < cells.length ? cells[i].trim() : ""; };
      const fields: BibFields = {};
      const ti = g("TI"); if (ti) fields.ti = ti;
      const di = g("DI"); if (di) fields.di = di;
      const py = g("PY"); if (py) fields.py = py;
      const so = g("SO"); if (so) fields.so = so;
      const au = g("AU"); if (au) fields.au = au;
      const ab = g("AB"); if (ab) fields.ab = ab;
      entries.push({ full: line, fields });
    }
    return { entries };
  }
  // tag-value 记录：PT 开头，ER 结束；续行缩进追加到上一字段
  let cur: BibFields | null = null;
  let curFull: string[] = [];
  const tagRe = /^([A-Z]{2})\s{2,}(.*)$/;
  for (const line of lines) {
    const tm = tagRe.exec(line);
    if (tm) {
      const key = tm[1].toLowerCase();
      const val = tm[2].trim();
      if (key === "pt" && val) {
        if (cur) entries.push({ full: curFull.join("\n"), fields: cur });
        cur = {}; curFull = [];
        continue;
      }
      if (cur) {
        curFull.push(line);
        if (key === "er") {
          entries.push({ full: curFull.join("\n"), fields: cur });
          cur = null; curFull = [];
        } else if (val) {
          cur[key] = cur[key] ? cur[key] + " " + val : val;
        }
      }
    } else if (cur && line.trim()) {
      curFull.push(line);
      const last = Object.keys(cur)[Object.keys(cur).length - 1];
      if (last) cur[last] = cur[last] + " " + line.trim();
    }
  }
  if (cur) entries.push({ full: curFull.join("\n"), fields: cur });
  return { entries };
}

/* ---------- 主入口 ---------- */

function item(detectedType: DetectedType, raw: string, extra: Partial<ImportedPaperCandidate> = {}, warnings: string[] = []): ImportedPaperCandidate {
  return { importId: nextImportId(), raw: cap(raw), detectedType, ...extra, parseWarnings: warnings };
}

/** 混贴文本 → 候选列表（deterministic，不抛错；unknown 带 warnings） */
export function parseCandidateBlob(raw: string): ImportedPaperCandidate[] {
  const items: ImportedPaperCandidate[] = [];
  let rest = String(raw ?? "");

  const bib = extractBibtex(rest);
  for (const b of bib.entries) {
    const warnings: string[] = [];
    const title = b.fields.title;
    const doi = b.fields.doi ? cleanToken(b.fields.doi) : undefined;
    const arxivId = b.fields.eprint ? cleanToken(b.fields.eprint) : undefined;
    const url = b.fields.url ? cleanToken(b.fields.url) : undefined;
    if (!title && !doi && !arxivId) warnings.push("BibTeX 条目缺少 title/doi/eprint");
    items.push(item("bibtex", b.full, { title, doi, arxivId, url }, warnings));
  }
  rest = bib.rest;

  const ris = extractRis(rest);
  for (const r of ris.entries) {
    const warnings: string[] = [];
    const title = r.fields.ti;
    const doi = r.fields.do ? cleanToken(r.fields.do) : undefined;
    const url = r.fields.ur ? cleanToken(r.fields.ur) : undefined;
    if (!title && !doi) warnings.push("RIS 条目缺少 TI/DO");
    items.push(item("ris", r.full, { title, doi, url }, warnings));
  }
  rest = ris.rest;

  // WoS：只消费「首个 PT 行 → 末个 ER 行」区域，绝不波及其余混贴内容
  if (looksLikeWos(rest)) {
    const startMatch = rest.match(/^PT\s+[A-Z][^\r\n]*/m);
    if (startMatch) {
      const start = startMatch.index ?? 0;
      let end = -1;
      const erRe = /^ER[^\r\n]*/gm;   // 不允许 \s 跨行吞掉 ER 之后的内容
      let mm: RegExpExecArray | null;
      while ((mm = erRe.exec(rest)) !== null) end = mm.index + mm[0].length;
      if (end > start) {
        const wosText = rest.slice(start, end);
        const wos = parseWos(wosText);
        if (wos.entries.length > 0) {
          for (const w of wos.entries) {
            const title = w.fields.ti;
            const doi = w.fields.di ? cleanToken(w.fields.di) : undefined;
            if (title || doi) {
              items.push(item("wos-export", w.full, { title, doi }));
            } else {
              items.push(item("wos-export", w.full, {}, ["WoS 记录缺少 TI/DI"]));
            }
          }
          rest = rest.slice(0, start) + " ".repeat(end - start) + rest.slice(end);
        }
      }
    }
  }

  // 剩余：按空行分块；块内逐 token 识别 DOI/arXiv/URL（一个块可拆出多个标识条目）；
  // 首个非标识行作为 title；块内无标识且无字母 → unknown（不静默丢失）
  const blocks = String(rest).split(/\n[\s\n]*\n/).map((b) => b.trim()).filter(Boolean);
  for (const block of blocks) {
    const doiTokens = [...block.matchAll(DOI_RE)].map((m) => cleanToken(m[0]));
    const arxivTokens = [...block.matchAll(ARXIV_RE)].map((m) => cleanToken(m[1]));
    const urlTokens = [...block.matchAll(URL_RE)].map((m) => cleanToken(m[0])).filter((u) => !/arxiv\.org\//i.test(u)); // arXiv URL 归 arxiv，不重复出 url
    const total = doiTokens.length + arxivTokens.length + urlTokens.length;
    if (total > 0) {
      const firstTitle = linesOf(block).find((l) => !isIdentifierLine(l));
      const title = firstTitle && firstTitle.length < 200 ? firstTitle : undefined;
      for (const t of doiTokens) items.push(item("doi", t, { doi: t, ...(title ? { title } : {}) }));
      for (const t of arxivTokens) items.push(item("arxiv", t, { arxivId: t, ...(title ? { title } : {}) }));
      for (const t of urlTokens) items.push(item("url", t, { url: t, ...(title ? { title } : {}) }));
    } else {
      const joined = linesOf(block).join(" ");
      if (/[A-Za-z\u4e00-\u9fa5]/.test(joined)) {
        items.push(item("title", joined, { title: cap(joined, 200) }));
      } else {
        items.push(item("unknown", block, {}, ["无法识别为论文（无标题/DOI/URL）"]));
      }
    }
  }

  return items;
}

function linesOf(block: string): string[] {
  return String(block).split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
}

const DOI_LINE = /10\.\d{4,9}\/[^\s"<>]+/i;
const ARXIV_LINE = /(?:arxiv\.org\/(?:abs|pdf)\/|arxiv:\s*)?(?<![\d.])\d{4}\.\d{4,5}(?:v\d+)?/i;
const URL_LINE = /https?:\/\/[^\s"'<>]+/i;

function isIdentifierLine(l: string): boolean {
  return DOI_LINE.test(l) || URL_LINE.test(l) || ARXIV_LINE.test(l);
}

