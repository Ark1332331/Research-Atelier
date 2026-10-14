import { withToolObservation } from "@/lib/learning/tool-observation";
import { bindExecutionSession } from "@/lib/execution-session";
import { getProject, updateProject } from "@/lib/project";
export async function GET(request: Request) {
  const projectId = new URL(request.url).searchParams.get("projectId");
  const project = projectId ? await getProject(projectId) : null;
  return project ? Response.json({ sessions: project.executionSessions }) : Response.json({ error: "项目不存在" }, { status: 404 });
}
async function observedPOST(request: Request) {
  let body: Record<string, unknown>; try { body = await request.json(); } catch { return Response.json({ error: "请求体必须是 JSON" }, { status: 400 }); }
  const projectId = String(body.projectId ?? ""); if (!projectId) return Response.json({ error: "projectId 必填" }, { status: 400 });
  if (body.action === "bind") {
    try {
      const session = await bindExecutionSession(String(body.deepLink ?? ""));
      const project = await updateProject(projectId, (item) => {
        if (!item.executionSessions.some((existing) => existing.deepLink === session.deepLink)) item.executionSessions.push(session);
      });
      return project ? Response.json({ sessions: project.executionSessions }) : Response.json({ error: "项目不存在" }, { status: 404 });
    } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "会话地址无效" }, { status: 400 }); }
  }
  if (body.action === "delete") {
    const project = await updateProject(projectId, (item) => { item.executionSessions = item.executionSessions.filter((session) => session.id !== body.id); });
    return project ? Response.json({ sessions: project.executionSessions }) : Response.json({ error: "项目不存在" }, { status: 404 });
  }
  return Response.json({ error: "未知 action" }, { status: 400 });
}

export const POST=withToolObservation({source:"实验执行记录",scene:"repro",conversation:false},observedPOST);
