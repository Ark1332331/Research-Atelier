/**
 * SearchPlan 纯逻辑（v1.1 guardrail #1/#2/#4 + v1.1.1 hardening）：
 *  - conceptGroups：组内 OR、组间 AND（compiler 唯一主题结构）
 *  - goal → primary 数据库：确定性规则（recent→arXiv、foundational→WoS、其余→Scholar）
 *  - resolveYearRange：显式注入当前年份，相对时间稳定解析（2026 最近三年 → [2024, 2026]）
 *  - normalizeSearchPlan：运行时强制恰好一个 recommendedNow
 */
import type { DatabaseStrategy, SearchPlan, SearchIntent, ResearchSession, NextStep, SearchGoal } from "./types.ts";
import { compileWosQuery } from "./compile-wos.ts";
import { landingUrlFor, hasDeepLink } from "./gs-link.ts";

const DB_IDS = ["google-scholar", "web-of-science", "semantic-scholar", "arxiv", "openalex"];
const PRIORITIES = ["primary", "secondary", "later"];
const GOALS = ["explore", "recent", "foundational", "survey", "reproducible", "follow_paper"];

function str(v: unknown): string { return typeof v === "string" ? v.trim() : ""; }
function strArr(v: unknown): string[] { return Array.isArray(v) ? v.map(str).filter(Boolean) : []; }
/** 二维字符串数组：过滤空行/空元素 */
function strArrArr(v: unknown): string[][] {
  if (!Array.isArray(v)) return [];
  return v
    .map((row) => (Array.isArray(row) ? strArr(row) : []))
    .filter((row) => row.length > 0);
}

/** goal → primary 数据库（确定性规则，v1.1.1） */
export const PRIMARY_BY_GOAL: Record<SearchGoal, DatabaseStrategy["id"]> = {
  explore: "google-scholar",
  recent: "arxiv",
  foundational: "web-of-science",
  survey: "google-scholar",
  reproducible: "google-scholar",
  follow_paper: "semantic-scholar",
};

export function primaryDbForGoal(goal: SearchGoal): DatabaseStrategy["id"] {
  return PRIMARY_BY_GOAL[goal] ?? "google-scholar";
}

/**
 * 年份解析（v1.1.1，纯函数、now 可注入）：
 *  - 显式范围：结束年 clamp 到 now（不许未来年份）；无效则移除
 *  - 无范围：recent → 最近三年 [now-2, now]；explore/survey → 近五年 [now-4, now]；其余不设
 */
export function resolveYearRange(intent: SearchIntent, now: number): SearchIntent {
  const { yearRange, ...rest } = intent;
  if (Array.isArray(yearRange) && yearRange.length === 2) {
    let from = Math.round(Number(yearRange[0]));
    let to = Math.round(Number(yearRange[1]));
    if (!Number.isFinite(from) || !Number.isFinite(to) || to < from) {
      return rest as SearchIntent;
    }
    if (to > now) to = now;
    if (from > now) from = now;
    if (to >= from && from >= 1000) {
      return { ...rest, yearRange: [from, to] } as SearchIntent;
    }
    return rest as SearchIntent;
  }
  if (intent.goal === "recent") return { ...rest, yearRange: [now - 2, now] } as SearchIntent;
  if (intent.goal === "explore" || intent.goal === "survey") {
    return { ...rest, yearRange: [now - 4, now] } as SearchIntent;
  }
  return rest as SearchIntent;
}

/** 意图归一化：conceptGroups 主结构；兼容旧 concepts（每个概念作为单元素组） */
export function normalizeIntent(raw: unknown): SearchIntent {
  const o = (raw ?? {}) as Record<string, unknown>;
  const goal = (GOALS.includes(str(o.goal)) ? str(o.goal) : "explore") as SearchIntent["goal"];
  const groups = strArrArr(o.conceptGroups);
  if (groups.length === 0 && Array.isArray(o.concepts)) {
    for (const c of strArr(o.concepts)) groups.push([c]);
  }
  const pt = strArr(o.preferredTypes).slice(0, 4);
  const intent: SearchIntent = {
    goal,
    conceptGroups: groups,
    context: strArr(o.context).slice(0, 6),
    exclude: strArr(o.exclude).slice(0, 6),
    ...(pt.length ? { preferredTypes: pt } : {}),
  };
  const yrRaw = Array.isArray(o.yearRange) && o.yearRange.length === 2
    ? [Number(o.yearRange[0]), Number(o.yearRange[1])]
    : null;
  if (yrRaw && Number.isFinite(yrRaw[0]) && Number.isFinite(yrRaw[1]) && yrRaw[1] >= yrRaw[0]) {
    intent.yearRange = [yrRaw[0], yrRaw[1]];
  }
  return intent;
}

function normalizeDatabase(d: unknown): DatabaseStrategy | null {
  const o = (d ?? {}) as Record<string, unknown>;
  const id = str(o.id);
  if (!DB_IDS.includes(id)) return null;
  const queries = strArr(o.queries);
  if (queries.length === 0) return null;
  const purpose = str(o.purpose);
  const why = str(o.why) || purpose;
  return {
    id: id as DatabaseStrategy["id"],
    purpose: purpose || "（未说明用途）",
    queries,
    ...(str(o.recommendedFirst) ? { recommendedFirst: str(o.recommendedFirst) } : {}),
    priority: (PRIORITIES.includes(str(o.priority)) ? str(o.priority) : "secondary") as DatabaseStrategy["priority"],
    recommendedNow: Boolean(o.recommendedNow),
    // v1.1.2：landingUrl 必有（缺失时按 id 确定性兜底）；deepLinkUrl 只有带 query 深链的库才有
    ...(str(o.landingUrl) ? { landingUrl: str(o.landingUrl) } : { landingUrl: landingUrlFor(id, queries[0]) }),
    ...(hasDeepLink(id) ? { deepLinkUrl: str(o.deepLinkUrl) || landingUrlFor(id, queries[0]) } : {}),
    nextActions: strArr(o.nextActions),
    why: why || "（未说明理由）",
  };
}

const DEFAULT_RETURN_PATH = [
  "在推荐数据库执行这条搜索",
  "先浏览前 2–3 页",
  "找到大约 10–20 篇看起来相关的论文",
  "回来交给 Research Atelier 筛选",
];

/** 归一化 SearchPlan：校验 + 强制恰好一个 recommendedNow。幂等。 */
export function normalizeSearchPlan(raw: unknown): SearchPlan {
  const o = (raw ?? {}) as Record<string, unknown>;
  const intent = normalizeIntent(o.intent);
  const dbs = (Array.isArray(o.databases) ? o.databases : [])
    .map(normalizeDatabase)
    .filter((x): x is DatabaseStrategy => x !== null);
  if (dbs.length === 0) throw new Error("SearchPlan 缺少有效数据库策略");
  const trues = dbs.map((d) => d.recommendedNow);
  if (!trues.includes(true)) {
    const idx = dbs.findIndex((d) => d.priority === "primary");
    dbs[idx >= 0 ? idx : 0].recommendedNow = true;
  } else if (trues.filter(Boolean).length > 1) {
    const first = trues.indexOf(true);
    dbs.forEach((d, i) => { if (i !== first) d.recommendedNow = false; });
  }
  const returnPath = strArr(o.returnPath);
  return {
    intent,
    stage: "plan-ready",
    databases: dbs,
    suggestedFirstAction: str(o.suggestedFirstAction) || "先执行推荐检索式。",
    returnPath: returnPath.length ? returnPath : DEFAULT_RETURN_PATH,
    warnings: strArr(o.warnings),
    createdAt: str(o.createdAt),
  };
}

const DB_META: Record<string, { purpose: string; why: string }> = {
  "google-scholar": { purpose: "广泛召回、Cited by、Related articles", why: "先建立较宽的候选池（召回强，Cited by / Related 生态好）" },
  "web-of-science": { purpose: "精确主题检索、引用追踪、Related Records", why: "更规范的筛选与引用追踪" },
  "semantic-scholar": { purpose: "Related Papers / Citations / References / 推荐网络", why: "找到种子论文后展开引用网络" },
  arxiv: { purpose: "最新、尚未正式发表的工作", why: "补最近工作" },
  openalex: { purpose: "开放学术元数据补充", why: "开放源补充（Quick Discovery 用）" },
};

const DB_ACTIONS: Record<string, string[]> = {
  "google-scholar": ["Cited by 找后续工作", "Related articles 找相似工作", "All versions 找版本"],
  "web-of-science": ["Related Records 找主题相近但术语不同的论文", "Times Cited 做引用追踪"],
  "semantic-scholar": ["References 找基础工作", "Citations 找后续", "Recommendations 找相似"],
  arxiv: [],
  openalex: [],
};

function quoteIfPhrase(t: string): string {
  return /\s/.test(t) ? '"' + t + '"' : t;
}

/** GS 短 query 由结构化 groups 编译：组间 AND（词间空格），组内取首同义词；末条 review */
export function gsQueriesFromIntent(intent: SearchIntent): string[] {
  const groups = intent.conceptGroups.filter((g) => g.length > 0);
  const ctx = intent.context;
  const c0 = groups[0]?.[0] ?? "research";
  const qc0 = quoteIfPhrase(c0);
  let queries: string[];
  if (groups.length >= 2) {
    const c1 = quoteIfPhrase(groups[1][0]);
    const c2 = quoteIfPhrase(groups[1][1] ?? ctx[0] ?? groups[1][0]);
    queries = [qc0 + " " + c1, qc0 + " " + c2, qc0 + " review"];
  } else if (ctx.length) {
    const x0 = quoteIfPhrase(ctx[0]);
    const x1 = quoteIfPhrase(ctx[1] ?? ctx[0]);
    queries = [qc0 + " " + x0, qc0 + " " + x1, qc0 + " review"];
  } else {
    queries = [qc0, qc0 + " review", qc0 + " survey"];
  }
  return [...new Set(queries)];
}

/** 由 intent 确定性生成 SearchPlan（LLM 只产 intent；不读任何 LLM 字符串） */
export function planFromIntent(intent: SearchIntent, now?: number): SearchPlan {
  const resolved = resolveYearRange(intent, now ?? new Date().getFullYear());
  const gsQueries = gsQueriesFromIntent(resolved);
  const q1 = gsQueries[0] ?? "";
  const wos = compileWosQuery(resolved);
  const primaryId = primaryDbForGoal(resolved.goal);

  const mk = (
    id: DatabaseStrategy["id"],
    priority: DatabaseStrategy["priority"],
    queries: string[],
    extra: Partial<DatabaseStrategy> = {},
  ): DatabaseStrategy => {
    const q0 = queries[0] ?? "";
    return {
      id,
      purpose: DB_META[id].purpose,
      queries,
      priority,
      recommendedNow: false,
      landingUrl: landingUrlFor(id, q0),           // v1.1.2：所有数据库必有可打开入口
      ...(hasDeepLink(id) ? { deepLinkUrl: landingUrlFor(id, q0) } : {}), // 有 query 深链才给 deepLinkUrl
      nextActions: DB_ACTIONS[id] ?? [],
      why: DB_META[id].why,
      ...extra,
    };
  };

  const databases: DatabaseStrategy[] = [];
  databases.push(mk("google-scholar", "primary", gsQueries, { recommendedFirst: q1 }));
  if (wos.query) {
    databases.push(mk("web-of-science", "secondary", [wos.query]));
  }
  databases.push(mk("semantic-scholar", "later", [q1]));
  databases.push(mk("arxiv", "later", [q1]));

  // goal → primary（v1.1.1）：优先 primaryId，构建缺失则 Scholar 兜底
  const primary =
    databases.find((d) => d.id === primaryId)
    ?? databases.find((d) => d.id === "google-scholar")
    ?? databases[0];
  for (const d of databases) d.recommendedNow = d === primary;
  for (const d of databases) if (d.recommendedNow) d.priority = "primary";
  databases.sort((a, b) => (a.recommendedNow ? -1 : b.recommendedNow ? 1 : 0));

  const plan: SearchPlan = {
    intent: resolved,
    stage: "plan-ready",
    databases,
    suggestedFirstAction: "第一步 · " + displayDbName(primary.id) + "：" + (primary.recommendedFirst ?? primary.queries[0]),
    returnPath: DEFAULT_RETURN_PATH,
    warnings: wos.note ? [wos.note] : [],
    createdAt: new Date().toISOString(),
  };
  return normalizeSearchPlan(plan); // 保证不变量：恰好一个 recommendedNow
}

/** nextStep 是 derived state：每次按当前 session 动态算，不持久化（v1.1） */
export function deriveNextStep(s: { stage: ResearchSession["stage"]; plan?: SearchPlan }): NextStep {
  switch (s.stage) {
    case "planning":
      return { action: "生成检索计划", reason: "你有一个研究问题，先编译成可执行的检索策略。" };
    case "ready-to-search":
      return { action: "打开 " + (primaryDbName(s.plan) || "推荐数据库") + " 执行推荐检索式", reason: "计划已就绪，先去真实数据库建立候选池。" };
    case "external-opened":
      return { action: "完成搜索后回来点「我搜完了，开始导入论文」", reason: "搜索进行中；回来后我们接住你。" };
    case "awaiting-import":
      return { action: "把搜到的论文带回来（Phase B-lite 导入即将接入）", reason: "你的位置已保存。" };
  }
}

function primaryDbName(plan?: SearchPlan): string {
  const db = plan?.databases.find((d) => d.recommendedNow);
  return db ? displayDbName(db.id) : "";
}

export function displayDbName(id: string): string {
  const map: Record<string, string> = {
    "google-scholar": "Google Scholar",
    "web-of-science": "Web of Science",
    "semantic-scholar": "Semantic Scholar",
    arxiv: "arXiv",
    openalex: "OpenAlex",
  };
  return map[id] ?? id;
}

