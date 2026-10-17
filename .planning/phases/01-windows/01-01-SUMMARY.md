# Plan 01-01 Summary: Windows NSIS 打包与冒烟验证

## 完成内容

**Task 1 — electron-builder win/nsis 配置与打包脚本**
- `electron-builder.yml` 增加 `win`（nsis, x64, artifactName 含版本）与 `nsis`（oneClick:false、可改安装目录、per-user、桌面快捷方式）配置；linux target 保留不回归
- `package.json` 增加 `dist:win` 脚本：`gen-runtime-config → next build → flatten-next-junctions → electron-builder --win`
- 新增 `scripts/flatten-next-junctions.mjs`：把 `next build` 在 `.next/node_modules` 创建的 junction（pdfjs-dist）替换为真实目录拷贝——否则 electron-builder 复制 junction 在 Windows 报 EPERM（非管理员无 symlink 权限）

**Task 2 — 打包版冒烟验证（win-unpacked，全部通过）**
1. 应用启动：窗口正常渲染（截图验证主界面 rail + 项目中心），Next server 就绪
2. 数据目录：`%APPDATA%\Research Atelier\data` 正确创建
3. 核心路径：
   - PDF 导入：nsr.pdf 导入成功（8 页、自动建项目、出现在论文库）——**修复打包版阻断 bug**：`extract-pdf.mjs` 的 `workerSrc` 用 Windows 绝对路径导致 pdfjs fake worker ESM import 报 `protocol 'c:'`；改为 `pathToFileURL().href`
   - PDF 服务 200（7.1MB）；`/read/[slug]` 200；`/learning` 200
   - 环境探测：Win11 + RTX 5070 + Python 3.13.5 正确返回
4. 进程清理：正常关窗 → Next server SIGTERM 退出 → 0 残留进程；强杀亦无残留

**产出**：`Research Atelier-Setup-0.1.0-x64.exe`（约 230MB，NSIS）

## 本机打包环境坑位（Windows 用户须知，已记入 memory）
- 杀毒/索引软件锁文件导致 electron-builder 两类失败：
  - `EPERM rename win-unpacked.tmp`（解压 electron zip 时被扫描锁住）→ 绕法：手动解压 electron zip 到项目外目录，`--config.electronDist` 指向它
  - `EBUSY unlink default_app.asar`（旧输出目录被锁）→ 绕法：输出目录换全新的（`--config.directories.output`）
- 因此 dist:win 标准脚本在本机可能需配合上述两个 workaround；CI/干净环境不受影响

## 验证证据
- `node scripts/extract-pdf.mjs` 本机提取 nsr.pdf 成功（8 页文本）
- 打包版（热修复后）：`POST /api/paper` 返回 ok + 项目创建；`GET /api/library` 出现导入论文；`GET /api/paper/pdf` 200
- 退出后 `Get-CimInstance Win32_Process -Filter "Name='Research Atelier.exe'"` 计数 0
- 最终安装包用修复后的脚本重新打出（避免热补丁只在 win-unpacked 里）

## 偏差与备注
- 种子拷贝日志显示 `resources/app/data` 不存在（仓库 data/ 被 gitignore，属预期空库）
- `/terms` 无索引路由（术语入口在主页面板），404 非回归
- 图标用 electron-builder 默认图标（待办，不阻塞）
- 正式安装到干净机器的验证依赖用户手动执行一次（本机冒烟已覆盖免安装版）
