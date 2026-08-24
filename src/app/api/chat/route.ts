/**
 * DeepSeek API 后端（大脑入口）
 * 用法：前端 POST /api/chat { messages: [{role, content}, ...] }
 * 环境变量：DEEPSEEK_API_KEY（见 .env.local.example）
 * 文档依据：node_modules/next/dist/docs/01-app/01-getting-started/15-route-handlers.md
 * 注意：POST 默认不缓存；API key 只存在于服务端。
 */
export async function POST(request: Request) {
  let body: { messages?: { role: string; content: string }[] };
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

  // 重试：DeepSeek 直连在部分网络下不稳定（时好时坏 / 偶发超时），一次失败就报错很伤体验。
  // 对瞬时网络抖动做 2 次指数退避重试；重试仍失败才把具体原因 + 可执行提示返回给前端。
  let lastErr: unknown = null;
  const MAX_ATTEMPTS = 3;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    if (attempt > 1) await new Promise((r) => setTimeout(r, 600 * 2 ** (attempt - 2)));
    try {
      const res = await fetch("https://api.deepseek.com/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: "deepseek-chat",
          messages,
          stream: false,
        }),
        signal: AbortSignal.timeout(120000), // DeepSeek 非流式补全可能较慢，给足超时
      });
      const data = await res.json();
      if (!res.ok) {
        // 402/401/4xx 是业务错误，重试无意义；5xx/429 是服务端可重试
        if (res.status >= 500 || res.status === 429) {
          lastErr = new Error(`HTTP ${res.status}: ${data?.error?.message ?? "服务端错误"}`);
          continue;
        }
        return Response.json({ error: data?.error?.message ?? "DeepSeek API 请求失败" }, { status: res.status });
      }
      return Response.json(data);
    } catch (err) {
      lastErr = err; // 网络层错误（连接超时 / 主动断开 / DNS）→ 记录并重试
    }
  }

  // 多次重试仍失败：给出具体原因 + 可执行提示
  const err = lastErr;
  const cause = err instanceof Error && (err as { cause?: { code?: string; message?: string } }).cause;
  const detail =
    err instanceof Error
      ? err.message + (cause ? `（${cause.code || cause.message}）` : "")
      : "网络错误";
  const proxyHint = process.env.HTTPS_PROXY || process.env.HTTP_PROXY
    ? "检测到代理配置，但仍连接失败，请检查代理地址/端口是否可用。"
    : "已自动重试 3 次仍失败，通常是网络到 api.deepseek.com 不稳定。若你的网络需要代理，请在 .env.local 里加 `HTTPS_PROXY=http://127.0.0.1:<端口>`（如 mihomo 的 7890）并重启应用；应用已启用 NODE_USE_ENV_PROXY 会自动走该代理。";
  return Response.json({ error: detail, hint: proxyHint }, { status: 502 });
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
