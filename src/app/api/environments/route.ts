/**
 * 环境卡（conda 环境管理）
 * 本地：动态采样 conda（conda env list / conda list -n <env>），拿到真实环境 + 依赖版本；
 *       用途/阶段由用户标注，存 data/environments.json。版本不手写死（采样即最新）。
 * 生产（Vercel）无 conda → 返回空（或用 data/environments.json 里的用途做展示）。
 *
 * GET  /api/environments            → { envs: [{name,python,torch,pkgCount,purpose,stage}] }
 * GET  /api/environments?name=<env> → { env, packages: [{name,version,build}] }
 * POST { name, purpose?, stage? }   → 存用途/阶段；返回 { ok, envs }
 */
import { execFile, execFileSync } from "node:child_process";
import { promisify } from "node:util";
import { readStore, writeStore } from "@/lib/store";

const execFileAsync = promisify(execFile);
const CONDA = process.env.RA_CONDA_BIN ?? "/home/ark/miniconda3/bin/conda";
const FILE = "environments.json";

interface EnvMeta { name: string; purpose?: string; stage?: string }
interface EnvStore { envs: EnvMeta[] }

async function readMeta(): Promise<EnvStore> {
  const raw = await readStore(FILE);
  if (raw) {
    try {
      const d = JSON.parse(raw);
      if (d && Array.isArray(d.envs)) return d as EnvStore;
    } catch { /* 忽略坏数据 */ }
  }
  return { envs: [] };
}

async function writeMeta(m: EnvStore): Promise<void> {
  await writeStore(FILE, JSON.stringify(m, null, 2));
}

/** 全局系统环境（Ubuntu/内核/GPU/驱动/架构/系统 Python） */
function collectSystem(): Record<string, string> {
  const out: Record<string, string> = {};
  try {
    const rel = execFileSync("cat", ["/etc/os-release"], { encoding: "utf-8" });
    const m = rel.match(/PRETTY_NAME="([^"]+)"/);
    if (m) out.os = m[1];
  } catch { /* */ }
  try { out.arch = execFileSync("uname", ["-m"], { encoding: "utf-8" }).trim(); } catch { /* */ }
  try { out.kernel = execFileSync("uname", ["-r"], { encoding: "utf-8" }).trim(); } catch { /* */ }
  try {
    const s = execFileSync("nvidia-smi", ["--query-gpu=name,driver_version", "--format=csv,noheader"], { encoding: "utf-8", timeout: 8000 });
    const line = s.split("\n")[0] || "";
    const parts = line.split(",");
    if (parts[0]) out.gpu = parts[0].trim();
    if (parts[1]) out.driver = parts[1].trim();
  } catch {
    try {
      const v = execFileSync("cat", ["/proc/driver/nvidia/version"], { encoding: "utf-8" }).trim().split("\n")[0] || "";
      out.driver = v.replace(/^NVRM version:/, "").trim().slice(0, 40);
    } catch { /* */ }
  }
  try { out.python = execFileSync("python3", ["--version"], { encoding: "utf-8" }).trim().replace(/^Python /, ""); } catch { /* */ }
  return out;
}

async function condaList(): Promise<{ name: string; prefix: string }[]> {
  try {
    const { stdout } = await execFileAsync(CONDA, ["env", "list", "--json"], { timeout: 20000 });
    const d = JSON.parse(stdout);
    return ((d.envs as string[]) ?? []).map((p) => ({ name: p.split("/").pop() || p, prefix: p }));
  } catch {
    return [];
  }
}

async function envSummary(name: string): Promise<{ python: string; torch: string; pkgCount: number }> {
  try {
    const { stdout } = await execFileAsync(CONDA, ["list", "-n", name, "--json"], { timeout: 30000 });
    const pkgs = JSON.parse(stdout) as { name: string; version: string }[];
    const find = (n: string) => pkgs.find((p) => p.name === n)?.version ?? "";
    return { python: find("python"), torch: find("torch"), pkgCount: pkgs.length };
  } catch {
    return { python: "", torch: "", pkgCount: 0 };
  }
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const name = url.searchParams.get("name");
  const meta = await readMeta();

  if (name) {
    try {
      const { stdout } = await execFileAsync(CONDA, ["list", "-n", name, "--json"], { timeout: 30000 });
      const pkgs = JSON.parse(stdout) as { name: string; version: string; build_string?: string }[];
      return Response.json({
        env: name,
        purpose: (meta.envs.find((x) => x.name === name)?.purpose) ?? "",
        packages: pkgs.slice(0, 800).map((p) => ({ name: p.name, version: p.version, build: p.build_string ?? "" })),
      });
    } catch {
      return Response.json({ env: name, purpose: "", packages: [] });
    }
  }

  const envs = await condaList();
  const list = await Promise.all(envs.map(async (e) => {
    const s = await envSummary(e.name);
    const m = meta.envs.find((x) => x.name === e.name);
    return { name: e.name, python: s.python, torch: s.torch, pkgCount: s.pkgCount, purpose: m?.purpose ?? "", stage: m?.stage ?? "" };
  }));
  return Response.json({ system: collectSystem(), envs: list });
}

export async function POST(request: Request) {
  let body: { name?: string; purpose?: string; stage?: string };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "请求体必须是 JSON" }, { status: 400 });
  }
  const name = body.name;
  if (!name) return Response.json({ error: "name 必填" }, { status: 400 });

  const meta = await readMeta();
  const arr = meta.envs ?? (meta.envs = []);
  let entry = arr.find((x) => x.name === name);
  if (!entry) {
    entry = { name };
    arr.push(entry);
  }
  if (typeof body.purpose === "string") entry.purpose = body.purpose;
  if (typeof body.stage === "string") entry.stage = body.stage;
  await writeMeta(meta);
  return Response.json({ ok: true, envs: meta.envs });
}
