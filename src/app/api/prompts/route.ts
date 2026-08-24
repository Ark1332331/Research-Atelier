/**
 * 工具提示词接口：允许用户在前端自定义/重置各工具的底层系统提示词。
 * 存储：data/prompts.json —— { [toolKey]: { prompt, updatedAt } }
 *
 * GET  ?tool=p0       → { tool, default, custom, updatedAt }（default 来自 TOOLS；custom 为用户自定义，无则 null）
 * POST { tool, prompt }            → 保存自定义；返回 { ok, tool, custom }
 * POST { tool, action:"reset" }    → 恢复默认（删除自定义）；返回 { ok, tool, custom:null }
 *
 * 数据层复用 src/lib/store.ts（本地 data/；生产（Vercel）自动切 KV）。
 */
import { readStore, writeStore } from "@/lib/store";
import { TOOLS } from "@/lib/data";

const FILE = "prompts.json";
type Store = Record<string, { prompt: string; updatedAt: string }>;

async function readStore2(): Promise<Store> {
  const raw = await readStore(FILE);
  if (raw) {
    try {
      const d = JSON.parse(raw);
      return d && typeof d === "object" ? (d as Store) : {};
    } catch { /* 忽略坏数据 */ }
  }
  return {};
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const tool = url.searchParams.get("tool");
  if (!tool) return Response.json({ error: "tool 必填" }, { status: 400 });
  const def = TOOLS[tool]?.prompt;
  if (def === undefined) return Response.json({ error: `未知 tool：${tool}` }, { status: 404 });

  const store = await readStore2();
  const entry = store[tool];
  return Response.json({ tool, default: def, custom: entry?.prompt ?? null, updatedAt: entry?.updatedAt ?? null });
}

export async function POST(request: Request) {
  let body: { tool?: string; prompt?: string; action?: string };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "请求体必须是 JSON" }, { status: 400 });
  }
  const tool = body.tool;
  if (!tool || TOOLS[tool]?.prompt === undefined) {
    return Response.json({ error: `未知 tool：${tool}` }, { status: 400 });
  }

  const store = await readStore2();

  if (body.action === "reset") {
    delete store[tool];
    await writeStore(FILE, JSON.stringify(store, null, 2));
    return Response.json({ ok: true, tool, custom: null });
  }

  if (typeof body.prompt !== "string") {
    return Response.json({ error: "缺少 prompt" }, { status: 400 });
  }
  store[tool] = { prompt: body.prompt, updatedAt: new Date().toISOString() };
  await writeStore(FILE, JSON.stringify(store, null, 2));
  return Response.json({ ok: true, tool, custom: body.prompt, updatedAt: store[tool].updatedAt });
}
