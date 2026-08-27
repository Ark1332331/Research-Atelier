/**
 * SearchPlan 纯逻辑（v1.1 guardrail #1/#2/#4）：
 *  - normalizeSearchPlan：运行时强制恰好一个 recommendedNow（0 → 提升第一个 primary；>1 → 只保留第一个）
 *  - planFromIntent：LLM 只产 intent，计划由代码确定性生成（WoS 串 / GS URL 均来自编译函数）
 *  - deriveNextStep：derived state，不持久化
 */
import type { DatabaseStrategy, SearchPlan, SearchIntent, ResearchSession, NextStep } from "./types.ts";
import { compileWosQuery } from "./compile-wos.ts";
import { googleScholarUrl } from "./gs-link.ts";

const DB_IDS = ["google-scholar", "web-of-science", "semantic-scholar", "arxiv", "openalex"];
const PRIORITIES = ["primary", "secondary", "later"];
const GOALS = ["explore", "recent", "foundational", "survey", "reproducible", "follow_paper"];

function str(v: unknown): string { return typeof v === "string" ? v.trim() : ""; }
function strArr(v: unknown): string[] { return Array.isArray(v) ? v.map(str).filter(Boolean) : []; }

/** 意图归一化：坏字段回退默认值，不做虚构 */
export function normalizeIntent(raw: unknown): SearchIntent {
  const o = (raw ?? {}) as Record<string, unknown>;
  const goal = (GOALS.includes(str(o.goal)) ? str(o.goal) : "explore") as SearchIntent["goal"];
  const yrRaw = Array.isArray(o.yearRange) && o.yearRange.length === 2
    ? [Number(o.yearRange[0]), Number(o.yearRange[1])]
    : null;
  const pt = strArr(o.preferredTypes).slice(0, 4);
  const intent: SearchIntent = {
    goal,
    concepts: strArr(o.concepts).slice(0, 8),
    context: strArr(o.context).slice(0, 6),
    exclude: strArr(o.exclude).slice(0, 6),
    ...(pt.length ? { preferredTypes: pt } : {}),   // 空时省略，保证 normalize 幂等
  };
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
    ...(str(o.deepLinkUrl) ? { deepLinkUrl: str(o.deepLinkUrl) } : {}),
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

/**
 * 归一化 SearchPlan：校验 + 强制恰好一个 recommendedNow。
 * 幂等：normalize(normalize(x)) 不再改变数据。
 */
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

function quoteIfPhrase(t: string): string {
  return /\s/.test(t) ? '"' + t + '"' : t;
}

/** 由 intent 确定性生成 SearchPlan（LLM 只产 intent；这里不读任何 LLM 字符串） */
export function planFromIntent(intent: SearchIntent): SearchPlan {
  const c0 = intent.concepts[0] ?? "research";
  const ctx = intent.context.length ? intent.context : ["research"];
  const qc0 = quoteIfPhrase(c0);
  const q1 = qc0 + " " + quoteIfPhrase(ctx[0]);
  const q2 = qc0 + " " + quoteIfPhrase(ctx[1] ?? ctx[0]);
  const q3 = qc0 + " review";
  const wos = compileWosQuery(intent);

  const databases: DatabaseStrategy[] = [
    {
      id: "google-scholar",
      purpose: DB_META["google-scholar"].purpose,
      queries: [q1, q2, q3],
      recommendedFirst: q1,
      priority: "primary",
      recommendedNow: true,
      deepLinkUrl: googleScholarUrl(q1),
      nextActions: ["Cited by 找后续工作", "Related articles 找相似工作", "All versions 找版本"],
      why: DB_META["google-scholar"].why,
    },
  ];
  if (wos.query) {
    databases.push({
      id: "web-of-science",
      purpose: DB_META["web-of-science"].purpose,
      queries: [wos.query],
      priority: "secondary",
      recommendedNow: false,
      nextActions: ["Related Records 找主题相近但术语不同的论文", "Times Cited 做引用追踪"],
      why: DB_META["web-of-science"].why,
    });
  }
  databases.push({
    id: "semantic-scholar",
    purpose: DB_META["semantic-scholar"].purpose,
    queries: [q1],
    priority: "later",
    recommendedNow: false,
    nextActions: ["References 找基础工作", "Citations 找后续", "Recommendations 找相似"],
    why: DB_META["semantic-scholar"].why,
  });
  databases.push({
    id: "arxiv",
    purpose: DB_META["arxiv"].purpose,
    queries: [q1],
    priority: "later",
    recommendedNow: false,
    nextActions: [],
    why: DB_META["arxiv"].why,
  });

  const plan: SearchPlan = {
    intent,
    stage: "plan-ready",
    databases,
    suggestedFirstAction: "第一步 · Google Scholar：先搜 " + q1,
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

