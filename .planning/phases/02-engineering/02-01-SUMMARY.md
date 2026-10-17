# 02-01 Summary: 死代码清理 + frozen 归档 + scripts 整理

**Status**: Complete
**Date**: 2026-10-17
**Requirements**: ENG-03, ENG-04

## What Was Done

### 可达性检查工具（新）
- `scripts/check-dead-code.cjs`：从 src/app 约定入口 + instrumentation + tests + package.json scripts BFS import 图（支持 `@/` 别名、动态 import、带 `.ts` 扩展的相对导入），不可达文件 exit 1。白名单：被 spawn 的工具（extract-pdf/py_chain/gen-runtime-config/flatten-next-junctions/migrate-v1/translate-full）。

**关键修正**：初版分析漏掉了显式 `.ts` 扩展的相对导入（`./planner.ts`），导致 search/ 一整个活子树（planner/plan/terms/session/importer/inbox/enrich/triage/resolve/session-storage/compile-wos/gs-link 与 fact-taxonomy）被误判为死代码。tsc 立即暴露（literature-api.ts / fact-extract.ts 引用断裂），修复 resolver（base 本身作为候选）后恢复全部误删文件。**教训：静态可达性结果必须经 tsc 验证后再动手删。**

### 实际删除
- **组件（20）**：workspace、dashboard、pdf-reader、pdf-reader-page、paper-pane、paper-library、code-read、code-reading、repro、repro-copilot、repro-target、repro-stage-{analyzing,decisions,materials,ready,target}、stages.ts、term-drawer
- **lib（2）**：history.ts（唯一真正死的 lib）；data-atelier.ts 随 variant 归档而不再被引用（见下）
- **杂项**：src/app/api/sync/route.ts.orig、一次性脚本 enrich-term-contexts.mjs / import-learning-drafts.mjs / run-phase-a-sample.mjs

### 冻结归档
- `src/components/atelier/`（3 个设计变体）→ `src/frozen/atelier/`，附 `src/frozen/README.md`（来源、复活方法）
- tsconfig `exclude` 与 eslint `globalIgnores` 均排除 `src/frozen/`

### scripts/ 整理（19 → 0 个 test-*.mjs）
- **移植 10 个**（纯逻辑/自带沙箱，Windows 实测通过）→ `tests/legacy/*.mjs`（修正相对导入路径），由 `tests/legacy.test.mjs` node:test 收口：子进程运行 + RA_DATA_DIR 临时沙箱 + exit code 断言，全量并入 `npm test`（44 → 54 个测试）
- **删除 7 个**（不可移植）：test-binding / test-fact-extract / test-mapping / test-repo-analyzer / test-reproduction-migration（硬编码 `/home/ark`、`/media/ark` 真实仓库路径，只能在原 Linux 机器跑）；test-literature-b-lite / test-literature-http（需起真实 dev server 的手工集成脚本）。git 历史可找回
- scripts/ 现只剩 7 个可复用工具（check-dead-code、extract-pdf、flatten-next-junctions、gen-runtime-config、migrate-v1、py_chain、translate-full）

## Verification

1. `node scripts/check-dead-code.cjs` → `OK: no dead files (checked 123)`
2. `tsc --noEmit` 零错误
3. `npm test` 54/54 全绿（44 原有 + 10 legacy）
4. `next build` 成功
5. dev 冒烟（browser 实测）：项目列表 / 文献发现 / 术语卡（39 个概念）/ 助手如何懂我四视图渲染正常；`/read/nsr-mvcdzj2d` PDF 阅读器 8 页 canvas 渲染正常

## Deviations from Plan

- 计划预估删除 21 组件 + 17 lib；实际 20 组件 + 2 lib —— 17 个 lib 中 15 个是 resolver bug 造成的误判（已恢复）。最终死代码规模远小于预估，说明 search/ 模块是活代码（literature-api 内部实现）
- chat-panel.tsx 实际被 learning 视图引用（活代码），未删

## Notes for Future Work

- tests/legacy/ 的 10 个脚本仍是手工断言风格，只是被 node:test 收口；若某个模块要大改，建议顺手重写成原生 node:test
- 删除的 5 个 Linux 路径测试覆盖的模块（fact-extract/gap-detector/mapping/code-reader/reproduction-spec）在 Windows 上无回归覆盖，重构这些模块时注意
