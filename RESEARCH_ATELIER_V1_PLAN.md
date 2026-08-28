# Research Atelier v1 — 文件级改造计划（审计稿）

> 基准：Research Atelier v1 Implementation Spec（产品基准，用户已定稿）
> 审计时间：2026-08-28 · 范围：`workflow-app/`（不含 `node_modules/`、`.next/`、`release/`、`.build-cache/`）
> 性质：本文件只做 **保留 / 修改 / 新增 / 冻结** 的判定与文件级映射，**不含任何新设计**。
> 复核：2026-08-28 用户已复核，6 处修正已并入（见 §5 已拍板决策）；按 §4 从 P0 开工，不再做产品方向的大设计评审。
> 执行约束：后续执行 AI 不得重新设计产品方向；以本计划为唯一改造依据。

---

## 0. 审计结论（一句话）

现有代码已经具备 v1 需要的**全部底层能力**——PDF 阅读与术语高亮、conda 环境扫描、Codex thread→rollout JSONL 读取、git revision 检测、DeepSeek 对话——但**前台结构仍是"按工具导航"**（论文库/筛选/精读/术语/代码导读/复现六个平级入口），且复现页被 `materials→target→analyzing→decisions→ready` 五阶段 + Facts/Gap/Decision 逻辑占据。v1 的核心工作 = **把前台从"工具导航"翻转为"Paper Project 导航"**，在 Reproduction 上**新写**「当前→外部AI→Sync→讲解→下一步」主线，并把现有引擎（环境扫描、Codex 读取、git 检测）**抽成 v1 的通用服务**（ExecutionSessionAdapter、Sync）。

---

## 1. 现状盘点（模块 → 现有文件 → 判定）

| # | 模块 | 现有实现（文件） | 对照 spec | 判定 |
|---|---|---|---|---|
| 1 | 主界面导航 | `src/app/page.tsx`（rail：论文库/文献发现/论文筛选/精读讲解/术语卡/代码导读/实验复现） | §1 按项目导航、无 Overview、项目卡回上次模块 | **修改** |
| 2 | 论文库视图 | `src/components/paper-library.tsx`、`src/app/api/library/route.ts`、`data/library.json` | §2 Projects 首页（标题+venue/year+状态行+笔记数+环境，无日期/进度/阶段/Facts/Gap/测试数） | **修改**（venue/year 等元数据并入 projects.json；library.json 冻结为迁移源） |
| 3 | PDF 阅读 | `src/app/read/[slug]/page.tsx`、`src/components/full-reader.tsx`、`full-pdf-page.tsx`、`src/lib/pdf-alignment.ts`、`src/lib/translate.ts`、`terms-extract.ts`、`src/app/api/paper/route.ts`、`paper/pdf/route.ts`、`terms/route.ts`、`scripts/extract-pdf.mjs`、`translate-full.mjs`、`public/pdf.worker.min.mjs`、`public/pdfjs/` | §1 PDF 保留现有阅读逻辑（中文阅读/术语高亮/AI 讲解） | **保留**（阅读 UI/翻译/高亮/现有交互不重构；仅 AI 讲解的上下文注入层允许修改，见 §11） |
| 4 | 复现主页面 | `src/components/repro.tsx` + `repro-stage-{materials,target,analyzing,decisions,ready}.tsx`（五阶段 stepper + 决策中心 + 右侧环境） | §3 顶部四个上下文入口（当前环境/执行会话/笔记/历史）+ 当前/为什么/下一步 主线 + [交给AI继续][同步最新进展] | **重写前台**（旧 stage 文件冻结） |
| 5 | Facts/Gap/Decision 引擎 | `src/lib/fact-extract.ts`、`gap-detector.ts`、`mapping.ts`、`decision-translation.ts`、`fact-taxonomy.ts`、`analyze.ts`、`code-reader.ts`（含 getRepoRevision/buildRepositorySnapshot）+ `/api/reproduction/{analyze,facts,gaps,mappings,copilot,prompt,source,review}` | §15 Facts/Mapping 数据保留前台隐藏；Gap/Decision UI 冻结；旧 stages 不再作为新 UI 状态源 | **冻结**（数据/引擎保留，不接入 v1 UI 主线） |
| 6 | 环境 | `src/app/api/environments/route.ts`（conda 采样 + 基线对比已实现 added/removed 差异）、`src/components/environments-panel.tsx`、`system-panel.tsx`、`data/environments.json`（全局）、`data/environment.md` | §10 全局环境库 + 项目 environmentRefs[] + fingerprint | **修改**（加 fingerprint；项目引用放项目模型） |
| 7 | Codex 会话读取 | `src/app/api/reproduction/review/route.ts`（`~/.codex/state_5.sqlite` → rollout JSONL → user/assistant 消息；另支持 dsh `.jsonl`） | §4 抽成通用 `ExecutionSessionAdapter` | **修改**（抽取） |
| 8 | 代码导读 | `src/components/code-reading.tsx`（页面）、`code-read.tsx`（文件树+重点+attach）、`src/lib/code-reader.ts`（共享读取层）、`src/app/api/code-read/route.ts`、`code-profile/route.ts`、`scripts/py_chain.py` | §13 删除内部完整阅读器；保留「用 AI 读这段代码」；§14 固定 Skill | **冻结/移出导航**（页面冻结；读取层/调用链保留为后端能力） |
| 9 | 对话面板 | `src/components/chat-panel.tsx`（历史/提示词编辑/上下文注入/代码画像注入）、`src/lib/data.ts`（TOOLS 提示词）、`src/app/api/chat/route.ts`、`prompts/route.ts`、`session-history/route.ts` | §7 讲解注入；§11 讲解偏好；§12 Learning Memory；§14 Skill | **修改**（注入讲解偏好+Learning Memory；code 提示词换固定 Skill；去掉"已掌握→跳过"语义） |
| 10 | 文献发现/筛选 | `src/components/discovery.tsx`、`candidate-workbench.tsx`、`src/lib/search/*`（session/triage/plan/resolve/enrich/importer/terms/types 等）、`src/app/api/literature/*`、`src/app/api/chat`（search_papers/download_paper 工具）、`data/research-sessions/` | §1 文献发现冻结 | **冻结**（完全不动） |
| 11 | 术语卡 | `src/components/terms.tsx`、`src/app/api/terms/route.ts`、`data/glossary.json` | §1 PDF 术语高亮依赖 | **保留**（服务 PDF；不并入 Learning Memory） |
| 12 | 数据层 | `src/lib/store.ts`（文件/KV 适配） | §15 继续沿用 JSON store | **保留** |
| 13 | 桌面壳 | `electron/main.js`、`preload.js`、`electron-builder.yml`、`scripts/gen-runtime-config.mjs` | 未涉及 | **保留** |
| 14 | 死代码 | `src/components/workspace.tsx`、`dashboard.tsx`（仅 KnowledgeGraph 被 terms 引用）、`paper-pane.tsx`、`repro-copilot.tsx`、`repro-target.tsx`、`pdf-reader.tsx`、`pdf-reader-page.tsx`、`term-drawer.tsx`、`atelier/variant-*.tsx` | — | **冻结/建议删除**（无任何 import；`full-reader` 已取代 `pdf-reader`） |
| 15 | 复现数据 | `data/reproduction.json`（records：path/pitfalls/facts/mappings/decisions/analysis/…；pitfalls 带 createdAt） | §15 Pitfall→Notes；日期不进入新模型；§9 ProjectNote | **冻结**（迁移源：pitfalls→notes 由迁移脚本读出写入 projects.json；reproduction.json 本身不再演进） |

---

## 2. 按 spec 章节的改造计划

### §1 产品结构：Paper Project

- **新增** `src/lib/project.ts`
  PaperProject 模型与存储读写，落在**新建的 `data/projects.json`**（继续沿用 JSON store 的文件读写——spec §15 只要求"不引入数据库"，不是必须复用 reproduction.json）。`data/reproduction.json` **冻结为迁移源/旧数据**，不再承担项目中心。结构：

  ```ts
  PaperProject {
    id: string,                     // crypto.randomUUID()
    slug, title,
    venue?, year?,                  // 从 data/library.json 同名论文一次性迁移
    lastModule: "pdf" | "repro" | "notes" | "environment",   // 点卡回到上次打开模块
    notes: ProjectNote[],           // §9（id 用 crypto.randomUUID()）
    history: SyncRecord[],          // §8（id 用 crypto.randomUUID()）
    executionSessions: ExecutionSession[],  // §4（id 用 crypto.randomUUID()）
    environmentRefs: string[],      // §10（全局环境库 id）
    currentEnvironmentId?: string,
    legacy?: { reproductionSlug?: string; libraryPaperId?: string },  // 指向旧数据，仅供回查
  }
  ```

- **冻结** `src/lib/reproduction-spec.ts`、`src/lib/reproduction.ts`、`data/reproduction.json`：保持 v2 schema 原样作为旧数据存储；v1 前台不再读写（仅迁移脚本读一次）。
- **新增** 一次性迁移脚本 `scripts/migrate-v1.mjs`：library.json（venue/year/论文）与 reproduction.json（复现记录）按 slug/标题合并 → 写入 `data/projects.json`；`pitfalls[]` 转成 `notes[]`（丢弃 createdAt，source="pitfall-migration"）；无复现记录的库论文也生成项目（PDF 存在）；迁移后 reproduction.json / library.json **原样不动**。
- **新增** `src/app/api/projects/route.ts`：项目列表（卡面数据）/创建/删除/`lastModule` 回写。
- **修改** `src/app/page.tsx`：导航改为 Projects 首页优先；点项目卡 → 进入项目（默认上次模块）。

### §2 Projects 首页

- **修改** `src/components/paper-library.tsx` → 改造为项目卡网格（或**新增** `src/components/projects.tsx` 取代其渲染；原组件冻结）。
  卡面只含：论文标题、venue/year（有则显示）、状态行（如"模型已经可以训练，但尚未证明实际效果优于简单方法"——来自最近一条 History 或 Sync 讲解 result）、"N 条笔记 · 已关联环境"。
  明确**不渲染**：日期、更新时间、进度百分比、阶段编号、Facts/Gap 数量、测试数量。
- **修改** `src/app/page.tsx`：移除 `todayStamp()` 顶栏日期、rail 的"今天"标签、`studyDays()` 持续天数等日期类显示（spec §15 时间日期前台删除）。

### §3 Reproduction 主页面（v1 前台替换）

- **新增** `src/components/project-repro.tsx`（或重构 `repro.tsx`）——v1 主线：
  - 顶部横向四个上下文入口 `[当前环境] [执行会话] [笔记] [历史]`，点开在下方**共享展开区**显示，一次只展开一个；**不是页面导航**。
  - 主线区：`当前 / 为什么`、`下一步 / 为什么现在做` + `[交给 AI 继续]` `[同步最新进展]`。
- **修改** `src/components/repro.tsx`：删除五阶段 stepper 与 stage 路由（`stageOf` 等），改挂新主线；右侧环境列并入「当前环境」展开区。
- **冻结** `src/components/repro-stage-{materials,target,analyzing,decisions,ready}.tsx`：文件保留（数据/逻辑可查），不再作为 v1 渲染路径。
- **新增** `src/components/execution-sessions.tsx`、`src/components/notes.tsx`、`src/components/history.tsx`、`src/components/environment-refs.tsx`（四个展开区组件）。
- **修改** `src/app/api/reproduction/prompt/route.ts` → 「交给 AI 继续」只生成 §5 四要素 prompt（当前状态/下一步/为什么现在做/本轮希望回答的问题 + "遵循 AGENTS.md 执行"），不再拼接大段 profile/纪律模板（纪律移入项目 AGENTS.md）。

### §4 外部执行（执行会话）

- **新增** `src/lib/execution-session.ts`：`ExecutionSession { id, provider, threadId, deepLink, cursor }`；**抽取** `review/route.ts` 中现有逻辑（`CODEX_DB = ~/.codex/state_5.sqlite`、`readRolloutText`、`readDshSession`）为通用 `ExecutionSessionAdapter`：`bind(deepLink)`、`listSessions(projectId)`、`readNewMessages(session, afterCursor)`（按 cursor 增量，供 Sync 用）。
- **修改** `src/app/api/reproduction/review/route.ts` → 变成薄封装（或冻结，能力由 `/api/execution-sessions` 承接）。
- **新增** `src/app/api/execution-sessions/route.ts`：绑定（第一次填 deep link 后永久绑定）、列表、删除。
- 一个项目允许多个执行会话（正式模型复现/环境排错/其他任务）；绑定 UI 在「执行会话」展开区。

### §5 AGENTS.md 执行规范

- **新增** 模板资产 `src/lib/agents-template.ts`（或 `templates/AGENTS.md`）：固定文本（检查 Git 状态/不得覆盖用户修改/一个工作单元一个 commit/普通工程 bug 自主解决/科学含义变化不得擅自决定——数据定义、模型方法、loss、evaluation、论文目标/不改写交接前 Git 历史）。
- **新增** 能力：项目绑定的代码仓库根（或 `reproduction/` 目录）不存在 `AGENTS.md` 时，应用可一键写入该模板（`src/app/api/projects/route.ts` 加 action 或独立 route）。
- **修改** `src/app/api/reproduction/prompt/route.ts`（同上 §3）。

### §6 Sync（v1 最重要新后端）

- **新增** `src/lib/sync.ts`：
  - `captureBaseline(project)` → `SyncBaseline { gitHead, gitDirtySnapshot, untrackedFiles, sessionCursors, environmentFingerprint }`，**不含任何用户可见时间日期**；存 `data/sync-baselines/<slug>.json`。
  - `diffBaseline(baseline, current)` → `SyncEvidence { git: { commits, changedFiles, workingTreeChanges }, conversations: { newMessages }, environment: { addedPackages, removedPackages, changedPackages } }`。
  - 复用：`code-reader.ts` 的 `getRepoRevision`（commit/dirty）、`execution-session.ts` 的 `readNewMessages`、`environments/route.ts` 的基线对比逻辑（提取为共享 `src/lib/environment.ts`：采样 + fingerprint + diff）。
  - 原则：**程序负责检测事实，AI 不参与"是否变化"的判定**。
- **新增** `src/app/api/sync/route.ts`：POST 同步 → 返回 `SyncEvidence`；同步**直接发生**，无"接受同步"步骤。
- 环境 fingerprint 在 `src/app/api/environments/route.ts`（**修改**）输出：对**完整规范化 package 列表**（name+version 排序后）做确定性 hash（含 python/torch 版本）。**不用 KEY_RE 特征包子集做指纹**——未命中 KEY_RE 的依赖变更也必须算作"环境变了"；UI 只负责展示时过滤出重要/特征包变化。

### §7 Sync 讲解

- **新增** `src/app/api/sync/explain/route.ts` + `src/lib/sync-explain.ts`：Evidence 获取完成后才调 AI 解释，输出 `SyncExplanation { result, meaning, limitation, nextStep, noteSuggestions[] }`。
- **新增** UI（repro 主线下方）：默认显示 `本轮结果 / 这意味着 / 下一步` + `[查看完整讲解]`；完整讲解含 发生了什么/为什么/意味着什么/还不能说明什么/重要代码变化/实验依据/执行对话依据/环境变化。
- **修改** 讲解持久化：每次同步产生一条 `SyncRecord { id, evidence, explanation }`（id 用 crypto.randomUUID()）追加进 `project.history`，**最新一条即当前讲解**（本轮结果/这意味着/下一步 取它）；下次同步追加新记录，旧证据不丢。允许用户 `[修改]`/`[这段理解不对]`（只改写 explanation，evidence 只读不可改）。noteSuggestions 显示 `[编辑并保存]` `[忽略]`（§9）。
- **新增** 完整讲解中"重要代码变化"一节：当 evidence.git 含重要代码变化时，该处提供 `[用 AI 读这段代码]` 入口（§13），仍不恢复独立代码阅读页面。

### §8 History（科研复现历史）

- **新增** `src/app/api/history/route.ts` + 项目模型 `history: SyncRecord[]`：每条 = `{ id, evidence, explanation }`（完整 SyncRecord，§7），点开能看到**当时的完整讲解 + Git/对话/环境 Evidence**；数组顺序即历史顺序；**不显示日期**。
- **写入时机**：只有 `SyncEvidence` 存在**实际新增内容**（commits / newMessages / 环境包变化 任一非空）才追加；空同步只更新 cursor/baseline，**不产生历史条目**。
- Git commit 只作为某条记录的底层证据（`evidence.git.commits`），不渲染日期。
- 用户可编辑/删除条目（同 §7：只改 explanation，不碰 evidence）。

### §9 Notes

- **新增** `src/lib/notes.ts` + `src/app/api/notes/route.ts` + 项目模型 `notes[]`：`ProjectNote { id, projectId, title, content, tags[], pinned?, source? }`；支持 新建/编辑/删除/置顶/标签；**无日期字段**；`id` 用 `crypto.randomUUID()`（不沿用 Date.now() 式 idFor）。
- **修改** 迁移：`pitfalls[]` → notes（source="pitfall-migration"，丢弃 createdAt）；前台删除独立 Pitfall 概念。
- AI 只能通过 `SyncExplanation.noteSuggestions` 建议，**绝不自动写入**；用户 `[编辑并保存]`/`[忽略]` 后落库。

### §10 Environment

- **修改** `src/app/api/environments/route.ts`：保持全局环境库语义（已全局化），输出 `fingerprint`（完整规范化 package 列表 hash，见 §6）；把 conda 采样/基线对比抽为共享 `src/lib/environment.ts` 供 Sync 复用。
- **修改** 项目模型：`environmentRefs[]`（全局环境库 id）+ `currentEnvironmentId?`；项目**不复制**环境。
- **修改** `src/components/environments-panel.tsx`（或新增关联选择器）：项目内"关联环境/设为当前"；同步时比较 fingerprint。
- **保留** `data/environments.json`（用途/阶段标注）、`data/environment.md`（环境卡，仍可作对话上下文）。

### §11 讲解偏好

- **新增** `src/lib/explain-preferences.ts` + `src/app/api/explain-preferences/route.ts` + `data/explain-preferences.json`：全局规则列表，用户 `+ 添加规则 / 编辑 / 删除`（如"代码讲解优先沿真实调用链和数据流展开"）。
- **新增** 入口「和 AI 一起调整讲解方式」：复用 `ChatPanel`（新 toolKey，如 `pref`），AI 依据 当前偏好 + 本聊天描述 + 用户提供的好/坏案例，提出 新增/修改/删除，**用户确认后**经 API 应用。
- **修改** `src/components/chat-panel.tsx` + `src/components/full-reader.tsx`：PDF 讲解、Reproduction 对话自动注入当前讲解偏好。**边界**：full-reader 只改 AI 讲解抽屉的上下文注入层（systemExtra / 偏好注入）；PDF 阅读 UI/翻译/高亮/现有交互不重构（与 §1 row 3 一致）。
- **禁止项**：不扫描历史会话自动推断/自动修改偏好；普通 PDF/Reproduction/外部 ChatGPT 会话不得自动更新讲解偏好（现有 code-profile 的"读后自动写画像"逻辑不得复制到讲解偏好上）。

### §12 Learning Memory

- **新增** `src/lib/learning-memory.ts` + `src/app/api/learning-memory/route.ts` + `data/learning-memory.json`：只记录"以前接触过什么"，如 `{ id, concept, where: "NSR 项目", context: ["坐标", "feature", "稀疏卷积", "输出坐标变化"] }`；**不记录**掌握度/熟练度/百分比/"已学会"。
- **写入机制（v1 明确，防回滑）**：① **不扫描普通聊天自动提炼** Learning Memory（与讲解偏好的禁令同源）；② 用户可手动添加/编辑/删除；③ AI 可在对话中**建议"保存为学习经历"**（结构化 suggestion，机制同 noteSuggestions），**用户确认后才写入**。API 只接受「用户手动」或「用户确认后」两类写入。
- **修改** `src/components/chat-panel.tsx`：注入方式改为"以前接触过 → 可以尝试连接旧经验"，**删除** code-profile `mastered` 的"已掌握→不重讲/跳过"语义（该语义与 spec §12 冲突）。
- `data/code-profile.json`（背景/卡点/偏好）**保留**为代码讲解参考，但 `mastered[]` 语义调整或停用。

### §13 Code Reading（删除内部完整阅读器）

- **冻结/移出导航**：`src/components/code-reading.tsx`、`code-read.tsx`；`src/app/page.tsx` 移除"代码导读"rail 入口。
- **保留**（作为后端能力）：`src/lib/code-reader.ts`、`src/app/api/code-read/route.ts`、`scripts/py_chain.py`。
- **新增** `src/lib/code-read-context.ts`：生成"用 AI 读这段代码"上下文包（当前论文/当前复现问题/为什么现在看这段代码/代码入口/上下游/相关论文位置/相关 Learning Memory/相关讲解偏好），交给 `ChatPanel`（toolKey "code"，走 §14 Skill 提示词）。**两个入口，均不恢复独立页面**：① Reproduction 下一步区（"读这段代码"小入口）；② 同步完整讲解的"重要代码变化"处（§7）。

### §14 Code Reading Skill（固定"怎么讲"）

- **修改** `src/lib/data.ts` 中 `TOOLS.code.prompt`：替换为 spec §14 固定 Skill 文本（先解释为什么现在读它 → 找到真实调用入口 → 沿一次真实数据流 输入→数据变化→输出→下一位使用者 → 只在阻碍理解时补 Python/PyTorch/库知识 → 首次遇到重要神经网络操作用当前真实数据给最小例子 → 始终连接回论文和当前复现问题 → 不用一次读完整个文件 → 最后告诉用户 必须理解什么/现在可以先跳过什么）。
- 现有 `code-profile` 画像注入（gaps/preferences）保留，但按 §12 调整 mastered 语义。

### §15 数据迁移原则

| 现数据 | 迁移去向 | 落点 |
|---|---|---|
| `data/papers/<slug>`（PDF/原文/译文） | 保留 | 不变 |
| `data/environments.json` + `environment.md` | 保留 | 不变 |
| `data/library.json`（论文元数据：venue/year/分组/当前在读） | **冻结为迁移源**：venue/year 并入 projects.json | 由 migrate-v1.mjs 只读一次 |
| `data/reproduction.json`（v2 schema，含 path/facts/mappings/decisions/analysis） | **冻结为迁移源**：数据原样保留，v1 前台不再读写 | 由 migrate-v1.mjs 只读一次 |
| `reproduction.json` `pitfalls[]`（含 createdAt） | → `notes[]`（丢弃 createdAt） | migrate-v1.mjs 写入 projects.json |
| `reproduction.json` `facts/mappings` | 数据保留，前台隐藏 | 留在旧文件原样不动 |
| Gap/Decision UI（`repro-stage-decisions.tsx`、`gaps/route.ts`） | 冻结 | 文件保留不接入 |
| 旧固定 stages（`path[]` + `repro-stage-*.tsx` + `stageOf`） | 冻结，不再作为新 UI 状态源 | 文件保留不接入 |
| Code Reading UI（`code-reading.tsx`/`code-read.tsx`） | 冻结/移出导航 | 文件保留不接入 |
| Literature Discovery（`discovery.tsx`、`search/*`、`literature/*`） | 冻结 | 完全不动 |
| 时间日期类前台信息（顶栏日期/卡片日期/持续天数/updatedAt 展示） | 删除 | 前台不再渲染；新模型不建日期字段 |

> **ID 约定**：新模型（PaperProject / ProjectNote / SyncRecord / ExecutionSession）的 id 一律用 `crypto.randomUUID()`，不沿用现有 `Date.now()` 式 `idFor`；旧 id（`pf-`/`st-`/`f-`/`m-`…）不需要迁移。

---

## 3. 文件动作总表

### 保留（不动）

```
src/app/read/[slug]/page.tsx
src/components/full-pdf-page.tsx（full-reader 移入"修改"：阅读层保留、仅 AI 讲解注入层可改）
src/lib/pdf-alignment.ts  src/lib/translate.ts  src/lib/terms-extract.ts
src/app/api/paper/route.ts  src/app/api/paper/pdf/route.ts  src/app/api/terms/route.ts
src/app/api/chat/route.ts（含 search_papers/download_paper 工具，服务筛选）
src/app/api/session-history/route.ts  src/app/api/prompts/route.ts
src/components/terms.tsx  src/components/page-head.tsx  src/components/markdown.tsx
src/lib/store.ts
electron/main.js  electron/preload.js  electron-builder.yml  scripts/gen-runtime-config.mjs
scripts/extract-pdf.mjs  scripts/translate-full.mjs  public/pdf.worker.min.mjs  public/pdfjs/  public/papers/nsr.pdf
data/papers/  data/glossary.json  data/environments.json  data/environment.md
文献发现整组：src/components/discovery.tsx  src/components/candidate-workbench.tsx
  src/lib/search/*  src/app/api/literature/*  data/research-sessions/
```

### 修改

```
src/app/page.tsx                       # 导航重构：Projects 优先、移除代码导读入口、删日期显示
src/components/paper-library.tsx       # 或冻结，由 projects.tsx 取代
src/components/repro.tsx               # v1 主线 + 四个上下文入口 + [交给AI继续][同步最新进展]
src/components/chat-panel.tsx          # 注入讲解偏好+Learning Memory；去掉"已掌握→跳过"；新增 pref 模式
src/components/full-reader.tsx         # 仅 AI 讲解抽屉注入讲解偏好（阅读 UI 不重构）
src/components/environments-panel.tsx  # 项目关联环境/设当前（或新增关联组件）
src/lib/data.ts                        # TOOLS.code → §14 固定 Skill；新增 pref 工具
src/app/api/environments/route.ts      # 抽共享环境层 + fingerprint（完整 package 列表 hash）
src/app/api/reproduction/review/route.ts  # 抽取 adapter 后变薄封装（或冻结）
src/app/api/reproduction/prompt/route.ts  # §5 四要素交接 prompt
```

### 新增

```
src/lib/project.ts                     # PaperProject 模型 + 存储（data/projects.json，含 lastModule）
src/lib/notes.ts                       # ProjectNote CRUD
src/lib/history.ts                     # SyncRecord 读写（history[]：{id, evidence, explanation}）
src/lib/execution-session.ts           # ExecutionSessionAdapter（抽取自 review/route.ts）
src/lib/environment.ts                 # conda 采样/fingerprint（完整 package 列表）/diff 共享层
src/lib/sync.ts                        # SyncBaseline / SyncEvidence 检测
src/lib/sync-explain.ts                # SyncExplanation（AI 讲解，独立于证据）
src/lib/explain-preferences.ts         # 讲解偏好规则
src/lib/learning-memory.ts             # 接触记录（exposure-only；仅手动/确认后写入）
src/lib/code-read-context.ts           # "用 AI 读这段代码"上下文包
src/lib/agents-template.ts             # 项目 AGENTS.md 固定模板
src/components/projects.tsx            # Projects 首页项目卡网格
src/components/project-repro.tsx       # v1 Reproduction 主线（当前/为什么/下一步）
src/components/execution-sessions.tsx  # 展开区：绑定/列表
src/components/notes.tsx               # 展开区：Notes CRUD + 建议采纳
src/components/history.tsx             # 展开区：科研复现历史（SyncRecord 详情）
src/components/environment-refs.tsx    # 展开区：关联环境
src/components/preferences.tsx         # 讲解偏好管理 + 和AI一起调整入口
src/app/api/projects/route.ts          # 项目列表/创建/删除/lastModule/写 AGENTS.md
src/app/api/notes/route.ts
src/app/api/history/route.ts
src/app/api/execution-sessions/route.ts
src/app/api/sync/route.ts              # POST → SyncEvidence（同步直接发生）
src/app/api/sync/explain/route.ts
src/app/api/explain-preferences/route.ts
src/app/api/learning-memory/route.ts
scripts/migrate-v1.mjs                 # library.json + reproduction.json → data/projects.json（源冻结）
data/projects.json                     # 项目中心（迁移脚本生成，之后为唯一项目存储）
data/sync-baselines/<slug>.json        # 运行时生成
data/explain-preferences.json  data/learning-memory.json  # 运行时生成
```

### 冻结（保留文件，不再接入 v1 UI；可归档到 `src/components/_legacy/`）

```
src/components/repro-stage-{materials,target,analyzing,decisions,ready}.tsx
src/components/repro-copilot.tsx  src/components/repro-target.tsx
src/components/code-reading.tsx  src/components/code-read.tsx
src/app/api/reproduction/route.ts（旧项目/步骤/坑点 API，冻结；新入口走 /api/projects）
src/app/api/reproduction/{analyze,facts,gaps,mappings,copilot,source}/route.ts
src/lib/analyze.ts  src/lib/fact-extract.ts  src/lib/gap-detector.ts
src/lib/mapping.ts  src/lib/decision-translation.ts  src/lib/fact-taxonomy.ts
src/lib/reproduction-spec.ts  src/lib/reproduction.ts（v2 schema，冻结为迁移源）
data/reproduction.json  data/library.json（冻结为迁移源，migrate-v1.mjs 只读）
```

### 冻结（已死代码，无任何 import；建议后续清理删除）

```
src/components/workspace.tsx  src/components/dashboard.tsx（KnowledgeGraph 移到 terms 后即可删）
src/components/paper-pane.tsx  src/components/term-drawer.tsx
src/components/pdf-reader.tsx  src/components/pdf-reader-page.tsx
src/components/atelier/variant-{atelier,mori,os}.tsx
```

---

## 4. 实施顺序（每阶段可独立验收，不阻塞后续）

| 阶段 | 内容 | 验收 |
|---|---|---|
| **P0 数据层** | `data/projects.json` 项目中心：`project.ts`/`notes.ts`/`history.ts`/`execution-session.ts`/`environment.ts`/`sync.ts` 类型与存储 + `migrate-v1.mjs`（library.json + reproduction.json → projects.json，源冻结） | 迁移生成 `data/projects.json`：pitfalls→notes、venue/year 并入、PDF-only 项目也生成；`reproduction.json`/`library.json` 原样未动；facts/mappings 留在旧文件未丢；`npm run lint`/迁移单测过 |
| **P1 项目壳** | Projects 首页 + 项目卡（标题/venue/year/状态行/笔记数/环境）+ lastModule 记忆 + 日期类前台删除 | 点卡进入 PDF 或 Reproduction，刷新后回到上次模块 |
| **P2 Repro 主线** | v1 Reproduction 页：四入口展开区 + 当前/为什么/下一步 + 执行会话绑定 + 交接 prompt（§5 四要素） | 可绑定 codex:// deep link、生成四要素交接 prompt |
| **P3 Sync + 讲解** | `/api/sync` + `/api/sync/explain` + History（SyncRecord 追加，**仅实际变化时**）+ noteSuggestions 采纳流 | 同步产生 Evidence（git/对话/环境三路）；空同步不产生历史条目；讲解可修改且不碰证据 |
| **P4 Notes/Environment 关联** | Notes 完整 CRUD/置顶/标签；环境关联 + fingerprint | 笔记与历史出现在项目内；环境引用不复制 |
| **P5 讲解偏好 + Learning Memory + Skill** | 偏好规则管理 + "和AI一起调整" + exposure-only 记忆 + code Skill 提示词 + 移出代码导读导航 | PDF/Repro 对话带偏好；无"已掌握→跳过"行为 |
| **P6 前台清理** | 冻结文件归档、globals.css 增 v1 样式、rail 导航收尾 | 全页面无日期显示；死代码清理后构建通过 |

---

## 5. 已拍板决策（2026-08-28 用户复核，含本轮 6 处修正）

以下决策已定，执行 AI 不再需要产品方向上的二次确认（不再做"大设计评审"）：

1. **项目存储 = `data/projects.json`**：新文件作为唯一项目中心；`reproduction.json` / `library.json` 冻结为迁移源，不再演进。
2. **History = `history: SyncRecord[]`**：每条保存完整 `{id, evidence, explanation}`；**仅在 SyncEvidence 有实际新增内容时追加**；空同步只更新 cursor/baseline。
3. **Environment fingerprint = 完整规范化 package 列表**（name+version 排序后 hash）；UI 只展示重要/特征包变化；KEY_RE 子集不得用于"环境是否变化"判定。
4. **术语卡保留**（PDF 高亮依赖），其"掌握状态"不进入 Learning Memory。
5. **执行会话第一版**只支持 Codex（state_5.sqlite）与 DSH `.jsonl`；其他 provider 走 ExecutionSessionAdapter 接口扩展。
6. **「用 AI 读这段代码」两个入口**：Reproduction 下一步区 + Sync 完整讲解"重要代码变化"处；均不恢复独立代码阅读页面。
7. **Learning Memory 写入**：不扫描普通聊天自动提炼；用户手动添加；AI 建议"保存为学习经历" → 用户确认后才写入。
8. **新模型 ID 一律 `crypto.randomUUID()`**，不沿用 `Date.now()` 式 idFor；旧 id 不迁移。
9. **full-reader 边界**：PDF 阅读 UI/翻译/高亮/现有交互不重构；仅 AI 讲解上下文注入层可修改。
10. **`code-profile.json` 的 `mastered[]`**：停用"已掌握→不重讲/跳过"语义（改 exposure 提示），字段保留但不再注入为跳过指令。

> 本计划是执行 AI 的唯一改造依据；未列入本计划的任何"新设计"都不在 v1 范围内。
