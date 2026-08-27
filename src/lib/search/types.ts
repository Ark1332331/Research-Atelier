/**
 * 论文检索管线 · 核心数据模型（Paper Search Pipeline）
 *
 * 对应 PAPER_SEARCH_IMPLEMENTATION.md §4.1（v0.2 封板版）。
 * 本文件保持无副作用（纯类型 + 纯函数），可被 scripts/test-search-types.mjs 直接单测。
 *
 * v0.2 封板补丁语义（§12.10-12.12）：
 *  - SearchRun.coverage（SourceCoverage）是一等字段，反映本轮真实覆盖，不许虚报；
 *  - 完整筛选完成 = Google Scholar ∈ {api, imported} AND Web of Science ∈ {api, imported}；
 *  - not-wired（○ 尚未接入）≠ missing（⚠ 未覆盖）≠ 0 命中（搜过但无结果）；
 *  - Google Scholar 的 BibTeX 导入是用户手动补充来源，不是自动检索 fallback。
 */

/** 学术索引来源（sourceProvider：这条记录来自哪个学术索引——对科研用户真正重要） */
export type SourceName =
  | "openalex"
  | "semantic-scholar"
  | "google-scholar"
  | "web-of-science"
  | "arxiv"
  | "crossref";

/** 访问渠道（accessProvider：通过什么渠道拿到的记录） */
export type AccessProvider = "official-api" | "serpapi" | "user-import";

/** 检索目的（RankingProfile 的模式键，§7） */
export type SearchGoal =
  | "explore"
  | "recent"
  | "foundational"
  | "survey"
  | "reproducible"
  | "follow_paper";

/** 检索意图：Query Planner 的输出（用户不需要学习检索语法）。
 *  v1.1.1 hardening：conceptGroups（组内 OR、组间 AND）取代扁平 concepts——
 *  「world model」与「robotics」必须是不同组（组间 AND），组内放同义词（组内 OR）。 */
export interface SearchIntent {
  goal: SearchGoal;
  conceptGroups: string[][];
  context: string[];
  exclude: string[];
  preferredTypes?: string[];
  yearRange?: [number, number];
  seedPaper?: { provider: string; id: string; title?: string };
}

/** 单条检索请求（planner 产出，provider 消费） */
export interface ProviderQuery {
  providerId: SourceName;
  mode: "keyword" | "phrase" | "boolean" | "semantic" | "title";
  raw: string;
  intent: SearchIntent;
  limit: number;
}

/** provider 原始返回，未归一化。sourceProvider 与 accessProvider 分离（v0.2 硬约束） */
export interface ProviderPaper {
  sourceProvider: SourceName;
  accessProvider?: AccessProvider;
  externalId: string;
  doi?: string;
  arxivId?: string;
  title: string;
  authors: string[];
  year?: number;
  venue?: string;
  type?: string;
  abstract?: string;
  citationCount?: number;
  relevanceScore?: number;
  isOa?: boolean;
  oaPdfUrl?: string;
  publisherUrl?: string;
  topics?: string[];
  raw?: unknown;
}

/** 分源引用键（引用量分源记录，绝不合并） */
export type CitationSourceKey =
  | "googleScholar"
  | "webOfScience"
  | "openAlex"
  | "semanticScholar";

/** 去重后的规范形态 */
export interface CanonicalPaper {
  canonicalId: string;
  doi?: string;
  arxivId?: string;
  title: string;
  authors: string[];
  year?: number;
  type?: string;
  venue?: string;
  abstract?: string;
  sources: SourceName[];
  metrics: { citations: Partial<Record<CitationSourceKey, number>> };
  links?: { isOa: boolean; oaPdfUrl?: string; publisherUrl?: string };
  topics?: string[];
  hits: ProviderPaper[];
}

/** 工具返回给 LLM 的形态（字段名与现有 prompt 的 oa_pdf_url / publisher_url 兼容 download_paper） */
export interface PaperHitV2 {
  id: string;
  arxivId?: string;
  title: string;
  authors: string;
  year: string;
  abstract: string;
  doi?: string;
  isOa: boolean;
  oaPdfUrl?: string;
  publisherUrl: string;
  publisherName: string;
  type?: string;
  venue?: string;
  sourceProvider: string;
  accessProvider?: string;
  sources?: string[];
  relevanceScore?: number;
  topics?: string[];
  citations?: { source: string; count: number; access: string }[];
}

/* ---------------- 覆盖语义（v0.2 封板补丁，§4.1/§12.10-12.12） ---------------- */

/**
 * 来源覆盖状态：
 *  - api       本轮真实 API 检索；
 *  - imported  本轮来自用户导入（WoS 导出 / Scholar BibTeX）；
 *  - missing   provider 已接线，但本轮无 API 也无导入（应搜没搜到数据）；
 *  - not-wired 当前构建尚未实现该 provider（显示「○ 尚未接入」，绝不显示 0）。
 */
export type CoverageStatus = "api" | "imported" | "missing" | "not-wired";

export interface SourceCoverage {
  googleScholar: CoverageStatus;
  webOfScience: CoverageStatus;
  openAlex: CoverageStatus;
  semanticScholar: CoverageStatus;
  arxiv: CoverageStatus;
}

/** 硬来源：完整筛选完成 = 这两者都已覆盖（api 或 imported） */
export const HARD_SOURCES = ["googleScholar", "webOfScience"] as const;
export type HardSourceKey = (typeof HARD_SOURCES)[number];

/** 一次完整检索运行的记录（含本轮真实覆盖，不许虚报） */
export interface SearchRun {
  id: string;
  intent: SearchIntent;
  queries: ProviderQuery[];
  coverage: SourceCoverage;
  candidateCount: number;
  afterDedupe: number;
  afterFilter: number;
  afterRerank: number;
  warnings: string[];
  createdAt: string;
}

const COVERED: CoverageStatus[] = ["api", "imported"];

export function isHardSourceCovered(status: CoverageStatus): boolean {
  return COVERED.includes(status);
}

/** 完整筛选完成判定：GS 已覆盖 AND WoS 已覆盖（api 或 imported 均可） */
export function hardSourcesCovered(coverage: SourceCoverage): boolean {
  return HARD_SOURCES.every((k) => COVERED.includes(coverage[k]));
}

/** 未覆盖（missing / not-wired）的硬来源列表 */
export function uncoveredHardSources(
  coverage: SourceCoverage,
): { key: HardSourceKey; status: CoverageStatus }[] {
  return HARD_SOURCES.map((k) => ({ key: k, status: coverage[k] })).filter(
    (x) => !COVERED.includes(x.status),
  );
}

/** 「本次结果为部分检索：尚未包含 …」文案；完整覆盖时返回 null */
export function partialRetrievalWarning(coverage: SourceCoverage): string | null {
  const missing = uncoveredHardSources(coverage);
  if (missing.length === 0) return null;
  const names = missing
    .map((m) => (m.key === "googleScholar" ? "Google Scholar" : "Web of Science"))
    .join("、");
  return "本次结果为部分检索：尚未包含 " + names + "。";
}

/** 状态 → 用户可见文案（not-wired 与 missing 显示不同；都 ≠ 0 命中） */
export function coverageStatusLabel(status: CoverageStatus): string {
  switch (status) {
    case "api":
      return "✓ 已检索";
    case "imported":
      return "✓ 已导入";
    case "missing":
      return "⚠ 未覆盖";
    case "not-wired":
      return "○ 尚未接入";
  }
}

export function sourceDisplayName(source: SourceName | HardSourceKey): string {
  const map: Record<string, string> = {
    googleScholar: "Google Scholar",
    webOfScience: "Web of Science",
    openalex: "OpenAlex",
    "semantic-scholar": "Semantic Scholar",
    arxiv: "arXiv",
    crossref: "Crossref",
  };
  return map[source] ?? source;
}

/* ---------------- 归一化与去重键（dedupe 的纯函数部分） ---------------- */

/** DOI 规范化：去 https://doi.org/、dx.doi.org、DOI: 前缀，去杂质字符 */
export function normalizeDoi(doi?: string | null): string | undefined {
  if (!doi) return undefined;
  let d = String(doi).trim();
  d = d.replace(/^https?:\/\/(dx\.)?doi\.org\//i, "");
  d = d.replace(/^doi:\s*/i, "");
  d = d.replace(/[^0-9A-Za-z./()_-]/g, "");
  return d || undefined;
}

/** arXiv id 规范化：去 abs/pdf URL 前缀与 .pdf 后缀 */
export function normalizeArxivId(id?: string | null): string | undefined {
  if (!id) return undefined;
  let v = String(id).trim();
  v = v.replace(/^https?:\/\/arxiv\.org\/(abs|pdf)\//i, "");
  v = v.replace(/\.pdf$/i, "");
  v = v.replace(/[^0-9A-Za-z._-]/g, "");
  return v || undefined;
}

/** 标题归一化：小写、去标点/空白、去版本后缀（如 "v2"） */
export function normalizedTitle(title?: string | null): string {
  if (!title) return "";
  return String(title)
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[^a-z0-9\u4e00-\u9fa5 ]/g, "")
    .replace(/\s*v\d+\s*$/g, "")
    .trim();
}

/** canonicalId 优先级：DOI > arxivId > normalizedTitle */
export function canonicalIdFor(paper: {
  doi?: string | null;
  arxivId?: string | null;
  title?: string | null;
}): string {
  const doi = normalizeDoi(paper.doi);
  if (doi) return "doi:" + doi;
  const arxiv = normalizeArxivId(paper.arxivId);
  if (arxiv) return "arxiv:" + arxiv;
  const title = normalizedTitle(paper.title);
  return title ? "title:" + title : "";
}



/* ================ Phase A：Search Guide / Research Session（v1.1 封板 schema） ================ */

/** SearchPlan 阶段状态机（v1.1 guardrail #4：Return Path 落到状态机，不只 UI 文案） */
export type SearchPlanStage =
  | "planning"          // 尚未生成计划
  | "ready-to-search"   // 计划已生成，推荐当前动作，等待用户去真实网站
  | "external-opened"   // 用户已点击打开外部数据库
  | "awaiting-import";  // 用户声称搜完回来，等待导入（Phase B-lite）

export interface DatabaseStrategy {
  id: "google-scholar" | "web-of-science" | "semantic-scholar" | "arxiv" | "openalex";
  purpose: string;
  queries: string[];
  recommendedFirst?: string;
  priority: "primary" | "secondary" | "later";
  recommendedNow: boolean;  // v1.1：一个 SearchPlan 只允许恰好一个 true（代码强制，见 normalizeSearchPlan）
  deepLinkUrl?: string;     // 只由确定性 builder 生成（gs-link.ts），LLM 返回的 URL 一律不可信
  nextActions: string[];
  why: string;
}

export interface SearchPlan {
  intent: SearchIntent;
  stage: "plan-ready";
  databases: DatabaseStrategy[];
  suggestedFirstAction: string;
  returnPath: string[];     // v1.1：这一轮任务 ①–④（由代码生成，Return Path）
  warnings: string[];       // 如 WoS 年份跨度提示
  createdAt: string;
}

export interface DatabaseAction {
  database: string;
  action: "query-generated" | "opened" | "results-imported";  // 只记录系统可确认的动作
  at: string;
}

export interface NextStep { action: string; reason: string; }

/* ---- Phase B/C schema（随 ResearchSession 一并落位；逻辑 Phase B/C 实现） ---- */

export type PaperRole =
  | "survey" | "foundational" | "core" | "follow-up"
  | "competing" | "recent" | "applied" | "peripheral";
export type ReadingDepth = "skip" | "skim" | "targeted" | "deep";
export type EvidenceLevel = "metadata" | "abstract" | "fulltext" | "citation-graph";

export interface EvidenceRef { kind: EvidenceLevel; source: string; detail?: string; }

export interface PaperTriage {
  paperId: string;
  role: PaperRole;
  roleReason: string;
  roleConfidence: "high" | "medium" | "low";
  roleEvidence: EvidenceRef[];
  worthReading: string;
  relationToQuestion: "high" | "medium" | "low" | "unknown";
  depth: ReadingDepth;
  evidenceLevel: EvidenceLevel;
  keySections: string[];    // 仅 evidenceLevel=fulltext 时允许填写，否则必须为空（v1.1）
  skipSections: string[];
  d: { d1: string; d2: string; d3: string; d4: string; d5: string; d6: string; };
  verdict: "读" | "扫读" | "跳过" | "待定";
}

export type MapRelation = "cites" | "related" | "author-continuity";

export interface MapNode { paperId: string; title: string; year?: number; role?: PaperRole; cluster?: string; }
export interface MapEdge {
  from: string; to: string;
  relation: MapRelation;
  explanation: string;
  evidence: string;
}
export interface ReadingPath { id: string; nodes: string[]; audience: "beginner" | "recent-3y" | "custom"; rationale: string; }

/* ---- ResearchSession（v1.1：schemaVersion 一开始就带） ---- */

export interface ResearchSession {
  schemaVersion: number;
  id: string;
  question: string;
  stage: SearchPlanStage;
  intent?: SearchIntent;
  plan?: SearchPlan;
  databaseActions: DatabaseAction[];
  candidates: CanonicalPaper[];
  triage: PaperTriage[];
  seedPapers: string[];
  map?: { nodes: MapNode[]; edges: MapEdge[] };
  readingPaths: ReadingPath[];
  openQuestions: string[];
  nextStepHistory: NextStep[];  // derived 建议的 history（备查，不作为当前真相）
  createdAt: string;
  updatedAt: string;
}

/** LLM 只产结构化意图（guardrail #2）；计划/URL/查询串由代码确定性生成 */
export interface RawPlannerOutput { intent: SearchIntent; }

