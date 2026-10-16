# Requirements: Research Atelier v1.1

里程碑目标：Windows 一等公民 + 工程化地基 + AI 讲解闭环真实化 + 学习记忆升级 + 单篇闭环打磨发布。

## v1 Requirements

### Windows 适配（WIN）

- [ ] **WIN-01**: 用户可在 Windows 上通过 `npm run dist:win`（electron-builder nsis target）产出可安装的安装包，安装后应用完整可用
- [ ] **WIN-02**: 环境探测（conda/python/GPU/sqlite）在 Windows 上使用跨平台命令（`where`、`python`/`py`）与注册表/标准安装路径，不再出现 Linux 硬编码路径
- [ ] **WIN-03**: 应用退出时 Electron 子进程（Next server）在 Windows 上被可靠清理，无残留进程
- [ ] **WIN-04**: 数据目录在 Windows 上落 `%APPDATA%/research-atelier`（dev 与打包一致），README 提供两平台快速开始

### 工程化（ENG）

- [ ] **ENG-01**: GitHub Actions CI 在 windows-latest 上运行 typecheck、lint、test，主分支保持绿色
- [ ] **ENG-02**: `npm run typecheck` 脚本存在且当前代码零类型错误
- [ ] **ENG-03**: 死代码（workspace/dashboard/pdf-reader 旧组件/variant-*）删除、冻结模块文件归档至 `src/frozen/`（或等价位置）、`.orig` 冲突残留清除
- [ ] **ENG-04**: scripts/ 中 19 个手工 `test-*.mjs` 移出构建脚本目录或删除，scripts/ 只留可复用工具
- [ ] **ENG-05**: sync、projects、handoff 三个核心 API 路由有 node:test 覆盖（正常路径 + 至少一个失败路径）

### AI 讲解闭环（AI）

- [ ] **AI-01**: Paper Project 的 Sync 讲解由真实 DeepSeek 调用生成（`/api/sync/explain`），基于项目上下文（论文、阶段、术语卡、问题池），不再用规则模板拼串
- [ ] **AI-02**: AI 讲解内容带引用锚定：讲到论文某处时可点击跳回 PDF 对应位置（至少页级）
- [ ] **AI-03**: AI 讲解区分"来自论文/证据的陈述"与"AI 推断"，推断部分有明确标注（诚实的不确定性）
- [ ] **AI-04**: 用户可设置讲解偏好（explain-preferences：详细程度、是否跳过已懂概念），讲解据此适配
- [ ] **AI-05**: 首次启动检测 DEEPSEEK_API_KEY，未配置时 UI 引导用户填入（配置零门槛，消灭配置地狱）

### 学习记忆（MEM）

- [ ] **MEM-01**: PDF 阅读中的高亮/标注可一键转为术语卡，8 字段自动预填（术语、来源、先理解为等），用户确认后入库，全程 < 30 秒
- [ ] **MEM-02**: 间隔复习调度切换为 FSRS 算法（ts-fsrs 库），既有卡片复习数据平滑迁移
- [ ] **MEM-03**: 新论文导入时预扫全文，已建档术语标"已见"，未建档术语提示首次出现（首次出现即建档）
- [ ] **MEM-04**: 学习画像按 exposure 累积记录术语接触/掌握事件，讲解时已懂概念少讲、新卡点多讲（成长账）

### 闭环打磨与发布（FLOW）

- [ ] **FLOW-01**: 新用户冷启动引导：首启向导带领导入第一篇 PDF 并完成首次导读
- [ ] **FLOW-02**: "读一篇论文" golden path（导入→首读→术语卡→精读讲解→复习）在打包后的 Windows 应用中端到端实测通过
- [ ] **FLOW-03**: v1.1 版本号、更新说明、安装包产出并可分发

## v2 Requirements (Deferred)

- 多篇论文对比/综述式综合
- Zotero/BibTeX 导入集成
- 本地 LLM（Ollama）支持
- 知识网络图可视化
- 记忆层 SQLite FTS 升级

## Out of Scope

- 激活旧复现执行引擎（五阶段/repro 编译器） — V1 已冻结；复现仅保留检查点与证据链
- 文献发现模块功能扩展 — 冻结；OpenAlex 检索够用
- 云端同步/账号体系 — 违背本地优先
- 移动端 — 非目标场景
- 全局前端状态层大规模重构 — 仅在阻塞具体需求时局部处理

## Traceability

| REQ | Phase | Plan | Status |
|-----|-------|------|--------|
| WIN-01..04 | Phase 1 | TBD | planned |
| ENG-01..05 | Phase 2 | TBD | planned |
| AI-01..05 | Phase 3 | TBD | planned |
| MEM-01..04 | Phase 4 | TBD | planned |
| FLOW-01..03 | Phase 5 | TBD | planned |
