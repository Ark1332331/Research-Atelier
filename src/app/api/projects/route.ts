import { withToolObservation } from "@/lib/learning/tool-observation";
import { promises as fs } from "node:fs";
import path from "node:path";
import { RA_AGENTS_SECTION, RA_AGENTS_MARKER_START } from "@/lib/agents-template";
import { assignProjectGroup, createProjectGroup, getProject, listProjectGroups, listProjects, updateProject, type ProjectModule, type PaperProject } from "@/lib/project";
import { paperDirectory, removePaperProject, renamePaper, reconcilePaperProjects } from "@/lib/paper-management";

async function withPdfStatus(project: PaperProject) {
  const pdfAvailable = !!project.paperSlug && await fs.stat(path.join(paperDirectory(project.paperSlug), 'original.pdf')).then(s => s.isFile()).catch(() => false);
  return { ...project, pdfAvailable };
}

export async function GET(request: Request) {
  try {
  const id = new URL(request.url).searchParams.get("id");
  if (id) {
    const project = await getProject(id);
    return project ? Response.json({ project: await withPdfStatus(project) }) : Response.json({ error: "论文项目已删除或不存在，请返回论文库" }, { status: 404 });
  }
  await reconcilePaperProjects();
  return Response.json({ projects: await Promise.all((await listProjects()).map(withPdfStatus)), groups: await listProjectGroups() });
  } catch(error) { return Response.json({error:error instanceof Error?error.message:'论文库读取失败，请重试'},{status:500}); }
}

function validModule(value: unknown): value is ProjectModule {
  return value === "pdf" || value === "repro" || value === "notes" || value === "environment";
}

async function observedPOST(request: Request) {
  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return Response.json({ error: "请求体必须是 JSON" }, { status: 400 }); }
  const action = String(body.action ?? "");
  if (action === "create") {
    return Response.json({ error: "请导入 PDF 创建论文项目" }, { status: 400 });
  }
  if (action === "createGroup") {
    try { return Response.json({ groups: await createProjectGroup(String(body.name ?? "")) }); }
    catch (error) { return Response.json({ error: error instanceof Error ? error.message : "无法新建分组" }, { status: 400 }); }
  }
  const id = String(body.id ?? "");
  if (!id) return Response.json({ error: "id 必填" }, { status: 400 });
  if (action === "delete" || action === "rename") {
    try {
      if (action === "delete") return (await removePaperProject(id)) ? Response.json({ ok: true }) : Response.json({ error: "项目不存在" }, { status: 404 });
      const project = await getProject(id);
      if (!project) return Response.json({ error: "项目不存在" }, { status: 404 });
      if (project.paperSlug) await renamePaper(project.paperSlug, body.title);
      else {
        if (typeof body.title !== 'string' || !body.title.trim() || body.title.trim().length > 200) return Response.json({ error: "名称须为 1–200 个字符" }, { status: 400 });
        await updateProject(id, p => { p.title = (body.title as string).trim(); });
      }
      return Response.json({ project: await getProject(id) });
    } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "操作失败" }, { status: 400 }); }
  }
  if (action === "setLastModule") {
    if (!validModule(body.module)) return Response.json({ error: "无效模块" }, { status: 400 });
    const project = await updateProject(id, (item) => { item.lastModule = body.module as ProjectModule; });
    return project ? Response.json({ project }) : Response.json({ error: "项目不存在" }, { status: 404 });
  }
  if (action === "setGroup") {
    const group = String(body.group ?? "").trim().slice(0, 60);
    const project = await assignProjectGroup(id, group);
    return project ? Response.json({ project }) : Response.json({ error: "项目不存在" }, { status: 404 });
  }
  if (action === "setWorkspace") {
    const repoPath = String(body.repoPath ?? "").trim();
    if (!path.isAbsolute(repoPath)) return Response.json({ error: "代码目录必须是绝对路径" }, { status: 400 });
    try { if (!(await fs.stat(repoPath)).isDirectory()) throw new Error("not a directory"); } catch { return Response.json({ error: "代码目录不存在或不可读" }, { status: 404 }); }
    const project = await updateProject(id, (item) => { item.workspace = { repoPath, repoRootId: typeof body.repoRootId === "string" ? body.repoRootId : undefined }; });
    return project ? Response.json({ project }) : Response.json({ error: "项目不存在" }, { status: 404 });
  }
  if (action === "agentsStatus" || action === "appendAgents") {
    const project = await getProject(id);
    if (!project?.workspace?.repoPath) return Response.json({ error: "请先关联项目代码目录" }, { status: 400 });
    const target = path.join(project.workspace.repoPath, "AGENTS.md");
    const existing = await fs.readFile(target, "utf-8").catch(() => null);
    const managed = Boolean(existing?.includes(RA_AGENTS_MARKER_START));
    if (action === "appendAgents" && !managed) {
      await fs.writeFile(target, existing ? existing.trimEnd() + "\\n\\n" + RA_AGENTS_SECTION + "\\n" : RA_AGENTS_SECTION + "\\n", "utf-8");
      return Response.json({ ok: true, action: existing ? "appended" : "created" });
    }
    return Response.json({ exists: existing !== null, managed, needsAppend: existing !== null && !managed });
  }
  return Response.json({ error: "未知 action" }, { status: 400 });
}

export const POST=withToolObservation({source:"项目管理",scene:"general",conversation:false},observedPOST);
