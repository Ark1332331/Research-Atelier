/**
 * LLM 检索意图生产者（v1.1 guardrail #2 边界 + v1.1.1 hardening + v1.4 术语映射）：
 * LLM 只输出结构化数据（SearchIntent 或 AcademicConceptMap JSON）；SearchPlan / WoS 查询串 /
 * GS/arXiv URL 一律由代码（planFromIntent / compileWosQuery / googleScholarUrl / arxivSearchUrl）
 * 确定性生成。当前年份显式注入；RA_PLANNER_MOCK / RA_CONCEPT_MOCK 供确定性测试。
 * v1.4：conceptMapper 负责「用户自然语言 → 学术标准术语映射」，绝不产出最终 query。
 */
import { normalizeIntent, resolveYearRange } from "./plan.ts";
import { normalizeConceptMap } from "./terms.ts";
import type { SearchIntent, AcademicConceptMap } from "./types.ts";

const DEEPSEEK_URL = "https://api.deepseek.com/chat/completions";

export function buildSystemPrompt(now: number): string {
  return "你是 Research Atelier 的检索策略编译器。把用户的研究问题编译成结构化检索意图 JSON。" +
    "只输出 JSON，不要任何解释、不要 Markdown 围栏。字段：\n" +
    '{ "goal": "explore | recent | foundational | survey | reproducible | follow_paper",' +
    ' "conceptGroups": [["核心概念", "同义词"], ["另一组必须同时出现的概念", "其同义词"], ...],' +
    ' "context": ["额外语境词，1-3 个，可选"],' +
    ' "exclude": ["需要排除的歧义词，0-3 个"],' +
    ' "preferredTypes": ["review | conference-paper | journal-article | preprint"] 可为空数组,' +
    ' "yearRange": [起始年, 结束年] 或 null }\n' +
    "语义规则：组间 AND、组内 OR —— 不同 conceptGroups 之间的概念必须同时出现在论文主题中，" +
    "组内是同一概念的不同表达（同义词）。例：「world model」「world models」与「robotics」「embodied agent」" +
    " 是两组，要求主题同时含 world model 与 robotics；不要把不同语义的概念塞进同一组。" +
    "yearRange 只填绝对年份；如果用户表达的是相对时间（如「最近三年」），填 null 并用 goal 表达，" +
    "代码会按当前年份计算。当前年份：" + now + "（以此为准，不要凭记忆，结束年不许超过它）。" +
    "exclude 用于排除歧义领域（如 world model 在 mental health / economics 的用法）；goal 按用户意图判断";
}

const CONCEPT_SYSTEM_PROMPT = "你是学术术语映射器（Research Atelier）。把用户研究问题中的表达映射为学术界实际使用的标准英文术语。" +
  "只输出 JSON，不要任何查询式、不要解释、不要 Markdown 围栏。结构：\n" +
  '{ "rawTerms": ["用户原词/短语"],' +
  ' "coreTasks": [{"canonical":"标准任务术语","alternatives":["用户表达或同义变体"],"confidence":"high|medium|low","sourceTerm":"来自哪个原词"}],' +
  ' "methods": [...同上...],' +
  ' "broaderFields": [...同上...],' +
  ' "applicationTerms": [...同上...],' +
  ' "adjacentTerms": [...同上...],' +
  ' "ambiguousTerms": [{"term":"原词或候选","note":"为什么有歧义/非标准","suggestedCanonical":"建议标准表达（如有）"}] }\n' +
  "规则：coreTasks=领域核心任务（如 human intention recognition / human action recognition / human motion prediction）；" +
  "methods=具体方法路线（如 skeleton-based action recognition / human-aware motion planning）；" +
  "broaderFields=上位领域（如 human-robot interaction / human-robot collaboration）；" +
  "applicationTerms=具体应用场景（如 robotic fencing——第一轮不应作为 hard constraint）；" +
  "adjacentTerms=邻近但非硬约束的概念；ambiguousTerms=非标准/有歧义的用户表达（如 human motion recognition，" +
  "领域更常用 human action recognition / human motion prediction）。每个 canonical 尽量给 alternatives 与 confidence。";

/** v1.4：用户自然语言 → 学术术语映射（LLM 语义判断，输出经 normalizeConceptMap 校验；绝不产出 query） */
export async function conceptMapper(question: string): Promise<AcademicConceptMap> {
  const q = String(question ?? "").trim();
  if (!q) throw new Error("研究问题不能为空");
  const mock = process.env.RA_CONCEPT_MOCK;
  if (mock) {
    const parsed = parseJsonObject(mock);
    if (parsed) return normalizeConceptMap(parsed);
  }
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) throw new Error("DEEPSEEK_API_KEY 未配置");
  let lastErr: unknown = null;
  for (let attempt = 1; attempt <= 2; attempt++) {
    if (attempt > 1) await new Promise((r) => setTimeout(r, 600 * 2 ** (attempt - 2)));
    try {
      const res = await fetch(DEEPSEEK_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + apiKey },
        body: JSON.stringify({
          model: "deepseek-chat",
          messages: [
            { role: "system", content: CONCEPT_SYSTEM_PROMPT },
            { role: "user", content: q },
          ],
          stream: false,
          temperature: 0.2,
        }),
        signal: AbortSignal.timeout(60000),
      });
      const data = await res.json();
      if (!res.ok) {
        lastErr = new Error("HTTP " + res.status + ": " + (data?.error?.message ?? "服务端错误"));
        if (res.status < 500 && res.status !== 429) break;
        continue;
      }
      const parsed = parseJsonObject(data?.choices?.[0]?.message?.content ?? "");
      if (!parsed) throw new Error("conceptMapper 返回不是有效 JSON");
      return normalizeConceptMap(parsed);
    } catch (err) {
      lastErr = err;
    }
  }
  throw new Error("学术术语映射失败：" + (lastErr instanceof Error ? lastErr.message : "未知错误"));
}

/** 调用 DeepSeek 把研究问题编译为结构化意图（失败抛错，由路由转 502）。now 可注入（测试用）。 */
export async function plannerIntent(question: string, now?: number): Promise<SearchIntent> {
  const year = now ?? new Date().getFullYear();
  const q = String(question ?? "").trim();
  if (!q) throw new Error("研究问题不能为空");

  // RA_PLANNER_MOCK：集成测试/无 key 环境的确定性路径（解析为 intent，同样走年份解析）
  const mock = process.env.RA_PLANNER_MOCK;
  if (mock) {
    const parsed = parseJsonObject(mock) ?? (() => { try { return JSON.parse(mock); } catch { return null; } })();
    if (parsed) return resolveYearRange(normalizeIntent(parsed.intent ?? parsed), year);
  }

  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) throw new Error("DEEPSEEK_API_KEY 未配置");

  let lastErr: unknown = null;
  for (let attempt = 1; attempt <= 2; attempt++) {
    if (attempt > 1) await new Promise((r) => setTimeout(r, 600 * 2 ** (attempt - 2)));
    try {
      const res = await fetch(DEEPSEEK_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + apiKey },
        body: JSON.stringify({
          model: "deepseek-chat",
          messages: [
            { role: "system", content: buildSystemPrompt(year) },
            { role: "user", content: q },
          ],
          stream: false,
          temperature: 0.2,
        }),
        signal: AbortSignal.timeout(60000),
      });
      const data = await res.json();
      if (!res.ok) {
        lastErr = new Error("HTTP " + res.status + ": " + (data?.error?.message ?? "服务端错误"));
        if (res.status < 500 && res.status !== 429) break;
        continue;
      }
      const content: string = data?.choices?.[0]?.message?.content ?? "";
      const parsed = parseJsonObject(content);
      if (!parsed) throw new Error("planner 返回的不是有效 JSON");
      return resolveYearRange(normalizeIntent(parsed.intent ?? parsed), year);
    } catch (err) {
      lastErr = err;
    }
  }
  const msg = lastErr instanceof Error ? lastErr.message : "未知错误";
  throw new Error("检索意图编译失败：" + msg);
}

/** 取首个 { 到末个 } 之间的 JSON（容忍围栏/前后噪声；不信任任何其他输出） */
function parseJsonObject(content: string): Record<string, unknown> | null {
  const c = String(content ?? "").trim();
  const start = c.indexOf("{");
  const end = c.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try { return JSON.parse(c.slice(start, end + 1)); } catch { return null; }
}

