# Research Atelier · Literature Discovery 实现方案
## （Design Intent v1.0 落地 · 取代旧 PAPER_SEARCH_IMPLEMENTATION v0.1/v0.2）

> 状态：**方案 v1.0 —— 待用户审阅（产品逻辑 / 技术可行性 / 用户实际操作路径 / 是否膨胀成大全系统），未开始新代码**。
> 本文整体重写旧版 PAPER_SEARCH_IMPLEMENTATION.md（v0.1/v0.2 已由本版本取代；git 历史保留旧版与旧 Step 1 记录）。
> 唯一已落地代码：**Paper Search Step 1**（src/lib/search/types.ts + 测试 + chat/route.ts 接线，2026-08-27 提交 fdebf7f）——保留，语义迁移见 §3。
> 依据：《Research Atelier · Literature Discovery Design Intent v1.0》（用户 2026-08-27 提供，下文简称 DI）。

---

## 0. 一句话定调（DI §29）

> **Research Atelier Literature Discovery 不以「替代学术数据库」为目标，而以「让不会使用学术数据库的人，也能完成高质量文献发现」为目标。**
> AI 负责把研究意图编译成检索策略、评价真实候选、解释引用与发展关系并持续建议下一步；
> Google Scholar、Web of Science 等成熟数据库继续负责它们最擅长的论文索引与检索。

---

## 1. 产品重新定位（DI §0/§1）

旧定位（被取代）：

~~~text
「AI 聚合多个学术数据库，替用户自动搜索论文」
成功指标 ≈ 接了多少 Provider / 搜到多少篇
~~~

新定位：

~~~text
Guided Literature Discovery Workflow / AI Research Navigator（科研检索导航层）
Research Atelier 不替代学术检索平台，而是负责用户最困难的部分：
  ① 不知道该怎么搜        → 检索策略编译（Search Guide）
  ② 不知道搜到的值不值得读 → 真实候选评价（Paper Triage）
  ③ 不知道下一步往哪找    → 引用与发展地图 + 下一步建议（Literature Map / Next Step）
~~~

**三个用户问题（DI §1）：**

| 用户问题 | Research Atelier 的职责 |
|---|---|
| 我不会搜 | 理解研究意图、拆概念、扩同义词、生成不同数据库的检索式、告诉用户为什么去这个数据库 |
| 我不知道哪些值得读 | 接收真实候选论文，基于摘要/正文/引用关系/venue/时间/代码数据等证据筛选 |
| 我不知道下一步找什么 | 从种子论文沿 references / citations / related / authors / timeline 展开并解释路线 |

**成功指标改变（DI §1）：** 不再以「搜索到多少篇 / 接了多少 Provider」为主指标，而以「用户是否更快建立一个领域的正确认知结构」为目标。

**成本原则（DI §26）：** 核心工作流**不能依赖任何额外付费 Search API**；Grok / Exa / Tavily / SerpApi / WoS API 等只能作为 Optional Accelerator（Phase E），不是产品依赖。

---

## 2. 现状盘点（真实代码 + Step 1 状态）

| 模块 | 现状（真实位置） | 新方案处理 |
|---|---|---|
| Step 1 数据模型 | src/lib/search/types.ts（已提交 fdebf7f）：SearchIntent / ProviderQuery / ProviderPaper / CanonicalPaper / PaperHitV2 / SearchRun + normalizeDoi / normalizeArxivId / normalizedTitle / canonicalIdFor + SourceCoverage / hardSourcesCovered / partialRetrievalWarning / coverageStatusLabel | **保留**；coverage 语义迁移（§3） |
| Step 1 测试 | scripts/test-search-types.mjs（30 用例通过）+ 回归 23/59 + tsc 干净 | 保留；随语义迁移补/改用例 |
| search_papers 接线 | chat/route.ts：search_papers 返回 PaperHitV2（sourceProvider=openalex，行为不变） | 保留；Phase D 重接为 Quick Discovery |
| 旧检索实现 | paper-tools.ts:57 searchPapers(query, max=6)：OpenAlex 单查询、select 无 relevance_score/cited_by_count/type | **降级为 Quick Discovery 的 provider 之一**（Phase D），不再作为产品主线 |
| P0 筛选 prompt | data.ts TOOLS.p0：六维评分 + 强制链接 | **升级为 Paper Triage**（Phase B）；六维保留、输出形态改（§7） |
| 筛选入口 | page.tsx「论文筛选」视图（ChatPanel toolKey="p0"） | **改造为四入口 + Research Session**（§4/§12） |
| 复现模块 | REPRO_SPEC_IMPLEMENTATION.md（Step 1–3 已合入，并行会话进行中） | 不动 |

---

## 3. Step 1 保留 / 迁移 / 废止（用户点名要求，逐项说明）

| Step 1 内容 | 处理 | 说明 |
|---|---|---|
| SearchIntent（goal/concepts/context/exclude/preferredTypes/yearRange/seedPaper） | **保留** | 语义不变；Phase A 在其上产出 SearchPlan（§5） |
| ProviderPaper（sourceProvider/accessProvider 分源） | **保留** | provenance 从「证明接了多少 API」改为「让所有科研判断可核实」（DI §19） |
| CanonicalPaper + canonicalIdFor + normalizeDoi/ArxivId/normalizedTitle | **保留** | Candidate Inbox 去重的核心（DI §7）；多版本链呈现（§7.2） |
| PaperHitV2 | **保留** | Quick Discovery 的返回形态；字段名兼容 download_paper |
| SearchRun | **保留类型，语义迁移** | 从「本轮检索运行记录」泛化为 Research Session 内的记录单元；不再承担完整度门控 |
| SourceCoverage / CoverageStatus | **保留类型，语义迁移** | coverage 从「完整筛选门控」降级为「本轮数据来源的透明记录/诊断展示」（哪些源贡献了、哪些没有） |
| hardSourcesCovered() / partialRetrievalWarning() | **废止作为产品门控** | 「GS AND WoS = 完整检索」判据取消（DI §25）；函数保留为诊断/透明展示工具，代码加 @deprecated 注释，Phase B 起不再作任何门控 |
| coverageStatusLabel() | 保留 | 用于来源状态展示（✓ 已检索 / ○ 尚未接入 / ⚠ 未覆盖），但**不再触发「部分检索」警示门控** |
| Query Planner（旧 v0.2 §4.2 设计） | **保留思想，职责改变** | 从「生成多路自动检索 query」改为「生成不同数据库的检索策略 + 为什么去这个库 + 进去以后点什么」（DI §3–5） |
| 旧 v0.2 的 Step 2–10（OpenAlex 管线 / WoS API / SerpApi / 数据源配置页 / Citation Graph 后置 …） | **废止，重排为 Phase A–E** | 新顺序见 §14；WoS/SerpApi 从产品依赖降为 Optional Accelerator（§10） |

---

## 4. 四个入口 + Research Session（DI §2/§22/§24）

**首页不再是大聊天框**，四个入口：

| 入口 | 用户状态 | 对应 Phase |
|---|---|---|
| 帮我开始检索 | 我只有一个研究问题，不知道该怎么搜 | A |
| 帮我筛这些论文 | 我已经从 Scholar/WoS 等搜到一些论文 | B |
| 从这篇论文继续找 | 我已找到一篇关键 seed paper | C |
| 快速发现一些论文 | 先不动身去网站，用开放数据库快速找一批 | D |

四个入口共享同一个 **Research Session**（持久对象，DI §22）：

~~~text
Research Session {
  研究问题
  检索意图（SearchIntent）
  检索计划（SearchPlan）
  用过的查询与访问过的平台（visitedDatabases）
  候选论文（CanonicalPaper[]）
  筛选结果（PaperTriage[]）
  种子论文（seedPapers）
  文献地图（MapNode[] / MapEdge[]）
  阅读路径（ReadingPath[]）
  未解决问题（openQuestions）
  下一步建议（NextStep）
}
~~~

进入入口后页面保持三层（DI §24）：顶部=当前研究目标+当前阶段；主体=当前最重要任务；侧边/下方=候选论文 / 地图 / 检索记录 / 证据。避免一次摊开几十个功能。

---

## 5. 数据模型（保留 + 新增）

### 5.1 保留（来自 Step 1，不改动字段）

SearchIntent / ProviderQuery / ProviderPaper / CanonicalPaper / PaperHitV2 / normalizeDoi / normalizeArxivId / normalizedTitle / canonicalIdFor（全文见 src/lib/search/types.ts）。

### 5.2 迁移（类型保留，语义调整）

SearchRun / SourceCoverage / CoverageStatus：记录与展示用；hardSourcesCovered / partialRetrievalWarning 标记 @deprecated（不作为产品门控，§3）。

### 5.3 新增（本方案核心 schema）

~~~ts
/* ---- Phase A：Search Guide ---- */
interface SearchPlan {
  intent: SearchIntent;
  stage: "plan-ready";
  databases: DatabaseStrategy[];   // 按当前研究状态推荐哪些库、怎么搜
  suggestedFirstAction: string;    // 「先找 1–2 篇近年综述」
  createdAt: string;
}

interface DatabaseStrategy {
  id: "google-scholar" | "web-of-science" | "semantic-scholar" | "arxiv" | "openalex";
  purpose: string;                 // 这个库适合干什么
  queries: string[];               // 各库语法的可执行检索式
  recommendedFirst?: string;       // 推荐先执行哪条
  deepLinkUrl?: string;            // 可稳定带 query 的深链（GS 的 q= 通常可用；WoS 不稳定 → 以复制为主）
  nextActions: string[];           // 进去以后点什么：Cited by / Related Records / References …
  why: string;                     // 为什么这一轮建议它（默认一句话，可展开）
}

/* ---- Phase B：Candidate Inbox + Paper Triage ---- */
type ImportKind = "title" | "doi" | "arxiv-url" | "bibtex" | "ris" | "wos-export" | "library";

interface ImportedCandidate {
  id: string;
  importKind: ImportKind;
  raw: string;                     // 粘贴文本 / 文件原文（保留证据）
  parsed: ProviderPaper[];         // 解析出的候选（0..n 条）
  importedAt: string;
}

type PaperRole =
  | "survey" | "foundational" | "core" | "follow-up"
  | "competing" | "recent" | "applied" | "peripheral";
type ReadingDepth = "skip" | "skim" | "targeted" | "deep";

interface PaperTriage {
  paperId: string;
  role: PaperRole;
  roleReason: string;              // 为什么是这个角色
  worthReading: string;            // 为什么值得读（或为什么跳过）
  relationToQuestion: "high" | "medium" | "low" | "unknown";
  depth: ReadingDepth;
  keySections: string[];           // 重点看
  skipSections: string[];          // 暂时不用看
  d: {                             // 六维一句话判断（DI §8），不打分
    d1: string; d2: string; d3: string;
    d4: string; d5: string; d6: string;
  };
  verdict: "读" | "扫读" | "跳过" | "待定";
}

/* ---- Phase C：Seed Paper + Literature Map ---- */
type MapRelation = "references" | "citations" | "related" | "author-lineage";

interface MapNode {
  paperId: string; title: string; year?: number;
  role?: PaperRole; cluster?: string;
}
interface MapEdge {
  from: string; to: string;
  relation: MapRelation;
  direction: "forward" | "backward" | "undirected";
  explanation: string;             // AI 解释为什么连在一起（DI §13）
  evidence: string;                // 证据（引用关系 / 方法继承 / 作者延续）
}
interface ReadingPath {
  id: string; nodes: string[];
  audience: "beginner" | "recent-3y" | "custom";
  rationale: string;               // 为什么按这个顺序读
}

/* ---- 贯穿：Next Step + Research Session ---- */
interface NextStep { action: string; reason: string; }

interface ResearchSession {
  id: string;
  question: string;
  intent?: SearchIntent;
  plan?: SearchPlan;
  visitedDatabases: { id: string; at: string; action?: string }[];
  candidates: CanonicalPaper[];
  triage: PaperTriage[];
  seedPapers: string[];
  map?: { nodes: MapNode[]; edges: MapEdge[] };
  readingPaths: ReadingPath[];
  openQuestions: string[];
  nextStep: NextStep;
  createdAt: string; updatedAt: string;
}
~~~

---

## 6. Phase A — Search Guide（第一核心功能，DI §3–5/§21/§23）

**职责**：解决「我不会搜」。输入研究问题，产出 **SearchPlan**——不是「这里有 8 篇论文」，而是：

~~~text
你的研究目标
核心概念：World Model / Embodied AI / Robotics
相关表达：Predictive world model · Latent dynamics · Model-based agent · Embodied foundation model
可能歧义：「world model」也大量出现在 mental health / economics 等领域
建议排除：mental health / world development report
时间范围：2022–2026
本轮目标：先找 1–2 篇近年综述、2–3 篇路线核心、2–3 篇近期代表
~~~

**AI 是「不同数据库的检索式编译器」（DI §4）：**

| 库 | 输出 | 为什么这一轮用它 |
|---|---|---|
| Google Scholar | 3 条建议检索式（如 "world model" (robotics OR "embodied agent")）+ [打开 Google Scholar ↗] / [复制] | 广泛召回、Cited by、Related articles |
| Web of Science | 自动转 WoS 语法：TS=("world model" OR "world models") AND TS=(robot* OR "embodied agent*") AND PY=(2022-2026) + [复制] / [打开 Advanced Search ↗] | 精确主题检索、引用追踪、Related Records、更规范的筛选条件 |
| Semantic Scholar | 提示其定位：Related Papers / Citations / References / 推荐网络（不必重新关键词搜索） | 图关系能力 |
| arXiv | 提示其定位：最新、尚未正式发表的工作 | 时效 |

**Next Research Action（DI §5）**：不只给 query，还给「进去以后点什么」。例如已有 DreamerV3：

~~~text
你已经有一篇很好的种子论文，这一轮不建议继续关键词搜索：
Google Scholar   → 点 Cited by      （找后来的 follow-up）
Web of Science   → 点 Related Records （找主题接近但术语不同的论文）
Semantic Scholar → 看 References    （找它建立在哪些基础工作上）
~~~

**轻量解释（DI §23）**：默认一句话「为什么这么做？」，想了解再展开（为什么用 exact phrase / 为什么点 Cited by / 为什么先看 survey）。不教程墙。

**验收（Phase A）：**
1. 输入「world model 在 robotics 最近三年」→ SearchPlan 含概念/同义词/排除/时间窗 + GS 3 条 query + WoS TS= 检索式 + S2/arXiv 定位 + 每库 why + 下一步动作
2. 每库有 [复制]；GS 深链可用则给 ↗，WoS 深链不稳定以复制为主（诚实降级）
3. 零付费 API 依赖（纯 LLM 生成策略）
4. seed 场景给出 Cited by / Related Records / References 三动作
5. 解释默认一句话、可展开

---

## 7. Phase B — Candidate Inbox + Paper Triage（第二核心功能，DI §6–10/§18–20）

**职责**：解决「我不知道搜回来的论文值不值得读」。用户把真实检索结果带回来。

### 7.1 Candidate Inbox（DI §6）

第一版入口（简单实用，不做浏览器扩展）：

~~~text
粘贴论文标题 / 粘贴 DOI / 粘贴 arXiv URL / 粘贴 BibTeX / 导入 RIS / 导入 WoS export / 从现有论文库选择
~~~

管线：import → 解析（importers/）→ **normalize + dedupe（保留 Step 1 纯函数）** → **metadata enrichment** → Paper Triage。

### 7.2 去重与版本链（DI §7，保留并完善）

~~~text
canonical identity：DOI > arXiv ID > normalized title（Step 1 已实现）

同一工作：
  arXiv preprint → Conference → Journal Extension
不稀里糊涂显示成三篇，也不粗暴合并 —— 呈现「版本链」：
  Preprint → Conference → Journal Extension
~~~

### 7.3 Metadata Enrichment（DI §18）

用开放数据源（Crossref / OpenAlex / Semantic Scholar）补：DOI、正式标题、venue、年份、摘要、**引用数（标来源）**、OA PDF、arXiv、代码链接、项目页。**不知道就是「未核实」**，禁止凭记忆填「大概发在 NeurIPS」。

### 7.4 Paper Triage（DI §8–10）

六维判断保留（D1 相关性 / D2 领域位置 / D3 知识关系 / D4 阅读门槛 / D5 可复现性 / D6 出处可信度），**输出不是六项考试打分**，而是：

~~~text
DreamerV3
角色：路线核心
为什么值得读：把 Dreamer 路线扩展到更广泛任务，后续大量 world-model 工作沿用了这一方向
与你的问题：高度相关
建议阅读深度：精读
重点看：Method §3 · Figure 2 · Main Experiments · Ablation
暂时不用看：部分附录实现细节
~~~

- **阅读深度四档（DI §9）**：跳过 / 扫读 / 定向阅读 / 精读 —— 回答「对当前任务值不值得投入 2 小时」。
- **领域角色（DI §10）**：综述/入门、奠基工作、核心路线、重要 follow-up、竞争路线、近期进展、应用工作、边缘相关。用户最终看到的是「建立背景 2 篇 / 理解主路线 3 篇 / 了解最新进展 2 篇 / 了解竞争方向 1 篇」，而非 Top 10 列表。
- **引用数分源（DI §20）**：OpenAlex citations: 980 / GS 1,250 / WoS 730 —— 明确写来源，不合并成一个「唯一事实」。
- **provenance（DI §19）**：每条候选保留 sourceProvider + accessProvider，服务「判断可核实」。

**验收（Phase B）：**
1. 粘贴标题 / DOI / arXiv URL / BibTeX / WoS export 四条路径解析成功（单测 + 手工样例）
2. 多版本归一：arXiv/会议/期刊识别为同一工作并呈现版本链
3. Enrichment 后字段带来源；缺失标「未核实」
4. Triage 输出：角色 + 四档深度 + 重点/暂不看 + 六维一句话（不打分）
5. 引用数分源；provenance 可核实

---

## 8. Phase C — Seed Paper + Literature Map（第三核心功能，DI §11–15）

**职责**：解决「我不知道下一步往哪找」。从种子论文展开。

### 8.1 Seed Paper Expansion（DI §15，从旧 v0.2 的 follow_paper 升级为主要工作流）

找到关键论文后，用户选择：

~~~text
找它之前的基础工作 / 找它之后的重要工作 / 找同路线工作 / 找竞争路线
找最近两年的 follow-up / 找作者后续
~~~

数据来源：开放源（Semantic Scholar recommendations/references/citations、OpenAlex referenced_works/cited_by）+ 用户导入候选中的关系。**不做 generic keyword search**。

### 8.2 Literature Map（DI §11–14）

不是「节点 + 一堆线」的视觉玩具，而是**有语义的地图**：

~~~text
2018 World Models（路线起点）
  ├─ PlaNet（latent planning）
  ├─ Dreamer（latent imagination）
  │    └─ DreamerV2 → DreamerV3（scaling / generalization）
  └─ 2024–2026：robotics / embodied agents / foundation world models
~~~

**四种关系（DI §12）：** references（引用了谁）/ citations（谁引用了它）/ related（主题结构相似）/ author-lineage（作者/团队延续）；以后可加 co-citation / bibliographic coupling。

**每条重要边可展开（DI §13）：**

~~~text
Dreamer → DreamerV2
关系：直接后续工作
变化：从 continuous control 扩展到 discrete actions
证据：DreamerV2 references Dreamer + 方法部分明确建立在 Dreamer framework 上
~~~

原则：**AI 解释关系，图算法发现候选关系。**

### 8.3 阅读路线生成（DI §14）

用户选择身份后生成 reading path：

~~~text
我是初学者     → Survey → World Models → PlaNet → Dreamer → DreamerV3 → 最近 robotics 工作
只关心近三年   → 跳过大量历史节点，直接进入 2024–2026 主线
~~~

**验收（Phase C）：**
1. seed → 前向（citations）+ 后向（references）+ related + author-lineage 四类候选
2. 每条边可展开「关系 + 变化 + 证据」
3. 生成两条 reading path（初学者全历史 / 最近三年跳过历史）
4. 地图先保证有解释、有路线、有下一步动作，再谈可视化

---

## 9. Phase D — Quick Discovery（降级为辅助模式，DI §16–17）

旧方案的自动检索发动机**不是不要了**，降级为「快速发现」：

~~~text
我现在还没想去 Scholar/WoS，先给我找十几篇看看。
来源：OpenAlex · Semantic Scholar · arXiv · Crossref enrichment
UI 必须明示：这是开放学术源的快速发现，不等于完整 Google Scholar/WoS 检索。
~~~

管线（复用旧方案成熟设计，作为内部工具）：

~~~text
Query Planner（多 query 召回）→ 100+ → Normalize → Dedupe → Hard Filters
→ RRF（多源排名融合）/ BM25（title+abstract 文本相关性）→ 20 → LLM → 5–10
~~~

**RRF + BM25 是内部工具（DI §17）**：用户不看到 BM25=13.77 / RRF=0.041，只看到「为什么留下」。旧 v0.2 的 relevance_score/cited_by_count/type 字段升级、语义检索（search.semantic）等在这里全部用上。

**验收（Phase D）：**
1. 开放源一轮快速发现 15–20 篇
2. RRF 融合多源排名；BM25 内部使用，不展示分数
3. UI 明示「快速发现 ≠ 完整 Scholar/WoS 检索」
4. 复用 Step 1 模型与 dedupe（无新数据模型）

---

## 10. Phase E — Optional Accelerators（DI §26/§28-E，最后才考虑）

~~~text
WoS API / Scholar API proxy（SerpApi）/ Grok / Exa / Tavily / 浏览器扩展 / alerts
~~~

约束：**不能改变核心架构**；核心工作流（策略生成、网站跳转、候选导入、筛选、地图、开放 metadata enrichment）零付费依赖即可运行。

---

## 11. 「下一步建议」贯穿能力 + Research Session 持久化（DI §21–22）

**任何时候系统回答「你现在最值得做的下一步是什么」：**

~~~text
当前：只有一个模糊方向        → 下一步：先找 survey
当前：已有 18 篇候选          → 下一步：先筛出 3 篇种子论文
当前：已经读完 DreamerV3      → 下一步：不要继续关键词搜索；沿 citations 找 2024–2026 直接 follow-up
~~~

这是整个模块最有「导航仪」感觉的能力。Research Session 作为持久对象（§4）承载它；存储沿用本地 data/ 模式（store.ts），可导出。

---

## 12. 首页 UX（DI §24）

~~~text
你现在想做什么？
┌ 帮我开始检索 ┐  ┌ 帮我筛这些论文 ┐
│ 我只有一个问题 │  │ 我已经搜到一些 │
┌ 从一篇论文继续找 ┐  ┌ 快速发现 ┐
│ 我有 seed paper │  │ 开放数据源先搜一轮 │

进入后三层：
顶部：当前研究目标 + 当前阶段
主体：当前最重要任务
侧边/下方：候选论文 / 地图 / 检索记录 / 证据
~~~

---

## 13. 明确不做（DI §27 + 旧方案保留合理项）

~~~text
1. 自己复刻 Google Scholar corpus
2. 直接抓 Scholar HTML 对抗 CAPTCHA / 浏览器自动化
3. 同时接 10 个 Search API 作为产品能力指标
4. 复杂知识图谱平台 / 自动替用户决定研究方向
5. 把所有论文全文都下载下来
6. 一开始就做漂亮但没有科研语义的巨大节点图（地图先保证解释/路线/下一步）
7. 第一版不做浏览器扩展（候选导入用粘贴/文件）
8. 「GS AND WoS = 完整检索」门控（已废止，§3）
9. 核心工作流依赖付费 Search API（§10 仅 Optional）
10. 不改复现模块 / 术语卡 / 精读讲解 / 论文库导入
~~~

---

## 14. 开发顺序与每阶段验收（旧 v0.2 Step 2–10 废止，重排如下）

| Phase | 内容 | 验收要点 |
|---|---|---|
| **A** | Search Guide：入口「帮我开始检索」+ SearchPlan 生成 + 数据库策略（GS/WoS/S2/arXiv）+ 复制/深链 + Next Research Action + 轻量解释 + Research Session 骨架 | §6 五条 |
| **B** | Candidate Inbox + Paper Triage：入口「帮我筛这些论文」+ 导入解析（title/DOI/arXiv/BibTeX/RIS/WoS export）+ dedupe + enrichment + 角色/深度输出 + 版本链 | §7 五条 |
| **C** | Seed Paper + Literature Map：入口「从这篇论文继续找」+ 四类关系 + 关系解释 + 阅读路线 | §8 四条 |
| **D** | Quick Discovery：入口「快速发现」+ OpenAlex/S2/arXiv 自动检索重新接入 + RRF/BM25 + UI 明示降级 | §9 四条 |
| **E** | Optional Accelerators（WoS API / SerpApi / Grok / Exa / Tavily / 浏览器扩展 / alerts） | 按需；不改变核心架构 |

依赖关系：A 是地基（SearchPlan/ResearchSession 被 B/C/D 复用）；B 的 dedupe 复用 Step 1；C 需要 B 的候选/种子；D 可并行但依赖 Step 1 模型。A→B→C 为用户主路径，D 为便利功能。

---

## 15. 最终验收：十项用户任务（DI §29，取代「接了多少 Provider」）

输入：「我想学习 robotics 中的 world model，最近三年为主，但也需要知道路线起点。」

系统必须做到：

~~~text
① 正确理解研究范围
② 给出合理关键词、同义词和排除项
③ 生成 Google Scholar / WoS 等可执行检索式
④ 告诉用户为什么用这些数据库
⑤ 用户导入 20–30 篇后能够正确去重
⑥ 将候选分成 survey / foundational / core / recent / peripheral
⑦ 给出每篇阅读深度和原因
⑧ 选择种子论文后生成前向/后向引用地图
⑨ 能给出一条「只读 5 篇」的合理阅读路线
⑩ 始终告诉用户当前最值得做的下一步
~~~

验收成立 ≠ 勾选「✓ OpenAlex ✓ WoS ✓ Scholar ✓ Grok ✓ Exa」，而 = 用户知道自己该读什么、为什么、下一步去哪。

---

## 16. 与复现模块的关系 + 成本原则

~~~text
文献发现：Human question → Search Plan → 真实数据库检索 → Candidate Inbox → Triage → Map → Next Step
复现模块：Paper → Reproduction Spec → Codex Tasks
共同风格：先把模糊目标「编译」成结构化任务，再调用外部工具（这里是把研究意图编译成检索策略）。
本方案不动复现模块；两模块共享的只有论文库（library.json）入口。
~~~

成本硬原则（DI §26）：Phase A–D 全部零付费 API 依赖；Optional Accelerator 只是加速，不是依赖。

---

## 17. 修订记录

~~~text
v0.1（2026-08-27）：旧方案初稿 —— 「多源自动检索管线」（Query Planner + OpenAlex/S2/Crossref/arXiv + dedupe/rerank）
v0.2（2026-08-27）：用户硬约束 —— WoS/Google Scholar 升一等来源（SerpApi/WoS API + 导入 fallback + coverage 门控）
v1.0（2026-08-27）Design Intent 重写（本文）：
- 产品定位从「AI 聚合数据库替用户搜索」改为「科研检索导航层（Guided Literature Discovery）」
- 保留：SearchIntent / ProviderPaper / CanonicalPaper / dedupe 纯函数 / provenance / PaperHitV2 / RankingProfile 思想
- 迁移：SearchRun/SourceCoverage 从完整度门控 → 透明记录；hardSourcesCovered/partialRetrievalWarning 废止为门控（保留诊断）
- 废止：GS AND WoS = 完整检索判据；WoS/SerpApi 从产品依赖降为 Optional Accelerator；旧 v0.2 Step 2–10 重排为 Phase A–E
- 新增：SearchPlan / DatabaseStrategy / ImportedCandidate / PaperTriage（角色+深度）/ LiteratureMap（四关系+解释+阅读路线）/ ResearchSession / NextStep
- 四个入口取代单一聊天入口；成功指标改为「用户是否更快建立领域的正确认知结构」
- 十项用户任务验收取代 Provider 数量验收
~~~

