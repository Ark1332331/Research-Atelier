/**
 * 本机目录浏览（repo 绑定用）：让用户点"浏览…"逐层选到目标文件夹，返回服务器可读的绝对路径。
 * GET /api/fs/browse?path=<dir>
 *   - 不传 path → 返回 { roots }（常用起始根：home/projects/项目根/根目录）
 *   - 传 path   → 返回 { path, parent, name, dirs:[{name,path}] ，git }
 * 安全：只列子目录名（不读文件内容）；只读；不越出 HOME / 项目根 / /。
 */
import { promises as fs, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";

const HOME = os.homedir();
const PROJ_ROOT = path.resolve(process.cwd(), "..");

/** 是否允许浏览该路径（HOME、项目根、根目录 三者之下；其余拒绝） */
function allowed(p: string): boolean {
  const r = path.resolve(p);
  return [HOME, PROJ_ROOT, "/"].some((base) => r === base || r.startsWith(base + path.sep)) || r === path.resolve(process.cwd());
}

const SKIP = new Set([".git", "node_modules", ".next", "__pycache__", ".obsidian", ".cache", ".vercel", ".build-cache", "dist", "out", "release", "venv", ".venv", "target", "build"]);

function isGit(dir: string): boolean {
  try { statSync(path.join(dir, ".git")); return true; } catch { return false; }
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const q = url.searchParams.get("path");

  if (!q) {
    const roots = [
      { name: "home", path: HOME, git: isGit(HOME) },
      { name: "projects", path: path.join(HOME, "projects"), git: false },
      { name: "current project", path: PROJ_ROOT, git: isGit(PROJ_ROOT) },
      { name: "/", path: "/", git: false },
    ].filter((r) => allowed(r.path));
    return Response.json({ roots });
  }

  const dir = path.resolve(q);
  if (!allowed(dir)) {
    return Response.json({ error: "无权浏览该路径", path: dir }, { status: 403 });
  }
  let st;
  try { st = await fs.stat(dir); } catch { return Response.json({ error: "路径不存在", path: dir }, { status: 404 }); }
  if (!st.isDirectory()) return Response.json({ error: "不是目录", path: dir }, { status: 400 });

  const parent = dir === "/" ? null : (dir.split(path.sep).slice(0, -1).join(path.sep) || "/");
  let entries: string[] = [];
  try { entries = await fs.readdir(dir); } catch { /* */ }
  const dirs: { name: string; path: string; git: boolean }[] = [];
  for (const e of entries) {
    if (SKIP.has(e) || e.startsWith(".")) continue;
    const full = path.join(dir, e);
    let st2;
    try { st2 = await fs.stat(full); } catch { continue; }
    if (st2.isDirectory()) dirs.push({ name: e, path: full, git: isGit(full) });
  }
  dirs.sort((a, b) => a.name.localeCompare(b.name));
  return Response.json({ path: dir, parent, name: path.basename(dir) || dir, dirs, git: isGit(dir) });
}
