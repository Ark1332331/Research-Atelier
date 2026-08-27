/**
 * Paper ↔ Code Mapping（Step 5）：AI 提议 → 用户确认。
 *
 * 一、normalizeMapping / normalizeMappings：确定性归一化
 *   - relation 必须是枚举（implements/configures/preprocesses/trains/evaluates）；
 *   - confidence 三分；status=proposed|confirmed；
 *   - codeRefs.file 必须存在且非空；paperRefs 可空（概念未定位到具体节）；
 *   - 保留冲突：同 concept+relation 不同 codeRef 都保留（Step 6 处理）。
 *
 * 二、proposeMappings(paperFacts, repoSnapshot)：DeepSeek 提议
 *   - 输入：论文事实（observed，带 section/quote）+ repo snapshot 候选（含 evidence/commit/dirty）；
 *   - 输出：mapping 候选（concept → codeRefs，relation，confidence，paperRefs）；
 *   - 校验：concept 尽量对齐 taxonomy 已知 key 的 label；codeRef.file 必须存在于 snapshot；
 *   - 不自动确认（status=proposed）——用户确认后才 confirmed（UX Contract：用户只处理 exception）。
 */
import { factDef, KNOWN_FACTS } from "./fact-taxonomy.ts";
import type { Fact, Mapping, MappingRelation, FactConfidence, CodeRef, PaperRef } from "@/lib/reproduction-spec";

/* ================= 1. 确定性归一化 ================= */

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
}

export function normalizeMapping(input: NormalizeMappingInput): Mapping | null {
  const concept = String(input.concept ?? "").trim();
  if (!concept) return null;
  const codeRefs = (Array.isArray(input.codeRefs) ? input.codeRefs : [])
    .filter((c) => c && typeof c.file === "string" && c.file.trim())
    .map((c) => ({ file: c.file.trim(), lineStart: typeof c.lineStart === "number" ? c.lineStart : undefined, lineEnd: typeof c.lineEnd === "number" ? c.lineEnd : undefined, symbol: typeof c.symbol === "string" ? c.symbol : undefined, commit: typeof c.commit === "string" ? c.commit : undefined }));
  if (!codeRefs.length) return null; // 没有代码锚点的 mapping 无效
  const configRefs = Array.isArray(input.configRefs)
    ? input.configRefs.filter((c) => c && typeof c.file === "string" && c.file.trim())
        .map((c) => ({ file: c.file.trim(), lineStart: typeof c.lineStart === "number" ? c.lineStart : undefined, lineEnd: typeof c.lineEnd === "number" ? c.lineEnd : undefined, symbol: typeof c.symbol === "string" ? c.symbol : undefined, commit: typeof c.commit === "string" ? c.commit : undefined }))
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
  };
}

/** 批量归一化：过滤无效；同 concept+relation+codeRefs(file) 去重（保留冲突 variant） */
export function normalizeMappings(inputs: NormalizeMappingInput[]): Mapping[] {
  const out: Mapping[] = [];
  const seen = new Set<string>();
  for (const inp of inputs) {
    const m = normalizeMapping(inp);
    if (!m) continue;
    const key = `${m.concept}|${m.relation}|${m.codeRefs.map((c) => c.file).join(",")}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(m);
  }
  return out;
}

/** 校验 codeRef 是否存在于 snapshot（防 AI 编造文件） */
export function codeRefsInSnapshot(codeRefs: CodeRef[], snapshotFiles: string[]): CodeRef[] {
  const set = new Set(snapshotFiles);
  return codeRefs.filter((c) => set.has(c.file));
}

/* ================= 2. AI 提议 ================= */

/** 渲染给 LLM 的论文事实摘要（observed 才给，避免用 missing 当依据） */
function paperFactsSummary(facts: Fact[]): string {
  const obs = facts.filter((f) => f.status === "observed" || f.status === "inferred");
  if (!obs.length) return "（无已确认的论文事实）";
  return obs.map((f) => {
    const def = factDef(f.key);
    return `- ${f.key}（${def?.label ?? ""}） = ${JSON.stringify(f.value)}${f.source?.kind === "paper" && f.source.section ? ` @ ${f.source.section}${f.source.page ? ` p${f.source.page}` : ""}` : ""}`;
  }).join("\n");
}

/** 渲染 repo snapshot 候选（entrypoints/training/eval/datasets/configs/deps） */
function snapshotSummary(snap: Record<string, any>): string {
  const cats = ["entrypoints", "training", "evaluation", "datasets", "configs", "dependencies"];
  const lines: string[] = [];
  for (const c of cats) {
    const items = (snap[c] ?? []) as { path: string; evidence?: string[]; commit?: string; workingTreeDirty?: boolean }[];
    if (!items.length) continue;
    lines.push(`[${c}]`);
    for (const it of items.slice(0, 30)) {
      lines.push(`  ${it.path}${it.evidence?.length ? ` (evidence: ${it.evidence.join(",")})` : ""}${it.commit ? ` @ ${it.commit.slice(0, 8)}${it.workingTreeDirty ? "+dirty" : ""}` : ""}`);
    }
  }
  return lines.join("\n") || "（snapshot 为空）";
}

const MAP_SYSTEM = (taxonomy: string) =>
  "你是论文↔代码对应关系提议器。给定论文事实 + 代码仓库 snapshot，为论文里的复现概念提议对应的代码实现位置。\n" +
  "规则：\n" +
  "1. 每个 mapping：concept（论文概念，尽量用 taxonomy key 对应的 label 或该 key 本身）、codeRefs（仓库文件，**必须来自上面 snapshot 列表**，可多个）、relation（implements=实现 / configures=配置 / preprocesses=预处理 / trains=训练 / evaluates=评估）、confidence（high/medium/low）；\n" +
  "2. paperRefs 从论文事实的来源填（section/page/quote 可选）；\n" +
  "3. 只提议你**有依据**的对应；没有把握的不输出；\n" +
  "4. 只输出 JSON 数组：[{\"concept\":\"...\",\"paperRefs\":[{\"section\":\"...\",\"page\":n,\"quote\":\"...\"}],\"codeRefs\":[{\"file\":\"...\",\"symbol\":\"...\",\"lineStart\":n}],\"relation\":\"implements|configures|preprocesses|trains|evaluates\",\"confidence\":\"high|medium|low\"}]。不要输出 JSON 以外内容。\n\n" +
  `Taxonomy 参考：\n${taxonomy}`;

export interface ProposeMappingInput {
  facts: Fact[];
  snapshot: Record<string, any>;
}

/** DeepSeek 提议 mapping（校验 codeRef 在 snapshot 内；返回 proposed 状态） */
export async function proposeMappings({ facts, snapshot }: ProposeMappingInput): Promise<Mapping[]> {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) return [];

  const snapshotFiles: string[] = [];
  for (const c of ["entrypoints", "training", "evaluation", "datasets", "configs", "dependencies"]) {
    for (const it of (snapshot[c] ?? []) as { path?: string }[]) if (typeof it.path === "string") snapshotFiles.push(it.path);
  }

  const user = `【论文事实】\n${paperFactsSummary(facts)}\n\n【仓库 snapshot】\n${snapshotSummary(snapshot)}`;

  interface RawMapping {
    concept?: string; paperRefs?: PaperRef[]; codeRefs?: CodeRef[]; configRefs?: CodeRef[];
    relation?: string; confidence?: string;
  }
  let rawArr: RawMapping[] = [];
  for (let attempt = 1; attempt <= 3; attempt++) {
    if (attempt > 1) await new Promise((r) => setTimeout(r, 600 * 2 ** (attempt - 2)));
    try {
      const res = await fetch("https://api.deepseek.com/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model: "deepseek-chat",
          messages: [
            { role: "system", content: MAP_SYSTEM(KNOWN_FACTS.map((f) => `${f.key} (${f.label})`).join("\n")) },
            { role: "user", content: user.slice(0, 20000) },
          ],
          stream: false,
          max_tokens: 4000,
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

  // 校验：codeRef 必须真实存在于 snapshot；relation/confidence 归一化；status 一律 proposed
  const mapped = normalizeMappings(rawArr.map((r) => ({
    concept: r.concept ?? "",
    paperRefs: r.paperRefs,
    codeRefs: codeRefsInSnapshot(Array.isArray(r.codeRefs) ? r.codeRefs : [], snapshotFiles),
    configRefs: r.configRefs ? codeRefsInSnapshot(r.configRefs, snapshotFiles) : undefined,
    relation: r.relation,
    confidence: r.confidence,
  })));
  return mapped.map((m) => ({ ...m, status: "proposed" as const }));
}

/** 确认/驳回：确认置 status=confirmed；驳回从列表移除 */
export function confirmMapping(mappings: Mapping[], id: string): Mapping[] {
  return mappings.map((m) => (m.id === id ? { ...m, status: "confirmed" } : m));
}
export function rejectMapping(mappings: Mapping[], id: string): Mapping[] {
  return mappings.filter((m) => m.id !== id);
}
