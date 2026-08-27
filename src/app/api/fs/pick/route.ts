/**
 * 原生目录选择：服务器（本机 next dev）调用 zenity 弹出**系统文件选择对话框**，
 * 返回用户选中的绝对路径（repo 绑定用）。服务器与浏览器同机同屏，弹窗直接显示在用户屏幕上。
 *
 * POST /api/fs/pick { startDir? } → { path } 或 { canceled: true }
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import os from "node:os";
import path from "node:path";
import { statSync } from "node:fs";

const execFileAsync = promisify(execFile);

export async function POST(request: Request) {
  let body: { startDir?: string };
  try { body = await request.json(); } catch { body = {}; }

  // 起始目录：默认 home；若给定且存在则用之
  let start = os.homedir();
  if (body.startDir) {
    try { if (statSync(body.startDir).isDirectory()) start = body.startDir; } catch { /* 忽略 */ }
  }

  const args = ["--file-selection", "--directory", "--title=选择代码仓库文件夹（复现绑定）", `--filename=${start}/`];
  try {
    // zenity --file-selection --directory：弹系统目录选择对话框；取消时 stdout 空 + exit code 1
    const { stdout } = await execFileAsync("zenity", args, { timeout: 120000 });
    const p = stdout.trim();
    if (!p) return Response.json({ canceled: true });
    return Response.json({ path: path.resolve(p) });
  } catch {
    return Response.json({ canceled: true }); // 用户取消 / 无 DISPLAY / zenity 出错
  }
}
