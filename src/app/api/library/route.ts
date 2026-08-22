/**
 * 论文库接口（总览「论文库」的真相源）
 * GET  /api/library            → { groups, papers }
 * POST /api/library            → 一个动作（见下）；全部返回最新 { groups, papers }
 *   动作：
 *     { action:"createGroup", name }                 → 新建分组
 *     { action:"renameGroup", id, name }             → 重命名分组
 *     { action:"deleteGroup", id }                   → 删除分组（其下论文移入 null = 未分组）
 *     { action:"addPaper", paper:{title,...}, group }→ 新增论文（手动加入 / 从导入列表选中）
 *     { action:"updatePaper", id, patch }            → 改任意字段（title/status/tags/group/…）
 *     { action:"setCurrent", id|null }               → 设为「当前在读」（同一时刻只有一篇）
 *     { action:"deletePaper", id }                   → 删除论文（只删库内记录，不删导入的 PDF 文件）
 * 存储：本地 data/library.json；生产（Vercel）自动切 KV（见 src/lib/store.ts）
 * 依据：node_modules/next/dist/docs/01-app/01-getting-started/15-route-handlers.md
 */
import { readStore, writeStore } from "@/lib/store";

const FILE = "library.json";

export interface LibraryGroup {
  id: string;
  name: string;
}

export interface LibraryPaper {
  id: string;
  title: string;
  authors?: string;
  venue?: string;
  year?: string;
  status?: string;
  statusColor?: string;
  tags?: string[];
  group: string | null;
  current?: boolean;
  source?: "builtin" | "imported";
  slug?: string | null;
  firstEncounter?: string;
  lastEngaged?: string;
}

interface Library {
  groups: LibraryGroup[];
  papers: LibraryPaper[];
}

async function readLibrary(): Promise<Library> {
  try {
    const raw = await readStore(FILE);
    if (!raw) return { groups: [], papers: [] };
    const data = JSON.parse(raw);
    return {
      groups: Array.isArray(data.groups) ? data.groups : [],
      papers: Array.isArray(data.papers) ? data.papers : [],
    };
  } catch {
    return { groups: [], papers: [] };
  }
}

async function writeLibrary(lib: Library): Promise<void> {
  await writeStore(FILE, JSON.stringify(lib, null, 2));
}

function idFor(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}${Math.floor(Math.random() * 1000).toString(36)}`;
}

export async function GET() {
  const lib = await readLibrary();
  return Response.json(lib);
}

export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "请求体必须是 JSON" }, { status: 400 });
  }

  const lib = await readLibrary();
  const action = body.action as string | undefined;

  switch (action) {
    case "createGroup": {
      const name = String(body.name ?? "").trim();
      if (!name) return Response.json({ error: "name 必填" }, { status: 400 });
      lib.groups.push({ id: idFor("g"), name });
      break;
    }

    case "renameGroup": {
      const g = lib.groups.find((x) => x.id === body.id);
      if (!g) return Response.json({ error: "分组不存在" }, { status: 404 });
      g.name = String(body.name ?? "").trim() || g.name;
      break;
    }

    case "deleteGroup": {
      const id = body.id as string;
      lib.groups = lib.groups.filter((x) => x.id !== id);
      lib.papers.forEach((p) => { if (p.group === id) p.group = null; });
      break;
    }

    case "addPaper": {
      const raw = (body.paper ?? {}) as Partial<LibraryPaper>;
      if (!raw.title || typeof raw.title !== "string") {
        return Response.json({ error: "paper.title 必填" }, { status: 400 });
      }
      const paper: LibraryPaper = {
        id: idFor("p"),
        title: raw.title,
        authors: raw.authors ?? "",
        venue: raw.venue ?? "",
        year: raw.year ?? "",
        status: raw.status ?? "未读",
        tags: Array.isArray(raw.tags) ? raw.tags : [],
        group: (body.group as string) ?? null,
        current: false,
        source: raw.source ?? "imported",
        slug: raw.slug ?? null,
        firstEncounter: raw.firstEncounter ?? new Date().toISOString().slice(0, 10),
        lastEngaged: raw.lastEngaged ?? "",
      };
      lib.papers.push(paper);
      break;
    }

    case "updatePaper": {
      const id = body.id as string;
      const patch = (body.patch ?? {}) as Partial<LibraryPaper>;
      const p = lib.papers.find((x) => x.id === id);
      if (!p) return Response.json({ error: "论文不存在" }, { status: 404 });
      Object.assign(p, patch);
      if (patch.statusColor !== undefined && !patch.statusColor) p.statusColor = undefined;
      break;
    }

    case "setCurrent": {
      const id = body.id as string | null;
      lib.papers.forEach((p) => { p.current = p.id === id; });
      break;
    }

    case "deletePaper": {
      const id = body.id as string;
      lib.papers = lib.papers.filter((x) => x.id !== id);
      // 若删的是当前在读，则清空当前标记
      if (!lib.papers.some((p) => p.current)) lib.papers.forEach((p) => { p.current = false; });
      break;
    }

    default:
      return Response.json({ error: `未知 action：${action}` }, { status: 400 });
  }

  await writeLibrary(lib);
  return Response.json(lib);
}
