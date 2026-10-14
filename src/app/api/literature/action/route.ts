import { withToolObservation } from "@/lib/learning/tool-observation";
import { handleAction } from "@/lib/search/literature-api";

async function observedPOST(request: Request) {
  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return Response.json({ error: "请求体必须是 JSON" }, { status: 400 }); }
  return handleAction(body);
}


export const POST=withToolObservation({source:"文献筛选决策",scene:"paper",conversation:false},observedPOST);
