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

async function envSummary(name: string, prefix?: string): Promise<{ python: string; torch: string; pkgCount: number }> {
  const pkgs = await pkgListOf(name, prefix);
  const find = (n: string) => pkgs.find((p) => p.name === n)?.version ?? "";
  return { python: find("python"), torch: find("torch"), pkgCount: pkgs.length };
}

/** 包名去噪：conda/pip 全家桶 + 元包，这些不该算“特征包”。 */
const NOISE_RE = /^(conda|conda-|python|python_abi|setuptools|wheel|pip|pip-tools|packaging|filelock|click|colorama|charset-normalizer|idna|certifi|urllib3|requests|typing|typing_extensions|typing-extensions|importlib|importlib_|importlib-metadata|importlib_resources|importlib-resources|importlib_metadata|xz|sqlite|openssl|readline|zlib|bzip2|libffi|libgcc|libstdcxx|libuuid|libzlib|ncurses|expat|tbb|ca-certificates|krb5|libedit|libnghttp2|libssh2|libxml2|libxslt|icu|pcre2|gettext|lz4|zstd|lzo|libpng|libjpeg|libtiff|freetype|fontconfig|harfbuzz|glib|gobject|pango|cairo|graphite2|dbus|libglib|libdbus|libxcb|libxkbcommon|libxrandr|libxdg|libxxf86vm|libice|libsm|libxfixes|libxext|libxrender|libxcursor|libxi|libxtst|librsvg|wayland|mesa|libglvnd|gstreamer|atk|at-spi|at-spi2|nss|nspr|libevent|libusb|libusb1|pyqt|qt-|qt6|pyside|pyside6|sip|build|flit|flit-core|pyflakes|pycodestyle|isort|black|mypy|pytest|pluggy|iniconfig|tomli|toml|jsonschema|attrs|referencing|rpds|jupyter|jupyter-|ipython|ipykernel|jupyterlab|notebook|traitlets|jupyter_client|jupyter_core|nbconvert|nbformat|nbclient|nbclassic|widgetsnbextension|qtconsole|matplotlib-inline|stack-data|executing|asttokens|pure_eval|backcall|pygments|tornado|jinja2|markupsafe|mistune|fastjsonschema|terminado|prompt_toolkit|prompt-toolkit|wcwidth|pyzmq|debugpy|comm|nest_asyncio|argon2|argon2-cffi|async-lru|async_timeout|async-timeout|aiosqlite|aiosignal|frozenlist|sniffio|anyio|outcome|websocket|websockets|soupsieve|beautifulsoup4|bs4|html5lib|webencodings|tinycss2|cssselect2|pyphen|defusedxml|et-xmlfile|openpyxl|xlrd|xlsxwriter|odf|pyarrow|greenlet|more-itertools|distlib|pathspec|platformdirs|editable|gmp|mpfr|mpmath|sympy|cython|nlohmann|libsodium|libclang|clang-|llvm|llvmlite|llvm-openmp|libgomp|libgfortran|libopenblas|openblas|blas|mkl|mkl-include|mkl_fft|mkl_random|libmkl|libblastrampoline|gfortran|gcc|gcc-|gxx|libgcc-|libstdcxx-|binutils|make|cmake|ninja|pkg-config|pkgconfig|pkgconf|meson|autoconf|automake|libtool|patch|diffutils|file|grep|gawk|sed|gettext|hostname|which|coreutils|perl|setuptools_scm|setuptools-scm|versioneer)$/i;

/** 核心大包排序权重：有特征意义的核心库排前面。 */
const CORE_WEIGHT: [RegExp, number][] = [
  [/^torch(py)?$/i, 100],
  [/^torchvision$/i, 95],
  [/^torchaudio$/i, 90],
  [/^pytorch-cuda|^cuda-(runtime|nvcc|cudart|cccl|libs|command|nvrtc|npp)$/i, 85],
  [/^cudatoolkit|^cudnn|^cu[0-9]+|^nvidia-|^nvidia_|^libcudart|^libcublas|^libcurand|^libcufft|^libcudnn|^libnvjpeg|^libnvrtc/i, 80],
  [/^numpy/i, 75],
  [/^numba/i, 72],
  [/^scipy/i, 70],
  [/^minkowski/i, 65],
  [/^isaac|^omni|^pxr|^usd/i, 60],
  [/^stable-worldmodel|^worldmodel/i, 55],
  [/^gymnasium|^gym-|^gym_|^mujoco|^dm_control/i, 50],
  [/^rsl_rl|^rsl-rl|^rl_games|^robosuite|^unitree|^legged/i, 45],
];

/** 取样一个环境的包。优先按环境名 `-n`；base 环境的目录名是前缀 basename（如 miniconda3），
 *  `conda list -n <basename>` 会失败，此时用 `-p <prefix>` 回退。 */
async function pkgListOf(name: string, prefix?: string): Promise<{ name: string; version: string; build_string?: string }[]> {
  const run = (args: string[]) => execFileAsync(CONDA, args, { timeout: 30000 }).then((r) => r.stdout);
  try {
    const stdout = await run(["list", "-n", name, "--json"]);
    return JSON.parse(stdout) as { name: string; version: string; build_string?: string }[];
  } catch {
    if (prefix) {
      try {
        const stdout = await run(["list", "-p", prefix, "--json"]);
        return JSON.parse(stdout) as { name: string; version: string; build_string?: string }[];
      } catch { /* falls through */ }
    }
    return [];
  }
}

/** 相对基线的“特征包”：基线里没有的同名包，或与基线版本不同者。 */
function featurePkgs(pkgs: { name: string; version: string }[], baseMap: Map<string, string>): { name: string; version: string }[] {
  return pkgs
    .filter((p) => {
      if (NOISE_RE.test(p.name)) return false;
      const baseV = baseMap.get(p.name);
      if (baseV === undefined) return true; // 基线里没有 → 特征
      return baseV !== p.version; // 版本不同 → 特征
    })
    .map((p) => ({ name: p.name, version: p.version }))
    .sort((a, b) => {
      const wa = CORE_WEIGHT.find(([re]) => re.test(a.name))?.[1] ?? 0;
      const wb = CORE_WEIGHT.find(([re]) => re.test(b.name))?.[1] ?? 0;
      if (wb !== wa) return wb - wa;
      return a.name.localeCompare(b.name);
    });
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const name = url.searchParams.get("name");
  const baseline = url.searchParams.get("baseline"); // 基线环境名（对比式特征包）
  const meta = await readMeta();
  const envs = await condaList();
  const prefixOf = (n: string) => envs.find((e) => e.name === n)?.prefix;

  if (name) {
    const pkgs = await pkgListOf(name, prefixOf(name));
    return Response.json({
      env: name,
      purpose: (meta.envs.find((x) => x.name === name)?.purpose) ?? "",
      packages: pkgs.slice(0, 800).map((p) => ({ name: p.name, version: p.version, build: p.build_string ?? "" })),
    });
  }

  // 基线对比模式：取样基线包名→版本，再取样每个环境，计算相对基线的特征包。
  let baseMap: Map<string, string> | null = null;
  if (baseline) {
    const basePkgs = await pkgListOf(baseline, prefixOf(baseline));
    baseMap = new Map(basePkgs.map((p) => [p.name, p.version]));
  }

  const list = await Promise.all(envs.map(async (e) => {
    const m = meta.envs.find((x) => x.name === e.name);
    const purpose = m?.purpose ?? "";
    const stage = m?.stage ?? "";
    if (baseMap) {
      const pkgs = await pkgListOf(e.name, e.prefix);
      const find = (n: string) => pkgs.find((p) => p.name === n)?.version ?? "";
      return {
        name: e.name,
        python: find("python"),
        torch: find("torch"),
        pkgCount: pkgs.length,
        purpose, stage,
        baseline,
        keyPkgs: featurePkgs(pkgs, baseMap).slice(0, 60),
      };
    }
    const s = await envSummary(e.name, e.prefix);
    return { name: e.name, python: s.python, torch: s.torch, pkgCount: s.pkgCount, purpose, stage };
  }));
  return Response.json({ system: collectSystem(), envs: list, baseline: baseline ?? null });
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
