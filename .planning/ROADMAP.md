# Roadmap: Research Atelier v1.1

## Overview

v1.1 里程碑把已基本成形的科研入门学习工作台改造为 Windows 上可安装、可分发、AI 讲解真实化的工具：先解决 Windows 发布阻断项，再补工程化地基（CI/清理/测试）为后续改动兜底，然后把产品核心价值主张（AI 讲解闭环）从规则模板升级为真实 AI，落地"数据即记忆"的学习记忆升级（FSRS/一键制卡/glossary 预扫），最后打磨"读一篇论文"单一闭环并发布。

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

- [x] **Phase 1: Windows 一等公民** - 可安装、可运行、可分发
- [x] **Phase 2: 工程化地基** - CI、类型安全、清理、关键测试
- [ ] **Phase 3: AI 讲解闭环真实化** - 规则模板 → 真 AI，带引用锚定
- [ ] **Phase 4: 学习记忆升级** - FSRS、标注一键变卡、glossary 预扫
- [ ] **Phase 5: 单篇闭环打磨与发布** - 冷启动引导、golden path 实测、v1.1 发布

## Phase Details

### Phase 1: Windows 一等公民
**Goal**: 用户可在 Windows 上安装并完整使用本应用；消除所有 Linux 专属假设
**Depends on**: Nothing (first phase)
**Requirements**: WIN-01, WIN-02, WIN-03, WIN-04
**Success Criteria** (what must be TRUE):
  1. `npm run dist:win` 产出 NSIS 安装包，安装在干净 Windows 10/11 后应用启动且核心功能（导入 PDF、阅读标注、术语复习）可用
  2. 环境探测 API（environments/code-read）在 Windows 上返回真实结果（探测 conda/python），无 Linux 硬编码路径残留（grep 不到 `/home/ark`、`miniconda3/bin`、`/etc/os-release`）
  3. 退出应用后任务管理器中无残留 node/next 子进程
  4. 数据目录落 `%APPDATA%/research-atelier`，README 有 Windows 与 Linux 双平台快速开始
**Plans**: 3 plans

Plans:
- [x] 01-01: electron-builder 增加 win/nsis target + 打包脚本 + 打包后冒烟验证
- [x] 01-02: 跨平台命令/路径探测层（conda/python/sqlite/GPU/zenity→无则降级）+ Windows 数据目录 + 进程清理
- [x] 01-03: 文档与 .env.local.example 修正（Windows 快速开始）

### Phase 2: 工程化地基
**Goal**: CI 绿灯 + 类型安全 + 代码库清理，为后续功能改动提供兜底
**Depends on**: Phase 1
**Requirements**: ENG-01, ENG-02, ENG-03, ENG-04, ENG-05
**Success Criteria** (what must be TRUE):
  1. GitHub Actions 在 windows-latest 上跑 typecheck+lint+test 全绿
  2. `npm run typecheck` 本地零错误
  3. 死代码与 .orig 清除后应用行为不变（冒烟验证）；冻结模块归档到明确的 frozen 目录
  4. sync/projects/handoff 路由测试存在且通过
**Plans**: 3 plans

Plans:
- [x] 02-01: 死代码清理 + .orig 清除 + atelier 变体归档 src/frozen/ + scripts/ 只留工具（含 19 个手工 test-*.mjs 整理）
- [x] 02-02: typecheck/lint 脚本 + lint 错误清零 + CI workflow（windows-latest）
- [x] 02-03: sync/projects/handoff 核心 API 路由测试补齐（node:test 直调 handler）

### Phase 3: AI 讲解闭环真实化
**Goal**: Paper Project 讲解由 DeepSeek 真实生成，带引用锚定与诚实的不确定性，配置零门槛 —— 兑现"越用越懂你"的产品主张
**Depends on**: Phase 2
**Requirements**: AI-01, AI-02, AI-03, AI-04, AI-05
**Success Criteria** (what must be TRUE):
  1. Sync 后讲解内容来自 DeepSeek 调用（可在 UI 看到与规则模板明显不同的、基于项目上下文的讲解）
  2. 讲解中涉及论文具体内容的陈述可点击跳转到 PDF 对应页
  3. AI 推断内容与论文原文陈述在 UI 上有可区分的标注
  4. 修改讲解偏好后，下次讲解的详细程度/覆盖范围随之变化
  5. 全新安装且无 .env.local 时，首启出现 API key 配置引导，填入后无需重启即可用 AI 功能
**Plans**: TBD (3 plans 预估)

Plans:
- [ ] 03-01: /api/sync/explain 接入 DeepSeek（项目上下文注入：论文/阶段/术语卡/问题池）+ explain-preferences
- [ ] 03-02: 引用锚定（页级跳转）+ 诚实不确定性标注 UI
- [ ] 03-03: 首启 key 检测与配置引导向导

### Phase 4: 学习记忆升级
**Goal**: "数据即记忆"落地 —— 标注一键变卡、FSRS 调度、glossary 预扫、学习画像累积
**Depends on**: Phase 3
**Requirements**: MEM-01, MEM-02, MEM-03, MEM-04
**Success Criteria** (what must be TRUE):
  1. 在 PDF 阅读器中选中高亮后 < 30 秒完成一张预填 8 字段的术语卡确认入库
  2. 复习调度使用 FSRS，既有卡片数据迁移后复习队列不丢失、不重置
  3. 导入新 PDF 后，术语面板中已建档术语标"已见"，未建档术语出现在首次出现提示中
  4. 讲解同一概念第二次出现时篇幅明显短于首次（画像生效的代理验证）
**Plans**: TBD (3 plans 预估)

Plans:
- [ ] 04-01: 标注→术语卡一键转换（8 字段预填 + 确认 UI）
- [ ] 04-02: ts-fsrs 集成 + 旧 study-model 数据迁移
- [ ] 04-03: glossary 导入预扫（已见标记/首次出现提示）+ exposure 画像记录与讲解适配

### Phase 5: 单篇闭环打磨与发布
**Goal**: 新用户 10 分钟内从安装到读完第一篇论文的导读；v1.1 发布
**Depends on**: Phase 4
**Requirements**: FLOW-01, FLOW-02, FLOW-03
**Success Criteria** (what must be TRUE):
  1. 全新用户（无数据）首启被向导带领导入第一篇 PDF 并完成首次导读，无需读文档
  2. golden path（导入→首读→术语卡→精读讲解→复习）在打包后的 Windows 安装版中端到端手动实测通过，无阻断
  3. 版本号更新为 1.1.0，产出带更新说明的 Windows 安装包
**Plans**: TBD (2 plans 预估)

Plans:
- [ ] 05-01: 冷启动首启向导（key 配置 + 首篇论文导入 + 首次导读）
- [ ] 05-02: golden path 端到端实测（打包版浏览器/桌面双验证）+ 版本号与发布

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3 → 4 → 5

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Windows 一等公民 | 3/3 | Complete | 2026-10-17 |
| 2. 工程化地基 | 3/3 | Complete | 2026-10-20 |
| 3. AI 讲解闭环真实化 | 0/3 | Not started | - |
| 4. 学习记忆升级 | 0/3 | Not started | - |
| 5. 单篇闭环打磨与发布 | 0/2 | Not started | - |
