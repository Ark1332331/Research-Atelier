/**
 * 术语卡数据接口（记忆层第一步：应用读写 glossary）
 * GET  /api/terms            → { terms: Term[] }
 * POST /api/terms            → upsert 一张卡 { term } / 删除 { deleteId }
 * 存储：本地 data/glossary.json；生产（Vercel）自动切 KV（见 src/lib/store.ts）
 * 依据：node_modules/next/dist/docs/01-app/01-getting-started/15-route-handlers.md
 */
import { readStore, writeStore } from "@/lib/store";

const FILE = "glossary.json";

export interface Term {
  id: string;
  name: string;        // 英文主名 / 中文旁注
  role: string;        // 角色归类（9 类小词表）
  status: string;      // 未接触 / 有直觉 / 能解释 / 能对应论文 / 能实现
  reuse: string;       // 通用 / 论文特有 / 论文内特殊含义
  note: string;        // 当前先理解为
  source: string;      // 来源（论文短名+节）
  links: string;       // 关联术语
  updatedAt: string;
}

// 仅本 route 内部参考（不导出——Next 不允许 route 文件导出非 handler 成员）
const ROLE_OPTIONS = [
  "感知/传感器", "状态估计/对齐", "场景表示/建图", "补全/学习机制",
  "控制/决策", "训练机制", "评估指标", "工程/部署", "领域背景",
];

const STATUS_OPTIONS = ["未接触", "有直觉", "能解释", "能对应论文", "能实现"];

const REUSE_OPTIONS = ["通用", "论文特有", "论文内特殊含义"];

async function readTerms(): Promise<Term[]> {
  try {
    const raw = await readStore(FILE);
    if (!raw) return [];
    const data = JSON.parse(raw);
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

async function writeTerms(terms: Term[]): Promise<void> {
  await writeStore(FILE, JSON.stringify(terms, null, 2));
}

export async function GET() {
  const terms = await readTerms();
  return Response.json({ terms });
}

export async function POST(request: Request) {
  let body: { term?: Partial<Term>; deleteId?: string };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "请求体必须是 JSON" }, { status: 400 });
  }

  const terms = await readTerms();

  // 删除分支
  if (body.deleteId) {
    const idx = terms.findIndex((t) => t.id === body.deleteId);
    if (idx < 0) return Response.json({ error: "术语不存在" }, { status: 404 });
    terms.splice(idx, 1);
    await writeTerms(terms);
    return Response.json({ terms });
  }

  const input = body.term;
  if (!input || !input.name || typeof input.name !== "string") {
    return Response.json({ error: "term.name 必填" }, { status: 400 });
  }
  const now = new Date().toISOString();
  let saved: Term;
  if (input.id) {
    const idx = terms.findIndex((t) => t.id === input.id);
    if (idx < 0) return Response.json({ error: "术语不存在" }, { status: 404 });
    saved = { ...terms[idx], ...input, updatedAt: now } as Term;
    terms[idx] = saved;
  } else {
    saved = {
      id: `t${Date.now().toString(36)}`,
      name: input.name,
      role: input.role ?? "领域背景",
      status: input.status ?? "未接触",
      reuse: input.reuse ?? "通用",
      note: input.note ?? "",
      source: input.source ?? "",
      links: input.links ?? "",
      updatedAt: now,
    };
    terms.push(saved);
  }
  await writeTerms(terms);
  return Response.json({ terms, saved });
}
