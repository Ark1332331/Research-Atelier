/**
 * 记忆层接口（自包含：一切数据落 Markdown；本地 data/，生产（Vercel）自动切 KV——见 src/lib/store.ts）
 * GET  /api/memory?kind=<profile|environment|handoff|screening> → { content }
 * POST /api/memory { kind, content } → 写；screening/handoff 为追加（每次一节），其余覆盖
 * 文件：data/profile.md（知识水平）/ data/environment.md（环境卡）
 *       data/handoffs.md（交接词）/ data/notes/screening.md（筛选笔记）
 * 依据：node_modules/next/dist/docs/01-app/01-getting-started/15-route-handlers.md
 */
import { appendStore, readStore, writeStore } from "@/lib/store";

const KINDS: Record<string, { file: string; append?: boolean }> = {
  profile: { file: "profile.md" },
  environment: { file: "environment.md" },
  handoff: { file: "handoffs.md", append: true },
  screening: { file: "notes/screening.md", append: true },
};

export async function GET(request: Request) {
  const url = new URL(request.url);
  const kind = url.searchParams.get("kind") ?? "profile";
  const spec = KINDS[kind];
  if (!spec) return Response.json({ error: `未知 kind：${kind}` }, { status: 400 });
  const content = (await readStore(spec.file)) ?? "";
  return Response.json({ kind, content });
}

export async function POST(request: Request) {
  let body: { kind?: string; content?: string };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "请求体必须是 JSON" }, { status: 400 });
  }
  const kind = body.kind ?? "profile";
  const content = body.content ?? "";
  const spec = KINDS[kind];
  if (!spec) return Response.json({ error: `未知 kind：${kind}` }, { status: 400 });

  if (spec.append) {
    await appendStore(spec.file, content);
  } else {
    await writeStore(spec.file, content);
  }
  return Response.json({ ok: true, kind });
}
