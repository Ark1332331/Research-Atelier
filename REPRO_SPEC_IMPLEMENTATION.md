# Research Atelier → Paper-to-Reproduction Compiler 实现方案

> 状态：**方案 v0.3（架构 v0.2 + UX Contract）——待确认，未开始实现**。用户确认后按 §14 开发顺序进入 Step 1。
> 配套设计文档：`../paper_repro_compiler.md`（产品定位 + NSR 走查 + token 审计证据）。
> v0.1 → v0.2 修订记录见 §15（评审 7 点已全部采纳）；v0.2 → v0.3 见 §15（新增 UX Contract）。

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
| 代码读取 | `/api/code-read`，`ALLOWED_EXT = [.py,.ts,.tsx,.js,.jsx,.mjs]`，`path.extname` 判断 | 保留；**抽共享层 + 修允许规则**（§7） |
| Python 调用链 | `scripts/py_chain.py`（AST） | 保留；喂给 Repo Analyzer |
| 代码画像 | `/api/code-profile` | 保留；**默认不进 Codex 上下文**（Human Context） |
| 环境 | `/api/environments`（真实采样 + 基线对比） | 保留；**升级为 Environment Resolver**（Desired vs Actual vs Diff vs Plan） |
| 复现数据 | `reproduction.ts`：`{path: Step[], pitfalls: Pitfall[]}` | **重构为 ReproductionSpec v2**（地基） |
| 坑点 | `reproduction.pitfalls`（含 env/stage/threads） | 保留；升级为 Failure Record 跨论文复用 |
| Codex 复盘 | `/api/reproduction/review`（读本机 codex threads） | 保留；升级为增量 Failure Interpreter |
| Prompt | `/api/reproduction/prompt`（拼接大 Prompt） | 降级为展示层；核心换成 `tasks` + `context-packet` |
| 上下文 | `/api/context`（返回整份 markdown） | **重做为 Context Router**（按任务算 token 预算组装最小包） |
| 页面 | `repro.tsx`：手动加步骤 + "生成整篇提示词到 GPT 那边拆" | 改为 Target→Facts→Align→Gaps→Decisions→Env→CodexPlan 流水线；Ready gate |
| 工作流定义 | `stages.ts` P4 已要求"证据账本（命令/文件/行号可追溯）" | **设计与实现脱节**：数据模型无 evidence，需补 |

---

## 2. ReproductionSpec v2（核心 schema）

文件：`src/lib/reproduction.ts` + `data/reproduction.json`。

**两条结构性原则**（评审点 7）：

1. **Source of truth（持久保存）**：`target / constraints / acceptance / facts / mappings / decisions / evidence / pitfalls / path`
2. **Derived state（计算产生，不持久或带 revision 快照）**：`gaps / readiness / tasks / context packets`

第一版实现：**readiness 每次 GET 动态算、不存储；gaps 动态算；tasks 允许保存快照但必须带 `compiledFromRevision`**。杜绝"Fact 改了 Gap 还是旧的"这类缓存一致性地狱。

```ts
ReproductionSpec {
  schemaVersion: 2;                 // 评审点 4：版本锚点

  identity: { slug, title, sourceUrl?, repoUrl? }

  paperRevision: {                  // 评审点 4
    id?: string;
    fileHash?: string;
  }
  repoRevision: {                   // 评审点 4：必须
    root: string;
    repoUrl?: string;
    commit?: string;
    branch?: string;
    dirty?: boolean;
  }

  target: Target;                   // §3（评审点 1 分家）
  constraints: Constraints;         // §3
  acceptance: Acceptance;           // §3

  facts: Fact[];                    // §4（paper + repo 统一，带 provenance/normalization）
  mappings: Mapping[];              // §5（评审点 5：补实现步骤）
  decisions: Decision[];            // §6 Decision Ledger
  environment?: EnvPlan;            // §8

  evidence: Evidence[];             // §11（评审点：Evidence 微调）

  // —— 历史兼容（保留，不丢数据）——
  path: Step[];
  pitfalls: Pitfall[];

  createdAt?: string;
  updatedAt?: string;
}
```

**向后兼容迁移**：`normalizeReproduction(raw) → ReproductionSpec`——旧记录缺字段用默认值；旧 UI/API 行为完全不变；迁移后写回时 `schemaVersion: 2` 成为稳定真相源（Step 1 验收，见 §14）。

---

## 3. Target / Constraints / Acceptance（评审点 1 分家）

`target` 只装科学目标；执行约束、验收标准各自独立。**`metric` 从单数改数组**（一张表可同时有 Accuracy/F1/Latency/Memory）。

```ts
Target {
  scope: "table" | "figure" | "metric" | "full" | "custom";
  name: string;                    // "Table 2" / "Figure 4" ...
  metrics: TargetMetric[];         // 数组
}
TargetMetric { name: string; expected?: number|string; tolerance?: number; unit?: string }

Constraints {
  hardware?: HardwareConstraint;   // { gpu?: string; memoryGb?: number }
  timeBudgetHours?: number;
  modificationPolicy: "none" | "minimal" | "allowed";
  computeBudget?: number;
  dataPolicy?: string;             // 如 "仅用官方 train split"
}

Acceptance { criteria: AcceptanceCriterion[] }
AcceptanceCriterion {
  id: string;
  text: string;                    // "validation F1 超过 current-measurement baseline"
  kind: "metric" | "behavior" | "artifact";
  satisfied?: boolean;
}
```

页面交互：新建记录后**强制先走 Target → Constraints → Acceptance**，不能上来就"添加步骤"。
接口：`/api/reproduction` POST `setTarget` / `setConstraints` / `setAcceptance`。

---

## 4. Fact：status / confidence / importance 三分 + normalizedValue（评审点 2、3）

**`missing` 从 confidence 里拆出**——存在性（status）与可信度（confidence）是两个维度。**importance 决定是否阻塞**：只有 `required + missing` 才计入 blocking（论文没写 num_workers/logging interval 不该卡住 Codex）。

```ts
Fact {
  id: string;
  key: string;                     // "training.batch_size"（点分路径，跨侧可比）
  side: "paper" | "repo";

  value?: unknown;                 // 显示用原文，如 "84.7%" / "Adam" / "0.0001"
  normalizedValue?: unknown;       // 比较用归一值，如 0.847 / "adam" / 1e-4（评审点 3）
  unit?: string;                   // "ratio" / "samples" / "step"

  status: "observed" | "inferred" | "missing";
  confidence: "high" | "medium" | "low";
  importance: "required" | "recommended" | "optional";

  source?: FactSource;             // §4.1
}

FactSource =
  | { kind: "paper"; section?: string; page?: number; quote?: string }
  | { kind: "repo"; file: string; lineStart?: number; lineEnd?: number; commit?: string }  // commit 绑定 repoRevision（评审点 4）
  | { kind: "user"; note?: string };
```

**Gap Detector 比较 `normalizedValue`，UI 显示 `value`**。归一化规则集中在 `src/lib/fact-normalize.ts`（百分比↔ratio、科学计数、Adam↔torch.optim.Adam、大小写/单位换算），逐条测试。

接口：POST `addFact` / `updateFact` / `deleteFact`。

---

## 5. Paper ↔ Code Mapping（评审点 5：新增独立实现步骤，不能靠 Facts 替代）

```ts
Mapping {
  id: string;
  concept: string;                 // "Multi-scale feature aggregation"
  paperRefs: PaperRef[];           // { section, page?, quote? }
  codeRefs: CodeRef[];             // { file, lineStart?, lineEnd?, symbol?, commit? }
  configRefs?: CodeRef[];          // config 锚点
  relation: "implements" | "configures" | "preprocesses" | "trains" | "evaluates";
  status: "proposed" | "confirmed";
  confidence: "high" | "medium" | "low";
  evidenceIds: string[];
}
```

第一版**半自动**：AI 提议 Mapping（基于论文结构抽取 + Repo Analyzer 的 entry 识别）→ 用户逐条确认 → `status: confirmed`。确认后的 mapping 进入 Context Router 与 Task Compiler 的锚点来源。

UI：`PAPER ↔ CODE` 面板，选中论文概念 → 右侧显示实现锚点（文件/符号/config）→ 确认/驳回。

---

## 6. Gap Detector + Decision Ledger（blocking-aware，评审点 7）

### 6.1 Gap（derived，动态算）
`/api/reproduction/gaps`（GET 时由 facts/mappings 计算，不持久）：
```
Gap {
  id, key?, type: "conflict"|"missing"|"risk"|"mapping_uncertain",
  paperValue?, repoValue?,          // 显示用 value
  severity: "critical"|"high"|"medium"|"low",
  blocksReady: boolean,             // 评审点 7：从 importance/severity 推导
  relatedDecisions?: string[]
}
```
- conflict：`paperFacts[key].normalizedValue` vs `repoFacts[key].normalizedValue` 不等。
- missing：`required + status=missing` → `blocksReady: true`；`optional missing` 不阻塞。
- 语义歧义（论文 Adam / repo AdamW）：先确定性抓，抓不到的进 Decision 由 LLM 辅助，不猜。

### 6.2 Decision Ledger
```
D-004 · Batch size conflict
  论文：64 · Section 4.1
  代码：32 · configs/train.yaml:21 (commit 13e8fa)
  推荐：优先用 repo 实验对应 config 的 32（可能为论文发表后 release 配置）
  影响：可能影响最终指标
  [采用 32] [采用 64] [自定义] [稍后决定]
```
```ts
Decision {
  id, key,
  paperValue?, repoValue?, chosen,
  rationale?, impact?,
  status: "accepted" | "pending",
  blocksReady: boolean,             // 评审点 7
  resolvedAt?
}
```
Codex 后续不再问已决问题（Context Router 注入 ledger）。

---

## 7. Repo Analyzer v1（评审点 6：允许规则 + 大小限制 + secret denylist）

### 7.1 先抽共享层 `src/lib/code-reader.ts`（评审点：Context Router 不 HTTP 调自己）
```
code-read route → code-reader.ts ← repo-analyzer ← context-router
```
三个模块共享底层读取/锚点函数，避免 server route 调 server route。

### 7.2 允许规则（不再只靠 `path.extname`）
```ts
const ALLOWED_EXTENSIONS = new Set([".py",".ts",".tsx",".js",".jsx",".mjs",
  ".yaml",".yml",".toml",".json",".md",".txt",".sh",".cfg",".ini",".csv",".env.example"]);
const ALLOWED_BASENAMES = new Set(["Dockerfile","Makefile","README","LICENSE"]);  // 无扩展名文件
const ALLOWED_PATTERNS = [ /^requirements.*\.(txt|in)$/, /^environment.*\.ya?ml$/, /^README.*$/, /^Dockerfile.*$/ ];
function isAllowedFile(name: string): boolean { ... }
```

### 7.3 大小限制 + 跳过清单（第一版就有）
```ts
MAX_ANALYZABLE_FILE_BYTES = 1_000_000;   // 1MB
SKIP_GLOBS = ["*.lock","*.log","checkpoints/**","weights/**","outputs/**","wandb/**","data/**","datasets/**","node_modules/**",".git/**"];
SECRET_DENYLIST = [".env","*.pem","*.key","credentials*","*.p12","id_rsa*"];
```

### 7.4 输出 Repository Snapshot
扫描 README/requirements/env.yml/pyproject/Dockerfile/configs/**/train*/eval*/dataset*/model* →
`entrypoints / training / evaluation / datasets / configs / dependencies(依赖图) / checkpoints / scripts / repoUrl+commit`。
snapshot 落进 `facts`（side:"repo"，带 file+line+commit）。

**验收**：任意 repo 目录返回结构化 snapshot；Dockerfile/README（无扩展名）与 requirements*.txt（模式）可读；1MB 以上与 secret 文件被跳过且记录于 `omitted`。

---

## 8. Environment Resolver（评审点：放在 Task Compiler 前）

现有 `/api/environments` 采样 Actual（保留为数据源）。
新增 `src/lib/env-resolver.ts` + `/api/environments/plan`：
```
Desired（repoFacts/requirements/env.yml 解析）
vs Actual（现有采样）
→ Compatibility Diff（python/torch/CUDA/驱动逐项 ⚠✓）
→ Environment Plan（Option A/B + 置信度 + 推荐；参考 NSR PR#637 实测）
→ blockingIssues（评审点 7：env 的阻塞数计入 ready）
→ Scientific impact（无/低/高）
```
修工程债：`CONDA` 硬编码 → PATH 探测 + `RA_CONDA_BIN` 覆盖 + 配置文件。
**顺序依据**：Codex Task 的 `allowed_changes / stop_conditions / environment context` 受环境决策影响，故 Env 必须在 Task Compiler 之前（§14 顺序 7→8）。

---

## 9. Task Compiler（`/api/reproduction/tasks`）

把 `/api/reproduction/prompt`（大 Prompt）降级为展示层；核心改为按任务编译（derived，带 revision 快照）：
```ts
CodexTask {
  id: "R04",
  goal: string,
  scientificTarget?: string,        // 引用 target
  inputs: { paper: string[]; code: CodeRef[] },
  knownFacts: string[],             // 引用 fact ids
  openQuestions: string[],
  decisions: string[],              // 引用 ledger ids
  allowedChanges: { level: 0|1|2 }, // Level 0 自做/1 记录/2 必须询问
  forbidden: string[],
  acceptance: string[],
  stopConditions: string[],
  compiledFromRevision: string,     // 评审点 7：task 快照绑定 spec revision
  compiledAt: string
}
```
例（沿用评审给出的 R04 结构）直接采用。

---

## 10. Context Router（`/api/context` 重做 + `/api/context-packet`）

### 10.1 共享读取
走 `code-reader.ts`（§7.1），不 HTTP 调自己。

### 10.2 组装 Context Packet（derived，按 taskId 计算）
```ts
ContextPacket {
  taskId: string;
  paperFacts: string[];  codeExcerpts: string[];  decisions: string[];
  knownRisks: string[];  acceptance: string[];    environment?: string;
  contextStats: {                                 // 评审点：不追固定数字
    estimatedTokens: number;
    budget: number;                               // 默认 2000，允许任务按复杂度升降
    included: string[];                           // 为什么纳入
    omitted: string[];                            // 被裁掉的关键上下文（排障用）
  }
}
```
原则：只含 relevant context + 预算上限 + **可解释纳入/裁掉理由**；不追求固定 1500 token（核对 Eq.7 可能 1500 不够，检查一个 config 可能 600 就够）。

### 10.3 Human Context 与 Agent Context 分离
- Codex 默认只拿 **Agent Context**（目标/事实/决策/约束/代码文件/验收）。
- **Human Context**（`profile.md`、`code-profile`）只在任务类型是"解释给用户听"时追加。
- 改动点：`/api/reproduction/prompt`、`/api/context`、`/api/chat` 的 system 组装。

---

## 11. Evidence 账本（P4 已写、代码没落实的部分；评审点：claim → observation）

```ts
Evidence {
  id: string;
  type: "paper" | "code" | "command" | "metric" | "artifact";
  observation: string;              // "官方预处理使用 center crop"——证据证明了什么（评审点）
  source: {
    kind: "paper" | "code" | "command" | "metric" | "artifact";
    ref?: string;                   // datasets/kitti.py:84-102 / 命令文本 / 指标值
    commit?: string;                // 绑定 repoRevision（评审点 4）
  };
  supports: EntityRef[];            // [ {kind:"task"|"decision"|"fact"|"mapping", id} ]
  createdAt: string;
}
```
UI：步骤/结论旁可"挂证据"；报告/Prompt/交接从账本取，不重新解释。`code-read` 的 `chain` 结果可一键存为 Evidence。

---

## 12. Ready Gate（评审点 7：blocking-aware，不存 readiness，GET 动态算）

```ts
ready =
     target.complete
  && acceptance.complete
  && repo.resolved
  && environment.blockingIssues === 0
  && blockingGaps === 0        // 只有 required+missing / critical conflict 计入
  && blockingDecisions === 0
  && tasks.length > 0;
```
页面顶部唯一门控：以上全满足才亮 `READY FOR CODEX`（显示逐项状态 + 综合分）。
- 不因 optional missing / 不影响实验的 pending decision 卡死（评审点 7）。
- 但 Target/Environment/Acceptance 缺失也不能因为 gap=0 而放行（评审点 7 的"太宽"修正）。

---

## 13. UX Contract：用户不需要理解 ReproductionSpec 才能使用 ReproductionSpec

> 这一章是用户层设计，与底层 schema 并行。**底层再漂亮，页面也不许变成"把 schema 可视化给用户看"。**
> 产品体验目标：
> **我拿到一篇论文 → 打开 Research Atelier → 它告诉我现在该做什么 → 它自己能做的先做掉 → 真需要我判断时再叫我 → 最后我几乎不用组织语言，就能把一个干净的任务交给 Codex。**

### 13.1 两条最高原则

1. **任何时刻，页面只能有一个主要任务（primary action）**——不是只有一个按钮，而是只有一个"现在最该做的事"。页面替你回答"我现在处于哪个阶段"，而不是让用户自己从一堆面板里猜。
2. **系统能自己确定的信息，不要做成表单让用户填写。** 能自动确定就自动确定；高置信度默认接受；只有低置信度或 blocking 冲突才要求用户处理。

### 13.2 内部术语与用户术语分离

底层叫法永远不直接出现在用户面前：

| 内部（schema/开发者） | 用户层（页面文案） |
|---|---|
| Target / Constraints / Acceptance | 你想复现什么 / 材料准备好了没 |
| Facts / provenance | 系统正在核对论文和代码 |
| Mapping | （不出现；只显示"对应关系已核对"） |
| Gap / Risk | 有几个地方需要你决定 / 需要注意 |
| Decision | 需要你决定 |
| Environment Plan | 看看这台电脑能不能跑 |
| Task Compiler / Context Packet | 准备交给 Codex / 查看 Codex 实际收到的上下文 |
| Ready gate | 开始交给 Codex |

`D-004 / normalizedValue / blocksReady / schemaVersion` 这些只在"查看详情/查看 Codex 收到的上下文"里出现。

### 13.3 页面结构：progressive disclosure（渐进披露）

三层结构，任何时刻用户只看到当前层：

```
┌─────────────────────────────────────────────────┐
│ 顶部：你现在在哪                                  │
│  Neural Scene Representation                     │
│  复现 Table 2 · Main Result                      │
│  准备进度  ███████░░  78%                        │
│  ✓ 目标  ✓ 材料  ✓ 论文↔代码  ● 需要决定  ○ 环境  ○ Codex │
├─────────────────────────────────────────────────┤
│ 中间：当前唯一任务（primary action）              │
│  还有 2 个问题需要决定                            │
│  解决后即可生成 Codex 执行计划                    │
│  [处理第一个问题 →]                              │
├─────────────────────────────────────────────────┤
│ 底部/侧边：折叠的详细信息                         │
│  查看全部：论文事实 27 · 代码事实 34 · 对应关系 16 · 风险 3 · 坑点 4 │
└─────────────────────────────────────────────────┘
```

### 13.4 全流程闭环（用户心智连续，不中断）

```
选论文 → 系统准备材料 → 确定复现目标 → 自动核对 → 只解决关键冲突
      → 环境放行 → 查看 Codex 计划 → 交给 Codex → 导入执行结果 → 下一任务
```

每个阶段只出现该阶段的 UI，其余全部隐藏。

### 13.5 各阶段用户层设计

**① 选论文（首次进入，空态）**
```
开始一次论文复现
你想复现哪篇论文？
[ 从论文库选择 ] [ 导入 PDF ] [ 粘贴论文链接 ]
[下一步 →]
```
不显示环境/坑点/Codex/Facts/Prompt/Acceptance/添加步骤——它们现在都与你无关。

**② 系统准备材料（选完后，系统自己干活）**
```
正在准备复现材料
论文   ✓ PDF 已导入  ✓ 已识别标题/作者/方法章节  ✓ 找到实验章节
官方代码 ○ 正在寻找          （若已给 GitHub：✓ 仓库找到 ✓ commit 固定 ✓ README ✓ 环境文件 ✓ 训练入口）
[继续：确定你要复现什么 →]
```

**③ 确定复现目标（选项式，不是填表）**
```
你这次想做到哪一步？
○ 先把官方代码跑起来（确认项目和环境可用）
● 复现论文里的一个核心结果（如 Table 2 / Figure 4 / 主指标）
○ 完整复现实验（主实验 + 消融 + 主要图表）
○ 我有自己的目标
```
选"核心结果"后，系统**根据论文自动给出候选**（Table 2 — Main results: Accuracy 84.7, F1 81.2 / Figure 4 — Ablation / Table 3 — Generalization），用户选/确认，而不是自己输入 `Target name / Metric / Expected / Tolerance`。

**④ 验收标准（系统推荐，用户确认）**
```
为了判断复现是否成功，我建议检查：
✓ 官方数据集版本一致  ✓ 评估协议一致  ✓ 主指标 84.7 ± 0.5  ✓ 未为凑结果改模型结构
[接受这些标准] [查看并调整]      （高级用户才展开编辑）
```
不出现"请定义 acceptance criteria"。

**⑤ 核对结论（默认显示结论，证据按需展开）**
```
论文与代码核对
✓ 数据集版本一致  ✓ 模型结构已找到对应实现  ✓ 优化器一致
⚠ Batch size 不一致   ? 论文没写随机种子
23 项已确认 · 2 项需要注意 · 1 项需要你决定
[查看需要处理的 3 项]        ← 点进去才看详细 Facts
```
**默认显示结论，详细证据按需展开**，不把几十个 Fact 当参数数据库扔给用户。

**⑥ Mapping（用户只处理 exception）**
```
论文方法已和代码对应好
Method §3.1 Multi-scale feature aggregation → models/fusion.py MultiScaleFusion.forward()
Method §3.2 Temporal alignment → models/temporal.py TemporalAlign.forward()
12 个高置信度对应关系已自动确认 · 2 个不确定需要你看看
[只处理不确定项]
```
**用户只处理 exception，不处理 normal case**——绝不逐条 `[确认][驳回]`。

**⑦ Decision Center（真正需要用户出现的地方）**
```
需要你决定 · 2     1 / 2
论文和官方代码的 batch size 不一致
  论文 64 · Section 4.1      官方代码 32 · configs/train.yaml:21
这意味着什么？batch size 可能影响结果，但不是模型结构变化。
Research Atelier 建议 ● 使用官方代码的 32
为什么？该 config 与论文对应实验直接绑定，更可能代表作者最终公开配置。影响等级：中
[采用推荐] [使用论文的 64] [我想先了解更多]
```
**不出现 `D-004 / normalizedValue / blocksReady`**——纯人类语言。

**⑧ 环境（从"环境管理器"变成"我到底能不能跑"）**
```
运行环境
⚠ 当前环境不能直接运行
项目需要 Python 3.9 / PyTorch 1.13 / CUDA 11.x
你的机器 Python 3.11 / PyTorch 2.4 / RTX 5070 Laptop
推荐方案 新建独立环境，不改你现有环境。科学影响：无。预计新增磁盘 ~6GB
[采用推荐方案] [查看详细环境信息]   ← 后者才进完整 Environment Panel
```
现有 SystemPanel/EnvironmentsPanel 保留但不再常驻占据注意力。

**⑨ Codex 计划（先给人类可读任务卡，YAML 折叠在后面）**
```
准备完成，已拆成 5 个 Codex 任务
01 检查项目环境（5–10 min，不修改科学逻辑）
02 验证数据预处理（涉及 3 个文件 · 成功标准：shape/split/normalization 与论文一致）
03 跑最小 Smoke Test（只验证 pipeline，不追求指标）
04 复现主实验（目标：Table 2）
05 对齐最终指标
```
点单个任务：
```
02 为什么要做？数据预处理不一致则后面指标无比较意义。
Codex 会看：datasets/kitti.py · configs/base.yaml · Section 4.1
Codex 不允许：修改数据划分 / 改变输入尺寸
完成标准：3 项
[查看 Codex 实际收到的上下文]    ← 这才显示结构化 Context Packet
```
透明度在，但用户默认不碰 YAML。

**⑩ 交给 Codex（不用"READY FOR CODEX"字样）**
```
准备完成
✓ 没有未解决的关键冲突  ✓ 环境方案已确定  ✓ 成功标准已明确  ✓ Codex 只收到当前任务需要的信息
[开始交给 Codex]
```
不能开始时：
```
还不能开始
还差 2 件事：1. 选择 batch size  2. 确认数据集版本
[继续处理]
```
**而不是一个灰掉的按钮让用户猜"为什么不让我点"。**

**⑪ Codex 跑完后的回归路径（闭环）**
```
任务 03 · Smoke Test
Codex 已完成？ [导入最近的 Codex 会话]
导入后自动：
本次执行结果  ✓ 数据加载 ✓ forward ✓ backward
发现 1 个问题：CUDA extension 编译失败，已用兼容方案修复
新证据 +command +config +output     科学逻辑修改：无
[确认完成任务 03] [我觉得结果有问题]
下一步：04 复现主实验
```
复用现有 `codex://threads/<id>` review 能力；用户心智连续，不需要记住"上次 Codex 干到哪了"。

### 13.6 两个贯穿性控件

- **"为什么"按钮（永远存在）**：解释"当前这一步为什么对当前这篇论文必要"，例如"因为论文复现不是代码能跑就算成功；现在确认数据处理与论文一致，否则指标接近也不能确认复现有效"。不是泛泛的产品说明。
- **"我不知道，让系统建议"（任何输入处可用）**：例如最大运行时间 → 系统按目标和机器建议"先不设硬上限；Smoke Test 控制在 10 分钟内，正式训练预计 5–8 小时"。**用户永远可以说不知道**。

### 13.7 产品级规则：User Decision Budget

> 对一次典型论文复现，进入 Codex 之前，Research Atelier 应尽量把用户必须主动做出的技术决策压缩到**真正影响科学结果或资源投入的少量问题**。可自动确定的内容自动确定；高置信度默认接受；低置信度或 blocking 冲突才要求用户处理。

与 Token Budget 成对——**减少 Codex token + 减少 Human decision load** 才是产品真正舒服的地方。

### 13.8 对实现的约束

1. 底层按 §2–§12 实现（schema、模块、ready 公式），**页面层按本章组织**；内部术语禁止直接成为用户导航。
2. 任何时刻页面只有一个 primary action（顶部"你现在在哪" + 中间唯一任务 + 底部折叠详情）。
3. 系统能推导的信息不做成表单；高置信度自动确认，用户只处理 exception。
4. Codex 计划默认展示人类可读任务卡；Context Packet / YAML 折叠在"查看 Codex 实际收到的上下文"。
5. 完整闭环必须成立：选论文 → 系统准备 → 确定目标 → 自动核对 → 只解决关键冲突 → 环境放行 → 查看 Codex 计划 → 交给 Codex → 导入执行结果 → 下一任务。

---

## 14. 开发顺序（评审调整：Target 提前、Mapping 补入、Env 在 Task 前）

| 顺序 | 做什么 | 验收 |
|---|---|---|
| **1** | ReproductionSpec v2 + schemaVersion + `normalizeReproduction()` 迁移 | **旧 reproduction.json → normalize → v2 → 写回/读取，旧 UI/API 行为完全不坏；拿到稳定 schemaVersion:2 真相源**（评审指定验收） |
| **2** | Target + Constraints + Acceptance（分家，metric 数组） | 新建记录必须先定义三者才能加步骤；字段落 spec |
| **3** | Repo Analyzer v1（code-reader.ts 共享层 + 允许规则 + 大小/secret 限制 + snapshot） | 任意 repo 返回结构化 snapshot；Dockerfile/README/requirements 可读；secret/大文件跳过 |
| **4** | PaperFacts + RepoFacts（provenance + normalization） | 每条事实带 status/confidence/importance + normalizedValue；归一化逐条测试 |
| **5** | **Paper ↔ Code Mapping v1**（评审点 5） | AI 提议 → 用户确认 → status:confirmed；锚点进入后续模块 |
| **6** | Gap Detector + Decision Ledger（blocking-aware） | conflict/missing 自动出 Gap；required+missing 阻塞；决策采纳写入 ledger |
| **7** | Environment Resolver（Desired vs Actual vs Diff vs Plan + conda PATH 探测） | 一键算出项目要什么 vs 本机有什么 vs 差在哪 vs 怎么跑起来 |
| **8** | Task Compiler + Context Router（prompt 降级；Human/Agent 分离；contextStats） | 每任务最小上下文包 + token 预算 + included/omitted |
| **9** | Evidence + Ready Gate + 最终 UI 重组（按 §13 UX Contract 组织页面：primary action、progressive disclosure、用户术语） | Ready 门控按 §12；Evidence 挂接；页面按 UX Contract 流水线重组（选论文→准备→目标→核对→决策→环境→Codex 计划→交给 Codex→回归） |

每步独立可验收、可回退；Step 1 完成后其余在它之上叠加，不返工。

---

## 15. v0.1 → v0.2 修订记录（评审 7 点逐条对应）

| # | 评审点 | 修订落点 |
|---|---|---|
| 1 | target 装了太多性质 → 拆 target/constraints/acceptance；metric 改数组 | §3 |
| 2 | confidence:"missing" 混淆存在性与可信度 → status/confidence/importance 三分；required+missing 才阻塞 | §4、§6 |
| 3 | Fact 需归一化避免假冲突 → value/normalizedValue/unit；Gap 比较 normalized | §4、§6.1 |
| 4 | 版本锚点 → schemaVersion、paperRevision、repoRevision.commit；RepoFact/Mapping/Evidence/CodeRef 绑定 commit | §2、§4.1、§5、§11 |
| 5 | 缺 Paper↔Code Mapping 实现步骤 → 新增 Step 5，半自动 AI 提议+用户确认 | §5、§14 |
| 6 | Repo Analyzer 文件规则坑 → ALLOWED_EXTENSIONS+BASENAMES+PATTERNS 拆分；1MB 限制；secret denylist 第一版就有 | §7.2、§7.3 |
| 7 | derived state 与 source-of-truth 分开 → readiness/gaps 动态算；tasks 快照带 compiledFromRevision；Ready Gate 改 blocking-aware（blockingIssues/blockingGaps/blockingDecisions） | §2、§6、§9、§12 |
| + | Context Router 不 HTTP 调自己 → 抽 `code-reader.ts` 共享层 | §7.1、§10.1 |
| + | Evidence claim → observation（证据证明了什么） | §11 |
| + | 不追固定 1500 token → 默认 budget 2k + 按复杂度升降 + contextStats.included/omitted | §10.2 |

### v0.2 → v0.3 修订（2026-08-27：新增 UX Contract）

| # | 评审点 | 修订落点 |
|---|---|---|
| 1 | 页面不能变成"把 schema 可视化给用户看"；内部术语与用户术语分离 | 新 §13 整章 |
| 2 | 任何时刻页面只有一个主要任务（primary action） | §13.1、§13.3 |
| 3 | 系统能自己确定的信息不做成表单；高置信度默认接受；用户只处理 exception | §13.1、§13.5⑥⑧ |
| 4 | Target/Acceptance 由系统生成候选、用户确认，而非填表 | §13.5③④ |
| 5 | Facts/Mapping 默认显示结论，证据按需展开；Mapping 只处理不确定项 | §13.5⑤⑥ |
| 6 | Environment 从"管理器"变"我到底能不能跑"；详情折叠 | §13.5⑧ |
| 7 | Codex 计划先给人类可读任务卡，YAML 折叠在"查看 Codex 实际收到的上下文" | §13.5⑨ |
| 8 | 按钮不叫 READY FOR CODEX → "开始交给 Codex"；不能开始时说"还差 N 件事"而非灰按钮 | §13.5⑩ |
| 9 | Codex 跑完必须能"回来"：导入会话 → 自动总结 → 确认 → 下一任务（闭环） | §13.4、§13.5⑪ |
| 10 | 永远存在的"为什么"按钮；用户永远可以说"我不知道，让系统建议" | §13.6 |
| 11 | 产品级规则：User Decision Budget（减少 token + 减少 human decision load） | §13.7 |

---

## 16. 明确不做

- 不做内置 Terminal / IDE / Git UI / 自训练实验 / 完整实验云平台 / 自写代码 Agent。
- Codex 已经会跑、会试错、会写代码；Research Atelier 占住的是 **Codex 前面那 10 分钟到 1 小时**。

---

## 17. 验收总则

1. 旧 `reproduction.json` 数据迁移后不丢（path/pitfalls 保留），旧 UI/API 行为不坏。
2. 每个新字段必须有对应 UI 或 API；禁止只加 schema 不给入口。
3. Missing/Conflict 显式分级并**仅 required/critical 影响 readiness**，不靠 AI 假装知道。
4. Context Packet 输出 token 预算 + included/omitted，可对比"整份 markdown"前后的 token 差。
5. 页面顶部唯一门控：§12 的 blocking-aware ready 公式，Critical 不清零不放行。
6. 页面按 §13 UX Contract：任何时刻一个 primary action；系统能确定的自动确定；用户只处理 exception；内部术语不出现在用户导航。
7. 完整闭环可走通：选论文 → 系统准备材料 → 确定目标 → 自动核对 → 只解决关键冲突 → 环境放行 → 查看 Codex 计划 → 交给 Codex → 导入执行结果 → 下一任务。
8. 全部改动 `tsc --noEmit` 通过、dev server 热重载验证；真实数据（NSR 记录）作为验收样本。
