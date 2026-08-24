/**
 * 会话历史接口：让「论文筛选 / 代码导读 / 环境」等工具对话自动留下历史记录，
 * 像研究侧栏一样可回看、可继续（不随刷新丢失）。
 *
 * 存储：data/session-history.json —— { [toolKeg]: Session[] }
 *   Session = { id, title, createdAt, updatedAt, msgs: [{role, content, time}] }
 *
 * GET  ?tool=p0                       → { sessions: [{id,title,createdAt,updatedAt,count}] }（列表，不含 msgs，按 updatedAt 倒序）
 * GET  ?tool=p0&id=xxx                → { session: {...} }（含完整 msgs）
 * POST { tool, action:"upsert", id?, title?, msgs } → 无 id 创建、有 id 更新；返回 { id, sessions }
 * POST { tool, action:"delete", id }  → 删除；返回 { ok, sessions }
 *
 * 依据：node_modules/next/dist/docs/01-app/01-getting-started/15-route-handlers.md
 * 数据层复用 src/lib/store.ts（本地 data/；生产（Vercel）自动切 KV）。
 */
import { readStore, writeStore } from "@/lib/store";

const FILE = "session-history.json";

interface SMsg { role: "user" | "assistant"; content: string; time: string }
interface SSession { id: string; title: string; createdAt: string; updatedAt: string; msgs: SMsg[] }
type Store = Record<string, SSession[]>;

async function readData(): Promise<Store> {
  const raw = await readStore(FILE);
  if (raw) {
    try {
      const d = JSON.parse(raw);
      return d && typeof d === "object" ? (d as Store) : {};
    } catch { /* 忽略坏数据 */ }
  }
  return {};
}

async function writeData(d: Store): Promise<void> {
  await writeStore(FILE, JSON.stringify(d, null, 2));
}

/** 列表摘要：去掉 msgs，只留标题/时间/条数 */
function summarize(arr: SSession[]) {
  return [...arr]
    .sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""))
    .map((s) => ({
      id: s.id,
      title: s.title,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
      count: Array.isArray(s.msgs) ? s.msgs.length : 0,
    }));
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const tool = url.searchParams.get("tool");
  if (!tool) return Response.json({ error: "tool 必填" }, { status: 400 });

  const data = await readData();
  const arr = data[tool] ?? [];

  const id = url.searchParams.get("id");
  if (id) {
    const s = arr.find((x) => x.id === id);
    if (!s) return Response.json({ error: "会话不存在" }, { status: 404 });
    return Response.json({ session: s });
  }
  return Response.json({ sessions: summarize(arr) });
}

export async function POST(request: Request) {
  let body: { tool?: string; action?: string; id?: string; title?: string; msgs?: SMsg[] };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "请求体必须是 JSON" }, { status: 400 });
  }
  const tool = body.tool;
  if (!tool) return Response.json({ error: "tool 必填" }, { status: 400 });

  const data = await readData();
  const arr = data[tool] ?? (data[tool] = []);
  const now = new Date().toISOString();

  if (body.action === "upsert") {
    const msgs = Array.isArray(body.msgs)
      ? body.msgs
          .filter((m) => m && m.role && typeof m.content === "string")
          .map((m) => ({ role: m.role, content: m.content, time: m.time || "" }))
      : [];
    if (msgs.length === 0) return Response.json({ error: "msgs 不能为空" }, { status: 400 });

    let sid = body.id;
    if (sid) {
      const s = arr.find((x) => x.id === sid);
      if (s) {
        s.msgs = msgs;
        s.updatedAt = now;
      } else {
        sid = undefined; // 引用已不存在的会话 → 当作新建
      }
    }
    if (!sid) {
      sid = `${tool.slice(0, 2)}-${Date.now().toString(36)}${Math.floor(Math.random() * 1000).toString(36)}`;
      const firstUser = msgs.find((m) => m.role === "user");
      arr.push({
        id: sid,
        title: (body.title || firstUser?.content || "新对话").slice(0, 50),
        createdAt: now,
        updatedAt: now,
        msgs,
      });
    }
    await writeData(data);
    return Response.json({ id: sid, sessions: summarize(arr) });
  }

  if (body.action === "delete") {
    const i = arr.findIndex((x) => x.id === body.id);
    if (i >= 0) {
      arr.splice(i, 1);
      await writeData(data);
    }
    return Response.json({ ok: true, sessions: summarize(arr) });
  }

  return Response.json({ error: `未知 action：${body.action}` }, { status: 400 });
}
