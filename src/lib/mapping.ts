/**
 * Paper ↔ Code Mapping（Step 5，grounding hardening 版）。
 *
 * grounding 原则（评审约束）：
 *  - LLM **不得自由生成** file/symbol/line/paperRefs；
 *  - 系统先按 taxonomy category 为每个 paper fact 路由/排序出候选代码（5–15 个），
 *    读取真实文件的安全 line-numbered snippet，生成系统侧 codeAnchorId；
 *  - LLM 只能返回 paperFactIds + codeAnchorIds + relation + confidence；
 *  - 最终 refs 由 anchor / fact **确定性恢复**（codeRefs 带真实行号/symbol/commit/dirty）。
 *
 * identity：
 *  - mappingIdentity = 排序后的 paperFactIds + relation + 排序后的 codeAnchorIds（稳定）；
 *  - save（merge）按 identity 合并：不新增重复、不覆盖不同值；
 *  - **confirmed 状态只允许 confirm/reject 改变**：普通 save 不得覆盖或降级已确认条目。
 */
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { factDef, KNOWN_FACTS, type FactCategory } from "./fact-taxonomy.ts";
import { CATEGORY_SNAPSHOT } from "./fact-extract.ts";
import type { Fact, Mapping, MappingRelation, FactConfidence, CodeRef, PaperRef } from "@/lib/reproduction-spec";

/* ================= 0. 系统侧 code anchor ================= */

export interface CodeAnchor {
  id: string;                 // anchor-<hash(file:symbol:lineStart)>
  file: string;
  symbol?: string;
  lineStart: number;
  lineEnd: number;
  snippet: string;            // 安全读取的 line-numbered 片段（≤ MAX_SNIPPET_LINES 行）
  commit?: string;
  dirty?: boolean;
}

const MAX_SNIPPET_LINES = 40;
const MAX_ANCHOR_CHARS = 6000;

function anchorId(file: string, symbol: string | undefined, lineStart: number): string {
  const h = createHash("sha1").update(`${file}|${symbol ?? ""}|${lineStart}`).digest("hex").slice(0, 12);
  return `anchor-${h}`;
}

/** 从文件内容提取候选符号：py 的 def/class，yaml/json/toml 的顶层键 */
function extractSymbols(content: string, isPy: boolean): { symbol: string; line: number }[] {
  const out: { symbol: string; line: number }[] = [];
  const lines = content.split("\n");
  lines.forEach((ln, i) => {
    if (isPy) {
      const m = ln.match(/^\s*(?:def|class)\s+([A-Za-z_]\w*)/);
      if (m) out.push({ symbol: m[1], line: i + 1 });
    } else {
      const m = ln.match(/^([A-Za-z_][\w.-]*)\s*:/);
      if (m) out.push({ symbol: m[1], line: i + 1 });
    }
  });
  return out;
}

/** 从 snapshot 候选文件构建 code anchors（安全 snippet；同文件多 symbol → 多 anchor，不错误去重） */
export async function buildCodeAnchors(
  snapshot: Record<string, any>,
  baseRoot: string,
  scope: { categories: string[]; maxPerFact: number },
): Promise<CodeAnchor[]> {
  const anchors: CodeAnchor[] = [];
  // 收集 scope 内的文件（去重）
  const files: { path: string; commit?: string; workingTreeDirty?: boolean }[] = [];
  const seen = new Set<string>();
  for (const sc of scope.categories) {
    for (const it of (snapshot[sc] ?? []) as { path?: string; commit?: string; workingTreeDirty?: boolean }[]) {
      if (typeof it.path !== "string" || seen.has(it.path)) continue;
      seen.add(it.path);
      files.push({ path: it.path, commit: it.commit, workingTreeDirty: it.workingTreeDirty });
    }
  }

  for (const f of files) {
    if (f.path.includes(".egg-info") || f.path.includes("node_modules")) continue;
    if (!/\.(py|ya?ml|toml|ini|cfg|json|txt|in)$/.test(f.path)) continue;
    let content = "";
    try {
      const abs = path.join(baseRoot, f.path);
      const st = await import("node:fs/promises").then((fsm) => fsm.stat(abs));
      if (st.size > 1_000_000) continue; // 同 code-reader 安全边界
      content = await readFile(abs, "utf-8");
    } catch { continue; }
    const isPy = f.path.endsWith(".py");
    const syms = extractSymbols(content, isPy);
    // 有符号 → 每个符号一个 anchor；无符号（纯 config）→ 文件整体一个 anchor
    if (syms.length) {
      for (const { symbol, line } of syms.slice(0, 20)) {
        const start = line - 1;
        const snippet = content.split("\n").slice(start, start + MAX_SNIPPET_LINES).map((l, i) => `${start + i + 1}: ${l}`).join("\n").slice(0, MAX_ANCHOR_CHARS);
        anchors.push({
          id: anchorId(f.path, symbol, line),
          file: f.path, symbol, lineStart: line,
          lineEnd: Math.min(line + MAX_SNIPPET_LINES - 1, content.split("\n").length),
          snippet, commit: f.commit, dirty: f.workingTreeDirty,
        });
      }
    } else {
      const snippet = content.split("\n").slice(0, MAX_SNIPPET_LINES).map((l, i) => `${i + 1}: ${l}`).join("\n").slice(0, MAX_ANCHOR_CHARS);
      anchors.push({
        id: anchorId(f.path, undefined, 1),
        file: f.path, symbol: undefined, lineStart: 1,
        lineEnd: Math.min(MAX_SNIPPET_LINES, content.split("\n").length),
        snippet, commit: f.commit, dirty: f.workingTreeDirty,
      });
    }
  }
  // 稳定排序（同输入 → 同顺序），上限由调用方决定
  anchors.sort((a, b) => a.id.localeCompare(b.id));
  return anchors;
}

/* ================= 1. 归一化 ================= */

const RELATIONS: MappingRelation[] = ["implements", "configures", "preprocesses", "trains", "evaluates"];
const CONFIDENCES: FactConfidence[] = ["high", "medium", "low"];

export interface NormalizeMappingInput {
  id?: string;
  concept: string;
  paperRefs?: PaperRef[];
  codeRefs: CodeRef[];
  configRefs?: CodeRef[];
  relation?: string;
  status?: string;
  confidence?: string;
  evidenceIds?: string[];
  paperFactIds?: string[];
  codeAnchorIds?: string[];
  legacy?: boolean;
}

export function normalizeMapping(input: NormalizeMappingInput): Mapping | null {
  const concept = String(input.concept ?? "").trim();
  if (!concept) return null;
  const codeRefs = (Array.isArray(input.codeRefs) ? input.codeRefs : [])
    .filter((c) => c && typeof c.file === "string" && c.file.trim())
    .map((c) => ({ file: c.file.trim(), lineStart: typeof c.lineStart === "number" ? c.lineStart : undefined, lineEnd: typeof c.lineEnd === "number" ? c.lineEnd : undefined, symbol: typeof c.symbol === "string" ? c.symbol : undefined, commit: typeof c.commit === "string" ? c.commit : undefined, dirty: typeof c.dirty === "boolean" ? c.dirty : undefined }));
  if (!codeRefs.length) return null;
  const configRefs = Array.isArray(input.configRefs)
    ? input.configRefs.filter((c) => c && typeof c.file === "string" && c.file.trim())
        .map((c) => ({ file: c.file.trim(), lineStart: typeof c.lineStart === "number" ? c.lineStart : undefined, lineEnd: typeof c.lineEnd === "number" ? c.lineEnd : undefined, symbol: typeof c.symbol === "string" ? c.symbol : undefined, commit: typeof c.commit === "string" ? c.commit : undefined, dirty: typeof c.dirty === "boolean" ? c.dirty : undefined }))
    : undefined;
  return {
    id: input.id ?? `m-${Date.now().toString(36)}${Math.floor(Math.random() * 1000).toString(36)}`,
    concept,
    paperRefs: Array.isArray(input.paperRefs) ? input.paperRefs.filter((p) => p && (p.section || p.page || p.quote)) : [],
    codeRefs,
    configRefs: configRefs && configRefs.length ? configRefs : undefined,
    relation: (RELATIONS as string[]).includes(input.relation ?? "") ? (input.relation as MappingRelation) : "implements",
    status: input.status === "confirmed" ? "confirmed" : "proposed",
    confidence: (CONFIDENCES as string[]).includes(input.confidence ?? "") ? (input.confidence as FactConfidence) : "medium",
    evidenceIds: Array.isArray(input.evidenceIds) ? input.evidenceIds.map(String) : [],
    paperFactIds: Array.isArray(input.paperFactIds) ? input.paperFactIds.map(String) : [],
    codeAnchorIds: Array.isArray(input.codeAnchorIds) ? input.codeAnchorIds.map(String) : [],
    // legacy：无 paperFactIds/codeAnchorIds 的旧 mapping 标记为 ungrounded，不参与 Step 6/Ready
    legacy: Boolean(input.legacy) || !Array.isArray(input.paperFactIds) || !Array.isArray(input.codeAnchorIds) || input.paperFactIds.length === 0 || input.codeAnchorIds.length === 0,
  };
}

/** mapping 是否 grounded（有真实 fact id + anchor id；legacy ungrounded 不参与 Step 6/Ready） */
export function isMappingGrounded(m: Mapping): boolean {
  return !m.legacy && m.paperFactIds.length > 0 && m.codeAnchorIds.length > 0;
}

/** 稳定 identity：排序后的 paperFactIds + relation + 排序后的 canonical codeAnchorIds */
export function mappingIdentity(m: Mapping): string {
  const pf = [...m.paperFactIds].sort().join(",");
  const ca = [...m.codeAnchorIds].sort().join(",");
  return `${pf}|${m.relation}|${ca}`;
}

/** 批量归一化：按 identity 去重（同 identity 保留第一条） */
export function normalizeMappings(inputs: NormalizeMappingInput[]): Mapping[] {
  const out: Mapping[] = [];
  const seen = new Set<string>();
  for (const inp of inputs) {
    const m = normalizeMapping(inp);
    if (!m) continue;
    const idn = mappingIdentity(m);
    if (seen.has(idn)) continue;
    seen.add(idn);
    out.push(m);
  }
  return out;
}

/** save 合并：按 identity merge；**confirmed 状态绝不覆盖/降级**（状态只由 confirm/reject 改变） */
export function mergeMappings(existing: Mapping[], incoming: Mapping[]): Mapping[] {
  const out = [...existing];
  for (const m of incoming) {
    const idn = mappingIdentity(m);
    const i = out.findIndex((x) => mappingIdentity(x) === idn);
    if (i >= 0) {
      // 已存在：保留 existing 的 id 与 status（confirmed 不降级、id 不因 re-propose 更换），非状态字段用 incoming 更新
      out[i] = { ...m, id: out[i].id, status: out[i].status };
    } else {
      out.push(m);
    }
  }
  return out;
}

/** 状态变化只允许 confirm/reject */
export function confirmMapping(mappings: Mapping[], id: string): Mapping[] {
  return mappings.map((m) => (m.id === id ? { ...m, status: "confirmed" } : m));
}
export function rejectMapping(mappings: Mapping[], id: string): Mapping[] {
  return mappings.filter((m) => m.id !== id);
}

/* ================= 2. 候选路由（grounding：不把全部文件给 LLM） ================= */

/** 每个 paper fact 按 category 路由到 snapshot categories，再按证据强度排序取 top N（5–15） */
export function routeFactCandidates(
  fact: Fact,
  snapshot: Record<string, any>,
): { file: string; score: number }[] {
  const def = factDef(fact.key);
  if (!def) return [];
  const snapCats = CATEGORY_SNAPSHOT[def.category] ?? [];
  const scored = new Map<string, number>();
  for (const sc of snapCats) {
    for (const it of (snapshot[sc] ?? []) as { path?: string; evidence?: string[] }[]) {
      if (typeof it.path !== "string") continue;
      let s = 0;
      if (Array.isArray(it.evidence) && it.evidence.length) s += it.evidence.length * 2; // 内容证据权重
      // 文件名含 category 关键词（train/eval/dataset/model/config）加分
      if (new RegExp(sc, "i").test(it.path)) s += 1;
      scored.set(it.path, (scored.get(it.path) ?? 0) + s);
    }
  }
  return [...scored.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 15)
    .map(([file, score]) => ({ file, score }));
}

/** 为一批 paper facts 构建候选 anchors + 每 fact 的 allowed anchor set（5–15 个/ fact）。 */
export async function buildAnchorsForFacts(
  facts: Fact[],
  snapshot: Record<string, any>,
  baseRoot: string,
): Promise<{ anchors: CodeAnchor[]; factAllowed: Map<string, Set<string>> }> {
  // 收集被路由到的文件集合（按 fact 去重），并记录每个 fact 允许的文件
  const wanted = new Set<string>();
  const factFiles = new Map<string, Set<string>>(); // fact.id -> allowed files
  for (const f of facts) {
    const files = routeFactCandidates(f, snapshot).map((c) => c.file);
    factFiles.set(f.id, new Set(files));
    for (const file of files) wanted.add(file);
  }
  const limitedSnapshot: Record<string, any> = {};
  for (const sc of ["entrypoints", "training", "evaluation", "datasets", "configs", "dependencies"]) {
    const items = ((snapshot[sc] ?? []) as { path?: string }[]).filter((it) => it.path && wanted.has(it.path));
    if (items.length) limitedSnapshot[sc] = items;
  }
  const anchors = await buildCodeAnchors(limitedSnapshot, baseRoot, { categories: Object.keys(limitedSnapshot), maxPerFact: 15 });

  // 每 fact 的 allowed anchor set：该 fact 允许的文件里构建出的 anchor id
  const factAllowed = new Map<string, Set<string>>();
  for (const f of facts) {
    const allowedFiles = factFiles.get(f.id) ?? new Set<string>();
    const ids = new Set(anchors.filter((a) => allowedFiles.has(a.file)).map((a) => a.id));
    factAllowed.set(f.id, ids);
  }
  return { anchors, factAllowed };
}

/* ================= 3. AI 提议（LLM 只选 id） ================= */

/** LLM 用临时 alias（fact#i）；持久化时转换为真实 Fact.id */
function paperFactLines(facts: Fact[]): string {
  return facts.map((f, i) => `- fact#${i} [${f.key}] = ${JSON.stringify(f.value)}${f.source?.kind === "paper" && f.source.section ? ` @ ${f.source.section}${f.source.page ? ` p${f.source.page}` : ""}` : ""}`).join("\n");
}

/** 给模型真实的短 snippet（多行，≤5 行），不是仅第一行 */
function anchorLines(anchors: CodeAnchor[]): string {
  return anchors.map((a) => {
    const snippet = a.snippet.split("\n").slice(0, 5).join(" | ");
    return `- anchor#${a.id} ${a.file}${a.symbol ? ` :: ${a.symbol}` : ""} L${a.lineStart}-${a.lineEnd} | ${snippet}`;
  }).join("\n");
}

const MAP_SYSTEM =
  "你是论文↔代码对应关系提议器。给定论文事实（paperFact#…）和系统预构建的代码锚点（anchor#…），为论文里的复现概念提议对应关系。\n" +
  "规则：\n" +
  "1. **只能引用上面给出的 fact# 与 anchor# 的 id**；禁止发明文件路径、符号、行号；\n" +
  "2. 每个 mapping 输出：paperFactIds（1–2 个 fact id）、codeAnchorIds（1–3 个 anchor id，且必须与所选 fact 属于同一概念域）、relation（implements=实现 / configures=配置 / preprocesses=预处理 / trains=训练 / evaluates=评估）、confidence（high/medium/low）；\n" +
  "3. 只提议你有依据的对应；没有把握的不输出；\n" +
  "4. 只输出 JSON 数组：[{\"paperFactIds\":[\"fact#0\"],\"codeAnchorIds\":[\"anchor-xxx\"],\"relation\":\"...\",\"confidence\":\"...\"}]。不要输出 JSON 以外内容。";

interface RawProposal {
  paperFactIds?: string[]; codeAnchorIds?: string[]; relation?: string; confidence?: string;
}

/** DeepSeek 提议（LLM 只选临时 alias id；持久化转真实 Fact.id + anchor id；per-fact allowed set 最终校验） */
export async function proposeMappings({
  facts, snapshot, root,
}: {
  facts: Fact[]; snapshot: Record<string, any>; root: string;
}): Promise<Mapping[]> {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) return [];
  const relevant = facts.filter((f) => f.status === "observed" || f.status === "inferred");
  if (!relevant.length) return [];

  const { anchors, factAllowed } = await buildAnchorsForFacts(relevant, snapshot, root);
  if (!anchors.length) return [];
  const anchorById = new Map(anchors.map((a) => [a.id, a]));

  const user = `【论文事实】\n${paperFactLines(relevant)}\n\n【代码锚点】\n${anchorLines(anchors)}`;

  let rawArr: RawProposal[] = [];
  for (let attempt = 1; attempt <= 3; attempt++) {
    if (attempt > 1) await new Promise((r) => setTimeout(r, 600 * 2 ** (attempt - 2)));
    try {
      const res = await fetch("https://api.deepseek.com/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model: "deepseek-chat",
          messages: [{ role: "system", content: MAP_SYSTEM }, { role: "user", content: user.slice(0, 24000) }],
          stream: false,
          max_tokens: 3000,
        }),
        signal: AbortSignal.timeout(90000),
      });
      if (res.ok) {
        const d = await res.json();
        const c = d?.choices?.[0]?.message?.content ?? "";
        const start = c.indexOf("[");
        const end = c.lastIndexOf("]");
        if (start >= 0 && end > start) {
          try {
            const arr = JSON.parse(c.slice(start, end + 1));
            if (Array.isArray(arr)) { rawArr = arr; break; }
          } catch { /* 坏 JSON → 重试 */ }
        }
      }
    } catch { /* 重试 */ }
  }

  // alias → 真实 fact；anchor id 校验 per-fact allowed set（每个选中 anchor 必须属于所选 fact 的 allowed set）
  const factByAlias = new Map(relevant.map((f, i) => [`fact#${i}`, f]));
  const out: Mapping[] = [];
  for (const r of rawArr) {
    const pids = (r.paperFactIds ?? []).filter((id) => factByAlias.has(id)).slice(0, 2);
    if (!pids.length) continue;
    const factsUsed = pids.map((id) => factByAlias.get(id)!);
    // per-fact allowed set：anchor 必须属于任一所选 fact 的 allowed set
    const allowed = new Set<string>();
    for (const f of factsUsed) for (const id of factAllowed.get(f.id) ?? []) allowed.add(id);
    const aids = (r.codeAnchorIds ?? []).filter((id) => allowed.has(id) && anchorById.has(id)).slice(0, 3);
    if (!aids.length) continue;

    const anchorsUsed = aids.map((id) => anchorById.get(id)!);
    const codeRefs: CodeRef[] = anchorsUsed.map((a) => ({
      file: a.file, symbol: a.symbol, lineStart: a.lineStart, lineEnd: a.lineEnd, commit: a.commit, dirty: a.dirty,
    }));
    const paperRefs: PaperRef[] = factsUsed
      .filter((f) => f.source?.kind === "paper")
      .map((f) => {
        const s = f.source as Extract<Fact["source"], { kind: "paper" }>;
        return { section: s.section, page: s.page, quote: s.quote } as PaperRef;
      });
    const concept = factsUsed.map((f) => factDef(f.key)?.label ?? f.key).join(" + ");
    const m = normalizeMapping({
      concept, paperRefs, codeRefs, relation: r.relation, confidence: r.confidence,
      // 持久化用真实 Fact.id（不是 fact#i 别名）；identity 基于真实稳定 id
      paperFactIds: factsUsed.map((f) => f.id),
      codeAnchorIds: aids,
      status: "proposed",
    });
    if (m) out.push(m);
  }
  // 按稳定 identity（真实 id）去重 + 总量上限 15
  const seen = new Set<string>();
  const uniq = out.filter((m) => {
    const idn = mappingIdentity(m);
    if (seen.has(idn)) return false;
    seen.add(idn);
    return true;
  });
  const order: Record<FactConfidence, number> = { high: 0, medium: 1, low: 2 };
  return uniq.sort((a, b) => (order[a.confidence] - order[b.confidence]) || a.concept.localeCompare(b.concept)).slice(0, 15);
}
