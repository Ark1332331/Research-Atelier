/**
 * Research Atelier · Electron 主进程（桌面壳）
 *
 * 职责（只加壳，不重写后端）：
 *  - 双击启动：找空闲端口，用 Electron 内置 Node（ELECTRON_RUN_AS_NODE）拉起本地 Next server
 *    （生产走 next build + next start，不用 dev），BrowserWindow 加载 http://127.0.0.1:<port>
 *  - 数据层：打包后首次把随包 data/ 种子拷贝到用户可写目录（app.getPath('userData')/data），
 *    并通过环境变量 RA_DATA_DIR 让 Next 后端读写用户目录（见 src/lib/store.ts），
 *    改动能持久、不写死在只读安装目录
 *  - 代码导读根：打包后默认根按 electron/runtime-config.json（打包时生成）重算，
 *    首次写入 data/code-roots.json；用户可改该文件或设 RA_DEFAULT_CODE_ROOT
 *  - 密钥：加载随包 .env.local（DEEPSEEK_API_KEY）传给 Next server
 *  - 退出/崩溃时清理 Next server 子进程；单实例锁；日志写 userData/server.log
 *
 * 开发模式：RA_DEV_URL=http://127.0.0.1:3110（npm run desktop:dev）时跳过 server 拉起，直接加载该地址。
 * 调试：RA_DEVTOOLS=1 开 DevTools；RA_DEBUG_SHOT=<png路径> 加载完成后截图（用于无头验证）。
 */
"use strict";

const { app, BrowserWindow, dialog, shell } = require("electron");
const { spawn } = require("node:child_process");
const fsp = require("node:fs/promises");
const fs = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");

const APP_NAME = "Research Atelier";
const DEV_URL = process.env.RA_DEV_URL || "";
const isPackaged = app.isPackaged;

app.setName(APP_NAME);

// Chromium 的单实例锁会把 socket 目录建在 TMPDIR 下（base::GetTempDir）。
// 若 TMPDIR 只读/不可写（例如沙箱、受限系统），锁会静默失败并导致早期退出。
// 启动时先确保 TMPDIR 可写；不行就回退到用户数据目录下的 tmp。
try {
  fs.mkdirSync(os.tmpdir(), { recursive: true });
} catch {
  const fallbackTmp = path.join(app.getPath("userData"), "tmp");
  try {
    fs.mkdirSync(fallbackTmp, { recursive: true });
    process.env.TMPDIR = fallbackTmp;
    process.env.TMP = fallbackTmp;
    process.env.TEMP = fallbackTmp;
  } catch { /* 极端情况：放弃，锁失败时下面会宽容处理 */ }
}

// 单实例：双击第二次聚焦已有窗口。锁失败（另一实例在跑 / 环境限制）不硬退——
// 本地个人工具可容忍多开，正常桌面环境下锁可用，second-instance 会聚焦已有窗口。
if (!app.requestSingleInstanceLock()) {
  console.log("[main] 未获得单实例锁（可能已有实例或环境受限），继续启动");
}

// <project>/electron/main.js → <project>（打包后即 resources/app）
const projectDir = path.dirname(__dirname);
const userDataDir = app.getPath("userData");
// 打包后数据必须落在用户可写目录；dev 保持项目内 data/（现状不变）
const dataDir = isPackaged ? path.join(userDataDir, "data") : path.join(projectDir, "data");
const logFile = path.join(userDataDir, "server.log");
const runtimeConfigPath = path.join(__dirname, "runtime-config.json");

let serverProc = null;
let quitting = false;

/* ---------- 工具 ---------- */

function readLogTail(max = 2000) {
  try {
    const s = fs.readFileSync(logFile, "utf-8");
    return s.slice(-max);
  } catch {
    return "";
  }
}

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  try {
    fs.appendFileSync(logFile, line + "\n");
  } catch { /* 日志写失败不致命 */ }
}

/** 解析 .env.local（KEY=VALUE，支持引号与注释）；已存在的环境变量不覆盖 */
function loadDotEnv(file) {
  const out = {};
  try {
    const raw = fs.readFileSync(file, "utf-8");
    for (const line of raw.split(/\r?\n/)) {
      const t = line.trim();
      if (!t || t.startsWith("#")) continue;
      const eq = t.indexOf("=");
      if (eq <= 0) continue;
      const key = t.slice(0, eq).trim();
      let val = t.slice(eq + 1).trim();
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1);
      }
      if (!(key in process.env)) out[key] = val;
    }
  } catch { /* 无 .env.local 也允许 */ }
  return out;
}

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const p = srv.address().port;
      srv.close(() => resolve(p));
    });
  });
}

async function copyDir(src, dst) {
  await fsp.mkdir(dst, { recursive: true });
  const entries = await fsp.readdir(src, { withFileTypes: true });
  for (const e of entries) {
    const s = path.join(src, e.name);
    const d = path.join(dst, e.name);
    if (e.isDirectory()) await copyDir(s, d);
    else await fsp.copyFile(s, d);
  }
}

async function waitForServer(url, timeoutMs = 90000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
      if (res.ok) return true;
    } catch { /* 服务还没起来，继续等 */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

function fatal(message, detail) {
  dialog.showErrorBox(APP_NAME, `${message}\n\n${detail || ""}`);
  app.exit(1);
}

/* ---------- 首次运行：数据种子迁移 ---------- */

async function seedDataDir() {
  await fsp.mkdir(dataDir, { recursive: true });
  // 只有首次（用户数据目录还没有 data/library.json）才拷贝种子，避免覆盖用户已有改动
  try {
    await fsp.access(path.join(dataDir, "library.json"));
    return;
  } catch { /* 首次运行 */ }
  const seed = path.join(projectDir, "data");
  try {
    await copyDir(seed, dataDir);
    log(`首次运行：已把 data/ 种子拷贝到用户目录 ${dataDir}`);
  } catch (err) {
    log(`种子拷贝失败（继续，可能为空库）：${err}`);
  }
}

/** 打包后代码导读默认根：运行时配置 > 环境变量 > dev 的项目上级 > 用户主目录兜底 */
function defaultCodeRoot() {
  if (process.env.RA_DEFAULT_CODE_ROOT && fs.existsSync(process.env.RA_DEFAULT_CODE_ROOT)) {
    return process.env.RA_DEFAULT_CODE_ROOT;
  }
  try {
    const cfg = JSON.parse(fs.readFileSync(runtimeConfigPath, "utf-8"));
    if (cfg.defaultCodeRoot && fs.existsSync(cfg.defaultCodeRoot)) return cfg.defaultCodeRoot;
  } catch { /* 未生成运行时配置（首次打包前） */ }
  if (!isPackaged) {
    const devParent = path.resolve(projectDir, "..");
    if (fs.existsSync(devParent)) return devParent;
  }
  return os.homedir();
}

async function seedCodeRoots() {
  const target = path.join(dataDir, "code-roots.json");
  try {
    await fsp.access(target);
    return;
  } catch { /* 首次，写默认 */ }
  const root = defaultCodeRoot();
  const roots = [{ id: "project", name: "项目根", root }];
  const repro = path.join(root, "reproduction");
  if (fs.existsSync(repro)) {
    roots.push({ id: "reproduction", name: "reproduction", root: repro });
  }
  await fsp.mkdir(dataDir, { recursive: true });
  await fsp.writeFile(target, JSON.stringify({ roots }, null, 2), "utf-8");
  log(`已写入 data/code-roots.json（默认代码根：${root}）`);
}

/* ---------- Next server ---------- */

async function startNextServer(port) {
  const nextBin = path.join(projectDir, "node_modules", "next", "dist", "bin", "next");
  if (!fs.existsSync(nextBin)) {
    fatal("找不到 Next server", `缺少 ${nextBin}。桌面包应包含构建产物，请重新打包（npm run desktop）。`);
    return null;
  }
  const env = {
    ...process.env,
    RA_DATA_DIR: dataDir,
    RA_NODE_BIN: process.execPath, // 子进程 node（extract-pdf.mjs）也用 Electron 二进制
    ELECTRON_RUN_AS_NODE: "1",     // 主进程自己：Electron 二进制当 node 用
    // 让服务端 Node fetch 支持代理：默认 ignore 系统代理。若 .env.local 配了
    // HTTPS_PROXY（例如 mihomo 的 http://127.0.0.1:7890），服务端调 DeepSeek 就会走代理，
    // 解决「直连 DeepSeek 不通 / 需代理」导致的 fetch failed。没配代理则仍直连，不受影响。
    NODE_USE_ENV_PROXY: "1",
  };
  Object.assign(env, loadDotEnv(path.join(projectDir, ".env.local")));

  const child = spawn(
    process.execPath,
    [nextBin, "start", "-p", String(port), "-H", "127.0.0.1"],
    { cwd: projectDir, env, stdio: ["ignore", "pipe", "pipe"] },
  );
  child.stdout.on("data", (d) => log(`[server] ${String(d).trimEnd()}`));
  child.stderr.on("data", (d) => log(`[server:err] ${String(d).trimEnd()}`));
  child.on("error", (err) => {
    log(`server 进程错误：${err}`);
    if (!quitting) fatal("Next server 启动失败", String(err));
  });
  child.on("exit", (code, sig) => {
    log(`Next server 退出 code=${code} sig=${sig}`);
    if (!quitting && code !== 0) {
      dialog.showErrorBox(APP_NAME, `本地服务意外退出（code=${code}）。应用即将关闭。\n\n${readLogTail()}`);
      app.quit();
    }
  });
  return child;
}

/* ---------- 窗口 ---------- */

function createWindow(url) {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1080,
    minHeight: 700,
    title: APP_NAME,
    autoHideMenuBar: true,
    backgroundColor: "#F7F4EF",
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });
  win.once("ready-to-show", () => win.show());
  // 外部链接走系统浏览器，不在应用内开新窗口
  win.webContents.setWindowOpenHandler(({ url: u }) => {
    if (u.startsWith("http://") || u.startsWith("https://")) shell.openExternal(u);
    return { action: "deny" };
  });
  win.webContents.on("did-fail-load", (_e, code, desc) => {
    if (code === -3) return; // ERR_ABORTED（正常跳转）
    log(`页面加载失败 code=${code} ${desc}`);
  });
  if (process.env.RA_DEVTOOLS) win.webContents.openDevTools({ mode: "detach" });

  // 无头验证：RA_DEBUG_SHOT=<png> 加载完成后截图（可选）；RA_DEBUG_DUMP=<txt> 存页面文本
  if (process.env.RA_DEBUG_SHOT || process.env.RA_DEBUG_DUMP) {
    win.webContents.once("did-finish-load", async () => {
      await new Promise((r) => setTimeout(r, Number(process.env.RA_DEBUG_DELAY) || 4500));
      if (process.env.RA_DEBUG_DUMP) {
        try {
          const txt = await Promise.race([
            win.webContents.executeJavaScript("document.body ? document.body.innerText.slice(0, 600) : '(no body)'"),
            new Promise((r) => setTimeout(() => r("(dump timeout)"), 6000)),
          ]);
          await fsp.writeFile(process.env.RA_DEBUG_DUMP, String(txt), "utf-8");
          log(`调试文本已保存：${process.env.RA_DEBUG_DUMP}`);
        } catch (err) {
          log(`文本转储失败：${err}`);
        }
      }
      if (process.env.RA_DEBUG_SHOT) {
        try {
          const img = await Promise.race([
            win.webContents.capturePage(),
            new Promise((r) => setTimeout(() => r(null), 8000)),
          ]);
          if (img) {
            await fsp.writeFile(process.env.RA_DEBUG_SHOT, img.toPNG());
            log(`调试截图已保存：${process.env.RA_DEBUG_SHOT}`);
          } else {
            log("截图超时（沙箱/软渲染环境可能不支持 capturePage）");
          }
        } catch (err) {
          log(`截图失败：${err}`);
        }
      }
    });
  }

  // 加载应用（server 已就绪才建窗，直接加载目标地址）
  win.loadURL(url);
  return win;
}

/* ---------- 生命周期 ---------- */

app.on("second-instance", () => {
  const w = BrowserWindow.getAllWindows()[0];
  if (w) {
    if (w.isMinimized()) w.restore();
    w.focus();
  }
});

app.on("before-quit", () => {
  quitting = true;
  if (serverProc && serverProc.exitCode === null) {
    try { serverProc.kill("SIGTERM"); } catch { /* 已退出 */ }
  }
});

app.on("window-all-closed", () => {
  app.quit();
});

app.whenReady().then(async () => {
  try {
    if (DEV_URL) {
      // 开发模式：直连已运行的 next dev
      if (!(await waitForServer(DEV_URL, 30000))) {
        return fatal("开发服务器未就绪", `请先运行 next dev（${DEV_URL}）`);
      }
      createWindow(DEV_URL);
      return;
    }

    if (isPackaged) {
      await seedDataDir();
      await seedCodeRoots();
    } else {
      log(`dev 模式：数据目录保持项目内 ${dataDir}`);
    }

    const port = await freePort();
    serverProc = await startNextServer(port);
    if (!serverProc) return;

    const base = `http://127.0.0.1:${port}`;
    log(`等待 Next server 就绪：${base}`);
    const ok = await waitForServer(`${base}/api/chat`);
    if (!ok) {
      return fatal("本地服务未能启动", `日志：${logFile}\n\n${readLogTail()}`);
    }
    log(`服务就绪，打开窗口`);
    createWindow(base);
  } catch (err) {
    fatal("启动失败", err instanceof Error ? err.stack || err.message : String(err));
  }
});
