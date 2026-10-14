import type { PaperProject } from "@/lib/project";
import type { SessionMessage } from "@/lib/execution-session";
import type { SyncExplanation } from "@/lib/sync-explain";

const DEEPSEEK_URL = "https://api.deepseek.com/chat/completions";

export interface ReproductionStage extends SyncExplanation {
  evidence: string;
}
export interface ReproductionChain {
  stages: ReproductionStage[];
  current: SyncExplanation;
}

function visibleTranscript(messages: SessionMessage[]): string {
  const rows = messages
    .filter((message) => !(message.role === "user" && message.text.includes("<codex_internal_context")))
    .map((message, index) => `[${index + 1}] ${message.role === "user" ? "用户" : "执行助手"}：${message.text.slice(0, 1800)}`);
  const text = rows.join("\n\n");
  return text.length <= 110000 ? text : `${text.slice(0, 55000)}\n\n[中间对话已省略]\n\n${text.slice(-55000)}`;
}

function parse(content: string): ReproductionChain {
  const json = content.match(/\{[\s\S]*\}/)?.[0];
  if (!json) throw new Error("AI 没有返回复现链 JSON");
  const data = JSON.parse(json) as { stages?: ReproductionStage[]; current?: SyncExplanation };
  if (!Array.isArray(data.stages) || !data.stages.length || !data.current) throw new Error("AI 返回的复现链不完整");
  const text = (value: unknown, fallback = "未提供") => typeof value === "string" && value.trim() ? value.trim() : fallback;
  const normalize = (item: Partial<ReproductionStage>): ReproductionStage => ({ stage: text(item.stage), result: text(item.result), meaning: text(item.meaning), limitation: text(item.limitation), nextStep: text(item.nextStep), whyNow: text(item.whyNow), question: text(item.question), evidence: text(item.evidence) });
  const current = data.current as Partial<SyncExplanation>;
  return { stages: data.stages.slice(0, 12).map(normalize), current: { stage: text(current.stage), result: text(current.result), meaning: text(current.meaning), limitation: text(current.limitation), nextStep: text(current.nextStep), whyNow: text(current.whyNow), question: text(current.question) } };
}

export async function buildReproductionChainWithAI(project: PaperProject, messages: SessionMessage[]): Promise<ReproductionChain> {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) throw new Error("DEEPSEEK_API_KEY 未配置，无法生成复现链。");
  const prompt = [
    "你是 Research Atelier 的科研复现档案 AI。根据完整执行对话，重建真实的复现链，而不是按同步次数罗列。",
    "按对话中实际暴露的工作单元划分 stages，例如环境/数据、实现与训练、失败与修正、评估验证、最终验收；不要使用固定步骤编号，不要编造未出现的内容。",
    "每个 stage 必须给出 evidence（来自对话的简短可核对事实）。current 是整个项目此刻的判断；只有明确最终评估和验收通过时才能判为完成。",
    "只返回 JSON：{\"stages\":[{\"stage\":string,\"result\":string,\"meaning\":string,\"limitation\":string,\"nextStep\":string,\"whyNow\":string,\"question\":string,\"evidence\":string}],\"current\":{\"stage\":string,\"result\":string,\"meaning\":string,\"limitation\":string,\"nextStep\":string,\"whyNow\":string,\"question\":string}}。",
    `项目：${project.title}`,
    `完整执行对话：\n${visibleTranscript(messages)}`,
  ].join("\n\n");
  const response = await fetch(DEEPSEEK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model: "deepseek-chat", messages: [{ role: "system", content: "你是严谨、可追溯的科研复现档案助手。" }, { role: "user", content: prompt }], stream: false, response_format: { type: "json_object" } }),
    signal: AbortSignal.timeout(120000),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error?.message ?? "AI 复现链请求失败");
  return parse(String(data?.choices?.[0]?.message?.content ?? ""));
}
