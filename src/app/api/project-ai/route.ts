import { observeConversation } from "@/lib/learning/extract";
import { prepareLearning, finishLearning, readLearning } from "@/lib/learning/store";
import { getProject, updateProject } from "@/lib/project";
import { answerProjectQuestion, isProtocolLeak, type ProjectAIMessage, type ProjectAIMode } from "@/lib/project-ai";

function cleanMessages(messages: ProjectAIMessage[]): ProjectAIMessage[] {
  return messages.filter((message) => message.role === "user" || !isProtocolLeak(message.content));
}

export async function POST(request: Request) {
  let body: { projectId?: string; question?: string; messages?: ProjectAIMessage[]; mode?: ProjectAIMode };
  try { body = await request.json(); } catch { return Response.json({ error: "请求体必须是 JSON" }, { status: 400 }); }
  const projectId = String(body.projectId ?? "").trim();
  const mode: ProjectAIMode = body.mode === "audit" ? "audit" : "chat";
  if (!projectId) return Response.json({ error: "projectId 必填" }, { status: 400 });
  const project = await getProject(projectId);
  if (!project) return Response.json({ error: "项目不存在" }, { status: 404 });
  const stored = cleanMessages(Array.isArray(project.aiMessages) ? project.aiMessages : []);
  const question = String(body.question ?? "").trim();
  const messages = question ? [...stored, { role: "user" as const, content: question }] : (Array.isArray(body.messages) ? body.messages.filter((message) => (message?.role === "user" || message?.role === "assistant") && typeof message.content === "string" && message.content.trim()) : []);
  if (!messages.length || messages[messages.length - 1].role !== "user") return Response.json({ error: "请先输入项目问题" }, { status: 400 });
  const contextText=messages.filter(m=>m.role==="user").slice(-2).map(m=>m.content).join(" ");
  const scene=mode==="audit"?"repro":/代码|函数|参数|numpy|pytorch|forward|tensor/i.test(contextText)?"code":/论文|文章|method|abstract|术语/i.test(contextText)?"paper":"repro";
  let learning;
  try { learning = await prepareLearning(messages[messages.length - 1].content, scene, projectId); }
  catch (error) { return Response.json({ error: error instanceof Error ? error.message : "学习库不可用" }, { status: 503 }); }
  const note=await observeConversation(learning,messages);
  try {
    const answer = await answerProjectQuestion(project, messages, mode, learning.selected);
    const metadata={runId:learning.id,observationId:learning.observationId,selected:learning.selected,proposedIds:learning.proposedIds,note};
    const saved = [...messages, { role: "assistant" as const, content: answer, learningRunId:learning.id }].slice(-80);
    const updated = await updateProject(projectId, (item) => { item.aiMessages = saved; });
    await finishLearning(learning, answer);
    return Response.json({ answer, learning: metadata, messages: (updated?.aiMessages ?? saved).map(m=>m.learningRunId===learning.id?{...m,learning:metadata}:m) });
  }
  catch (error) { await finishLearning(learning, "", error instanceof Error ? error.message : "请求失败"); return Response.json({ error: error instanceof Error ? error.message : "项目 AI 请求失败" }, { status: 502 }); }
}

export async function GET(request: Request) {
  const projectId = new URL(request.url).searchParams.get("projectId")?.trim();
  if (!projectId) return Response.json({ error: "projectId 必填" }, { status: 400 });
  const project = await getProject(projectId);
  if (!project) return Response.json({ error: "项目不存在" }, { status: 404 });
  let messages=cleanMessages(project.aiMessages??[]);
  try { const state=await readLearning();messages=messages.map(m=>{const run=state.runs.find(r=>r.id===m.learningRunId);return run?{...m,learning:{runId:run.id,observationId:state.observations?.find(o=>o.traceId===run.id)?.id,selected:run.selected,proposedIds:state.memories.filter(x=>x.status==="pending"&&x.evidence.some(e=>e.source===`回答反馈 ${run.id}`)).map(x=>x.id)}}:m;}); } catch { /* History stays readable even if the learning store is unavailable. */ }
  return Response.json({ messages });
}
