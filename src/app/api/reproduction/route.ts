/**
 * 复现工作台接口
 * GET  /api/reproduction            → { records: [...] }（摘要列表）
 * GET  /api/reproduction?slug=x     → { record }
 * POST 动作（{ action, ... }）：
 *   create {slug,title}                    建复现记录
 *   update {slug, patch}                   改 title/note（patch）
 *   setSource {slug, sourceUrl} / setRepo {slug, repoUrl}   设源码地址 / 仓库地址
 *   setTitle {slug, title}
 *   addStep {slug, title, note?}           加一步（复现路径）
 *   updateStep {slug, id, patch}           改一步
 *   setStepStatus {slug, id, status}       勾状态 todo|doing|done
 *   deleteStep {slug, id}                  删一步
 *   addPitfall {slug, text, env, stage?}   记一个坑点（env=true 归环境）
 *   deletePitfall {slug, id}
 *   delete {slug}                          删整篇
 * 数据：data/reproduction.json（见 src/lib/reproduction.ts）
 */
import { listReproductions, getReproduction, upsertReproduction, deleteReproduction, idFor, isDefinitionComplete, type Reproduction, type ReproductionStep } from "@/lib/reproduction";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const slug = url.searchParams.get("slug");
  if (slug) {
    const record = await getReproduction(slug);
    if (!record) return Response.json({ error: "记录不存在" }, { status: 404 });
    return Response.json({ record });
  }
  const records = await listReproductions();
  return Response.json({ records });
}

export async function POST(request: Request) {
  let body: Record<string, any>;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "请求体必须是 JSON" }, { status: 400 });
  }
  const action = body.action as string | undefined;
  const slug = body.slug as string | undefined;

  if (action === "create") {
    if (!slug || !body.title) return Response.json({ error: "slug/title 必填" }, { status: 400 });
    const existing = await getReproduction(slug);
    if (existing) return Response.json({ record: existing });
    await upsertReproduction({ slug, title: String(body.title), path: [], pitfalls: [], createdAt: new Date().toISOString() });
    return Response.json({ record: await getReproduction(slug) });
  }

  if (!slug) return Response.json({ error: "slug 必填" }, { status: 400 });
  const r = await getReproduction(slug);
  if (!r) return Response.json({ error: "记录不存在" }, { status: 404 });
  const now = new Date().toISOString();

  switch (action) {
    case "update": {
      if (typeof body.patch?.title === "string") r.title = body.patch.title;
      if (typeof body.patch?.note === "string") r.note = body.patch.note;
      break;
    }
    case "setTitle": { if (typeof body.title === "string") r.title = body.title; break; }
    case "setSource": { if (typeof body.sourceUrl === "string") r.sourceUrl = body.sourceUrl; break; }
    case "setRepo": { if (typeof body.repoUrl === "string") r.repoUrl = body.repoUrl; break; }
    case "setNote": { if (typeof body.note === "string") r.note = body.note; break; }
    case "setGoalIntent": {
      if (["run_first", "main_result", "figure", "full", "unknown"].includes(body.goalIntent)) r.goalIntent = body.goalIntent;
      break;
    }
    case "bindArtifacts": {
      // Analysis Binding Gate：显式绑定论文（data/papers/<paperId>）与仓库（code-roots rootId）
      if (body.paperId) r.paperArtifact = { paperId: String(body.paperId), parsedPages: 0 };
      if (body.repoRootId && body.repoPath) r.repoArtifact = { repoRootId: String(body.repoRootId), repoPath: String(body.repoPath) };
      break;
    }
    case "setDefinition": {
      // 原子式一次写入 target/constraints/acceptance（对应 UI 的「保存目标与验收」单动作）
      if (body.target && typeof body.target === "object") r.target = body.target;
      if (body.constraints && typeof body.constraints === "object") r.constraints = body.constraints;
      if (body.acceptance && typeof body.acceptance === "object") r.acceptance = body.acceptance;
      break;
    }
    case "setTarget": {
      if (body.target && typeof body.target === "object") r.target = body.target;
      else if (body.target === null) r.target = undefined;
      break;
    }
    case "setConstraints": {
      if (body.constraints && typeof body.constraints === "object") r.constraints = body.constraints;
      break;
    }
    case "setAcceptance": {
      if (body.acceptance && typeof body.acceptance === "object") r.acceptance = body.acceptance;
      break;
    }
    case "addStep": {
      // 业务门控：未完成「你想复现什么」前禁止拆路径（与 UI 门控同一 helper）
      if (!isDefinitionComplete(r)) {
        return Response.json({ error: "先完成“你想复现什么”（目标 + 约束 + 验收），再添加复现步骤。" }, { status: 400 });
      }
      const status = ["todo", "doing", "done"].includes(body.status) ? body.status : "todo";
      r.path.push({ id: idFor("st"), title: String(body.title ?? "未命名步骤"), status, note: body.note ?? "" });
      break;
    }
    case "updateStep": {
      const st = r.path.find((x) => x.id === body.id);
      if (st && typeof body.patch?.title === "string") st.title = body.patch.title;
      if (st && typeof body.patch?.note === "string") st.note = body.patch.note;
      break;
    }
    case "setStepStatus": {
      const st = r.path.find((x) => x.id === body.id);
      if (st && ["todo", "doing", "done"].includes(body.status)) st.status = body.status;
      break;
    }
    case "deleteStep": { r.path = r.path.filter((x) => x.id !== body.id); break; }
    case "addPitfall": {
      if (!body.text) return Response.json({ error: "text 必填" }, { status: 400 });
      r.pitfalls.push({
        id: idFor("pf"),
        text: String(body.text),
        env: Boolean(body.env),
        stage: body.stage ? String(body.stage) : undefined,
        papers: Array.isArray(body.papers) ? body.papers.map(String) : [slug],
        threads: Array.isArray(body.threads) ? body.threads.map(String) : undefined,
        createdAt: now,
      });
      break;
    }
    case "deletePitfall": { r.pitfalls = r.pitfalls.filter((x) => x.id !== body.id); break; }
    case "delete": { await deleteReproduction(slug); return Response.json({ ok: true }); }
    default: return Response.json({ error: `未知 action：${action}` }, { status: 400 });
  }

  await upsertReproduction(r);
  return Response.json({ record: r });
}
