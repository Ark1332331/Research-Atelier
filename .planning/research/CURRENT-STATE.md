# Research: 项目现状（2026-10-16）

来源：对 `D:\devpy\projects\Research-Atelier` 代码库的实读（README、RESEARCH_ATELIER_V1_PLAN.md、src/、electron/、tests/、git log）。

## 定位与技术栈
本地优先的科研入门个人工作台：论文库/筛选（OpenAlex 联网检索）→ PDF 精读翻译标注 → 术语卡间隔回忆 → 代码导读 → 实验复现检查点。Next.js 16.3（App Router）+ React 19.2 + TS + Tailwind 4 + react-pdf/pdfjs-dist 4.10；Electron 43 + electron-builder（asar:false）；数据层纯 JSON 文件（`src/lib/store.ts`，RA_DATA_DIR 可覆盖）。

## 已实现功能（按模块与完成度）
- **PDF 阅读器/导入/翻译**：`src/app/read/[slug]`、`full-reader.tsx`（555 行）、`/api/paper` + `scripts/extract-pdf.mjs`，持久高光/选词翻译/悬停释义 — 完成。
- **文献发现/筛选**：`src/lib/search/*`（14 文件）+ `/api/literature/*`（8 路由）+ `discovery.tsx`，Query Ladder、去重、证据门控 — 完成（V1 判定冻结，不再扩展）。
- **术语卡与复习**：`terms-store.ts` + `study-model.ts`（自研 SRS）+ `/terms/[id]`，需真实复述证据 — 完成。
- **受控学习/观察**：`src/lib/learning/*`（7 文件）+ `/api/learning` + `/learning`，候选→审核→应用→反馈→回退 — 完成。
- **Paper Project 中心（V1 主线）**：`project.ts`、`projects.tsx`、`project-repro.tsx`、`/api/sync` — 骨架级。Sync 证据仅 git 工作区 + Codex 会话两路；讲解为**规则模板而非 AI**。
- **复现五阶段/代码导读/环境管理**：已冻结为旧引擎；环境扫描为 **Linux conda 专用**。

## Windows 适配问题清单（文件:行号）
1. `electron-builder.yml:21-27` 仅 linux target，**无 win/nsis 配置，无法出 Windows 包**。
2. `src/app/api/environments/route.ts:17` conda 硬编码 `/home/ark/miniconda3/bin/conda`；:51/:55/:65 依赖 `cat /etc/os-release`、`uname`、`/proc/driver/nvidia/version`。
3. `src/app/api/fs/pick/route.ts:28` Web 模式依赖 zenity（Windows 不存在，静默 canceled）；:25 正斜杠拼接。
4. `src/lib/execution-session.ts:9`、`src/app/api/reproduction/review/route.ts:18` sqlite3 默认 `~/miniconda3/bin/sqlite3`；CODEX_DB 依赖 CLI 版 Codex。
5. `src/app/api/code-read/route.ts:48`、`environments/route.ts:69` 调 `python3`（Windows 惯为 `python`/`py`）。
6. `src/lib/store.ts:17` dev 数据目录用 `XDG_CONFIG_HOME`/`~/.config`（Windows 落到非标准位置）。
7. `electron/main.js:339` `SIGTERM` 杀子进程在 Windows 不可靠。
8. `.env.local.example` 注释与 `electron/main.js:231` 实读路径不一致；README 快速开始均为 bash 语法。

## 工程化短板
- 测试仅 5 个 node:test 文件，**sync/projects/handoff/literature 全无测试**；scripts/ 下 19 个 `test-*.mjs` 手工脚本混于构建脚本。
- 无 CI、无 typecheck 脚本、无 prettier；`.orig` 冲突残留入库（`src/app/api/sync/route.ts.orig`）。
- 死代码未清（`workspace.tsx`、`dashboard.tsx`、`pdf-reader*.tsx`、`atelier/variant-*`）。
- 前端全部 useState + 手工 fetch，无统一状态/数据获取层。

## V1 计划未完成部分
- **P3 半成品**：缺 `/api/sync/explain`（AI 讲解 SyncExplanation，现为规则拼串）；缺环境 fingerprint 与 commits 维度（`src/lib/environment.ts` 共享层未建）。
- **P4 部分完成**：notes.ts 仅 16 行最小 CRUD。
- **P5 基本未做**：讲解偏好（explain-preferences）、Learning Memory（exposure 记忆）、code Skill 固定提示词、code-read-context 均缺。
- **P6 未做**：冻结文件未归档、死代码未清。
