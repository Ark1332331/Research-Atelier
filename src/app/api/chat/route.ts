/**
 * DeepSeek API 后端（大脑入口）
 * 用法：前端 POST /api/chat { messages: [...], enableToolcall?: boolean }
 * 环境变量：DEEPSEEK_API_KEY（见 .env.local.example）
 * 文档依据：node_modules/next/dist/docs/01-app/01-getting-started/15-route-handlers.md
 * 注意：POST 默认不缓存；API key 只存在于服务端。
 *
 * enableToolcall 时启用 function calling（tools）：让 AI 能指挥后端执行
 *   - search_papers(query)：联网检索论文（OpenAlex），候选含 DOI/出版社入口与开放获取 PDF
 *   - download_paper(...)：下载开放获取 PDF 并导入本地论文库
 * （AI 本身不联网，真正的检索/下载由后端 route 执行——见 src/lib/paper-tools.ts）
 */
import { searchPapers, downloadPaper } from "@/lib/paper-tools";

const DEEPSEEK_URL = "https://api.deepseek.com/chat/completions";

type ChatMsg = { role: string; content?: string | null; tool_calls?: unknown; tool_call_id?: string };
type ToolDef = { type: "function"; function: { name: string; description: string; parameters: Record<string, unknown> } };

const TOOLS: ToolDef[] = [
  {
    type: "function",
    function: {
      name: "search_papers",
      description:
        "联网检索论文（用户想了解某个领域/主题、或筛选候选论文时调用）。返回候选论文的标题/作者/年份/摘要、"
        + "DOI 与出版社入口（用户在学校订阅/校园网内可下载）、以及是否开放获取、开放获取的 PDF 直链。",
      parameters: {
        type: "object",
        properties: { query: { type: "string", description: "检索关键词，如 world model 或 visual navigation" } },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "download_paper",
      description:
        "下载一篇开放获取论文的 PDF 并导入本地论文库（会出现在「论文库」，可去精读讲解）。"
        + "用 search_papers 返回的 oa_pdf_url（开放获取直链）或 arxiv_id 调用。"
        + "若论文不是开放获取（需要学校/出版社订阅），会失败——此时把 search_papers 返回的 publisher_url 告诉用户在校内下载后导入。",
      parameters: {
        type: "object",
        properties: {
          pdf_url: { type: "string", description: "开放获取 PDF 直链（来自 search_papers 的 oa_pdf_url）" },
          arxiv_id: { type: "string", description: "arXiv id（若是 arXiv 论文）" },
          title: { type: "string", description: "论文标题（可选）" },
        },
      },
    },
  },
];

async function executeTool(name: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
  if (name === "search_papers") {
    const query = String(args.query ?? "").trim();
    if (!query) return { error: "需要一个检索关键词" };
    try {
      const hits = await searchPapers(query);
      return { hits };
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e), hint: "检索失败，可能是网络到 api.openalex.org 不通（可配代理）。" };
    }
  }
  if (name === "download_paper") {
    const pdfUrl = args.pdf_url ? String(args.pdf_url) : undefined;
    const arxivId = args.arxiv_id ? String(args.arxiv_id) : undefined;
    const title = args.title ? String(args.title) : undefined;
    if (!pdfUrl && !arxivId) return { error: "缺少 pdf_url 或 arxiv_id" };
    try {
      const r = await downloadPaper({ pdfUrl, arxivId, title });
      return {
        imported: true,
        slug: r.slug,
        title: r.title,
        pages: r.pages,
        note: "论文 PDF 已下载并导入本地论文库（data/papers）。整篇中文翻译正在后台生成（约 1–2 分钟），之后可在「精读讲解」看到；若等太久没看到译文，可稍后重新翻译。",
      };
    } catch (e) {
      return { imported: false, error: e instanceof Error ? e.message : String(e) };
    }
  }
  return { error: `未知工具：${name}` };
}

/** 单次 DeepSeek 调用（带重试网络抖动；5xx/429 重试，4xx 业务错误直接返回）。
    超时/重试控制得很短，避免用户在界面「思考中…」等太久而无响应。 */
async function deepseekChat(apiKey: string, messages: ChatMsg[], tools?: ToolDef[]): Promise<Response> {
  let lastErr: unknown = null;
  for (let attempt = 1; attempt <= 2; attempt++) {
    if (attempt > 1) await new Promise((r) => setTimeout(r, 600 * 2 ** (attempt - 2)));
    try {
      const res = await fetch(DEEPSEEK_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model: "deepseek-chat",
          messages,
          stream: false,
          ...(tools ? { tools, tool_choice: "auto" } : {}),
        }),
        signal: AbortSignal.timeout(120000),
      });
      const data = await res.json();
      if (res.ok) return Response.json(data);
      if (res.status >= 500 || res.status === 429) {
        lastErr = new Error(`HTTP ${res.status}: ${data?.error?.message ?? "服务端错误"}`);
        continue;
      }
      return Response.json({ error: data?.error?.message ?? "DeepSeek API 请求失败" }, { status: res.status });
    } catch (err) {
      lastErr = err;
    }
  }
  // 多次重试仍失败：具体原因 + 可执行提示
  const err = lastErr;
  const cause = err instanceof Error && (err as { cause?: { code?: string; message?: string } }).cause;
  const detail = err instanceof Error ? err.message + (cause ? `（${cause.code || cause.message}）` : "") : "网络错误";
  const proxyHint = process.env.HTTPS_PROXY || process.env.HTTP_PROXY
    ? "检测到代理配置，但仍连接失败，请检查代理地址/端口是否可用。"
    : "已自动重试 2 次仍失败，通常是网络到 api.deepseek.com 不稳定。若你的网络需要代理，请在 .env.local 里加 `HTTPS_PROXY=http://127.0.0.1:<端口>`（HTTP_PROXY 也填同一端口）并彻底重启应用。";
  return Response.json({ error: detail, hint: proxyHint }, { status: 502 });
}

export async function POST(request: Request) {
  let body: { messages?: ChatMsg[]; enableToolcall?: boolean };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "请求体必须是 JSON" }, { status: 400 });
  }

  const messages = body.messages;
  if (!Array.isArray(messages) || messages.length === 0) {
    return Response.json({ error: "messages 不能为空" }, { status: 400 });
  }

  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    return Response.json(
      { error: "DEEPSEEK_API_KEY 未配置：复制 .env.local.example 为 .env.local 并填入你的 key" },
      { status: 500 },
    );
  }

  const useTools = Boolean(body.enableToolcall);
  // function calling 循环：AI 要求调用工具 → 后端执行 → 回填 → 再让 AI 继续，最多 4 轮
  const MAX_TOOL_ROUNDS = 3;
  let convo: ChatMsg[] = messages;
  for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
    const res = await deepseekChat(apiKey, convo, useTools ? TOOLS : undefined);
    if (!res.ok) return res;
    const data = await res.json();
    const msg = data?.choices?.[0]?.message as ChatMsg | undefined;
    const toolCalls = (msg?.tool_calls as { id: string; function: { name: string; arguments?: string } }[] | undefined);

    if (useTools && Array.isArray(toolCalls) && toolCalls.length && round < MAX_TOOL_ROUNDS) {
      convo = [...convo, { role: "assistant", content: msg?.content ?? "", tool_calls: msg?.tool_calls }];
      for (const tc of toolCalls) {
        let args: Record<string, unknown> = {};
        try { args = JSON.parse(tc.function?.arguments || "{}"); } catch { /* 忽略坏参数 */ }
        const result = await executeTool(tc.function?.name || "", args);
        convo.push({ role: "tool", tool_call_id: tc.id, content: JSON.stringify(result) });
      }
      continue;
    }
    return Response.json(data);
  }
  return Response.json({ error: "工具调用次数过多，已停止。" }, { status: 500 });
}

/** 健康检查：GET /api/chat */
export async function GET() {
  const key = process.env.DEEPSEEK_API_KEY;
  return Response.json({
    ok: true,
    apiKeyConfigured: Boolean(key),
    tools: ["p0", "env", "code", "p3", "handoff", "checklist"],
  });
}
