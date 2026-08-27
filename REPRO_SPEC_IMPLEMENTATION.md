# Research Atelier → Paper-to-Reproduction Compiler 实现方案

> 状态：**方案 v0.2（按评审修订）——待确认，未开始实现**。用户确认后按 §13 开发顺序进入 Step 1。
> 配套设计文档：`../paper_repro_compiler.md`（产品定位 + NSR 走查 + token 审计证据）。
> v0.1 → v0.2 修订记录见 §14（用户评审 7 点已全部采纳）。

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

**向后兼容迁移**：`normalizeReproduction(raw) → ReproductionSpec`——旧记录缺字段用默认值；旧 UI/API 行为完全不变；迁移后写回时 `schemaVersion: 2` 成为稳定真相源（Step 1 验收，见 §13）。

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
**顺序依据**：Codex Task 的 `allowed_changes / stop_conditions / environment context` 受环境决策影响，故 Env 必须在 Task Compiler 之前（§13 顺序 7→8）。

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

## 13. 开发顺序（评审调整：Target 提前、Mapping 补入、Env 在 Task 前）

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
| **9** | Evidence + Ready Gate + 最终 UI 重组 | Ready 门控按 §12；Evidence 挂接；页面流水线完整 |

每步独立可验收、可回退；Step 1 完成后其余在它之上叠加，不返工。

---

## 14. v0.1 → v0.2 修订记录（评审 7 点逐条对应）

| # | 评审点 | 修订落点 |
|---|---|---|
| 1 | target 装了太多性质 → 拆 target/constraints/acceptance；metric 改数组 | §3 |
| 2 | confidence:"missing" 混淆存在性与可信度 → status/confidence/importance 三分；required+missing 才阻塞 | §4、§6 |
| 3 | Fact 需归一化避免假冲突 → value/normalizedValue/unit；Gap 比较 normalized | §4、§6.1 |
| 4 | 版本锚点 → schemaVersion、paperRevision、repoRevision.commit；RepoFact/Mapping/Evidence/CodeRef 绑定 commit | §2、§4.1、§5、§11 |
| 5 | 缺 Paper↔Code Mapping 实现步骤 → 新增 Step 5，半自动 AI 提议+用户确认 | §5、§13 |
| 6 | Repo Analyzer 文件规则坑 → ALLOWED_EXTENSIONS+BASENAMES+PATTERNS 拆分；1MB 限制；secret denylist 第一版就有 | §7.2、§7.3 |
| 7 | derived state 与 source-of-truth 分开 → readiness/gaps 动态算；tasks 快照带 compiledFromRevision；Ready Gate 改 blocking-aware（blockingIssues/blockingGaps/blockingDecisions） | §2、§6、§9、§12 |
| + | Context Router 不 HTTP 调自己 → 抽 `code-reader.ts` 共享层 | §7.1、§10.1 |
| + | Evidence claim → observation（证据证明了什么） | §11 |
| + | 不追固定 1500 token → 默认 budget 2k + 按复杂度升降 + contextStats.included/omitted | §10.2 |

---

## 15. 明确不做

- 不做内置 Terminal / IDE / Git UI / 自训练实验 / 完整实验云平台 / 自写代码 Agent。
- Codex 已经会跑、会试错、会写代码；Research Atelier 占住的是 **Codex 前面那 10 分钟到 1 小时**。

---

## 16. 验收总则

1. 旧 `reproduction.json` 数据迁移后不丢（path/pitfalls 保留），旧 UI/API 行为不坏。
2. 每个新字段必须有对应 UI 或 API；禁止只加 schema 不给入口。
3. Missing/Conflict 显式分级并**仅 required/critical 影响 readiness**，不靠 AI 假装知道。
4. Context Packet 输出 token 预算 + included/omitted，可对比"整份 markdown"前后的 token 差。
5. 页面顶部唯一门控：§12 的 blocking-aware ready 公式，Critical 不清零不放行。
6. 全部改动 `tsc --noEmit` 通过、dev server 热重载验证；真实数据（NSR 记录）作为验收样本。
