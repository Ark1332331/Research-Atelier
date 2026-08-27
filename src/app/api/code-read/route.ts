/**
 * 代码读取接口：代码导读的取件层（Step 3 起走共享层 code-reader.ts）
 * GET  /api/code-read?root=<配置里的根别名>                  → { available, roots, currentRoot, files:[{name,path,lines}] }
 * GET  /api/code-read?root=<别名>&file=<相对路径>             → { name, content, lines, ... }
 * GET  /api/code-read?root=<别名>&file=<p>&chain=1            → 同上，且 Python 文件附带跨文件调用链
 * 说明：
 *   - 根目录列表来自 data/code-roots.json（服务器端声明允许读的目录，防任意盘漫游）；默认项目根。
 *   - 允许规则（扩展名/basename/模式）与跳过规则（大小/secret/目录）由 code-reader.ts 统一提供。
 *   - chain 仅对 Python 生效（调 scripts/py_chain.py 基于 AST 精确解析）；TS/React 返回空。
 * 依据：node_modules/next/dist/docs/01-app/01-getting-started/15-route-handlers.md
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { readStore } from "@/lib/store";
import { isAllowedFile, checkReadable, scanTree } from "@/lib/code-reader";

interface RootConfig { id: string; name: string; root: string }

async function readRoots(): Promise<RootConfig[]> {
  const raw = await readStore("code-roots.json");
  if (raw) {
    try { const d = JSON.parse(raw); return Array.isArray(d.roots) ? d.roots : []; } catch { /* */ }
  }
  const projectRoot = process.env.RA_DEFAULT_CODE_ROOT ?? path.resolve(process.cwd(), "..");
  return [{ id: "project", name: "项目根（allinone）", root: projectRoot }];
}

function safeResolve(root: string, rel: string): string | null {
  const r = path.resolve(root);
  const full = path.resolve(r, rel.replace(/^\/+/, ""));
  if (full === r) return null;
  if (!full.startsWith(r + path.sep)) return null;
  return full;
}

async function listDir(root: string): Promise<{ name: string; path: string; lines: number }[]> {
  const { files } = await scanTree(root);
  return files.map((f) => ({ name: path.basename(f.path), path: f.path, lines: f.lines }));
}

function pythonChain(absFullPath: string): Record<string, unknown> {
  const dir = path.dirname(absFullPath);
  const base = path.basename(absFullPath);
  const script = path.join(process.cwd(), "scripts", "py_chain.py");
  try {
    const stdout = execFileSync("python3", [script, dir, base], {
      cwd: process.cwd(), maxBuffer: 8 * 1024 * 1024, timeout: 8000, encoding: "utf-8",
    });
    const parsed = JSON.parse(stdout);
    return parsed && !parsed.error ? parsed : { available: false };
  } catch {
    return { available: false };
  }
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const rootId = url.searchParams.get("root") ?? "project";
  const rel = url.searchParams.get("file");

  const roots = await readRoots();
  const rootCfg = roots.find((r) => r.id === rootId) ?? roots[0];
  if (!rootCfg) return Response.json({ roots: [], currentRoot: null, files: [] });

  const root = rootCfg.root;
  try {
    const st = await fs.stat(root);
    if (!st.isDirectory()) throw new Error("not dir");
  } catch {
    return Response.json({ available: false, roots, currentRoot: rootCfg, error: "根目录不可读" });
  }

  if (!rel) {
    const files = await listDir(root);
    return Response.json({ available: true, roots, currentRoot: rootCfg, files });
  }

  const full = safeResolve(root, rel);
  if (!full || !isAllowedFile(path.basename(full))) {
    return Response.json({ error: "非法路径或扩展名" }, { status: 400 });
  }
  const ck = await checkReadable(full, rel);
  if (!ck.read) {
    return Response.json({ error: `文件被安全规则跳过（${ck.reason}）` }, { status: 403 });
  }
  let content: string;
  try {
    content = await fs.readFile(full, "utf-8");
  } catch {
    return Response.json({ error: "文件不存在或不可读" }, { status: 404 });
  }
  const lines = content.split("\n");

  const resp: Record<string, unknown> = {
    available: true, name: path.basename(full), path: rel, content, lines: lines.length,
  };

  if (url.searchParams.get("chain") === "1" && full.endsWith(".py")) {
    resp.chain = pythonChain(full);
  }

  return Response.json(resp);
}
