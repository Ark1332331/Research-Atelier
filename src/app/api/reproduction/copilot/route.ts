/**
 * 复现商定 copilot：在 App 内和 AI 边聊边敲定复现路径。
 * POST { slug, messages: [{role, content}] } → { reply, proposed, error? }
 *  - 自动注入：论文标题/来源/仓库 + 当前路径 + 坑点 + 你的画像（背景纪律）。
 *  - DeepSeek 可调用 propose_repro_steps 工具，把「已商定的步骤」结构化提交；
 *    后端捕获该步骤清单，随 reply 一起返回，前端据此渲染「建议步骤」勾选/改写后再写回路径。
 */
import { getReproduction } from "@/lib/reproduction";
import { readStore } from "@/lib/store";

const DEEPSEEK_URL = "https://api.deepseek.com/chat/completions";

type ChatMsg = { role: string; content?: string | null; tool_calls?: unknown; tool_call_id?: string };
type ProposedStep = { id: string; title: string; note?: string; done?: boolean };

const STAT = { todo: "待办", doing: "进行中", done: "已完成" } as const;

/** 复现路径商定工具：AI 把达成共识的步骤结构化提交。 */
const PROPOSE_TOOL = {
  type: "function",
  function: {
    name: "propose_repro_steps",
    description:
      "在与用户商定复现路径时，把已经和用户达成共识的一步或多步「复现步骤」结构化提交。"
      + "每步给出简洁可验证的标题、可选说明（如最小成功标准 / 需核对的输入输出）、以及是否已完成。"
      + "调用后这些步骤会作为「建议步骤」呈现给用户勾选/改写，用户确认后才写入路径。"
      + "不要擅自提交未经用户确认的步骤；一次可以提交多步。",
    parameters: {
      type: "object",
      properties: {
        steps: {
          type: "array",
          description: "商定好的复现步骤（按实际推进顺序）",
          items: {
            type: "object",
            properties: {
              title: { type: "string", description: "这一步要完成什么（简洁、可验证）" },
              note: { type: "string", description: "可选说明，如最小成功标准、要核对的输入/输出、或关键实现来源" },
              done: { type: "boolean", description: "是否已完成（默认 false）" },
            },
            required: ["title"],
          },
        },
      },
      required: ["steps"],
    },
  },
};

async function profileSummary(): Promise<string> {
  const md = await readStore("profile.md");
  if (!md) return "（暂无画像，按新手友好、数据合同讲解）";
  const lines = md.split("\n").filter((l) => /^[-*]\s|^\d+\.|编程与工具|PyTorch|Python|终端|论文理解|学习方法/.test(l.trim())).slice(0, 30).join("\n");
  return lines.slice(0, 1200) || "（暂无画像，按新手友好、数据合同讲解）";
}

function buildSystem(rec: NonNullable<Awaited<ReturnType<typeof getReproduction>>>, profile: string): string {
  const pathText = rec.path.length
    ? rec.path.map((s) => `- [${STAT[s.status]}] ${s.title}${s.note ? `（${s.note}）` : ""}`).join("\n")
    : "- （尚未明确路径，我们正在一起商定）";
  const pitText = rec.pitfalls.length
    ? rec.pitfalls.map((p) => `- ${p.text}${p.env ? "【环境】" : ""}`).join("\n")
    : "- （暂无）";
  return (
    `你是「复现伙伴」，正在和用户共同商定《${rec.title}》的可复现路径。\n\n` +
    `论文来源：${rec.sourceUrl || "(待补充)"}\n` +
    `代码/仓库：${rec.repoUrl || "(待补充；若缺可帮用户找)"}\n\n` +
    `用户知识水平（据此调整讲解深度）：\n${profile}\n\n` +
    `复现纪律：\n` +
    `① 分层推进（概念→数据→模型→训练→指标→对齐），每层给出可验证的最小成功标准；\n` +
    `② 不能把 loss 下降当成功，必须超过明确 baseline；\n` +
    `③ 超参/结构选择标注来源（论文给定 / 工程约束 / toy 暂定）；\n` +
    `④ 环境问题用三层定位法（驱动层/环境层/项目层）；\n` +
    `⑤ 代码讲解走「真实调用链→函数数据合同→执行前后变化」。\n\n` +
    `当前复现路径：\n${pathText}\n\n` +
    `已记录坑点：\n${pitText}\n\n` +
    `任务：和用户讨论下一步做什么、怎么验证。当一步（或多步）已经和用户达成共识，就用 propose_repro_steps 把它结构化提交；"
    + "否则只用文字回复、推进对话。每一步要在当下是明确、可验证、能判断「做对没做对」的。`
  );
}

async function deepseekChat(apiKey: string, messages: ChatMsg[]): Promise<{ ok: boolean; data?: Record<string, unknown>; error?: string; hint?: string }> {
  try {
    const res = await fetch(DEEPSEEK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: "deepseek-chat",
        messages,
        stream: false,
        tools: [PROPOSE_TOOL],
        tool_choice: "auto",
      }),
      signal: AbortSignal.timeout(120000),
    });
    const data = await res.json();
    if (!res.ok) return { ok: false, error: data?.error?.message ?? `HTTP ${res.status}`, hint: res.status >= 500 || res.status === 429 ? "服务端繁忙，稍后重试。" : undefined };
    return { ok: true, data };
  } catch (err) {
    const cause = err instanceof Error && (err as { cause?: { code?: string; message?: string } }).cause;
    const detail = err instanceof Error ? err.message + (cause ? `（${cause.code || cause.message}）` : "") : "网络错误";
    const proxyHint = process.env.HTTPS_PROXY || process.env.HTTP_PROXY
      ? "检测到代理配置，但仍连接失败，请检查代理地址/端口。"
      : "已重试仍失败，通常是网络到 api.deepseek.com 不稳定；若需要代理请在 .env.local 配 HTTPS_PROXY 后重启。";
    return { ok: false, error: detail, hint: proxyHint };
  }
}

export async function POST(request: Request) {
  let body: { slug?: string; messages?: ChatMsg[] };
  try { body = await request.json(); } catch { return Response.json({ error: "请求体必须是 JSON" }, { status: 400 }); }

  const slug = body.slug;
  if (!slug) return Response.json({ error: "slug 必填" }, { status: 400 });
  const rec = await getReproduction(slug);
  if (!rec) return Response.json({ error: "记录不存在" }, { status: 404 });

  const userMsgs = Array.isArray(body.messages) ? body.messages : [];
  if (userMsgs.length === 0) return Response.json({ error: "messages 不能为空" }, { status: 400 });

  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    return Response.json({ error: "DEEPSEEK_API_KEY 未配置：复制 .env.local.example 为 .env.local 并填入你的 key" }, { status: 500 });
  }

  const profile = await profileSummary();
  const system = buildSystem(rec, profile);
  const convo: ChatMsg[] = [{ role: "system", content: system }, ...userMsgs.map((m) => ({ role: m.role, content: m.content ?? "" }))];

  // 工具循环：AI 要求提交步骤 → 捕获（只取最新一次，用户端以它为准）→ 回填已收录步骤 → 继续。
  let proposed: ProposedStep[] = [];
  let reply = "";
  for (let round = 0; round <= 2; round++) {
    const r = await deepseekChat(apiKey, convo);
    if (!r.ok) return Response.json({ error: r.error, hint: r.hint }, { status: 502 });
    const data = r.data!;
    const first = Array.isArray((data as { choices?: unknown }).choices) ? ((data as { choices: any[] }).choices[0] as { message?: unknown }) : undefined;
    const msg: ChatMsg = (first?.message as ChatMsg) ?? {};
    const toolCalls = (msg.tool_calls as { id: string; function: { name: string; arguments?: string } }[] | undefined);

    const toolCall = toolCalls?.find((tc) => tc.function?.name === "propose_repro_steps");
    if (toolCall) {
      let args: { steps?: { title?: string; note?: string; done?: boolean }[] } = {};
      try { args = JSON.parse(toolCall.function?.arguments || "{}"); } catch { /* */ }
      if (Array.isArray(args.steps)) {
        proposed = args.steps.map((s, i) => ({
          id: `prop-${Date.now().toString(36)}-${i}`,
          title: String(s.title ?? "").trim(),
          note: s.note ? String(s.note).trim() : undefined,
          done: Boolean(s.done),
        })).filter((s) => s.title);
      }
      // 回填当前路径给模型，确认已收录
      const cur = rec.path.map((st) => `- [${STAT[st.status]}] ${st.title}`).join("\n") || "- （空）";
      convo.push({ role: "assistant", content: msg.content ?? "", tool_calls: msg.tool_calls });
      convo.push({ role: "tool", tool_call_id: toolCall.id, content: JSON.stringify({ ok: true, currentPath: cur, note: "以上步骤已作为建议步骤返回给用户，等待用户确认。请继续与用户讨论下一步。" }) });
      continue;
    }
    reply = msg.content ?? "";
    break;
  }

  return Response.json({ reply, proposed });
}
