/**
 * 原生目录选择：服务器（本机 next dev）调用 zenity 弹出**系统文件选择对话框**，
 * 返回用户选中的绝对路径（repo 绑定用）。服务器与浏览器同机同屏，弹窗直接显示在用户屏幕上。
 * 桌面模式优先走 Electron 原生对话框（preload 桥）；Web 模式依赖 zenity，
 * 本机没有 zenity（如 Windows 裸环境）时返回 unsupported，前端提示改用桌面版或手输路径。
 *
 * POST /api/fs/pick { startDir? } → { path } 或 { canceled: true }
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import os from "node:os";
import path from "node:path";
import { statSync } from "node:fs";
import { which } from "@/lib/platform";

const execFileAsync = promisify(execFile);

export async function POST(request: Request) {
  let body: { startDir?: string };
  try { body = await request.json(); } catch { body = {}; }

  // 起始目录：默认 home；若给定且存在则用之
  let start = os.homedir();
  if (body.startDir) {
    try { if (statSync(body.startDir).isDirectory()) start = body.startDir; } catch { /* 忽略 */ }
  }

  if (!which("zenity")) {
    return Response.json({
      canceled: true,
      unsupported: true,
      message: "本机没有 zenity，无法弹出系统目录选择框。请使用桌面版（Electron 原生对话框）或直接输入路径。",
    });
  }

  const args = ["--file-selection", "--directory", "--title=选择代码仓库文件夹（复现绑定）", `--filename=${start}${path.sep}`];
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
