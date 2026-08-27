import { handlePreview } from "@/lib/search/literature-api";

export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return Response.json({ error: "请求体必须是 JSON" }, { status: 400 }); }
  return handlePreview(body);
}

