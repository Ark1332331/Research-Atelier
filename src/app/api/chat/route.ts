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
    });

    const data = await res.json();
    if (!res.ok) {
      return Response.json({ error: data?.error?.message ?? "DeepSeek API 请求失败" }, { status: res.status });
    }
    return Response.json(data);
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "网络错误" },
      { status: 502 },
    );
  }
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
