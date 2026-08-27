/**
 * Fact 归一化 + 有来源抽取（Step 4，hardening 版）。
 *
 * 一、normalizeFact / normalizeFacts：确定性归一化
 *   - key 必须来自 fact-taxonomy（有限注册表），未知 key 拒绝（不进入正式 Facts）；
 *   - status=observed|inferred|missing、confidence=high|medium|low、importance 按注册表；
 *   - missing 必须带 missingReason + missingType（not_found/not_scanned/ambiguous/not_applicable）；
 *   - enum 归一化只做 exact canonical / 显式 alias，禁止 substring 猜测（AdamW≠adam）；
 *   - normalizeFacts **保留冲突**：同 key+side 不同值/不同来源的候选都保留，
 *     只去掉真正重复（key+side+normalizedValue+source 全部相同）的记录。
 *
 * 二、saveFacts(existing, incoming, mode)：merge（默认，不覆盖已有不同值）/ replace-side / replace-all。
 *
 * 三、extractRepoFacts：沿 Step 3 snapshot 候选文件做确定性抽取（不调 LLM）
 *   - 按 taxonomy category → snapshot category 映射定向读（datasets/configs/training/evaluation/dependencies/…），
 *     不只读 manifest/config；
 *   - 每类都会记录是否扫描过：某 category 没扫描到 → 该类的 required key 生成 missingType=not_scanned
 *     （不得假装 not_found）；
 *   - 每条带 file + lineStart + commit + dirty（provenance 保到 Fact）。
 *
 * 四、extractPaperFacts：DeepSeek 完整论文 section/chunk 定向抽取
 *   - 页码按数字排序（page_2 不会排在 page_10 后）；
 *   - 整篇按 chunk 覆盖（不截前 24k 就完事）；只有全部 chunk 都扫描过的 key 才允许判
 *     missingType=not_found；有 chunk 因超预算被丢 → 相关 key 判 not_scanned；
 *   - 验证 quote 确实存在于对应页；不存在则去掉 quote、confidence 压到 medium。
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { KNOWN_FACTS, factDef, isKnownFactKey, ENUM_ALIASES, type FactCategory } from "./fact-taxonomy.ts";
import type { Fact, FactConfidence, FactImportance, FactMissingType, FactStatus } from "@/lib/reproduction-spec";

/* ================= 1. 确定性归一化 ================= */

const STATUSES: FactStatus[] = ["observed", "inferred", "missing"];
const CONFIDENCES: FactConfidence[] = ["high", "medium", "low"];
const MISSING_TYPES: FactMissingType[] = ["not_found", "not_scanned", "ambiguous", "not_applicable"];

/** 按 valueType 归一化；enum 只做 exact/alias，无法归一化返回 undefined（保留原文） */
export function normalizeValue(raw: unknown, def: { valueType: string; enumValues?: string[]; key?: string }): { value: unknown; normalizedValue?: unknown; unit?: string } {
  if (raw === undefined || raw === null || raw === "") return { value: undefined };
  const s = String(raw).trim();
  switch (def.valueType) {
    case "number": {
      const n = Number(s.replace(/,/g, ""));
      if (!Number.isFinite(n)) return { value: raw };
      return { value: raw, normalizedValue: n };
    }
    case "bool":
      return { value: raw, normalizedValue: /^(true|yes|1|是)$/i.test(s) };
    case "enum": {
      // exact canonical first
      const low = s.toLowerCase().trim();
      if ((def.enumValues ?? []).includes(low)) return { value: raw, normalizedValue: low };
      // explicit alias (per-key short name, e.g. training.optimizer → optimizer), NO substring guessing
      const aliasKey = (def.key ?? "").split(".").pop() ?? "";
      const alias = ENUM_ALIASES[aliasKey]?.[low];
      if (alias !== undefined) return { value: raw, normalizedValue: alias };
      return { value: raw }; // 无法归一化 → normalizedValue 缺省（Step 6 不比较它）
    }
    case "array":
      return { value: raw, normalizedValue: s.split(/[,，\s]+/).filter(Boolean) };
    default:
      return { value: raw, normalizedValue: s };
  }
}

export interface NormalizeFactInput {
  key: string;
  side: "paper" | "repo";
  value?: unknown;
  status?: FactStatus;
  confidence?: FactConfidence;
  importance?: FactImportance;
  missingReason?: string;
  missingType?: FactMissingType;
  source?: Fact["source"];
  id?: string;
}

/** 归一化单个 fact：未知 key 返回 null；严格三分 + missing 结构化原因 */
export function normalizeFact(input: NormalizeFactInput): Fact | null {
  const def = factDef(input.key);
  if (!def) return null;
  if (input.side !== "paper" && input.side !== "repo") return null;
  const status: FactStatus = STATUSES.includes(input.status as FactStatus) ? (input.status as FactStatus) : "observed";
  const confidence: FactConfidence = CONFIDENCES.includes(input.confidence as FactConfidence) ? (input.confidence as FactConfidence) : "medium";
  const importance: FactImportance = def.importance;
  const { value, normalizedValue, unit } = normalizeValue(input.value, { ...def, key: def.key });

  if (status === "missing") {
    return {
      id: input.id ?? `f-${Date.now().toString(36)}${Math.floor(Math.random() * 1000).toString(36)}`,
      key: def.key, side: input.side, status, confidence, importance,
      missingReason: input.missingReason ?? "未在来源中找到该事实",
      missingType: MISSING_TYPES.includes(input.missingType as FactMissingType) ? (input.missingType as FactMissingType) : "not_found",
      source: input.source,
    };
  }
  return {
    id: input.id ?? `f-${Date.now().toString(36)}${Math.floor(Math.random() * 1000).toString(36)}`,
    key: def.key, side: input.side,
    value, normalizedValue, unit,
    status, confidence, importance,
    source: input.source,
  };
}

/** 真正重复判定：key + side + normalizedValue + source 锚点全部相同才算重复 */
export function factIdentity(f: Fact): string {
  const src = f.source;
  let srcKey = "no-source";
  if (src?.kind === "repo") srcKey = `repo:${src.file}:${src.lineStart ?? ""}`;
  else if (src?.kind === "paper") srcKey = `paper:${src.section ?? ""}:${src.page ?? ""}`;
  else if (src?.kind === "user") srcKey = "user";
  return `${f.side}|${f.key}|${JSON.stringify(f.normalizedValue ?? f.value)}|${srcKey}`;
}

/** 批量归一化：过滤未知 key；**保留冲突**（不同值/不同来源都保留），只去真正重复 */
export function normalizeFacts(inputs: NormalizeFactInput[]): Fact[] {
  const out: Fact[] = [];
  const seen = new Set<string>();
  for (const inp of inputs) {
    const f = normalizeFact(inp);
    if (!f) continue;
    const idn = factIdentity(f);
    if (seen.has(idn)) {
      // 真正重复 → 后者更新（同值同源，更新无副作用）
      const i = out.findIndex((x) => factIdentity(x) === idn);
      if (i >= 0) out[i] = f;
      continue;
    }
    seen.add(idn);
    out.push(f);
  }
  return out;
}

/** 合并保存语义：merge（默认，不覆盖已有不同值）/ replace-side / replace-all */
export function saveFacts(existing: Fact[], incoming: Fact[], mode: "merge" | "replace-side" | "replace-all" = "merge"): Fact[] {
  if (mode === "replace-all") return normalizeFacts(incoming as never[]);
  if (mode === "replace-side") {
    const sides = new Set(incoming.map((f) => f.side));
    const kept = existing.filter((f) => !sides.has(f.side)); // 被替换的那一侧全部移除
    return normalizeFacts([...kept, ...incoming] as never[]);
  }
  // merge：incoming 只覆盖「真正重复」的已有条目；不同值/不同源都保留
  const out = [...existing];
  for (const f of incoming) {
    const idn = factIdentity(f);
    const i = out.findIndex((x) => factIdentity(x) === idn);
    if (i >= 0) out[i] = f;
    else out.push(f);
  }
  return out;
}

/* ================= 2. Repo 侧确定性抽取（按 taxonomy→snapshot 映射定向） ================= */

/** taxonomy category → snapshot category 映射（定向读取，明确每类扫没扫） */
export const CATEGORY_SNAPSHOT: Record<FactCategory, string[]> = {
  data: ["datasets", "configs"],
  preprocessing: ["datasets", "configs"],
  model: ["training", "entrypoints", "configs"],
  training: ["training", "configs"],
  evaluation: ["evaluation", "configs"],
  runtime: ["dependencies", "configs"],
};

/** key 属于哪个 taxonomy category */
export function keyCategory(key: string): FactCategory | undefined {
  return factDef(key)?.category;
}

interface RepoFactHit { key: string; value: unknown; file: string; lineStart?: number; commit?: string; dirty?: boolean }

const REPO_VALUE_RE = /([A-Za-z0-9_.-]+)\s*[:=]\s*(.+)$/;

function repoKeyFromToken(rawKey: string): string | undefined {
  const k = rawKey.toLowerCase().replace(/-/g, "_");
  if (/^(python|python_?version)$/.test(k)) return "runtime.python_version";
  if (/^(torch|pytorch|torch_?version)$/.test(k)) return "runtime.pytorch_version";
  if (/^(cuda|cuda_?version)$/.test(k)) return "runtime.cuda_version";
  if (/^batch_?size$/.test(k)) return "training.batch_size";
  if (/^(lr|learning_?rate)$/.test(k)) return "training.lr";
  if (/^(optimizer|opt)$/.test(k)) return "training.optimizer";
  if (/^epochs?$/.test(k)) return "training.epochs";
  if (/^(steps?|max_?steps|num_?steps|iterations?|num_?iterations?)$/.test(k)) return "training.steps";
  if (/^seed$/.test(k)) return "training.seed";
  if (/^(input_?size|image_?size|grid_?size|resolution)$/.test(k)) return "preprocessing.input_size";
  if (/^(voxel_?size|cell_?size|voxel_?resolution)$/.test(k)) return "preprocessing.voxel_resolution";
  if (/^(metric|metrics)$/.test(k)) return "evaluation.metric";
  if (/^(alpha|pruning_?alpha|prun_?alpha)$/.test(k)) return "model.pruning_alpha";
  return undefined;
}

/** 从 snapshot 的候选文件里按 taxonomy→snapshot 映射确定性抽取 fact。
 *  返回 { facts, scannedCategories }：没扫描到的 category 的 required key 会判 not_scanned。 */
export async function extractRepoFacts(
  snapshot: Record<string, any>,
  baseRoot: string,
): Promise<{ facts: Fact[]; scannedCategories: Set<FactCategory> }> {
  const hits: RepoFactHit[] = [];
  const scannedCategories = new Set<FactCategory>();

  // 遍历所有 taxonomy category，按映射找对应 snapshot 分类的文件
  const allCategories = Object.keys(CATEGORY_SNAPSHOT) as FactCategory[];
  for (const cat of allCategories) {
    const snapCats = CATEGORY_SNAPSHOT[cat];
    let foundAny = false;
    for (const sc of snapCats) {
      const files = (snapshot[sc] ?? []) as { path: string; commit?: string; workingTreeDirty?: boolean }[];
      for (const f of files) {
        if (typeof f.path !== "string") continue;
        const low = f.path.toLowerCase();
        if (low.includes(".egg-info") || low.includes("node_modules")) continue;
        // .py 代码（datasets/model/training/eval）与 manifest/config 都读；data 资产目录由 Step 3 已排除
        if (!/\.(py|ya?ml|toml|ini|cfg|json|txt|in)$/.test(low)) continue;
        let content = "";
        try { content = await readFile(path.join(baseRoot, f.path), "utf-8"); } catch { continue; }
        foundAny = true;
        const lines = content.split("\n");
        lines.forEach((line, i) => {
          const cudaUrl = line.match(/whl\/(cu\d+(?:\.\d+)?)/i);
          if (cudaUrl) {
            hits.push({ key: "runtime.cuda_version", value: cudaUrl[1].toLowerCase(), file: f.path, lineStart: i + 1, commit: f.commit, dirty: f.workingTreeDirty });
            return;
          }
          const m = line.match(REPO_VALUE_RE);
          if (!m) return;
          const key = repoKeyFromToken(m[1]);
          if (!key || !isKnownFactKey(key)) return;
          let rawVal = m[2].trim().replace(/^["']|["']$/g, "").replace(/#.*$/, "").trim();
          // Python 类型注解/签名噪声：`voxel_size: float = 0.5,` / `def f(x: float)` / `x: int` → 值部分是裸类型名时丢弃
          if (/^(float|int|str|bool|list|dict|tuple|None|Any|optional)$/i.test(rawVal.replace(/[,;]$/, ""))) return;
          if (/^=\s*(float|int|str|bool|list|dict|tuple|None)\b/i.test(rawVal) || /^[A-Za-z]+:\s*(float|int|str|bool)\b/i.test(rawVal)) return;
          if (!rawVal) return;
          // python 代码里 batch_size = 32 / optimizer = Adam(...)：剥掉函数调用
          rawVal = rawVal.replace(/\(.*$/, "").trim();
          // `float = 0.5,` 这类类型注解 + 默认值 → 丢弃（不是 config 值）
          if (/^(float|int|str|bool)\s*=/i.test(rawVal)) return;
          const verMatch = rawVal.match(/[0-9]+(?:\.[0-9]+){1,3}/);
          const value = key.startsWith("runtime.") && verMatch ? verMatch[0] : rawVal;
          hits.push({ key, value, file: f.path, lineStart: i + 1, commit: f.commit, dirty: f.workingTreeDirty });
        });
      }
    }
    if (foundAny) scannedCategories.add(cat);
  }

  const facts = normalizeFacts(hits.map((h) => ({
    key: h.key, side: "repo" as const, value: h.value, status: "observed" as const, confidence: "high" as const,
    source: { kind: "repo" as const, file: h.file, lineStart: h.lineStart, commit: h.commit, dirty: h.dirty },
  })));

  // 未扫描到的 category：其中的 required key 生成 missingType=not_scanned（不是 not_found）
  const scannedKeys = new Set(hits.map((h) => h.key));
  for (const cat of allCategories) {
    if (scannedCategories.has(cat)) continue;
    for (const def of KNOWN_FACTS) {
      if (def.category !== cat || def.importance !== "required") continue;
      if (def.sides.includes("repo") && !scannedKeys.has(def.key)) {
        facts.push(normalizeFact({
          key: def.key, side: "repo", status: "missing", missingType: "not_scanned",
          missingReason: `repo 的 ${cat} 类文件（${CATEGORY_SNAPSHOT[cat].join("/")}）未扫描到，不能判定为未找到`,
        })!);
      }
    }
  }
  return { facts, scannedCategories };
}

/* ================= 3. Paper 侧抽取（DeepSeek，完整覆盖 + chunk 定向） ================= */

export function taxonomyPrompt(): string {
  return KNOWN_FACTS.map((f) => `"${f.key}": { category: "${f.category}", label: "${f.label}", importance: "${f.importance}", valueType: "${f.valueType}"${f.hint ? `, hint: "${f.hint}"` : ""} }`).join("\n");
}

const PAPER_EXTRACT_SYSTEM = (taxonomy: string) =>
  "你是论文复现事实抽取器。给定一篇论文的正文文本（按页分块），按下面这份**封闭的 taxonomy** 抽取复现相关事实。\n" +
  "规则：\n" +
  "1. key 只能从 taxonomy 里取，**禁止发明新 key**；\n" +
  "2. 论文明确写了 → status=observed，confidence 按明确程度 high/medium，source.section 填论文章节（如 III-B / 4.1），source.page 填页号，source.quote 填原句（≤80 字）；\n" +
  "3. 论文暗示但未明说（如从图/上下文推断）→ status=inferred，confidence=low/medium；\n" +
  "4. 你**只能报告你在本块文本里实际看到的事实**；没看到的 key 不要输出 missing（missing 由系统在聚合时统一判定）；\n" +
  "5. 只输出一个 JSON 数组：[{\"key\":\"...\",\"value\":...,\"status\":\"observed|inferred\",\"confidence\":\"high|medium|low\",\"section\":\"...\",\"page\":n,\"quote\":\"...\"}]。不要输出 JSON 以外内容。\n\n" +
  `Taxonomy：\n${taxonomy}`;

interface PaperExtractRaw {
  key?: string; value?: unknown; status?: string; confidence?: string;
  section?: string; page?: number; quote?: string; missingReason?: string;
  source?: { section?: string; page?: number; quote?: string };
}

/** 页码数字排序：page_2 在 page_10 前 */
export function sortPages(names: string[]): string[] {
  return [...names].sort((a, b) => {
    const na = Number((a.match(/page_(\d+)/) ?? [])[1] ?? 0);
    const nb = Number((b.match(/page_(\d+)/) ?? [])[1] ?? 0);
    return na - nb;
  });
}

const MAX_PAGE_CHARS = 20000;   // 单页最大可扫描字符；超出部分不静默截断（拆 fragment）
const CHUNK_MAX_CHARS = 20000;  // 每 chunk 约 2 万字符
const MAX_CHUNKS = 3;           // 最多扫描 3 个 chunk（保护 token）；超出 → 未扫描

export interface PaperCoverage {
  complete: boolean;            // 全部 chunk 成功扫描 且 无 fragment 被丢弃 → 才允许 not_found
  totalPages: number;
  coveredPages: number;         // 真实被成功扫描覆盖的页数（去重；按 fragment 是否进入成功 chunk）
  totalChunks: number;
  scannedChunks: number;
  failedChunks: { index: number; reason: string }[];
  droppedFragments: number;     // 因预算被丢弃的 fragment 数
}

interface PageFragment { page: number; text: string }
interface ChunkResult { scanned: boolean; reason?: string; raws: PaperExtractRaw[] }

/** 把每页拆成 ≤ MAX_PAGE_CHARS 的 fragment（长页拆 sub-chunk，不静默截断）。
 *  返回 [fragments, dropped 的页是否因超单页上限] */
function pageFragments(pages: string[]): { frags: PageFragment[]; oversizePages: number[] } {
  const frags: PageFragment[] = [];
  const oversize: number[] = [];
  pages.forEach((p, i) => {
    if (p.length <= MAX_PAGE_CHARS) {
      frags.push({ page: i + 1, text: p });
    } else {
      // 单页超上限：拆成多个 fragment（每片 ≤ MAX_PAGE_CHARS），保证整页内容都被送入（不 slice 截断）
      oversize.push(i + 1);
      for (let s = 0; s < p.length; s += MAX_PAGE_CHARS) {
        frags.push({ page: i + 1, text: p.slice(s, s + MAX_PAGE_CHARS) });
      }
    }
  });
  return { frags, oversizePages: oversize };
}

/** 组装 chunk：按字符预算顺序聚合 fragment（同一页的多 fragment 可跨 chunk） */
function makeChunks(frags: PageFragment[]): PageFragment[][] {
  const chunks: PageFragment[][] = [];
  let cur: PageFragment[] = [];
  let curChars = 0;
  for (const fr of frags) {
    if (curChars + fr.text.length > CHUNK_MAX_CHARS && cur.length) {
      chunks.push(cur); cur = []; curChars = 0;
    }
    cur.push(fr); curChars += fr.text.length;
  }
  if (cur.length) chunks.push(cur);
  return chunks;
}

/** 单个 chunk：成功请求 + 成功解析才算 scanned；否则返回 reason */
async function scanChunk(chunk: PageFragment[], apiKey: string, idx: number): Promise<ChunkResult> {
  const text = chunk.map((fr) => `【第 ${fr.page} 页】\n${fr.text}`).join("\n\n");
  for (let attempt = 1; attempt <= 3; attempt++) {
    if (attempt > 1) await new Promise((r) => setTimeout(r, 600 * 2 ** (attempt - 2)));
    try {
      const res = await fetch("https://api.deepseek.com/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model: "deepseek-chat",
          messages: [
            { role: "system", content: PAPER_EXTRACT_SYSTEM(taxonomyPrompt()) },
            { role: "user", content: text },
          ],
          stream: false,
          max_tokens: 4000,
        }),
        signal: AbortSignal.timeout(90000),
      });
      if (!res.ok) continue; // HTTP 失败 → 重试
      const d = await res.json();
      const c = d?.choices?.[0]?.message?.content ?? "";
      const start = c.indexOf("[");
      const end = c.lastIndexOf("]");
      if (start >= 0 && end > start) {
        try {
          const arr = JSON.parse(c.slice(start, end + 1));
          if (Array.isArray(arr)) return { scanned: true, raws: arr };
        } catch { /* 坏 JSON → 重试 */ }
      }
    } catch { /* 网络失败 → 重试 */ }
  }
  return { scanned: false, reason: `chunk ${idx + 1} 三次请求/解析失败`, raws: [] };
}

/** DeepSeek 抽取论文事实：整篇 chunk 覆盖 + quote 验证 + missing 仅在 coverage.complete 后判定。
 *  覆盖记录真实：页不静默截断（长页拆 fragment）；每 chunk 只有成功请求+成功解析才算 scanned；
 *  失败/被丢弃 → coverage.complete=false → 缺失 key 只能 not_scanned，绝不 not_found。 */
export async function extractPaperFacts(
  pageTexts: string[],
): Promise<{ facts: Fact[]; coverage: PaperCoverage }> {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) return { facts: [], coverage: { complete: false, totalPages: pageTexts.length, coveredPages: 0, totalChunks: 0, scannedChunks: 0, failedChunks: [], droppedFragments: 0 } };

  const { frags, oversizePages } = pageFragments(pageTexts);
  const chunks = makeChunks(frags);

  const allRaw: PaperExtractRaw[] = [];
  const failedChunks: { index: number; reason: string }[] = [];
  let scannedChunks = 0;

  // 按预算扫描前 MAX_CHUNKS 个 chunk；其余 fragment 标记 dropped（未扫描）
  const used = chunks.slice(0, MAX_CHUNKS);
  const droppedCount = chunks.slice(MAX_CHUNKS).reduce((n, c) => n + c.length, 0);
  const results: ChunkResult[] = [];
  for (let i = 0; i < used.length; i++) {
    const r = await scanChunk(used[i], apiKey, i);
    results.push(r);
    if (r.scanned) { scannedChunks++; allRaw.push(...r.raws); }
    else failedChunks.push({ index: i, reason: r.reason ?? "失败" });
  }
  // 失败 chunk 里的 fragment 也算未扫描（dropped）
  const failedFragCount = used.reduce((n, c, i) => n + (results[i]?.scanned ? 0 : c.length), 0);

  // 真实覆盖：被成功扫描 fragment 覆盖的页号集合
  const coveredPagesSet = new Set<number>();
  used.forEach((chunk, i) => {
    if (results[i]?.scanned) for (const fr of chunk) coveredPagesSet.add(fr.page);
  });

  const complete = scannedChunks === used.length && chunks.length <= MAX_CHUNKS && failedChunks.length === 0;

  // quote 验证：quote 必须存在于对应页；不存在 → 去 quote、confidence 压到 medium
  const facts = normalizeFacts(allRaw.map((r) => {
    const page = r.page ?? r.source?.page;
    const quote = r.quote ?? r.source?.quote;
    const pageText = page !== undefined && pageTexts[page - 1] ? pageTexts[page - 1] : undefined;
    let conf = (r.confidence as FactConfidence) ?? "medium";
    let finalQuote: string | undefined = quote;
    if (quote && pageText) {
      const norm = (s: string) => s.replace(/\s+/g, " ").trim();
      if (!norm(pageText).includes(norm(quote.slice(0, 40)))) {
        finalQuote = undefined;
        if (conf === "high") conf = "medium";
      }
    }
    return {
      key: r.key ?? "",
      side: "paper" as const,
      value: r.value,
      status: (r.status as FactStatus) ?? "observed",
      confidence: conf,
      source: { kind: "paper" as const, section: r.section ?? r.source?.section, page, quote: finalQuote },
    };
  }));

  // 聚合后判定 genuinely missing：只有 coverage.complete=true 才允许 not_found；
  // 否则（失败 chunk / 预算丢弃 / 单页超限未扫完）→ not_scanned
  const seenKeys = new Set(facts.map((f) => f.key));
  for (const def of KNOWN_FACTS) {
    if (def.importance !== "required" || !def.sides.includes("paper")) continue;
    if (seenKeys.has(def.key)) continue;
    facts.push(normalizeFact({
      key: def.key, side: "paper", status: "missing",
      missingType: complete ? "not_found" : "not_scanned",
      missingReason: complete
        ? "完整论文已扫描，未找到该事实"
        : (failedChunks.length ? `部分 chunk 扫描失败（${failedChunks.map((f) => `#${f.index + 1}`).join(",")}）` : "部分论文章节未扫描（超出预算/单页超限），不能判定为未找到"),
    })!);
  }

  return {
    facts,
    coverage: {
      complete,
      totalPages: pageTexts.length,
      coveredPages: coveredPagesSet.size,
      totalChunks: chunks.length,
      scannedChunks,
      failedChunks,
      droppedFragments: droppedCount + failedFragCount,
    },
  };
}
