/**
 * WoS 检索式确定性编译器（v1.1 guardrail #2；v1.1.1 组语义）。
 * LLM 只产结构化 intent；WoS 查询字符串一律由本文件纯函数编译。
 * 组语义：conceptGroups 组内 OR、组间 AND（「world model」与「robotics」必须组间 AND）。
 */
import type { SearchIntent } from "./types.ts";

export const MAX_YEAR_SPAN = 5;

/** 清洗单个检索词：去掉引号/括号/运算符等语法字符，保留 WoS 通配 *（仅词尾） */
export function sanitizeTerm(term: string): string {
  return String(term ?? "")
    .replace(/["()&|^$#@!~\\/]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** TS=(...) 组：含空格且无通配符的词加引号（短语），其余直接写（可带词尾 *） */
export function topicGroup(terms: string[]): string {
  const cleaned = (terms ?? []).map(sanitizeTerm).filter(Boolean);
  if (cleaned.length === 0) return "";
  const parts = cleaned.map((t) => (/\s/.test(t) && !t.includes("*") ? '"' + t + '"' : t));
  return "TS=(" + parts.join(" OR ") + ")";
}

/** 排除组：NOT TS=(...) */
export function excludeGroup(terms: string[]): string {
  const g = topicGroup(terms);
  return g ? "NOT " + g : "";
}

/** 年份子句：单年 PY=2022；区间 PY=(2022-2026)；跨度 > MAX_YEAR_SPAN 时不生成并给提示 */
export function yearClause(yearRange?: [number, number]): { clause: string; note: string | null } {
  if (!Array.isArray(yearRange) || yearRange.length !== 2) return { clause: "", note: null };
  const from = Number(yearRange[0]);
  const to = Number(yearRange[1]);
  if (!Number.isFinite(from) || !Number.isFinite(to) || to < from) return { clause: "", note: null };
  if (from === to) return { clause: "PY=" + from, note: null };
  if (to - from > MAX_YEAR_SPAN) {
    return {
      clause: "",
      note: "时间跨度较大（" + from + "–" + to + "），建议第一轮不限制年份，或拆成「近五年 + 历史基础工作」两轮。",
    };
  }
  return { clause: "PY=(" + from + "-" + to + ")", note: null };
}

/** 编译完整 WoS 检索式：conceptGroups 组间 AND、context 追加 AND 组、exclude NOT、年份 */
export function compileWosQuery(
  intent: Pick<SearchIntent, "conceptGroups" | "context" | "exclude" | "yearRange">,
): { query: string; note: string | null } {
  const parts: string[] = [];
  for (const g of intent.conceptGroups ?? []) {
    const t = topicGroup(g);
    if (t) parts.push(t);
  }
  const xg = topicGroup(intent.context ?? []);
  if (xg) parts.push(xg);
  const eg = excludeGroup(intent.exclude ?? []);
  if (eg) parts.push(eg);
  const yc = yearClause(intent.yearRange);
  if (yc.clause) parts.push(yc.clause);
  return { query: parts.join(" AND "), note: yc.note };
}

