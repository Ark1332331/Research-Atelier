import crypto from "node:crypto";
import { clearPendingSync, collectPendingSync, explainPendingSync, readPendingSync, type PendingSync } from "@/lib/sync";
import { explainSyncWithAI } from "@/lib/sync-explain";
import { readNewMessages } from "@/lib/execution-session";
import { buildReproductionChainWithAI } from "@/lib/reproduction-chain";
import { getProject, updateProject } from "@/lib/project";

export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return Response.json({ error: "请求体必须是 JSON" }, { status: 400 }); }
  const projectId = String(body.projectId ?? "");
  if (!projectId) return Response.json({ error: "projectId 必填" }, { status: 400 });
  const project = await getProject(projectId);
  if (!project) return Response.json({ error: "项目不存在" }, { status: 404 });
  if (body.action === "rebuildHistory") {
    const messages = (await Promise.all(project.executionSessions.map((session) => readNewMessages(session, 0)))).flatMap((item) => item.messages);
    if (!messages.length) return Response.json({ error: "绑定会话中没有可分析的对话内容。" }, { status: 400 });
    const chain = await buildReproductionChainWithAI(project, messages);
    const state = { current: chain.current.result, why: `${chain.current.meaning}；还不能说明：${chain.current.limitation}`, nextStep: chain.current.nextStep, whyNow: chain.current.whyNow, question: chain.current.question };
    const history = chain.stages.map((stage) => ({ id: crypto.randomUUID(), evidence: { source: "完整执行对话", excerpt: stage.evidence }, explanation: stage }));
    const updated = await updateProject(projectId, (item) => { item.reproState = state; item.history = history; });
    return Response.json({ project: updated, stages: chain.stages });
  }
  if (body.action === "refreshState") {
    const hasEvidence = (evidence: PendingSync["evidence"]) => Boolean(evidence.code?.changedFiles.length || evidence.conversations.some((session) => session.messages.length));
    const record = project.history.find((item) => hasEvidence(item.evidence as PendingSync["evidence"]));
    const evidence = record?.evidence as PendingSync["evidence"] | undefined;
    if (!evidence) return Response.json({ error: "还没有可用于更新状态的同步记录。" }, { status: 400 });
    const explanation = await explainSyncWithAI(project, { projectId, evidence, sessionCursors: {}, hasEvidence: true });
    const state = { current: explanation.result, why: `${explanation.meaning}；还不能说明：${explanation.limitation}`, nextStep: explanation.nextStep, whyNow: explanation.whyNow, question: explanation.question };
    const updated = await updateProject(projectId, (item) => { item.reproState = state; item.history = item.history.filter((entry) => hasEvidence(entry.evidence as PendingSync["evidence"])).map((entry) => entry.id === record!.id ? { ...entry, explanation } : entry); });
    return Response.json({ project: updated });
  }
  if (body.action === "collect") {
    const pending = await collectPendingSync(project);
    const updated = await updateProject(projectId, (item) => {
      item.executionSessions = item.executionSessions.map((session) => pending.sessionCursors[session.id] === undefined ? session : { ...session, cursor: pending.sessionCursors[session.id] });
    });
    return Response.json({ pending, project: updated });
  }
  if (body.action === "explain") {
    const pending = await readPendingSync(projectId);
    if (!pending) return Response.json({ error: "没有待讲解的同步内容，请先同步。" }, { status: 400 });
    const messages = (await Promise.all(project.executionSessions.map((session) => readNewMessages(session, 0)))).flatMap((item) => item.messages);
    if (!messages.length) return Response.json({ error: "绑定会话中没有可分析的对话内容。" }, { status: 400 });
    const chain = await buildReproductionChainWithAI(project, messages);
    const state = { current: chain.current.result, why: `${chain.current.meaning}；还不能说明：${chain.current.limitation}`, nextStep: chain.current.nextStep, whyNow: chain.current.whyNow, question: chain.current.question };
    const history = chain.stages.map((stage) => ({ id: crypto.randomUUID(), evidence: { source: "完整执行对话", excerpt: stage.evidence }, explanation: stage }));
    const updated = await updateProject(projectId, (item) => { item.reproState = state; item.history = history; });
    if (!updated) return Response.json({ error: "项目不存在" }, { status: 404 });
    await clearPendingSync(projectId);
    return Response.json({ stages: chain.stages, project: updated });
  }
  return Response.json({ error: "未知 action" }, { status: 400 });
}
