import { recordObservation, observationContext } from "@/lib/learning/observations";
import { readLearning, manageLearning, exportMarkdown } from "@/lib/learning/store";
import { selectMemories } from "@/lib/learning/core";
export const runtime = "nodejs";
export async function GET(request: Request) {
  try {
    const state = await readLearning(); const url = new URL(request.url);
    if (url.searchParams.get("export") === "markdown") return new Response(exportMarkdown(state), { headers: { "Content-Type": "text/markdown; charset=utf-8", "Content-Disposition": "attachment; filename=learning.md" } });
    if (url.searchParams.get("export") === "json") return new Response(JSON.stringify(state, null, 2), { headers: { "Content-Type": "application/json", "Content-Disposition": "attachment; filename=learning.json" } });
    if (url.searchParams.has("query")) {
      const scene = url.searchParams.get("scene") ?? "general";
      if (!["general", "code", "paper", "repro"].includes(scene)) return Response.json({ error: "场景无效" }, { status: 400 });
      return Response.json({ selected: selectMemories(state, url.searchParams.get("query") ?? "", scene as "general", url.searchParams.get("projectId")) });
    }
    return Response.json(state, { headers: { "Cache-Control": "no-store" } });
  } catch (e) { return Response.json({ error: e instanceof Error ? e.message : "读取失败" }, { status: 500 }); }
}
export async function POST(request: Request) {
  try {
    const body = await request.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("请求须为 JSON 对象");
    if (body.action === "analyze") {
      if (typeof body.text !== "string" || !["general", "code", "paper", "repro"].includes(body.scene)) throw new Error("反馈或场景无效");
      if(!body.text.trim()||body.text.length>20000)throw Error("反馈须为 1–20000 字符");
      const observation=await recordObservation({source:"学习反馈",scene:body.scene,projectId:typeof body.projectId === "string"?body.projectId:null,kind:"feedback",action:"补充学习方式",userText:body.text});
      return Response.json({state:await readLearning(),queued:true,observationId:observation.id});
    }
    const state=await manageLearning(body);
    if(body.action==="feedback"&&body.helpful===false&&typeof body.note==="string"&&body.note.trim()){const run=state.runs.find(r=>r.id===body.runId);if(run)await recordObservation({source:"回答反馈",scene:run.scene,projectId:run.projectId,kind:"feedback",action:"换个讲法",userText:body.note,context:observationContext([{role:"user",content:run.query},{role:"assistant",content:run.answer}])});}
    return Response.json(await readLearning());
  }
  catch (e) { const error = e instanceof Error ? e.message : "请求失败"; return Response.json({ error }, { status: error.includes("其他窗口") ? 409 : 400 }); }
}
