/**
 * ResearchSession 纯逻辑（v1.1 guardrail #3/#4）——不 import store，保持可被 node 直跑单测。
 * schemaVersion 一开始就带；Return Path 用显式状态机
 * planning → ready-to-search → external-opened → awaiting-import。
 * 存储薄层见 session-storage.ts（引入 store 适配器，仅供路由使用）。
 */
import { randomUUID } from "node:crypto";
import { normalizeSearchPlan, normalizeIntent, deriveNextStep } from "./plan.ts";
import type { ResearchSession, SearchPlanStage, SearchPlan, SearchIntent, DatabaseAction, DiscoveryEvent, DiscoveryEventKind, ScreeningRecord, PendingRow } from "./types.ts";

export const SESSION_SCHEMA_VERSION = 1;

const STAGES: SearchPlanStage[] = ["planning", "ready-to-search", "external-opened", "awaiting-import", "screening"];

export function createSession(question: string): ResearchSession {
  const now = new Date().toISOString();
  return {
    schemaVersion: SESSION_SCHEMA_VERSION,
    id: randomUUID(),
    question: String(question ?? "").trim(),
    stage: "planning",
    databaseActions: [],
    candidates: [],
    triage: [],
    screening: [],
    pending: [],
    seedPapers: [],
    readingPaths: [],
    openQuestions: [],
    nextStepHistory: [],
    events: [],
    createdAt: now,
    updatedAt: now,
  };
}

/** 幂等归一化：坏字段回退默认，不丢已存在数据 */
export function normalizeSession(raw: unknown): ResearchSession {
  const o = (raw ?? {}) as Record<string, unknown>;
  let plan: SearchPlan | undefined;
  try { if (o.plan) plan = normalizeSearchPlan(o.plan); } catch { plan = undefined; }
  return {
    schemaVersion: Number(o.schemaVersion) || SESSION_SCHEMA_VERSION,
    id: typeof o.id === "string" ? o.id : "",
    question: typeof o.question === "string" ? o.question : "",
    stage: STAGES.includes(o.stage as SearchPlanStage) ? (o.stage as SearchPlanStage) : "planning",
    ...(o.intent ? { intent: normalizeIntent(o.intent) } : {}),
    ...(plan ? { plan } : {}),
    databaseActions: Array.isArray(o.databaseActions) ? (o.databaseActions as DatabaseAction[]) : [],
    ...(o.importBatch && typeof o.importBatch === "object" ? { importBatch: o.importBatch as ResearchSession["importBatch"] } : {}),
    ...(o.importStats && typeof o.importStats === "object" ? { importStats: o.importStats as ResearchSession["importStats"] } : {}),
    ...(o.termCalibration && typeof o.termCalibration === "object" ? { termCalibration: o.termCalibration as ResearchSession["termCalibration"] } : {}),
    candidates: Array.isArray(o.candidates) ? o.candidates : [],
    triage: Array.isArray(o.triage) ? o.triage : [],
    screening: Array.isArray(o.screening) ? (o.screening as ScreeningRecord[]) : [],
    pending: Array.isArray(o.pending) ? (o.pending as PendingRow[]) : [],
    seedPapers: Array.isArray(o.seedPapers) ? o.seedPapers.map(String) : [],
    ...(o.map ? { map: o.map as ResearchSession["map"] } : {}),
    readingPaths: Array.isArray(o.readingPaths) ? o.readingPaths : [],
    openQuestions: Array.isArray(o.openQuestions) ? o.openQuestions.map(String) : [],
    nextStepHistory: Array.isArray(o.nextStepHistory) ? o.nextStepHistory : [],
    events: Array.isArray(o.events) ? (o.events as DiscoveryEvent[]) : [],
    createdAt: typeof o.createdAt === "string" ? o.createdAt : "",
    updatedAt: typeof o.updatedAt === "string" ? o.updatedAt : "",
  };
}

/** 状态机转移表（v1.1 guardrail #4：Return Path 落到状态机，不只 UI 文案） */
const TRANSITIONS: Record<SearchPlanStage, SearchPlanStage[]> = {
  planning: ["ready-to-search"],
  "ready-to-search": ["external-opened", "awaiting-import"],
  "external-opened": ["awaiting-import", "ready-to-search"],
  "awaiting-import": ["awaiting-import", "screening"],   // v1.2：导入完成 → screening
  "screening": ["screening"],                              // v1.2：候选筛选状态（刷新后恢复）
};

export function transitionStage(s: ResearchSession, next: SearchPlanStage): ResearchSession {
  const allowed = TRANSITIONS[s.stage] ?? [];
  if (!allowed.includes(next)) {
    throw new Error("非法状态转移：" + s.stage + " → " + next);
  }
  return { ...s, stage: next, updatedAt: new Date().toISOString() };
}

export function recordDatabaseAction(s: ResearchSession, a: DatabaseAction): ResearchSession {
  return { ...s, databaseActions: [...s.databaseActions, a], updatedAt: new Date().toISOString() };
}

/** 计划就绪：写入 intent/plan，进入 ready-to-search，并记录 query-generated */
export function withPlan(s: ResearchSession, intent: SearchIntent, plan: SearchPlan): ResearchSession {
  const now = new Date().toISOString();
  const primaryId = plan.databases.find((d) => d.recommendedNow)?.id ?? "google-scholar";
  return {
    ...s,
    intent,
    plan,
    stage: "ready-to-search",
    databaseActions: [...s.databaseActions, { database: primaryId, action: "query-generated", at: now }],
    updatedAt: now,
  };
}

/** v1.5：append-only 发现过程事件日志（最多保留 200 条） */
export function recordEvent(
  s: ResearchSession,
  kind: DiscoveryEventKind,
  detail: Record<string, unknown> = {},
): ResearchSession {
  const ev: DiscoveryEvent = { at: new Date().toISOString(), kind, detail };
  const events = [...(s.events ?? []), ev].slice(-200);
  return { ...s, events, updatedAt: new Date().toISOString() };
}

/** v1.2：导入完成 → screening，记录导入统计与原始文本（刷新可恢复） */
export function withImport(
  s: ResearchSession,
  stats: { rawItems: number; recognized: number; unknown: number; merged: number; unique: number },
  raw: string,
): ResearchSession {
  const now = new Date().toISOString();
  return {
    ...s,
    stage: "screening",
    importBatch: { raw, importedAt: now },
    importStats: stats,
    updatedAt: now,
  };
}

export { deriveNextStep };

