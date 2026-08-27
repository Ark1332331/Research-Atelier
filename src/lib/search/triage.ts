/**
 * Evidence-aware Triage（B5/B6 + v1.3 hardening）：
 *  - evidenceLevelFor：按候选实际拥有的证据判定（abstract / metadata），B-lite 无 fulltext
 *  - enforceTriageEvidenceBoundary：evidenceLevel !== fulltext 时 keySections/skipSections 代码强制为空
 *  - normalizeTriage：只绑定真实 Candidate ID；LLM 声称的 evidenceLevel 不得超过候选实际证据
 *  - roleEvidence 必须与真实 metadata/abstract provenance 对齐：
 *    fulltext 一律剔除；citation-graph 仅当候选真有分源引用数；abstract 仅当候选有摘要且来源匹配；
 *    metadata 仅当来源在 enrichment provenance 或 import 中（v1.3）
 *  - 输出不做总分排行榜（B6），只给角色/深度/为什么
 */
import type { CanonicalPaper, EvidenceLevel, PaperTriage, EvidenceRef, AcademicConceptMap } from "./types.ts";

export function evidenceLevelFor(c: CanonicalPaper): EvidenceLevel {
  return c.abstract && c.abstract.trim().length > 0 ? "abstract" : "metadata";
}

export function enforceTriageEvidenceBoundary(t: PaperTriage): PaperTriage {
  if (t.evidenceLevel !== "fulltext" && (t.keySections.length > 0 || t.skipSections.length > 0)) {
    return { ...t, keySections: [], skipSections: [] };
  }
  return t;
}

const ROLES = ["survey", "foundational", "core", "follow-up", "competing", "recent", "applied", "peripheral"];
const DEPTHS = ["skip", "skim", "targeted", "deep"];
const RELS = ["high", "medium", "low", "unknown"];
const CONFS = ["high", "medium", "low"];
const VERDICTS = ["读", "扫读", "跳过", "待定"];

function str(v: unknown): string { return typeof v === "string" ? v.trim() : ""; }
function strArr(v: unknown): string[] { return Array.isArray(v) ? v.map(str).filter(Boolean).slice(0, 8) : []; }

/** v1.3：roleEvidence 必须与真实 provenance 对齐；虚构/越权证据剔除 */
function roleEvidenceOk(e: EvidenceRef, c: CanonicalPaper): boolean {
  const kind = str(e?.kind);
  const src = str(e?.source);
  if (kind === "fulltext") return false;                              // B-lite 无全文
  if (kind === "citation-graph") {
    return Object.keys(c.metrics?.citations ?? {}).includes(src);      // 只有真有分源引用数
  }
  if (kind === "abstract") {
    if (!c.abstract) return false;
    const sources = c.enrichment?.abstract ?? [];
    return sources.includes(src) || (sources.length === 0 && src === "openalex");
  }
  if (kind === "metadata") {
    const sources = new Set([
      ...(c.enrichment?.title ?? []), ...(c.enrichment?.authors ?? []),
      ...(c.enrichment?.year ?? []), ...(c.enrichment?.venue ?? []),
      ...(c.enrichment?.doi ?? []), ...(c.enrichment?.oa ?? []),
    ]);
    return sources.has(src) || src === "import" || src === "user-import";
  }
  return false;
}

/** 归一化 triage：绑定真实候选、clamp evidenceLevel、强制边界。幂等。 */
export function normalizeTriage(raw: unknown, candidates: CanonicalPaper[]): PaperTriage[] {
  if (!Array.isArray(raw)) return [];
  const byId = new Map(candidates.map((c) => [c.canonicalId, c]));
  const out: PaperTriage[] = [];
  for (const r of raw) {
    const o = (r ?? {}) as Record<string, unknown>;
    const paperId = str(o.paperId);
    const cand = byId.get(paperId);
    if (!cand) continue; // 只绑定真实候选
    const maxLevel = evidenceLevelFor(cand);
    let level = str(o.evidenceLevel) as EvidenceLevel;
    if (level !== "fulltext" && level !== "abstract" && level !== "metadata") level = maxLevel;
    if (maxLevel === "metadata" && level !== "metadata") level = "metadata";   // 无 abstract 不许越权
    const t: PaperTriage = {
      paperId,
      role: (ROLES.includes(str(o.role)) ? str(o.role) : "peripheral") as PaperTriage["role"],
      roleReason: str(o.roleReason),
      roleConfidence: (CONFS.includes(str(o.roleConfidence)) ? str(o.roleConfidence) : "low") as PaperTriage["roleConfidence"],
      roleEvidence: (Array.isArray(o.roleEvidence) ? o.roleEvidence : [])
        .filter((e): e is EvidenceRef => e && typeof e === "object" && roleEvidenceOk(e as EvidenceRef, cand))
        .slice(0, 5),
      worthReading: str(o.worthReading),
      relationToQuestion: (RELS.includes(str(o.relationToQuestion)) ? str(o.relationToQuestion) : "unknown") as PaperTriage["relationToQuestion"],
      depth: (DEPTHS.includes(str(o.depth)) ? str(o.depth) : "skim") as PaperTriage["depth"],
      evidenceLevel: level,
      keySections: level === "fulltext" ? strArr(o.keySections) : [],
      skipSections: level === "fulltext" ? strArr(o.skipSections) : [],
      d: {
        d1: str((o.d as Record<string, unknown> | undefined)?.d1), d2: str((o.d as Record<string, unknown> | undefined)?.d2), d3: str((o.d as Record<string, unknown> | undefined)?.d3),
        d4: str((o.d as Record<string, unknown> | undefined)?.d4), d5: str((o.d as Record<string, unknown> | undefined)?.d5), d6: str((o.d as Record<string, unknown> | undefined)?.d6),
      },
      verdict: (VERDICTS.includes(str(o.verdict)) ? str(o.verdict) : "待定") as PaperTriage["verdict"],
    };
    out.push(enforceTriageEvidenceBoundary(t));
  }
  return out;
}

const SYSTEM_PROMPT = "你是 Research Atelier 的论文筛选器。基于给定证据对每篇候选给出结构化判断。\n" +
  "输出 JSON 数组，每项：\n" +
  '{ "paperId": "必须是给定列表中的 canonicalId",' +
  ' "role": "survey|foundational|core|follow-up|competing|recent|applied|peripheral",' +
  ' "roleReason": "为什么是这个角色（相对当前研究问题）",' +
  ' "roleConfidence": "high|medium|low",' +
  ' "roleEvidence": [{"kind":"abstract|metadata|citation-graph","source":"…","detail":"…"}],' +
  ' "worthReading": "为什么值得读/跳过（一句话）",' +
  ' "relationToQuestion": "high|medium|low|unknown",' +
  ' "depth": "skip|skim|targeted|deep",' +
  ' "evidenceLevel": "abstract 或 metadata（只许用给定证据，不得虚报）",' +
  ' "keySections": [], "skipSections": [],' +
  ' "d": {"d1":"…","d2":"…","d3":"…","d4":"…","d5":"…","d6":"…"},' +
  ' "verdict": "读|扫读|跳过|待定" }\n' +
  "规则：evidenceLevel 只能取给定证据允许的最高档（有摘要→abstract，否则→metadata）；" +
  "keySections/skipSections 一律填空数组（没有全文）；不要给任何分数或总分排名；" +
  "role 是相对当前研究问题的判断，不是论文元数据。";

/** v1.3：prompt 必须显式携带研究问题（relationToQuestion/role 依赖它）。
 *  v1.6：同时携带 AcademicConceptMap 的 canonical 术语——AI 判断相对真实研究问题与学术术语。 */
export function buildTriageUserPrompt(candidates: CanonicalPaper[], question: string, conceptMap?: AcademicConceptMap): string {
  const q = String(question ?? "").trim();
  let header = "用户的研究问题：" + (q || "（未提供）") + "\n" +
    "所有 role / relationToQuestion / worthReading 都相对这个研究问题判断。\n";
  if (conceptMap) {
    const terms: string[] = [];
    for (const key of ["coreTasks", "methods", "broaderFields", "applicationTerms"] as const) {
      for (const c of conceptMap[key] ?? []) terms.push(c.canonical);
    }
    if (terms.length) header += "学术术语映射（canonical）：" + [...new Set(terms)].join("、") + "\n";
  }
  header += "\n";
  const lines = candidates.map((c, i) => {
    const ev = evidenceLevelFor(c);
    return (i + 1) + ". canonicalId=" + c.canonicalId + " | title=" + c.title +
      " | authors=" + (c.authors ?? []).join("; ") +
      " | year=" + (c.year ?? "?") + " | venue=" + (c.venue ?? "?") +
      " | evidence=" + ev +
      (ev === "abstract" ? " | abstract=" + (c.abstract ?? "").slice(0, 800) : " | 无摘要");
  });
  return header + "候选列表：\n" + lines.join("\n");
}

/** LLM triage；RA_TRIAGE_MOCK 提供确定性路径（测试/无 key 环境）；question + conceptMap 显式传入 */
export async function runTriage(candidates: CanonicalPaper[], question: string, conceptMap?: AcademicConceptMap): Promise<PaperTriage[]> {
  const mock = process.env.RA_TRIAGE_MOCK;
  if (mock) {
    let parsed: unknown = null;
    try { parsed = JSON.parse(mock); } catch { parsed = null; }
    if (parsed) return normalizeTriage(parsed, candidates);
  }
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) throw new Error("DEEPSEEK_API_KEY 未配置");
  const res = await fetch("https://api.deepseek.com/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + apiKey },
    body: JSON.stringify({
      model: "deepseek-chat",
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: buildTriageUserPrompt(candidates, question, conceptMap) },
      ],
      stream: false,
      temperature: 0.2,
    }),
    signal: AbortSignal.timeout(120000),
  });
  const data = await res.json();
  if (!res.ok) throw new Error("Triage LLM HTTP " + res.status + ": " + (data?.error?.message ?? ""));
  const content: string = data?.choices?.[0]?.message?.content ?? "";
  const start = content.indexOf("[");
  const end = content.lastIndexOf("]");
  if (start < 0 || end <= start) throw new Error("Triage 返回不是 JSON 数组");
  let parsed: unknown;
  try { parsed = JSON.parse(content.slice(start, end + 1)); } catch { throw new Error("Triage JSON 解析失败"); }
  return normalizeTriage(parsed, candidates);
}

