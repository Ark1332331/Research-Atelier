# 02-03 Summary: sync/projects/handoff 核心 API 路由测试

**Status**: Complete
**Date**: 2026-10-20
**Requirements**: ENG-05

## What Was Done

### @/ 别名 loader（tests/helpers/alias-hooks.mjs）
- `registerHooks()`（Node 24 内线程钩子）解析 `@/x` → `src/x`（含 `.ts`/`.tsx`/`index` 候选与裸路径）
- 通过 `--import ./tests/helpers/alias-hooks.mjs` 注册进 npm test 脚本；对所有既有测试无副作用
- 踩坑：`module.register()` 只接受字符串路径，对象钩子必须用 `registerHooks()`

### 三个路由测试（tests/api-{projects,handoff,sync}.test.mjs，22 用例）
- 每文件独立 `RA_DATA_DIR` 临时沙箱 + 种子 projects.json，**先设环境变量再动态 import 路由**（DATA_DIR 是模块加载时常量）
- **projects**（10）：GET 列表/按 id/404；POST create 正常+空 title 400+非 JSON 400；setLastModule 非法 module 400/项目不存在 404；delete 正常路径；未知 action 400
- **handoff**（4）：正常路径断言交接词含论文标题、/read/ 链接、复现状态、AGENTS.md 约定；缺/不存在 projectId 404；非 JSON 400
- **sync**（8）：非 JSON/缺 projectId 400；项目不存在 404；**collect 正常路径**（空 pending + `sync-pending/<id>.json` 落盘）；rebuildHistory/explain/refreshState 无证据 400；未知 action 400
- AI 相关分支（refreshState/explain 触发 DeepSeek 的路径）只测 400 守卫，不发真实网络请求

## Verification

1. `npm test` 76/76 全绿（54 原有 + 22 新增），无顺序依赖（各文件独立沙箱与进程）
2. `npm run typecheck` 零错误、`npm run lint` 零输出、`node scripts/check-dead-code.cjs` OK
3. CI（windows-latest）推送后全绿（见 CI 记录）

## Notes for Future Work

- Phase 3 改造 /api/sync/explain 前先跑 tests/api-sync.test.mjs——400 守卫行为是回归底线
- 路由直调测试模式（Request 对象进出）可复制到其他路由；不必起 Next server
