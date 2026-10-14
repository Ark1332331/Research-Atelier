import { listNotes, removeNote, saveNote } from "@/lib/notes";
export async function GET(request: Request) {
  const projectId = new URL(request.url).searchParams.get("projectId");
  if (!projectId) return Response.json({ error: "projectId 必填" }, { status: 400 });
  const notes = await listNotes(projectId);
  return notes ? Response.json({ notes }) : Response.json({ error: "项目不存在" }, { status: 404 });
}
export async function POST(request: Request) {
  let body: Record<string, unknown>; try { body = await request.json(); } catch { return Response.json({ error: "请求体必须是 JSON" }, { status: 400 }); }
  const projectId = String(body.projectId ?? ""); if (!projectId) return Response.json({ error: "projectId 必填" }, { status: 400 });
  if (body.action === "delete") return (await removeNote(projectId, String(body.id ?? ""))) ? Response.json({ ok: true }) : Response.json({ error: "笔记不存在" }, { status: 404 });
  if (body.action === "save") {
    const note = await saveNote(projectId, {
      id: typeof body.id === "string" ? body.id : undefined, title: String(body.title ?? ""), content: String(body.content ?? ""),
      tags: Array.isArray(body.tags) ? body.tags.map(String) : [], pinned: Boolean(body.pinned), source: typeof body.source === "string" ? body.source : undefined,
    });
    return note ? Response.json({ note }) : Response.json({ error: "项目不存在" }, { status: 404 });
  }
  return Response.json({ error: "未知 action" }, { status: 400 });
}
