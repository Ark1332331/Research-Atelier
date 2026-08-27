/**
 * Literature Discovery · Phase A API（Search Guide + Research Session 状态机）
 * POST /api/literature/plan    { question, sessionId? } → { session, plan, nextStep }
 * GET  /api/literature/session?id=<id>                  → { session, nextStep }（刷新恢复）
 * POST /api/literature/action  { sessionId, action: "open-external" | "returned-import" } → { session, nextStep }
 * 存储：data/research-sessions/<id>.json（store 适配器；session 持久化，刷新不丢）
 * LLM 边界：plannerIntent 只产结构化 intent；WoS 串 / GS URL 由代码确定性生成。
 */
import { plannerIntent } from "../../../lib/search/planner";
import { planFromIntent, deriveNextStep } from "../../../lib/search/plan";
import { createSession, withPlan, transitionStage, recordDatabaseAction } from "../../../lib/search/session";
import { loadSession, saveSession } from "../../../lib/search/session-storage";

export async function POST(request: Request) {
  const sub = new URL(request.url).pathname.split("/").pop();
  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return Response.json({ error: "请求体必须是 JSON" }, { status: 400 }); }

  if (sub === "plan") {
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

  if (sub === "action") {
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

  return Response.json({ error: "未知子路径" }, { status: 400 });
}

export async function GET(request: Request) {
  const id = new URL(request.url).searchParams.get("id");
  if (!id) return Response.json({ error: "缺少 id" }, { status: 400 });
  const session = await loadSession(id);
  if (!session) return Response.json({ error: "会话不存在" }, { status: 404 });
  return Response.json({ session, nextStep: deriveNextStep(session) });
}

