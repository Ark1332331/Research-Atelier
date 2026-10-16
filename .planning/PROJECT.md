# Research Atelier

## What This Is

本地优先的科研入门个人学习工作台（Windows 桌面，Electron + Next.js）：帮中文科研入门者完成"拿到一篇论文 → 筛选 → 导读 → 精读 → 术语沉淀 → 复现检查点"的单一闭环，AI 讲解全程内置论文/阶段/术语卡上下文，学习产物以纯文本落盘、可被任何 agent 读取。本里程碑（v1.1）目标是把它改造成 Windows 上可安装、可分发、AI 讲解真实化的好用工具。

## Core Value

把"读一篇论文"的单一学习闭环在 Windows 上做顺：AI 讲解基于学习者真实知识状态，学习产物沉淀为可复用的记忆（数据即记忆）。

## Requirements

### Validated

<!-- 已实现并可靠运行的能力（从现有代码推断） -->

- ✓ 本地 PDF 导入、阅读、持久高亮、选词翻译、悬停释义 — existing
- ✓ 文献发现/筛选（OpenAlex 检索、Query Ladder、去重、证据门控）— existing（冻结，不再扩展）
- ✓ 术语卡 8 字段建模与间隔回忆（复述证据门控）— existing
- ✓ 受控学习：候选 → 审核 → 应用 → 反馈 → 回退 — existing
- ✓ Paper Project 中心骨架：projects.json、项目壳、repro 主线、handoff — existing
- ✓ Electron 桌面壳：端口探测、数据目录迁移、原生目录选择、单实例锁 — existing

### Active

- [ ] 见 .planning/REQUIREMENTS.md（v1.1 全量需求，按 REQ-ID 追踪）

### Out of Scope

- 激活旧复现引擎/复现五阶段重写 — V1 已判定冻结；复现工作流仅保留检查点与证据链展示
- 文献发现模块功能扩展 — 冻结；现有 OpenAlex 检索够用
- 云端同步 / 多设备 / 账号体系 — 违背本地优先原则
- Zotero/Mendeley 导入集成、多篇综述综合 — v2 再议
- 本地 LLM（Ollama）支持 — v2 再议；当前仅 DeepSeek
- 移动端 — 非目标用户场景
- 全局前端状态层重构（React Query 等） — 除非阻塞具体需求，不做大规模重构

## Context

- **原始设计**：`D:\devpy\projects\allinone`（设计意图、50+ 条用户画像、P0–P5 蓝图、评审决定）。关键设计决定见 `.planning/research/ORIGINAL-DESIGN.md`，勿违反其中评审结论。
- **现状差距**：Windows 无法出包（electron-builder 仅 linux）；AI 讲解为规则模板非真 AI；无 CI/typecheck；死代码与 .orig 残留。详见 `.planning/research/CURRENT-STATE.md`。
- **市场对标**：table stakes 与差异化机会（引用锚定、一键制卡、FSRS、配置零门槛）见 `.planning/research/MARKET.md`。
- **目标用户**：中文科研入门者（本科生/低年级研究生），Windows，英文术语基础弱，掌控感优先于效率。
- **AI 依赖**：DeepSeek API，key 在 `.env.local`（gitignored）。

## Constraints

- **Tech stack**: 保持 Next.js 16 App Router + Electron 43 + 纯 JSON 数据层 — V1 架构已定型，不推倒重来
- **Compatibility**: Windows 10/11 优先（用户实际环境），Linux/macOS 行为不回归
- **Data**: 既有 `data/*.json` 结构兼容 — 升级需迁移脚本，不可破坏用户数据
- **Dependencies**: 新增依赖最小化；SRS 用 ts-fsrs 而非自研
- **Security**: API key 只存 .env.local，永不入库、永不出现在规划/日志文档
- **Design principles**: 遵守 allinone 评审决定（术语首次出现即建档、评分表→改动对照表、画像先提议经同意写入等）

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| v1.1 里程碑聚焦"Windows + 工程化 + AI 真实化 + 学习记忆"，不铺新功能 | 设计评审与市场失败模式共同指向：单一闭环做顺 > 功能大而全 | — Pending |
| SRS 采用 ts-fsrs 开源库替换自研 study-model | FSRS 同等记忆率少 20-30% 复习量；自研维护成本高 | — Pending |
| AI 讲解必须带句子级引用锚定 + 诚实的不确定性标注 | 反幻觉是 AI 工具生死线（市场调研） | — Pending |
| 规划用 GSD（get-shit-done）框架管理 | 用户指定；.planning/ 入库随代码演进 | — Pending |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd-transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd-complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-10-16 after initialization (v1.1 milestone planning)*
