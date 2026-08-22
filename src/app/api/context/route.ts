/**
 * 上下文接口：工具对话的自动上下文（代码导读→复现状态；环境→环境卡+指导者提醒）
 * GET /api/context?kind=repro|environment → { kind, content }
 * 存储：本地 data/，生产（Vercel）自动切 KV（见 src/lib/store.ts）
 * 依据：node_modules/next/dist/docs/01-app/01-getting-started/15-route-handlers.md
 */
import { readStore } from "@/lib/store";

const KINDS: Record<string, string> = {
  repro: "repro-context.md",
  environment: "environment.md",
};

export async function GET(request: Request) {
  const url = new URL(request.url);
  const kind = url.searchParams.get("kind") ?? "repro";
  const file = KINDS[kind];
  if (!file) return Response.json({ error: `未知 kind：${kind}` }, { status: 400 });
  const content = (await readStore(file)) ?? "";
  return Response.json({ kind, content });
}
