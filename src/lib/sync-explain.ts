import type { PaperProject } from "@/lib/project";
import type { PendingSync } from "@/lib/sync";

const DEEPSEEK_URL = "https://api.deepseek.com/chat/completions";

export interface SyncExplanation {
  stage: string;
  result: string;
  meaning: string;
  limitation: string;
  nextStep: string;
  whyNow: string;
  question: string;
}

function evidenceForModel(pending: PendingSync) {
  return {
    code: pending.evidence.code,
    conversations: pending.evidence.conversations.map((session) => ({
      provider: session.provider,
      messages: session.messages.slice(-8).map((message) => ({ role: message.role, text: message.text.slice(0, 4000) })),
    })),
  };
}

function parseExplanation(content: string): SyncExplanation {
  const json = content.match(/\{[\s\S]*\}/)?.[0];
  if (!json) throw new Error("AI 没有返回结构化同步讲解");
  const value = JSON.parse(json) as Partial<SyncExplanation>;
  const field = (key: keyof SyncExplanation) => typeof value[key] === "string" && value[key]?.trim() ? value[key]!.trim() : "未提供";
  return { stage: field("stage"), result: field("result"), meaning: field("meaning"), limitation: field("limitation"), nextStep: field("nextStep"), whyNow: field("whyNow"), question: field("question") };
}

export async function explainSyncWithAI(project: PaperProject, pending: PendingSync): Promise<SyncExplanation> {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) throw new Error("DEEPSEEK_API_KEY 未配置，无法由 AI 讲解同步证据。");
  const prompt = [
    "你是 Research Atelier 的科研项目状态管理 AI。程序已采集证据；你只根据证据判断，不编造实验、结果或完成状态。",
    "请判断当前复现是否已完成：只有证据明确给出最终可验证评估并声明验收通过时，result 才可以写为“复现已完成”。否则如实说明进行中或证据不足。",
    "先从对话和证据判断这一轮的复现进展，用 stage 给出简短阶段名（如：环境就绪、实现与训练、评估验证、最终验收）。它不是固定步骤编号。只返回 JSON，不要 Markdown：{\"stage\":string,\"result\":string,\"meaning\":string,\"limitation\":string,\"nextStep\":string,\"whyNow\":string,\"question\":string}。",
    `项目：${project.title}`,
    `同步证据：${JSON.stringify(evidenceForModel(pending))}`,
  ].join("\n\n");
  const response = await fetch(DEEPSEEK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model: "deepseek-chat", messages: [{ role: "system", content: "你是严谨的科研复现状态管理助手。" }, { role: "user", content: prompt }], stream: false, response_format: { type: "json_object" } }),
    signal: AbortSignal.timeout(120000),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error?.message ?? "AI 同步讲解请求失败");
  return parseExplanation(String(data?.choices?.[0]?.message?.content ?? ""));
}
