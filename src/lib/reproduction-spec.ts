/**
 * 复现记录（复现工作台数据层）：data/reproduction.json —— { records: ReproductionSpec[] }
 *
 * Step 1（v0.3 方案 §2 / §14-1）：ReproductionSpec v2 + normalizeReproduction 迁移。
 *
 * 设计约束：
 *  - 顶层保留 v1 字段（slug/title/sourceUrl/repoUrl/note/path/pitfalls），
 *    以保证旧 GET/POST API 与 repro.tsx 在 Step 1 后行为完全不坏（§14-1 验收）。
 *  - schemaVersion: 2 是稳定版本锚点；normalizeReproduction 幂等：
 *        normalize(v1) → v2
 *        normalize(v2) → 同一个 v2（不继续改变数据）
 *  - 新字段（target/constraints/acceptance/facts/mappings/decisions/environment/evidence）
 *    为后续步骤（2–9）预留；本步只保证类型落地 + 迁移 + 幂等，不做 UI/AI。
 *  - gaps/readiness/tasks 是 derived state，不在本文件持久化（§2 原则），由后续步骤动态计算。
 */

const FILE = "reproduction.json";
export const SPEC_VERSION = 2 as const;

/* ================= 类型（v2） ================= */

export type StepStatus = "todo" | "doing" | "done";
export interface ReproductionStep { id: string; title: string; status: StepStatus; note?: string }
export interface ReproductionPitfall {
  id: string; text: string; env: boolean; stage?: string;
  papers?: string[]; threads?: string[]; createdAt: string;
}

/** 事实（§4）：存在性 status / 可信度 confidence / 重要性 importance 三分；value 显示、normalizedValue 比较 */
export type FactStatus = "observed" | "inferred" | "missing";
export type FactConfidence = "high" | "medium" | "low";
export type FactImportance = "required" | "recommended" | "optional";
/** Fact 的 missing 结构化原因：not_found=扫过没找到 / not_scanned=没扫到那部分（不得判 missing）/
 *  ambiguous=来源有歧义 / not_applicable=该 key 不适用此侧 */
export type FactMissingType = "not_found" | "not_scanned" | "ambiguous" | "not_applicable";
export type FactSource =
  | { kind: "paper"; section?: string; page?: number; quote?: string }
  | { kind: "repo"; file: string; lineStart?: number; lineEnd?: number; commit?: string; dirty?: boolean }
  | { kind: "user"; note?: string };
export interface Fact {
  id: string;
  key: string;               // "training.batch_size"（点分路径，跨侧可比）
  side: "paper" | "repo";
  value?: unknown;           // 显示用原文
  normalizedValue?: unknown; // 比较用归一值
  unit?: string;
  status: FactStatus;
  confidence: FactConfidence;
  importance: FactImportance;
  missingReason?: string;    // status=missing 时保留原因（如「论文未报告 / repo 未找到」）
  missingType?: FactMissingType; // status=missing 时结构化原因（not_found/not_scanned/ambiguous/not_applicable）
  runId?: string;            // 产生该事实的分析轮次（analyze run；user 事实无；历史轮只审计）
  source?: FactSource;
}

/** Paper↔Code Mapping（§5）：AI 提议 → 用户确认 */
export type MappingRelation = "implements" | "configures" | "preprocesses" | "trains" | "evaluates";
export interface PaperRef { section?: string; page?: number; quote?: string }
export interface CodeRef { file: string; lineStart?: number; lineEnd?: number; symbol?: string; commit?: string; dirty?: boolean }
export interface Mapping {
  id: string;
  concept: string;
  paperRefs: PaperRef[];
  codeRefs: CodeRef[];
  configRefs?: CodeRef[];
  relation: MappingRelation;
  status: "proposed" | "confirmed";
  confidence: FactConfidence;
  evidenceIds: string[];
  /** 稳定 identity 锚点（Step 5 grounding）：LLM 只选这些 id，refs 由 anchor/fact 确定性恢复 */
  paperFactIds: string[];
  codeAnchorIds: string[];
  /** 旧数据/无锚点标记：legacy ungrounded mapping 不参与 Step 6/Ready */
  legacy?: boolean;
}

/** Decision 的可追溯选择：优先选参与冲突的真实 Fact（kind=fact），否则用户自定义值 */
export type DecisionChoice =
  | { kind: "fact"; factId: string }
  | { kind: "custom"; value: unknown };

/** Decision Ledger（§6.2）：必须引用 gapId + paperFactIds/repoFactIds，不存裸值 */
export interface Decision {
  id: string;
  gapId?: string;               // 关联的 Gap（必须是可消解的 gap：value_conflict/source_conflict/not_found/uncomparable）
  gapType?: GapType;            // 关联 gap 的类型（accept 时校验当前 gap 类型一致）
  gapFingerprint?: string;      // 关联 gap 的确定性指纹（证据变化后 → stale，不再消解新 gap）
  key: string;
  paperFactIds: string[];       // 参与冲突的 paper fact id（真实 id）
  repoFactIds: string[];        // 参与冲突的 repo fact id（真实 id）
  choice?: DecisionChoice;      // 可追溯选择（accept 必须有有效 choice）
  rationale?: string;
  impact?: string;
  status: "accepted" | "pending";
  blocksReady: boolean;
  resolvedAt?: string;
}

/** Gap（derived，GET 动态算；完全确定性，LLM 不参与是否冲突的判定） */
export type GapType =
  | "value_conflict"     // 跨侧（paper vs repo）同 key normalizedValue 不同
  | "source_conflict"    // 同侧（paper 内或 repo 内）不同来源值不同
  | "not_found"          // 一侧 required missing（missingType=not_found）
  | "not_scanned"        // 一侧 missing 但 missingType=not_scanned（未扫描，不可消解）
  | "uncomparable"       // 一侧有值但无 normalizedValue（无法比较）
  | "missing_required";  // 该 key 在两侧都无 observed 且 required

export type GapCategory = "data" | "preprocessing" | "model" | "training" | "evaluation" | "runtime";

export interface Gap {
  id: string;
  key: string;
  category: GapCategory;
  type: GapType;
  severity: "critical" | "high" | "medium" | "low";
  blocksReady: boolean;         // required + (value_conflict | source_conflict | not_found | missing_required)
  paperFacts: Fact[];
  repoFacts: Fact[];
  paperValue?: unknown;         // 显示用
  repoValue?: unknown;
  paperNormalized?: unknown;    // 比较用
  repoNormalized?: unknown;
  description: string;
}

/** 目标/约束/验收（§3 分家） */
export type TargetScope = "table" | "figure" | "metric" | "full" | "custom";
export interface TargetMetric { name: string; expected?: number | string; tolerance?: number; unit?: string }
export interface Target { scope: TargetScope; name: string; metrics: TargetMetric[] }
export interface HardwareConstraint { gpu?: string; memoryGb?: number }
export interface Constraints {
  hardware?: HardwareConstraint;
  timeBudgetHours?: number;
  modificationPolicy: "none" | "minimal" | "allowed";
  computeBudget?: number;
  dataPolicy?: string;
}
export interface AcceptanceCriterion {
  id: string;
  text: string;
  kind: "metric" | "behavior" | "artifact";
  satisfied?: boolean;
}
export interface Acceptance { criteria: AcceptanceCriterion[] }

/** 环境计划（§8；本步只预留类型，Step 7 实现） */
export interface EnvPlan {
  desired?: Record<string, string>;
  actual?: Record<string, string>;
  diff?: { key: string; desired?: string; actual?: string; ok: boolean }[];
  plan?: { id: string; label: string; confidence: number; recommended?: boolean }[];
  blockingIssues: number;
}

/** 证据账本（§11；P4 已要求、代码未落实的部分） */
export type EvidenceType = "paper" | "code" | "command" | "metric" | "artifact";
export interface EntityRef { kind: "task" | "decision" | "fact" | "mapping"; id: string }
export interface Evidence {
  id: string;
  type: EvidenceType;
  observation: string;
  source: { kind: EvidenceType; ref?: string; commit?: string };
  supports: EntityRef[];
  createdAt: string;
}

/** 版本锚点（§2） */
export interface PaperRevision { id?: string; fileHash?: string }
export interface RepoRevision {
  root: string;
  repoUrl?: string;
  commit?: string;
  branch?: string;
  dirty?: boolean;
}

/** Analysis Binding Gate：每篇复现记录必须显式绑定论文与仓库（P0 context binding） */
export interface PaperArtifact {
  paperId: string;          // 论文库 id 或 data/papers/<slug> 的 slug
  parsedPages: number;      // 已解析页数（0 = 未解析全文）
  paperRevision?: string;   // 正文页文件内容 hash（sha1 前 16）
}
export interface RepoArtifact {
  repoRootId: string;       // code-roots.json 里登记的 rootId（绝不允许 fallback roots[0]）
  repoPath: string;         // root 绝对路径（记录用）
  commit?: string;
  dirty?: boolean;
}

/** 粗粒度复现目标意图（阶段①，系统分析前用户唯一输入；不是 Target——Target 需分析后确认） */
export type GoalIntent = "run_first" | "main_result" | "figure" | "full" | "unknown";

/** 分析编排状态（阶段② analyze orchestrator 持久化；固定本轮 paper/repo revision） */
export interface AnalysisState {
  status: "running" | "done" | "failed";
  ranAt: string;
  paperRevision?: string;   // 本轮 paper 文件 hash
  repoRevision?: RepoRevision;
  error?: string;
  /** ⑤ 系统建议目标：来自本轮 paper facts 的真实证据；null=暂时无法推荐（不硬编码） */
  suggestedTarget?: Target | null;
  summary?: {
    paperFacts: number; repoFacts: number; mappings: number; gaps: number; blocking: number;
  };
}

export interface ReproductionSpec {
  schemaVersion: typeof SPEC_VERSION;
  // —— v1 顶层字段（保留，向后兼容）——
  slug: string;
  title: string;
  sourceUrl?: string;
  repoUrl?: string;
  note?: string;
  path: ReproductionStep[];
  pitfalls: ReproductionPitfall[];
  createdAt?: string;
  updatedAt?: string;
  // —— v2 新增 ——
  paperRevision?: PaperRevision;
  repoRevision?: RepoRevision;
  paperArtifact?: PaperArtifact;  // Binding Gate：论文绑定（无则不可分析）
  repoArtifact?: RepoArtifact;    // Binding Gate：仓库绑定（无则不可分析，绝不 fallback）
  goalIntent?: GoalIntent;    // 阶段①：粗粒度目标（"我不知道，让系统建议"=unknown，不写假 Target）
  analysis?: AnalysisState;   // 阶段②：分析编排状态（persisted，防半新半旧）
  target?: Target;
  constraints?: Constraints;
  acceptance?: Acceptance;
  facts: Fact[];
  mappings: Mapping[];
  decisions: Decision[];
  environment?: EnvPlan;
  evidence: Evidence[];
}

/** 旧类型别名：兼容现有 import（route.ts 里 type Reproduction） */
export type Reproduction = ReproductionSpec;

interface Store { records: ReproductionSpec[] }

/* ================= normalizeReproduction（幂等迁移） ================= */

const isObj = (v: unknown): v is Record<string, any> => typeof v === "object" && v !== null && !Array.isArray(v);
const notNull = <T,>(x: T | null): x is T => x !== null;

/** Fact.source 归一化（显式返回类型，避免联合类型窄化丢失） */
function normFactSource(s: any): FactSource | undefined {
  if (!isObj(s)) return undefined;
  if (s.kind === "paper") return { kind: "paper", section: typeof s.section === "string" ? s.section : undefined, page: typeof s.page === "number" ? s.page : undefined, quote: typeof s.quote === "string" ? s.quote : undefined };
  if (s.kind === "user") return { kind: "user", note: typeof s.note === "string" ? s.note : undefined };
  return { kind: "repo", file: String(s.file ?? ""), lineStart: typeof s.lineStart === "number" ? s.lineStart : undefined, lineEnd: typeof s.lineEnd === "number" ? s.lineEnd : undefined, commit: typeof s.commit === "string" ? s.commit : undefined, dirty: typeof s.dirty === "boolean" ? s.dirty : undefined };
}

/** Evidence.source 归一化 */
function normEvidenceSource(s: any): Evidence["source"] {
  if (!isObj(s)) return { kind: "code" };
  const kind: EvidenceType = (["paper", "code", "command", "metric", "artifact"] as const).includes(s.kind) ? s.kind : "code";
  return { kind, ref: typeof s.ref === "string" ? s.ref : undefined, commit: typeof s.commit === "string" ? s.commit : undefined };
}

/** 把任意输入规整为 ReproductionSpec v2。幂等：normalize(normalize(x)) === normalize(x)。 */
export function normalizeReproduction(raw: unknown): ReproductionSpec {
  const r = isObj(raw) ? raw : {};
  const path = Array.isArray(r.path)
    ? r.path.map((s: any) => isObj(s) ? {
        id: typeof s.id === "string" ? s.id : `st-${Math.random().toString(36).slice(2, 8)}`,
        title: String(s.title ?? "未命名步骤"),
        status: (["todo", "doing", "done"] as const).includes(s.status) ? s.status : "todo",
        note: typeof s.note === "string" ? s.note : undefined,
      } : null).filter(notNull)
    : [];
  const pitfalls = Array.isArray(r.pitfalls)
    ? r.pitfalls.map((p: any) => isObj(p) ? {
        id: typeof p.id === "string" ? p.id : `pf-${Math.random().toString(36).slice(2, 8)}`,
        text: String(p.text ?? ""),
        env: Boolean(p.env),
        stage: typeof p.stage === "string" ? p.stage : undefined,
        papers: Array.isArray(p.papers) ? p.papers.map(String) : undefined,
        threads: Array.isArray(p.threads) ? p.threads.map(String) : undefined,
        createdAt: typeof p.createdAt === "string" ? p.createdAt : new Date().toISOString(),
      } : null).filter(notNull)
    : [];

  const spec: ReproductionSpec = {
    schemaVersion: SPEC_VERSION,
    slug: String(r.slug ?? ""),
    title: String(r.title ?? ""),
    sourceUrl: typeof r.sourceUrl === "string" && r.sourceUrl ? r.sourceUrl : undefined,
    repoUrl: typeof r.repoUrl === "string" && r.repoUrl ? r.repoUrl : undefined,
    note: typeof r.note === "string" && r.note ? r.note : undefined,
    path,
    pitfalls,
    createdAt: typeof r.createdAt === "string" ? r.createdAt : undefined,
    updatedAt: typeof r.updatedAt === "string" ? r.updatedAt : undefined,
    paperRevision: isObj(r.paperRevision)
      ? { id: typeof r.paperRevision.id === "string" ? r.paperRevision.id : undefined, fileHash: typeof r.paperRevision.fileHash === "string" ? r.paperRevision.fileHash : undefined }
      : undefined,
    repoRevision: isObj(r.repoRevision)
      ? {
          root: String(r.repoRevision.root ?? ""),
          repoUrl: typeof r.repoRevision.repoUrl === "string" ? r.repoRevision.repoUrl : undefined,
          commit: typeof r.repoRevision.commit === "string" ? r.repoRevision.commit : undefined,
          branch: typeof r.repoRevision.branch === "string" ? r.repoRevision.branch : undefined,
          dirty: typeof r.repoRevision.dirty === "boolean" ? r.repoRevision.dirty : undefined,
        }
      : undefined,
    paperArtifact: isObj(r.paperArtifact)
      ? {
          paperId: String(r.paperArtifact.paperId ?? ""),
          parsedPages: typeof r.paperArtifact.parsedPages === "number" ? r.paperArtifact.parsedPages : 0,
          paperRevision: typeof r.paperArtifact.paperRevision === "string" ? r.paperArtifact.paperRevision : undefined,
        }
      : undefined,
    repoArtifact: isObj(r.repoArtifact)
      ? {
          repoRootId: String(r.repoArtifact.repoRootId ?? ""),
          repoPath: String(r.repoArtifact.repoPath ?? ""),
          commit: typeof r.repoArtifact.commit === "string" ? r.repoArtifact.commit : undefined,
          dirty: typeof r.repoArtifact.dirty === "boolean" ? r.repoArtifact.dirty : undefined,
        }
      : undefined,
    goalIntent: (["run_first", "main_result", "figure", "full", "unknown"] as const).includes(r.goalIntent) ? r.goalIntent : undefined,
    analysis: isObj(r.analysis)
      ? {
          status: (["running", "done", "failed"] as const).includes(r.analysis.status) ? r.analysis.status : "failed",
          ranAt: typeof r.analysis.ranAt === "string" ? r.analysis.ranAt : new Date().toISOString(),
          paperRevision: typeof r.analysis.paperRevision === "string" ? r.analysis.paperRevision : undefined,
          repoRevision: isObj(r.analysis.repoRevision)
            ? { root: String(r.analysis.repoRevision.root ?? ""), repoUrl: typeof r.analysis.repoRevision.repoUrl === "string" ? r.analysis.repoRevision.repoUrl : undefined, commit: typeof r.analysis.repoRevision.commit === "string" ? r.analysis.repoRevision.commit : undefined, branch: typeof r.analysis.repoRevision.branch === "string" ? r.analysis.repoRevision.branch : undefined, dirty: typeof r.analysis.repoRevision.dirty === "boolean" ? r.analysis.repoRevision.dirty : undefined }
            : undefined,
          error: typeof r.analysis.error === "string" ? r.analysis.error : undefined,
          suggestedTarget: isObj(r.analysis.suggestedTarget)
            ? {
                scope: (["table", "figure", "metric", "full", "custom"] as const).includes(r.analysis.suggestedTarget.scope) ? r.analysis.suggestedTarget.scope : "table",
                name: String(r.analysis.suggestedTarget.name ?? ""),
                metrics: Array.isArray(r.analysis.suggestedTarget.metrics)
                  ? r.analysis.suggestedTarget.metrics.map((m: any) => isObj(m) ? { name: String(m.name ?? ""), expected: m.expected, tolerance: typeof m.tolerance === "number" ? m.tolerance : undefined, unit: typeof m.unit === "string" ? m.unit : undefined } : null).filter((x): x is NonNullable<typeof x> => Boolean(x))
                  : [],
              }
            : r.analysis.suggestedTarget === null ? null : undefined,
          summary: isObj(r.analysis.summary)
            ? { paperFacts: typeof r.analysis.summary.paperFacts === "number" ? r.analysis.summary.paperFacts : 0, repoFacts: typeof r.analysis.summary.repoFacts === "number" ? r.analysis.summary.repoFacts : 0, mappings: typeof r.analysis.summary.mappings === "number" ? r.analysis.summary.mappings : 0, gaps: typeof r.analysis.summary.gaps === "number" ? r.analysis.summary.gaps : 0, blocking: typeof r.analysis.summary.blocking === "number" ? r.analysis.summary.blocking : 0 }
            : undefined,
        }
      : undefined,
    target: isObj(r.target)
      ? {
          scope: (["table", "figure", "metric", "full", "custom"] as const).includes(r.target.scope) ? r.target.scope : "custom",
          name: String(r.target.name ?? ""),
          metrics: Array.isArray(r.target.metrics)
            ? r.target.metrics.map((m: any) => isObj(m) ? {
                name: String(m.name ?? ""),
                expected: m.expected,
                tolerance: typeof m.tolerance === "number" ? m.tolerance : undefined,
                unit: typeof m.unit === "string" ? m.unit : undefined,
              } : null).filter(notNull)
            : [],
        }
      : undefined,
    constraints: isObj(r.constraints)
      ? {
          hardware: isObj(r.constraints.hardware)
            ? { gpu: typeof r.constraints.hardware.gpu === "string" ? r.constraints.hardware.gpu : undefined, memoryGb: typeof r.constraints.hardware.memoryGb === "number" ? r.constraints.hardware.memoryGb : undefined }
            : undefined,
          timeBudgetHours: typeof r.constraints.timeBudgetHours === "number" ? r.constraints.timeBudgetHours : undefined,
          modificationPolicy: (["none", "minimal", "allowed"] as const).includes(r.constraints.modificationPolicy) ? r.constraints.modificationPolicy : "allowed",
          computeBudget: typeof r.constraints.computeBudget === "number" ? r.constraints.computeBudget : undefined,
          dataPolicy: typeof r.constraints.dataPolicy === "string" ? r.constraints.dataPolicy : undefined,
        }
      : undefined,
    acceptance: isObj(r.acceptance)
      ? {
          criteria: Array.isArray(r.acceptance.criteria)
            ? r.acceptance.criteria.map((c: any) => isObj(c) ? {
                id: typeof c.id === "string" ? c.id : `ac-${Math.random().toString(36).slice(2, 8)}`,
                text: String(c.text ?? ""),
                kind: (["metric", "behavior", "artifact"] as const).includes(c.kind) ? c.kind : "behavior",
                satisfied: typeof c.satisfied === "boolean" ? c.satisfied : undefined,
              } : null).filter(notNull)
            : [],
        }
      : undefined,
    facts: Array.isArray(r.facts)
      ? r.facts.map((f: any) => isObj(f) ? {
          id: typeof f.id === "string" ? f.id : `f-${Math.random().toString(36).slice(2, 8)}`,
          key: String(f.key ?? ""),
          side: (f.side === "repo" ? "repo" : "paper") as "paper" | "repo",
          value: f.value,
          normalizedValue: f.normalizedValue,
          unit: typeof f.unit === "string" ? f.unit : undefined,
          status: (["observed", "inferred", "missing"] as const).includes(f.status) ? f.status : "observed",
          confidence: (["high", "medium", "low"] as const).includes(f.confidence) ? f.confidence : "medium",
          importance: (["required", "recommended", "optional"] as const).includes(f.importance) ? f.importance : "recommended",
          missingReason: typeof f.missingReason === "string" ? f.missingReason : undefined,
          missingType: (["not_found", "not_scanned", "ambiguous", "not_applicable"] as const).includes(f.missingType) ? f.missingType : undefined,
          runId: typeof f.runId === "string" ? f.runId : undefined,
          source: normFactSource(f.source),
        } : null).filter(notNull)
      : [],
    mappings: Array.isArray(r.mappings)
      ? r.mappings.map((m: any) => isObj(m) ? {
          id: typeof m.id === "string" ? m.id : `m-${Math.random().toString(36).slice(2, 8)}`,
          concept: String(m.concept ?? ""),
          paperRefs: Array.isArray(m.paperRefs) ? m.paperRefs.map((p: any) => isObj(p) ? { section: typeof p.section === "string" ? p.section : undefined, page: typeof p.page === "number" ? p.page : undefined, quote: typeof p.quote === "string" ? p.quote : undefined } : null).filter(notNull) : [],
          codeRefs: Array.isArray(m.codeRefs) ? m.codeRefs.map((c: any) => isObj(c) ? { file: String(c.file ?? ""), lineStart: typeof c.lineStart === "number" ? c.lineStart : undefined, lineEnd: typeof c.lineEnd === "number" ? c.lineEnd : undefined, symbol: typeof c.symbol === "string" ? c.symbol : undefined, commit: typeof c.commit === "string" ? c.commit : undefined, dirty: typeof c.dirty === "boolean" ? c.dirty : undefined } : null).filter(notNull) : [],
          configRefs: Array.isArray(m.configRefs) ? m.configRefs.map((c: any) => isObj(c) ? { file: String(c.file ?? ""), lineStart: typeof c.lineStart === "number" ? c.lineStart : undefined, lineEnd: typeof c.lineEnd === "number" ? c.lineEnd : undefined, symbol: typeof c.symbol === "string" ? c.symbol : undefined, commit: typeof c.commit === "string" ? c.commit : undefined, dirty: typeof c.dirty === "boolean" ? c.dirty : undefined } : null).filter(notNull) : undefined,
          relation: (["implements", "configures", "preprocesses", "trains", "evaluates"] as const).includes(m.relation) ? m.relation : "implements",
          status: (m.status === "confirmed" ? "confirmed" : "proposed") as "proposed" | "confirmed",
          confidence: (["high", "medium", "low"] as const).includes(m.confidence) ? m.confidence : "medium",
          evidenceIds: Array.isArray(m.evidenceIds) ? m.evidenceIds.map(String) : [],
          paperFactIds: Array.isArray(m.paperFactIds) ? m.paperFactIds.map(String) : [],
          codeAnchorIds: Array.isArray(m.codeAnchorIds) ? m.codeAnchorIds.map(String) : [],
          legacy: Boolean(m.legacy) || !Array.isArray(m.paperFactIds) || !Array.isArray(m.codeAnchorIds) || m.paperFactIds.length === 0 || m.codeAnchorIds.length === 0,
        } : null).filter(notNull)
      : [],
    decisions: Array.isArray(r.decisions)
      ? r.decisions.map((d: any) => isObj(d) ? {
          id: typeof d.id === "string" ? d.id : `d-${Math.random().toString(36).slice(2, 8)}`,
          gapId: typeof d.gapId === "string" ? d.gapId : undefined,
          gapType: (["value_conflict","source_conflict","not_found","not_scanned","uncomparable","missing_required"] as const).includes(d.gapType) ? d.gapType : undefined,
          gapFingerprint: typeof d.gapFingerprint === "string" ? d.gapFingerprint : undefined,
          key: String(d.key ?? ""),
          paperFactIds: Array.isArray(d.paperFactIds) ? d.paperFactIds.map(String) : [],
          repoFactIds: Array.isArray(d.repoFactIds) ? d.repoFactIds.map(String) : [],
          choice: isObj(d.choice) && (d.choice.kind === "fact" ? typeof d.choice.factId === "string" : d.choice.kind === "custom")
            ? (d.choice.kind === "fact"
                ? { kind: "fact" as const, factId: String(d.choice.factId) }
                : { kind: "custom" as const, value: d.choice.value })
            : undefined,
          rationale: typeof d.rationale === "string" ? d.rationale : undefined,
          impact: typeof d.impact === "string" ? d.impact : undefined,
          status: (d.status === "accepted" ? "accepted" : "pending") as "accepted" | "pending",
          blocksReady: Boolean(d.blocksReady),
          resolvedAt: typeof d.resolvedAt === "string" ? d.resolvedAt : undefined,
        } : null).filter(notNull)
      : [],
    environment: isObj(r.environment)
      ? {
          desired: isObj(r.environment.desired) ? { ...r.environment.desired } : undefined,
          actual: isObj(r.environment.actual) ? { ...r.environment.actual } : undefined,
          diff: Array.isArray(r.environment.diff) ? r.environment.diff.map((x: any) => isObj(x) ? { key: String(x.key ?? ""), desired: typeof x.desired === "string" ? x.desired : undefined, actual: typeof x.actual === "string" ? x.actual : undefined, ok: Boolean(x.ok) } : null).filter(notNull) : undefined,
          plan: Array.isArray(r.environment.plan) ? r.environment.plan.map((p: any) => isObj(p) ? { id: String(p.id ?? ""), label: String(p.label ?? ""), confidence: typeof p.confidence === "number" ? p.confidence : 0, recommended: typeof p.recommended === "boolean" ? p.recommended : undefined } : null).filter(notNull) : undefined,
          blockingIssues: typeof r.environment.blockingIssues === "number" ? r.environment.blockingIssues : 0,
        }
      : undefined,
    evidence: Array.isArray(r.evidence)
      ? r.evidence.map((e: any) => isObj(e) ? {
          id: typeof e.id === "string" ? e.id : `e-${Math.random().toString(36).slice(2, 8)}`,
          type: (["paper", "code", "command", "metric", "artifact"] as const).includes(e.type) ? e.type : "code",
          observation: String(e.observation ?? ""),
          source: normEvidenceSource(e.source),
          supports: Array.isArray(e.supports) ? e.supports.map((s: any) => isObj(s) ? { kind: (["task", "decision", "fact", "mapping"] as const).includes(s.kind) ? s.kind : "task", id: String(s.id ?? "") } : null).filter(notNull) : [],
          createdAt: typeof e.createdAt === "string" ? e.createdAt : new Date().toISOString(),
        } : null).filter(notNull)
      : [],
  };

  // 幂等保证：v1 数据（无 schemaVersion）→ 输出 schemaVersion=2；
  // 已是 v2 的数据 → normalize 后结构不变（字段顺序/值全部保持）。
  return spec;
}

/** 深度相等（JSON 语义） */
export function specsEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * 复现目标定义是否完整（Step 2 门控 + 未来 Ready Gate 共用）。
 * 完整 = target 有名字 + constraints 有修改政策 + acceptance 至少一条标准。
 * 注意：不要求 metrics 非空——「先把官方代码跑起来」这类 preset 允许 0 指标。
 */
export function isDefinitionComplete(spec: Partial<ReproductionSpec> | null | undefined): boolean {
  if (!spec) return false;
  const t = spec.target;
  const c = spec.constraints;
  const a = spec.acceptance;
  if (!t || typeof t.name !== "string" || !t.name.trim()) return false;
  if (!c || !["none", "minimal", "allowed"].includes(c.modificationPolicy)) return false;
  if (!a || !Array.isArray(a.criteria) || a.criteria.length === 0) return false;
  return true;
}

/** 人类可读的「未定义完成」原因（给 UI/API 提示用） */
export function definitionGaps(spec: Partial<ReproductionSpec> | null | undefined): string[] {
  if (!spec) return ["还没有复现记录"];
  const gaps: string[] = [];
  if (!spec.target || !spec.target.name?.trim()) gaps.push("未定义复现目标");
  if (!spec.constraints || !["none", "minimal", "allowed"].includes(spec.constraints.modificationPolicy)) gaps.push("未确认修改政策");
  if (!spec.acceptance || !spec.acceptance.criteria?.length) gaps.push("未确认验收标准");
  return gaps;
}

/* ================= 存储层在 reproduction.ts（本文件为纯逻辑，可被迁移测试直接 import） ================= */
