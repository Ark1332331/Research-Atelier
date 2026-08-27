/**
 * LLM 检索意图生产者（v1.1 guardrail #2 边界）：
 * LLM 只输出结构化 SearchIntent（JSON）；SearchPlan / WoS 查询串 / GS URL 一律由代码
 * （planFromIntent / compileWosQuery / googleScholarUrl）确定性生成，LLM 字符串不可信。
 */
import { normalizeIntent } from "./plan.ts";
import type { SearchIntent } from "./types.ts";

const DEEPSEEK_URL = "https://api.deepseek.com/chat/completions";

const SYSTEM_PROMPT = "你是 Research Atelier 的检索策略编译器。把用户的研究问题编译成结构化检索意图 JSON。" +
  "只输出 JSON，不要任何解释、不要 Markdown 围栏。字段：\n" +
  '{ "goal": "explore | recent | foundational | survey | reproducible | follow_paper",' +
  ' "concepts": ["核心概念，2-4 个，必须出现在主题中"],' +
  ' "context": ["语境/相关表达，1-3 个，用于缩小范围"],' +
  ' "exclude": ["需要排除的歧义词，0-3 个"],' +
  ' "preferredTypes": ["review | conference-paper | journal-article | preprint"] 可为空数组,' +
  ' "yearRange": [起始年, 结束年] 或 null }\n' +
  "规则：concepts 是主题核心词；context 是领域语境（如 robotics / embodied agent）；" +
  "exclude 用于排除歧义领域（如 world model 在 mental health / economics 的用法）；" +
  "yearRange 默认近五年，用户强调历史起点时放宽；goal 按用户意图判断";

/** 调用 DeepSeek 把研究问题编译为结构化意图（失败抛错，由路由转 502） */
export async function plannerIntent(question: string): Promise<SearchIntent> {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) throw new Error("DEEPSEEK_API_KEY 未配置");
  const q = String(question ?? "").trim();
  if (!q) throw new Error("研究问题不能为空");

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
            { role: "system", content: SYSTEM_PROMPT },
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
      return normalizeIntent(parsed.intent ?? parsed);
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

