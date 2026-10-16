# Plan 01-02 Summary: 跨平台探测层 + Windows 数据目录 + 进程清理

## 完成内容

**Task 1 — 跨平台探测层 `src/lib/platform.ts`（新建）**
- `which()`: Windows `where` / POSIX `which`
- `resolvePython()`: Win `python → py -3 → python3`，POSIX `python3 → python`；`RA_PYTHON_BIN` 覆盖
- `resolveConda()`: PATH + Windows（%USERPROFILE%\miniconda3 等）/ POSIX（~/miniconda3 等）标准路径；`RA_CONDA_BIN` 覆盖
- `resolveSqlite()`: PATH + conda 目录捆绑 sqlite3；找不到返回 null
- `systemInfo()`: 全平台 OS/arch/kernel/GPU/driver/python（Win11 版本号识别、nvidia-smi 双平台探测）
- `environments/route.ts`: 删除 `/home/ark/...` 硬编码与 `cat /etc/os-release`/`uname`/`python3` 调用；conda 未找到时优雅返回空列表；env 路径分隔符兼容 `\`
- `code-read/route.ts`: `pythonChain` 走 resolvePython（无 Python 时返回 unavailable）

**Task 2 — Windows 数据目录 + fs/pick 降级**
- `store.ts`: dev 数据目录 Windows 落 `%APPDATA%\Research Atelier\data`（与 Electron userData 一致）；检测到旧 `~/.config` 数据时一次性 cpSync 迁移
- `fs/pick/route.ts`: zenity 不存在时返回 `{canceled, unsupported, message}`（明确提示用桌面版/手输路径），不再静默 canceled；`--filename` 用平台分隔符
- `execution-session.ts` / `reproduction/review/route.ts`: sqlite3 经 resolveSqlite，null 时跳过（codex 会话读取降级为空）
- `code-reader.ts`: home 回退 `/home/ark` → `os.homedir()`
- `repro-stage-materials.tsx`: 占位符去掉 `/home/ark` 个人路径

**Task 3 — Electron 进程清理（electron/main.js）**
- `killServer()`: Windows `taskkill /pid <pid> /T /F` 杀进程树 + 兜底；POSIX SIGTERM→SIGKILL 升级
- 挂到 `before-quit`、`will-quit`、`process.on("exit")` 三处

**顺手修复（存量问题）**
- `layout.tsx`: `LayoutProps<"/">`（依赖构建期生成类型，裸 tsc 报错）→ 显式 `{ children: React.ReactNode }`

## 验证证据
- `npx tsc --noEmit` 通过（0 错误）
- `npm test` 44/44 全绿（新增 `tests/platform.test.mjs` 6 项）
- Windows 实测（dev server）：
  - `GET /api/environments?system=1` → `{"os":"Windows 11 (10.0.26200)","arch":"x64","gpu":"NVIDIA GeForce RTX 5070 Laptop GPU","driver":"592.01","python":"3.13.5"}`
  - `POST /api/fs/pick` → `{"canceled":true,"unsupported":true,"message":"本机没有 zenity..."}`（不再静默）
- grep 检查：src/ 与 electron/ 中 `home/ark`、`miniconda3/bin`、`/etc/os-release`、`uname` 仅存于 platform.ts 的 POSIX 分支与注释

## 偏差与备注
- conda 完整列表（`conda env list`）在本机未实测（无 conda），但代码路径与 Linux 原逻辑一致且有 null 守卫
- 遗留待 01-01 打包后验证：taskkill 清理在打包版退出时无残留进程（dev 模式 SIGKILL 路径不适用）
