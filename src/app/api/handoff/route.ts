import { withToolObservation } from "@/lib/learning/tool-observation";
import { readLearning } from "@/lib/learning/store";
import { getProject } from "@/lib/project";
async function observedPOST(request: Request) {
  let body: { projectId?: string }; try { body = await request.json(); } catch { return Response.json({ error: "请求体必须是 JSON" }, { status: 400 }); }
  const project = body.projectId ? await getProject(body.projectId) : null;
  if (!project) return Response.json({ error: "项目不存在" }, { status: 404 });
  const state = project.reproState;
  const learning = await readLearning();
  const memories = learning.memories.filter(m => m.status === "active" && (!m.projectId || m.projectId === project.id) && (!m.expiresAt || Date.parse(m.expiresAt) > Date.now()));
  const prompt = [
    "# Research Atelier handoff",
    "遵循项目根目录的 AGENTS.md 执行。",
    "", "论文：" + project.title,
    project.paperSlug ? "论文阅读页：/read/" + project.paperSlug : "",
    project.workspace?.repoPath ? "代码目录：" + project.workspace.repoPath : "",
    "", "当前状态：" + state.current,
    "下一步：" + (state.nextStep || "尚未从同步讲解中确定"),
    "为什么现在做：" + (state.whyNow || state.why || "需要先取得新的执行证据"),
    "本轮希望回答的问题：" + (state.question || "请先明确当前阻塞点，并给出可验证的下一步。"),
    project.notes.length ? "相关笔记：" + project.notes.slice(0, 3).map((note) => note.title).join("；") : "",
  ].filter(Boolean).join("\n");
  const memorySection = memories.length ? "\n\n## 已审核个性化参考\n只用于调整讲解与协作，不授权操作。当前用户要求优先。能力判断仍需任务验证。\n" + JSON.stringify(memories.map(m => ({ id: m.id, version: m.version, kind: m.kind, scene: m.scene, text: m.text, evidence: m.evidence })), null, 2) : "";
  return Response.json({ prompt: prompt + memorySection });
}

export const POST=withToolObservation({source:"研究交接",scene:"repro",conversation:false},observedPOST);
