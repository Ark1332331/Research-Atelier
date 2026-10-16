/**
 * 跨平台探测层：Windows / macOS / Linux 统一的本机命令与路径探测。
 * 所有环境探测（conda/python/sqlite3/GPU/OS 信息）必须经由本模块，
 * 各 API 路由不得再写死平台专属路径或命令名。
 */
import { execFileSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";

const IS_WIN = process.platform === "win32";

/** 在 PATH 上找一个可执行文件；找不到返回 null（Windows 用 where.exe，POSIX 用 which）。 */
export function which(bin: string): string | null {
  const lookup = IS_WIN ? "where" : "which";
  try {
    const out = execFileSync(lookup, [bin], { encoding: "utf-8", timeout: 5000 });
    const first = out.split(/\r?\n/)[0]?.trim();
    return first || null;
  } catch {
    return null;
  }
}

function firstExisting(candidates: string[]): string | null {
  for (const c of candidates) if (c && fs.existsSync(c)) return c;
  return null;
}

export interface PythonBin {
  /** 可执行文件（不含参数） */
  cmd: string;
  /** 附加参数（如 Windows py 启动器的 -3） */
  args: string[];
}

/** 系统 Python：Windows 依次试 python / py -3，POSIX 依次试 python3 / python。 */
export function resolvePython(): PythonBin | null {
  if (process.env.RA_PYTHON_BIN) return { cmd: process.env.RA_PYTHON_BIN, args: [] };
  const candidates: PythonBin[] = IS_WIN
    ? [{ cmd: "python", args: [] }, { cmd: "py", args: ["-3"] }, { cmd: "python3", args: [] }]
    : [{ cmd: "python3", args: [] }, { cmd: "python", args: [] }];
  for (const c of candidates) if (which(c.cmd)) return c;
  return null;
}

/** conda：PATH 优先，其次各平台标准安装路径。RA_CONDA_BIN 显式覆盖。 */
export function resolveConda(): string | null {
  if (process.env.RA_CONDA_BIN) return process.env.RA_CONDA_BIN;
  const onPath = which(IS_WIN ? "conda.exe" : "conda") ?? which("conda");
  if (onPath) return onPath;
  const home = os.homedir();
  const candidates = IS_WIN
    ? [
        path.join(home, "miniconda3", "Scripts", "conda.exe"),
        path.join(home, "anaconda3", "Scripts", "conda.exe"),
        path.join(process.env.LOCALAPPDATA ?? "", "miniconda3", "Scripts", "conda.exe"),
        path.join(process.env.PROGRAMDATA ?? "", "miniconda3", "Scripts", "conda.exe"),
      ]
    : [
        path.join(home, "miniconda3", "bin", "conda"),
        path.join(home, "anaconda3", "bin", "conda"),
        "/opt/conda/bin/conda",
        "/usr/local/bin/conda",
        "/usr/bin/conda",
      ];
  return firstExisting(candidates);
}

/** sqlite3：RA_SQLITE_BIN 覆盖 > PATH > conda 安装目录内捆绑的 sqlite3。找不到返回 null（调用方降级）。 */
export function resolveSqlite(): string | null {
  if (process.env.RA_SQLITE_BIN) return process.env.RA_SQLITE_BIN;
  const onPath = which(IS_WIN ? "sqlite3.exe" : "sqlite3") ?? which("sqlite3");
  if (onPath) return onPath;
  const home = os.homedir();
  const candidates = IS_WIN
    ? [path.join(home, "miniconda3", "Scripts", "sqlite3.exe"), path.join(home, "anaconda3", "Scripts", "sqlite3.exe")]
    : [path.join(home, "miniconda3", "bin", "sqlite3"), path.join(home, "anaconda3", "bin", "sqlite3")];
  return firstExisting(candidates);
}

export interface SystemInfo {
  os: string;
  arch: string;
  kernel: string;
  gpu?: string;
  driver?: string;
  python?: string;
}

/** 全局系统环境（OS/内核/GPU/驱动/架构/系统 Python），全平台可用，探测不到的字段省略。 */
export function systemInfo(): SystemInfo {
  const out: SystemInfo = { os: "", arch: process.arch, kernel: os.release() };
  if (IS_WIN) {
    // 10.0.22xxx+ 是 Windows 11，其余按 NT 版本号展示
    const rel = os.release();
    out.os = /^10\.0\.(2[2-9]|[3-9]\d)\d*/.test(rel) ? `Windows 11 (${rel})` : `Windows (${rel})`;
  } else {
    try {
      const rel = fs.readFileSync("/etc/os-release", "utf-8");
      const m = rel.match(/PRETTY_NAME="([^"]+)"/);
      if (m) out.os = m[1];
    } catch {
      out.os = `${os.type()} ${os.release()}`;
    }
  }
  const nvidiaSmi = which(IS_WIN ? "nvidia-smi.exe" : "nvidia-smi")
    ?? (IS_WIN && fs.existsSync(path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "nvidia-smi.exe"))
      ? path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "nvidia-smi.exe")
      : null);
  if (nvidiaSmi) {
    try {
      const s = execFileSync(nvidiaSmi, ["--query-gpu=name,driver_version", "--format=csv,noheader"], { encoding: "utf-8", timeout: 8000 });
      const parts = (s.split("\n")[0] || "").split(",");
      if (parts[0]) out.gpu = parts[0].trim();
      if (parts[1]) out.driver = parts[1].trim();
    } catch { /* nvidia-smi 存在但查询失败 */ }
  } else if (!IS_WIN) {
    try {
      const v = fs.readFileSync("/proc/driver/nvidia/version", "utf-8").trim().split("\n")[0] || "";
      out.driver = v.replace(/^NVRM version:/, "").trim().slice(0, 40);
    } catch { /* 无 NVIDIA 驱动信息 */ }
  }
  const py = resolvePython();
  if (py) {
    try {
      const v = execFileSync(py.cmd, [...py.args, "--version"], { encoding: "utf-8", timeout: 5000 });
      out.python = v.trim().replace(/^Python /, "");
    } catch { /* 探测版本失败，省略 */ }
  }
  return out;
}
