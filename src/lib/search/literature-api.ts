/**
 * Literature Discovery API 处理器（Phase A）——三个真实子路由共享：
 *   /api/literature/plan    POST
 *   /api/literature/action  POST
 *   /api/literature/session GET
 * 存储：data/research-sessions/<id>.json（store 适配器；session 持久化，刷新不丢）
 * LLM 边界：plannerIntent 只产结构化 intent；WoS 串 / GS/arXiv URL 由代码确定性生成。
 */
import { plannerIntent } from "./planner.ts";
import { planFromIntent, deriveNextStep } from "./plan.ts";
import { createSession, withPlan, transitionStage, recordDatabaseAction } from "./session.ts";
import { loadSession, saveSession } from "./session-storage.ts";

export async function handlePlan(body: Record<string, unknown>): Promise<Response> {
  const question = String(body.question ?? "").trim();
  if (!question) return Response.json({ error: "研究问题不能为空" }, { status: 400 });
  let session = body.sessionId ? await loadSession(String(body.sessionId)) : null;
  if (!session) session = createSession(question);
  try {
    const intent = await plannerIntent(question);
    const plan = planFromIntent(intent);
    session = withPlan(session, intent, plan);
    await saveSession(session);
    return Response.json({ session, nextStep: deriveNextStep(session) });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const hint = msg.includes("DEEPSEEK_API_KEY")
      ? "DEEPSEEK_API_KEY 未配置：复制 .env.local.example 为 .env.local 并填入你的 key"
      : "检索意图编译失败，请稍后重试（可检查网络/代理）。";
    return Response.json({ error: msg, hint }, { status: 502 });
  }
}

export async function handleAction(body: Record<string, unknown>): Promise<Response> {
  const sessionId = String(body.sessionId ?? "");
  const action = String(body.action ?? "");
  let session = await loadSession(sessionId);
  if (!session) return Response.json({ error: "会话不存在" }, { status: 404 });
  try {
    if (action === "open-external") {
      const primaryId = session.plan?.databases.find((d) => d.recommendedNow)?.id ?? "google-scholar";
      session = transitionStage(session, "external-opened");
      session = recordDatabaseAction(session, { database: primaryId, action: "opened", at: new Date().toISOString() });
    } else if (action === "returned-import") {
      session = transitionStage(session, "awaiting-import");
    } else {
      return Response.json({ error: "未知 action" }, { status: 400 });
    }
    await saveSession(session);
    return Response.json({ session, nextStep: deriveNextStep(session) });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 409 });
  }
}

export async function handleSessionGet(id: string): Promise<Response> {
  if (!id) return Response.json({ error: "缺少 id" }, { status: 400 });
  const session = await loadSession(id);
  if (!session) return Response.json({ error: "会话不存在" }, { status: 404 });
  return Response.json({ session, nextStep: deriveNextStep(session) });
}

