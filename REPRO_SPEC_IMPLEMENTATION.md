# Research Atelier → Paper-to-Reproduction Compiler 实现方案

> 状态：**方案待确认**（未开始实现）。用户确认本方案可行后，按 §8 开发顺序逐步落地。
> 配套设计文档：`../paper_repro_compiler.md`（产品定位 + NSR 走查 + token 审计证据）。
> 本文只写"改什么 / 怎么改 / 落在哪个文件 / 验收是什么"，不写代码。

---

## 0. 产品核心（一句话定调）

> Research Atelier 的核心任务，不是替用户复现论文，而是在 **Codex 开始工作之前**，把论文、代码、环境和用户决策编译成一个低歧义、可验证、最小上下文的 **Reproduction Spec**。

一切改动围绕这条纵向主轴；横向功能（终端/IDE/Git/自己训练）**不做**。

---

## 1. 现状盘点（已核对真实代码）

| 模块 | 现状 | 判断 |
|---|---|---|
| 论文库/阅读 | `/api/paper` + PDF reader | 保留 |
| 论文筛选 | OpenAlex + DeepSeek function calling | 保留 |
| 代码读取 | `/api/code-read`，`ALLOWED_EXT = [.py,.ts,.tsx,.js,.jsx,.mjs]` | 保留；**扩展可读类型** |
| Python 调用链 | `scripts/py_chain.py`（AST） | 保留；喂给 Repo Analyzer |
| 代码画像 | `/api/code-profile` | 保留；**默认不进 Codex 上下文**（Human Context） |
| 环境 | `/api/environments`（真实采样 + 基线对比） | 保留；**升级为 Environment Resolver**（Desired vs Actual vs Diff vs Plan） |
| 复现数据 | `reproduction.ts`：`{path: Step[], pitfalls: Pitfall[]}` | **重构为 ReproductionSpec**（地基） |
| 坑点 | `reproduction.pitfalls`（含 env/stage/threads） | 保留；升级为 Failure Record 跨论文复用 |
| Codex 复盘 | `/api/reproduction/review`（读本机 codex threads） | 保留；升级为增量 Failure Interpreter |
| Prompt | `/api/reproduction/prompt`（拼接大 Prompt） | 降级为展示层；核心换成 `tasks` + `context-packet` |
| 上下文 | `/api/context`（返回整份 markdown） | **重做为 Context Router**（按任务算 token 预算组装最小包） |
| 页面 | `repro.tsx`：手动加步骤 + "生成整篇提示词到 GPT 那边拆" | 改为 Target→Facts→Align→Gaps→Decisions→Env→CodexPlan 流水线；Ready gate |
| 工作流定义 | `stages.ts` P4 已要求"证据账本（命令/文件/行号可追溯）" | **设计与实现脱节**：数据模型无 evidence，需补 |

---

## 2. 核心改动一：Reproduction 数据模型 → ReproductionSpec

文件：`src/lib/reproduction.ts` + `data/reproduction.json`（**向后兼容迁移**：旧记录缺字段时用默认值，不丢数据）。

```ts
ReproductionSpec {
  identity:  { slug, title, sourceUrl?, repoUrl? }
  target:    { type: "table"|"figure"|"metric"|"full"|"custom",
               name, metric, expected?, tolerance? }        // §3
  paperFacts: Fact[]     // 论文侧事实，带来源+置信度       // §4
  repoFacts:  Fact[]     // 代码侧事实，带文件+行号         // §4
  mappings:   Mapping[]  // 论文概念 ↔ 代码 ↔ config        // §6
  gaps:       Gap[]      // 缺失/冲突/风险，分级             // §5
  decisions:  Decision[] // Decision Ledger                  // §5
  environment?: EnvPlan  // Desired/Actual/Diff/Plan         // §7
  tasks:      CodexTask[]// Task Compiler 产物               // §8
  evidence:   Evidence[] // 证据账本（P4 要求）              // §9
  readiness:  { target:boolean, facts:boolean, repo:boolean,
                env:boolean, criticalGaps:number,
                pendingDecisions:number, acceptance:boolean,
                score:number }                               // §10
  path: Step[]        // 保留：复现路径（历史兼容）
  pitfalls: Pitfall[] // 保留：坑点（历史兼容 + Failure Record）
}

Fact {
  key: "training.batch_size"   // 点分路径，跨侧可比
  value: unknown
  source: { kind:"paper", section?, page?, quote? }
        | { kind:"repo", file, line? }
  confidence: "confirmed"|"inferred"|"missing"   // 禁止 AI 假装知道
}
```

**为什么先做这个**：所有后续模块（Gap Detector、Decision Center、Context Router、Task Compiler、Evidence）都消费这份结构；页面、接口、Codex 输出全部以它为准。旧 `path/pitfalls` 字段保留，保证已存数据不坏。

---

## 3. 目标定义器（Target Definition）

页面入口：`repro.tsx` 新建记录后**强制先走目标定义**，不能上来就"添加步骤"。
接口：`/api/reproduction` POST 新增 `setTarget` action。

交互（点选，非 prompt）：
```
复现目标：○ Table 2 主实验  ○ Figure 4  ○ 某指标  ● 完整论文
目标指标：F1 / height MAE / accuracy
期望值：84.7   允许误差：±0.5
硬件：RTX 5070 Laptop   最大实验时间：12h
是否允许修改官方实现：○ 否  ● 最小修改  ○ 可以
```
产出冻结到 `spec.target`；后续所有 acceptance 引用它。

**验收**：新建记录后不定义目标无法添加步骤；目标写入 `spec.target` 并在页面顶部常驻显示。

---

## 4. Paper Facts + Repo Facts（来源 + 置信度）

接口：`/api/reproduction` POST 新增 `addFact` / `updateFact` / `deleteFact`（paper/repo 两侧）。
来源：`paperFacts` 从论文解析（当前是导入 PDF + 术语抽取，先**半自动**：AI 提议 + 用户确认来源节号）；`repoFacts` 从 Repo Analyzer（§5）产出。

UI：一个"参数表"，每行 = Fact，列 = key / paper 值 / repo 值 / 状态（Confirmed / Inferred / **Missing 标红**）。

**验收**：任一 Missing 事实在 UI 显红且计入 readiness；AI 生成的 Fact 必须带 `source`，无来源的推断标 `inferred`，禁止空口 `confirmed`。

---

## 5. Repo Analyzer v1（先扩 code-read，再自动识别结构）

第一处小改：`src/app/api/code-read/route.ts` 的 `ALLOWED_EXT` 扩为：
```
.py .ts .tsx .js .jsx .mjs
.yaml .yml .toml .json .md .txt .sh .cfg .ini
requirements*.txt requirements*.in environment*.yml pyproject.toml setup.py setup.cfg
Dockerfile* Makefile README* LICENSE*
```
（逐类验证解析安全：yaml/toml 用轻量解析或当文本返回，不执行。）

新增 `src/lib/repo-analyzer.ts` + `/api/repo-analyzer`：导入 repo 路径后自动：
```
扫描入口 → README/requirements/env.yml/pyproject/Dockerfile/configs/**/train*/eval*/dataset*/model*
产出 Repository Snapshot:
  entrypoints / training / evaluation / datasets / configs /
  dependencies(依赖图) / checkpoints / scripts / repoUrl+commit
```
snapshot 落进 `spec.repoFacts`（文件+行号来源）。

**验收**：导入任意 repo 目录，`repo-analyzer` 返回结构化 snapshot；requirements 里的 python/torch/cuda 约束进入 `repoFacts`；`code-read` 能读 yaml/toml/md/txt。

---

## 6. Gap Detector + Decision Center

### 6.1 确定性冲突优先（不靠 LLM 猜）
`/api/reproduction/gaps`：对比 `paperFacts[key]` vs `repoFacts[key]`，自动产出：
```
gap { type:"conflict"|"missing", key, paperValue?, repoValue?, severity:"critical"|"high"|"medium"|"low" }
```
例：`training.batch_size` paper=64 / repo=32 → conflict high。

### 6.2 Decision Center（独立 Ledger）
`/api/reproduction/decisions`（或并入 POST action）：
```
D-004 · Batch size conflict
  论文：64 · Section 4.1
  代码：32 · configs/train.yaml:21
  推荐：优先用 repo 实验对应 config 的 32（可能为论文发表后 release 配置）
  影响：可能影响最终指标
  [采用 32] [采用 64] [自定义] [稍后决定]
```
确认 → `spec.decisions[]`：`{id, key, chosen, rationale, status:"accepted"|"pending"}`。
**Codex 后续永远不再问已决问题**（Context Router 会注入决策）。

**验收**：同一 key 冲突自动生成 Gap + 待决 Decision；用户采纳后写入 ledger；`pendingDecisions` 计入 readiness，>0 时 Ready 不放行。

---

## 7. Environment Resolver（Desired vs Actual vs Diff vs Plan）

现有 `/api/environments` 已能采样 Actual（OS/GPU/driver/python/conda 环境/包版本）——保留为数据源。
新增 `src/lib/env-resolver.ts` + `/api/environments/plan`：
```
Desired（来自 repoFacts/requirements/env.yml 解析）
vs Actual（现有采样）
→ Compatibility Diff（python/torch/CUDA/驱动逐项 ⚠✓）
→ Environment Plan（Option A/B + 置信度 + 推荐，复用 conda；参考 PR#637 实测结论）
→ Scientific impact（无 / 低 / 高）
```
另修一处工程债：`CONDA = /home/ark/miniconda3/bin/conda` 硬编码 → 改为 PATH 探测 + `RA_CONDA_BIN` 覆盖 + 配置文件。

**验收**：导入 repo 后一键算出"项目要什么 vs 本机有什么 vs 差在哪 vs 怎么用最少修改跑起来"；plan 含选项+置信度；conda 路径不再写死单机。

---

## 8. Task Compiler + Context Router（核心省 token 改造）

### 8.1 Task Compiler：`/api/reproduction/tasks`
把 `/api/reproduction/prompt`（拼接大 Prompt）降级为展示层；核心换成按任务编译：
```
POST { slug } → tasks: CodexTask[]
CodexTask {
  id: "R04", goal, scientific_target,
  inputs: { paper:[Section refs], code:[files+anchors] },
  known_facts[], open_questions[],
  decisions[](引用 ledger),
  allowed_changes:{ level: 0|1|2 },
  forbidden[], acceptance[], stop_conditions[]
}
```
例（沿用你给的 R04 结构）直接采用。

### 8.2 Context Router：`/api/context` 重做
现状 `kind=repro → 返回整份 repro-context.md`——**与省 token 目标直接矛盾**。
改为：
```
GET /api/context?task=R04 → Context Packet
  paper facts    310 tok
  code excerpts  920
  decisions      130
  known risks     95
  acceptance      80
  ───────────── 1535 tok
```
实现：`src/lib/context-router.ts`，按 taskId 查 `spec.facts/mappings/gaps/decisions/tasks`，从 `code-read` 取文件锚点片段，汇总 token 预算并返回。旧 `kind=repro/environment` 保留兼容。

### 8.3 Human Context 与 Agent Context 分离
- Codex 默认只拿 **Agent Context**（目标/事实/决策/约束/代码文件/验收）。
- **Human Context**（`profile.md`、`code-profile` 的 background/gaps/depth/mastered）只在任务类型是"解释给用户听"时追加。
- 改动点：`/api/reproduction/prompt`、`/api/context`、`/api/chat` 的 system 组装。

**验收**：同一任务下 context-packet 输出 ≈1500 token 级（对比现状整份 markdown）；profile 不再默认进入 Codex 执行上下文。

---

## 9. Evidence 账本（stages.ts P4 已写、代码没落实的部分）

补 `Evidence` 到 spec（`/api/reproduction` POST `addEvidence`）：
```
Evidence { id, taskId, type:"paper"|"code"|"command"|"metric"|"artifact",
           source, value, supports:[taskId|decisionId], createdAt }
E031: claim="official preprocessing uses center crop"
      evidence=datasets/kitti.py:84-102  commit=13e8fa  supports=Task R03 / Decision D08
```
UI：在步骤/结论旁可"挂证据"；报告/Prompt/交接从账本取，不重新解释。

**验收**：P4 交付要求"结论可追溯到命令/文件/行号"在数据模型层成立；code-read 的 `chain` 结果可一键存为 Evidence。

---

## 10. 页面重构（repro.tsx）：从 checklist → 编译流水线

页面结构改为（顶部门控）：
```
论文 → TARGET → FACTS → PAPER↔CODE → GAPS&RISKS → DECISIONS → ENVIRONMENT → CODEX PLAN
顶部常驻：Reproduction Readiness
  Target ✓ / Paper facts ✓ / Repository ✓ / Environment ✓
  Critical gaps 0 / Pending decisions 0 / Acceptance ✓ → 92%
  [READY FOR CODEX]  ← Critical gaps=0 且 pendingDecisions=0 才亮
```
现有组件保留：路径步骤（path）、坑点（pitfalls）、复现商定 copilot、复盘 review——全部挂到新 spec 结构下。
"生成整篇提示词到 GPT 那边拆"按钮**移除**，替换为"生成 CODEX PLAN"（调用 tasks + context-packet）。

---

## 11. 明确不做（避免横向膨胀）

- 不做内置 Terminal / IDE / Git UI / 自训练实验 / 完整实验云平台 / 自写代码 Agent。
- Codex 已经会跑、会试错、会写代码；Research Atelier 占住的是 **Codex 前面那 10 分钟到 1 小时**。

---

## 12. 开发顺序（按投入产出比）

| # | 步骤 | 涉及文件 | 依赖 |
|---|---|---|---|
| 1 | **重构 reproduction.ts 数据模型**（ReproductionSpec + 迁移兼容） | `src/lib/reproduction.ts`、`api/reproduction/route.ts` | 无（地基） |
| 2 | **Repo Analyzer v1**（扩 code-read 可读类型 + snapshot） | `api/code-read/route.ts`、`src/lib/repo-analyzer.ts`、`api/repo-analyzer/route.ts` | 1 |
| 3 | **目标定义器**（新建先定义目标，setTarget） | `api/reproduction/route.ts`、`repro.tsx` | 1 |
| 4 | **Paper/Repo Facts**（addFact/updateFact + 参数表 UI） | `api/reproduction/route.ts`、`repro.tsx`、新 `repro-facts.tsx` | 1,2,3 |
| 5 | **Gap Detector + Decision Center** | `api/reproduction/route.ts`、`repro.tsx`、新 `repro-decisions.tsx` | 4 |
| 6 | **Task Compiler + Context Router**（prompt 降级；context 重做；Human/Agent 分离） | `api/reproduction/tasks/route.ts`、`api/context/route.ts`、`src/lib/context-router.ts`、`api/chat/route.ts` | 1–5 |
| 7 | **Environment Resolver**（Desired vs Actual + Plan + conda PATH 探测） | `src/lib/env-resolver.ts`、`api/environments/route.ts` | 2,4 |
| 8 | **Evidence 账本 + Ready gate + 页面重组** | `api/reproduction/route.ts`、`repro.tsx`、`stages.ts` 联动 | 1–7 |

每步独立可验收、可回退；第 1 步完成后其余步骤在它之上叠加，不返工。

---

## 13. 验收总则

1. 旧 `reproduction.json` 数据迁移后不丢（path/pitfalls 保留）。
2. 每个新字段必须有对应 UI 或 API；禁止只加 schema 不给入口。
3. Missing/Conflict 必须显式分级并影响 readiness，**不靠 AI 假装知道**。
4. Context Router 输出 token 预算，能对比"整份 markdown"前后的 token 差。
5. 页面顶部唯一门控：`Critical gaps=0 且 Pending decisions=0` 才亮 `READY FOR CODEX`。
6. 全部改动 `tsc --noEmit` 通过、dev server 热重载验证；真实数据（NSR 记录）作为验收样本。
