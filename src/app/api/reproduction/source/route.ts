/**
 * 网络调研论文/源码：复现工作台在添加论文/找源码地址时调用。
 * POST { query }              → { hits }（searchPapers 检索，含 landing/publisher/arxiv/oaPdf，供选来源）
 * POST { query, pick=索引 }    → 直接返回该 hit（方便"调研→填 sourceUrl"）
 */
import { searchPapers } from "@/lib/paper-tools";

export async function POST(request: Request) {
  let body: { query?: string; pick?: number };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "请求体必须是 JSON" }, { status: 400 });
  }
  const query = body.query?.trim();
  if (!query) return Response.json({ error: "query 必填" }, { status: 400 });
  try {
    const hits = await searchPapers(query, 8);
    if (typeof body.pick === "number" && hits[body.pick]) {
      const h = hits[body.pick];
      return Response.json({ hit: h });
    }
    return Response.json({ hits });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}
