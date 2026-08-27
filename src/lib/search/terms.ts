/**
 * Phase A.5：Academic Term Mapper + Query Ladder（v1.4）。
 * 纯函数（可单测）：
 *  - normalizeConceptMap：校验 LLM 产出的术语映射；用户原词必须逐条落位（ambiguous 显式标注，不可静默当标准术语）
 *  - buildLadderFromMap：broad → method → application 三层；application 默认不进第一层
 *  - intentForTier：按层确定性生成 SearchIntent（conceptGroups 组内 OR、组间 AND）
 *  - calibrateTerms：基于真实候选 title/abstract 统计，给出 confirmed/suggested/weakOrRare（只建议，不改研究目标）
 * LLM 允许做语义判断，但最终结构必须经本模块 normalize/validate；LLM 绝不产出最终 query。
 */
import type {
  AcademicConcept, AcademicConceptMap, ConceptRole, QueryLadder, QueryLadderTier,
  SearchIntent, CanonicalPaper, TermCalibration,
} from "./types.ts";

const ROLES: ConceptRole[] = ["coreTask", "method", "broaderField", "application", "adjacent"];
const CONF = ["high", "medium", "low"];

function str(v: unknown): string { return typeof v === "string" ? v.trim() : ""; }
function strArr(v: unknown): string[] { return Array.isArray(v) ? v.map(str).filter(Boolean) : []; }
function low(s: string): string { return s.toLowerCase().replace(/\s+/g, " ").trim(); }

/** 单条概念归一化：角色/置信度/变体校验；空 canonical 丢弃 */
function normalizeConcept(raw: unknown, role: ConceptRole): AcademicConcept | null {
  const o = (raw ?? {}) as Record<string, unknown>;
  const canonical = str(o.canonical || o.term);
  if (!canonical) return null;
  const sourceTerm = str(o.sourceTerm) || canonical;
  return {
    canonical,
    role,
    alternatives: [...new Set(strArr(o.alternatives).filter((a) => low(a) !== low(canonical)))],
    confidence: (CONF.includes(str(o.confidence)) ? str(o.confidence) : "medium") as AcademicConcept["confidence"],
    sourceTerm,
    ...(str(o.note) ? { note: str(o.note) } : {}),
  };
}

/**
 * 归一化概念映射。关键不变量：
 *  - 每个用户原词必须至少出现在某个概念的 sourceTerm/alternatives 或 ambiguousTerms 中，
 *    否则自动放入 ambiguousTerms（显式标注，不可静默当标准术语）。
 */
export function normalizeConceptMap(raw: unknown): AcademicConceptMap {
  const o = (raw ?? {}) as Record<string, unknown>;
  const rawTerms = strArr(o.rawTerms);
  const bucket = (key: string, role: ConceptRole): AcademicConcept[] =>
    (Array.isArray(o[key]) ? o[key] : []).map((x) => normalizeConcept(x, role)).filter((x): x is AcademicConcept => x !== null);

  const map: AcademicConceptMap = {
    coreTasks: bucket("coreTasks", "coreTask"),
    methods: bucket("methods", "method"),
    broaderFields: bucket("broaderFields", "broaderField"),
    applicationTerms: bucket("applicationTerms", "application"),
    adjacentTerms: bucket("adjacentTerms", "adjacent"),
    ambiguousTerms: (Array.isArray(o.ambiguousTerms) ? o.ambiguousTerms : [])
      .map((x) => {
        const oo = (x ?? {}) as Record<string, unknown>;
        const term = str(oo.term || oo.canonical);
        return term ? { term, note: str(oo.note) || "有歧义/非标准表达", ...(str(oo.suggestedCanonical) ? { suggestedCanonical: str(oo.suggestedCanonical) } : {}) } : null;
      })
      .filter((x): x is NonNullable<typeof x> => x !== null),
    rawTerms,
  };

  // 未落位原词 → ambiguous（显式标注）
  const covered = new Set<string>();
  const cover = (t: string) => { const l = low(t); if (l) covered.add(l); };
  for (const key of ["coreTasks", "methods", "broaderFields", "applicationTerms", "adjacentTerms"] as const) {
    for (const c of map[key]) { cover(c.canonical); cover(c.sourceTerm); for (const a of c.alternatives) cover(a); }
  }
  for (const a of map.ambiguousTerms) cover(a.term);
  for (const rt of rawTerms) {
    if (!covered.has(low(rt))) {
      map.ambiguousTerms.push({ term: rt, note: "未映射为任何标准学术术语（不静默当作标准术语）" });
    }
  }
  return map;
}

function groupOf(c: AcademicConcept): string[] {
  return [c.canonical, ...c.alternatives.filter((a) => low(a) !== low(c.canonical))];
}

/** 每层取 2 个 canonical 概念（组内 OR、组间 AND）；不足则取可用个数 */
function pickGroups(primary: AcademicConcept[], fallback: AcademicConcept[], max = 2): string[][] {
  const out: string[][] = [];
  const seen = new Set<string>();
  const take = (c: AcademicConcept) => {
    if (out.length >= max) return;
    if (seen.has(low(c.canonical))) return;
    seen.add(low(c.canonical));
    out.push(groupOf(c));
  };
  for (const c of primary) take(c);
  for (const c of fallback) take(c);
  return out;
}

/** v1.4 确定性护栏：ambiguous 词即使出现在 LLM 的 alternatives 里也一律不进任何层 */
function stripAmbiguous(groups: string[][], map: AcademicConceptMap): string[][] {
  const amb = new Set(map.ambiguousTerms.map((a) => a.term.toLowerCase()));
  return groups
    .map((g) => g.filter((x) => !amb.has(x.toLowerCase())))
    .filter((g) => g.length > 0);
}

/** 三层 Query Ladder：application 不进第一层；ambiguous 不进任何层。
 *  v1.4 分层取词规则：tier1 = 上位领域[0] + 核心任务[0]（如 HRI AND human intention recognition）；
 *  tier2 = 方法[0] + 核心任务[1]；tier3 = 应用[0] + 核心任务[0]。 */
export function buildLadderFromMap(map: AcademicConceptMap): QueryLadder {
  const take = (c?: AcademicConcept): string[][] => (c ? [groupOf(c)] : []);
  const rawT1 = [...take(map.broaderFields[0]), ...take(map.coreTasks[0])];
  const rawT2 = [...take(map.methods[0]), ...take(map.coreTasks[1] ?? map.coreTasks[0])];
  const rawT3 = [...take(map.applicationTerms[0]), ...take(map.coreTasks[0])];
  const t1 = stripAmbiguous(rawT1, map);
  const t2 = stripAmbiguous(rawT2, map);
  const t3 = stripAmbiguous(rawT3, map);
  const tiers: QueryLadderTier[] = [
    {
      tier: "broad-domain",
      label: "上位领域 / 核心任务",
      conceptGroups: t1.length ? t1 : stripAmbiguous(pickGroups(map.coreTasks, []), map),
      why: "先确认领域标准术语、综述、经典路线——用学术界真正在用的表达进入领域",
    },
    {
      tier: "method-task",
      label: "方法 / 技术路线",
      conceptGroups: t2.length ? t2 : stripAmbiguous(pickGroups(map.methods, map.coreTasks), map),
      why: "再找具体技术路线（方法/任务层面的 canonical 表达）",
    },
    {
      tier: "application-narrow",
      label: "应用场景",
      conceptGroups: t3.length ? t3 : stripAmbiguous(pickGroups(map.applicationTerms, map.coreTasks), map),
      why: "最后才加入具体应用场景（应用词不该第一轮当 hard constraint）",
    },
  ];
  const activeTier = 0; // 第一轮永远从 broad-domain 开始（A.5 核心）
  return { tiers, activeTier };
}

export function normalizeLadder(raw: unknown): QueryLadder {
  const o = (raw ?? {}) as Record<string, unknown>;
  const tiers = (Array.isArray(o.tiers) ? o.tiers : [])
    .map((t, i) => {
      const oo = (t ?? {}) as Record<string, unknown>;
      const groups = Array.isArray(oo.conceptGroups)
        ? (oo.conceptGroups as unknown[]).map((g) => strArr(g).filter(Boolean)).filter((g) => g.length > 0)
        : [];
      return {
        tier: (["broad-domain", "method-task", "application-narrow"].includes(str(oo.tier)) ? str(oo.tier) : "broad-domain") as QueryLadderTier["tier"],
        label: str(oo.label) || ("tier" + (i + 1)),
        conceptGroups: groups,
        why: str(oo.why),
      };
    })
    .filter((t) => t.conceptGroups.length > 0);
  const activeTier = Number(o.activeTier);
  return {
    tiers,
    activeTier: Number.isInteger(activeTier) && activeTier >= 0 && activeTier < tiers.length ? activeTier : 0,
  };
}

/** 按层确定性生成 SearchIntent（ambiguous 与未映射词一律不进 conceptGroups） */
export function intentForTier(map: AcademicConceptMap, tierIndex: number): SearchIntent {
  const ladder = buildLadderFromMap(map);
  const tier = ladder.tiers[Math.min(Math.max(tierIndex, 0), ladder.tiers.length - 1)] ?? ladder.tiers[0];
  const adjacent = pickGroups(map.adjacentTerms, [], 1).flat();
  const intent: SearchIntent = {
    goal: "explore",
    conceptGroups: tier.conceptGroups,
    ...(adjacent.length ? { context: adjacent.slice(0, 3) } : { context: [] }),
    exclude: [],
  };
  return intent;
}

/* ---------------- B-lite term calibration（v1.4，基于真实候选证据） ---------------- */

function allText(c: CanonicalPaper): string {
  return [c.title, c.abstract].filter(Boolean).join(" ").toLowerCase();
}

/** 高频 Title-Case 短语提取（≥2 次），用于 termsSuggested */
function extractPhrases(candidates: CanonicalPaper[]): { term: string; count: number }[] {
  const counts = new Map<string, number>();
  const re = /\b[A-Z][a-zA-Z0-9-]+(?:\s+[A-Z][a-zA-Z0-9-]+){0,3}\b/g;
  for (const c of candidates) {
    const text = [c.title, c.abstract].filter(Boolean).join(" ");
    const m = text.matchAll(re);
    const seen = new Set<string>();
    for (const mm of m) {
      const t = mm[0];
      if (/^(The|A|An|In|On|Of|For|With|From|To|And|Or|Based|Using|Towards|Toward|Review|Survey)$/i.test(t)) continue;
      const l = t.toLowerCase();
      if (seen.has(l)) continue;
      seen.add(l);
      counts.set(l, (counts.get(l) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .filter(([, n]) => n >= 2)
    .map(([term, count]) => ({ term, count }))
    .sort((a, b) => b.count - a.count);
}

/** 基于真实候选 title/abstract 的术语校准：只建议，不改研究目标 */
export function calibrateTerms(candidates: CanonicalPaper[], map: AcademicConceptMap): TermCalibration {
  const texts = candidates.map(allText);
  const countTerm = (term: string): number => {
    const t = term.toLowerCase();
    let n = 0;
    for (const tx of texts) if (tx.includes(t)) n++;
    return n;
  };
  const known = [...map.coreTasks, ...map.methods, ...map.broaderFields, ...map.applicationTerms, ...map.adjacentTerms];
  const knownLow = new Set(known.map((k) => k.canonical.toLowerCase()));
  for (const k of known) for (const a of k.alternatives) knownLow.add(a.toLowerCase());

  const confirmed = known
    .map((k) => ({ term: k.canonical, count: countTerm(k.canonical) }))
    .filter((x) => x.count >= 2)
    .sort((a, b) => b.count - a.count);
  const weakBase = known
    .map((k) => ({ term: k.canonical, count: countTerm(k.canonical), note: "" }))
    .filter((x) => x.count <= 1)
    .map((x) => ({ ...x, note: x.count === 0 ? "候选集中未出现（弱/罕见）" : "候选集中仅出现 1 次" }));
  // v1.4：歧义/非标准表达（用户原词）在候选集中罕见也应提示换词
  for (const a of map.ambiguousTerms) {
    const c = countTerm(a.term);
    if (c <= 1) {
      weakBase.push({
        term: a.term,
        count: c,
        note: (a.suggestedCanonical ? "你使用的表达在候选集中罕见，建议改用「" + a.suggestedCanonical + "」" : "你使用的表达在候选集中罕见（歧义/非标准）"),
      });
    }
  }
  const weak = weakBase;
  const suggested = extractPhrases(candidates)
    .filter((x) => !knownLow.has(x.term.toLowerCase()))
    .slice(0, 5);

  return {
    termsConfirmed: confirmed.slice(0, 8),
    termsSuggested: suggested,
    termsWeakOrRare: weak.slice(0, 8),
    basedOn: candidates.length,
    computedAt: new Date().toISOString(),
  };
}

