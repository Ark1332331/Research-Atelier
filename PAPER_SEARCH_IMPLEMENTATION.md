# Research Atelier · Literature Discovery 实现方案
## （Design Intent v1.0 落地 · 取代旧 PAPER_SEARCH_IMPLEMENTATION v0.1/v0.2）

> 状态：**方案 v1.1（hardening patch 已合入，2026-08-27）—— 用户四角度审核通过；待用户 GO 后从 Phase A 开始编码**。
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

**成本原则（DI §26，v1.1 精确化）：** **核心工作流不依赖任何额外付费 Search API**（Grok / Exa / Tavily / SerpApi / WoS API 等只能作为 Optional Accelerator，Phase E）。注意：这不等于「整套功能零成本」——Phase A 的策略生成使用项目已有的 LLM（DeepSeek），属既有运行成本；「零依赖」特指**不再新增付费检索 API 依赖**。

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
| SearchIntent（goal/**conceptGroups**/context/exclude/preferredTypes/yearRange/seedPaper） | **保留（v1.1.1 字段升级）** | concepts 升级为 conceptGroups（组内 OR、组间 AND：world model 与 robotics 必须是不同组）；Phase A 在其上产出 SearchPlan（§5） |
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

| 入口 | 用户状态 | 对应 Phase | 权重（v1.1） |
|---|---|---|---|
| 我只有一个研究问题 → 帮我开始检索 | 还没有论文 | A | **主入口**（研究工作流） |
| 我已经搜到一些论文 → 帮我筛这些论文 | 已经有一堆论文 | B | **主入口**（研究工作流） |
| 我已经有关键论文 → 从这篇继续找 | 已经找到关键论文 | C | **主入口**（研究工作流；第一版不实现，入口可后置） |
| 快速发现一些论文 | 先不动身去网站 | D | **次级快捷工具**（页底小字「只是想先看看？」） |

**入口权重（v1.1）**：A/B/C 是研究工作流（对应「还没有论文 → 已经有一堆论文 → 已经找到关键论文」的自然阶段），D 是快捷工具。首页用三张主卡片 + 页底次级入口「只是想先看看？[快速发现一些论文]（基于开放学术数据源）」，**避免新用户误以为「能自动搜」而跳过真实数据库**。

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
  priority: "primary" | "secondary" | "later";  // v1.1：本轮是否主推
  recommendedNow: boolean;         // v1.1：一个 SearchPlan 只允许一个 recommendedNow=true
  landingUrl: string;              // v1.1.2：所有数据库必有的可打开入口（WoS=Advanced Search 入口页）
  deepLinkUrl?: string;            // v1.1.2：带 query 的直达深链（GS/S2/arXiv/OpenAlex）；WoS 无 → 复制检索式+打开入口
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
type EvidenceLevel = "metadata" | "abstract" | "fulltext" | "citation-graph";  // v1.1

interface PaperTriage {
  paperId: string;
  role: PaperRole;
  roleReason: string;              // 为什么是这个角色
  roleConfidence: "high" | "medium" | "low";   // v1.1：角色是相对当前问题的判断，不是绝对事实
  roleEvidence: EvidenceRef[];     // v1.1：角色依据（如「被当前候选集 9 篇后续工作引用」）
  worthReading: string;            // 为什么值得读（或为什么跳过）
  relationToQuestion: "high" | "medium" | "low" | "unknown";
  depth: ReadingDepth;
  evidenceLevel: EvidenceLevel;    // v1.1：本次判断基于什么证据
  keySections: string[];           // 重点看 —— 仅 evidenceLevel=fulltext 时允许填写，否则必须为空
  skipSections: string[];          // 暂时不用看 —— 同上
  d: {                             // 六维一句话判断（DI §8），不打分
    d1: string; d2: string; d3: string;
    d4: string; d5: string; d6: string;
  };
  verdict: "读" | "扫读" | "跳过" | "待定";
}

interface EvidenceRef {            // v1.1
  kind: EvidenceLevel;
  source: string;                  // 如「当前候选集内 9 篇引用」「Crossref 元数据」
  detail?: string;
}

/* ---- Phase C：Seed Paper + Literature Map（设计保留，第一版不实现，见 §14） ---- */
type MapRelation = "cites" | "related" | "author-continuity";   // v1.1：底层关系事实

interface MapNode {
  paperId: string; title: string; year?: number;
  role?: PaperRole; cluster?: string;
}
interface MapEdge {
  from: string; to: string;        // Paper B cites Paper A → from=B, to=A, relation="cites"
  relation: MapRelation;
  explanation: string;             // AI 解释为什么连在一起（DI §13）
  evidence: string;                // 证据（引用关系 / 方法继承 / 作者延续）
}
// v1.1：forward/backward 不再写进底层关系（避免 relation="citations"+direction="backward"
// 自相矛盾），只作为「相对当前 seed 的 UI 视角」在展示层计算。
// author-continuity 只表示作者/团队连续，不自动断言「学术路线传承」——更强结论由 AI 解释给出。
interface ReadingPath {
  id: string; nodes: string[];
  audience: "beginner" | "recent-3y" | "custom";
  rationale: string;               // 为什么按这个顺序读
}

/* ---- 贯穿：Next Step（derived）+ Research Session ---- */
interface NextStep { action: string; reason: string; }

interface DatabaseAction {         // v1.1：替代 visitedDatabases（只记录系统可确认的动作）
  database: string;
  action: "query-generated" | "opened" | "results-imported";
  at: string;
}

interface ResearchSession {
  id: string;
  question: string;
  intent?: SearchIntent;
  plan?: SearchPlan;
  databaseActions: DatabaseAction[];
  candidates: CanonicalPaper[];
  triage: PaperTriage[];
  seedPapers: string[];
  map?: { nodes: MapNode[]; edges: MapEdge[] };
  readingPaths: ReadingPath[];
  openQuestions: string[];
  // v1.1：nextStep 是 derived state —— deriveNextStep(session) 每次动态算，
  // 不作为持久化事实（session 一变旧建议立即过期）；最近一次建议可存 history 备查
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

**一次只给一个主要任务（v1.1，与复现模块 UX 原则一致）：**

~~~text
第一步 · Google Scholar（推荐现在做）
搜索："world model" robotics
为什么：先建立较宽的候选池
[复制并打开 Scholar]

（折叠）之后可以：
Web of Science —— 更规范的筛选和引用追踪
arXiv —— 补最近工作
Semantic Scholar —— 找到种子论文后展开引用网络
~~~

一个 SearchPlan 中只有一个 DatabaseStrategy 的 recommendedNow=true；其余全部折叠为「之后可以」。**不把四个数据库的检索式同时砸给用户。**

**WoS 检索式 = 确定性 compiler（v1.1 技术原则）：**

~~~text
LLM 只产结构化概念（concepts / context / yearRange）
  ↓
compileWosQuery(intent)   ← 代码负责 WoS 语法
  ↓
TS=("world model" OR "world models") AND TS=(robot* OR "embodied agent*") AND PY=(2022-2026)
~~~

**禁止 LLM 直接生成最终 WoS 字符串**（括号未闭 / 字段 tag 写错 / 转义不对 / 年份语法错是常见但无聊的 bug）。compiler 规则：TS= 包概念组与语境组、AND 连接、PY= 年份区间；**年份跨度超过五年时不机械生成 PY=(2010-2026)**，改为提示「时间跨度较大，建议第一轮不限制，或拆成『近五年 + 历史基础工作』两轮」。

**Google Scholar 用多条短 query，不追求复杂 Boolean（v1.1）：**

~~~text
① "world model" robotics          先搜；结果太宽再换②
② "world model" "embodied agent"
③ "world models" robotics review  需要背景综述时
~~~

Scholar 的性格是「短而明确的 query + 用户在其原生排序 / Cited by / Related articles 上继续探索」；WoS 才是「一条结构严谨的高级查询式」。两者不要互相照搬。

**Return Path（v1.1，Phase A→B 的最大 UX 风险点）：**

打开外链前固定显示「这一轮任务」：

~~~text
这一轮任务
① 在 Scholar 执行这条搜索
② 先浏览前 2–3 页
③ 找到大约 10–20 篇看起来相关的论文
④ 回来交给 Research Atelier 筛选

[复制并打开 Google Scholar]

回来以后：[我搜完了，开始导入论文]
~~~

用户点外链时 Research Session 已保存；回来页面仍在「World Model / Robotics · 当前步骤：把刚刚搜到的论文带回来」，而不是回到空聊天框。

**Next Research Action（DI §5）**：不只给 query，还给「进去以后点什么」。例如已有 DreamerV3：

~~~text
你已经有一篇很好的种子论文，这一轮不建议继续关键词搜索：
Google Scholar   → 点 Cited by      （找后来的 follow-up）
Web of Science   → 点 Related Records （找主题接近但术语不同的论文）
Semantic Scholar → 看 References    （找它建立在哪些基础工作上）
~~~

**轻量解释（DI §23）**：默认一句话「为什么这么做？」，想了解再展开（为什么用 exact phrase / 为什么点 Cited by / 为什么先看 survey）。不教程墙。

**验收（Phase A）：**
1. 输入「world model 在 robotics 最近三年」→ SearchPlan 含概念/同义词/排除/时间窗 + **仅 1 个 recommendedNow 主动作** + GS 短 query 组 + WoS TS= 检索式（由 compileWosQuery 确定性生成）+ S2/arXiv 定位 + 每库 why + 下一步动作
2. 每库有 [复制]；GS 深链可用则给 ↗，WoS 深链不稳定以复制为主（诚实降级）
3. 零额外付费 Search API 依赖（LLM 策略生成为项目既有成本）
4. seed 场景给出 Cited by / Related Records / References 三动作
5. 解释默认一句话、可展开
6. **Return Path**：外链前显示「这一轮任务 ①–④」；回来有「我搜完了，开始导入论文」入口且 Session 不丢

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

- **证据等级（v1.1，必须诚实）**：每次判断标注 evidenceLevel（metadata / abstract / fulltext / citation-graph）与 roleConfidence（high/medium/low）。UI 区分「基于标题+摘要判断」与「已读取全文后判断」；**只有全文可用时才输出「重点看 Method §3 / 跳过 Appendix B」，没有全文就写「重点阅读章节：需要导入全文后判断」——禁止凭空猜章节。**
- **阅读深度四档（DI §9）**：跳过 / 扫读 / 定向阅读 / 精读 —— 回答「对当前任务值不值得投入 2 小时」。
- **领域角色（DI §10）**：综述/入门、奠基工作、核心路线、重要 follow-up、竞争路线、近期进展、应用工作、边缘相关。用户最终看到的是「建立背景 2 篇 / 理解主路线 3 篇 / 了解最新进展 2 篇 / 了解竞争方向 1 篇」，而非 Top 10 列表。
- **引用数分源（DI §20）**：OpenAlex citations: 980 / GS 1,250 / WoS 730 —— 明确写来源，不合并成一个「唯一事实」。
- **provenance（DI §19）**：每条候选保留 sourceProvider + accessProvider，服务「判断可核实」。

**验收（Phase B，第一版为 B-lite，见 §14）：**
1. **大文本框一次贴多行**（标题/DOI/URL 混贴自动逐条识别）+ BibTeX + RIS + WoS export 解析成功（单测 + 手工样例）
2. 多版本归一：arXiv/会议/期刊识别为同一工作并呈现版本链
3. Enrichment 后字段带来源；缺失标「未核实」
4. Triage 输出：角色 + roleConfidence/roleEvidence + 四档深度 + 六维一句话（不打分）
5. 引用数分源；provenance 可核实
6. **无全文不得编造章节**：evidenceLevel ≠ fulltext 时 keySections/skipSections 必须为空，UI 显示「需要导入全文后判断」

---

## 8. Phase C — Seed Paper + Literature Map（第三核心功能，DI §11–15）

**职责**：解决「我不知道下一步往哪找」。从种子论文展开。**开发状态（v1.1）：设计与 schema 完整保留，第一版不实现（§14 MVP 1 = A + B-lite；C 待 A/B 闭环验证后进入）。**

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

**底层三种关系（v1.1，避免字段自相矛盾）：** cites（Paper B cites Paper A，引用了谁 / 谁引用了它由 from→to 方向表达）/ related（主题结构相似）/ author-continuity（作者/团队连续——只表示延续，不自动断言「学术路线传承」，更强结论由 AI 解释给出）；以后可加 co-citation / bibliographic coupling。**forward/backward 只是相对当前 seed 的 UI 视角，不写进底层关系事实（§5.3）。**

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

**开发状态（v1.1）：不进入第一版（§14 MVP 1）。** 旧 search_papers() 在 Phase D 落地前继续作为现状能力存在；Phase D 单独开发时把自动检索接回 Quick Discovery。

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

这是整个模块最有「导航仪」感觉的能力。

**实现原则（v1.1，derived state）**：nextStep 不持久化 —— deriveNextStep(session) 每次按当前 session 状态动态计算；session 一变（如刚导入 20 篇）旧建议立即过期。最近一次建议可存入 history 供展示，但不作为当前状态唯一真相。databaseActions 只记录系统可确认的动作（query-generated / opened / results-imported），不假装「访问过」。Research Session 作为持久对象（§4）承载这一切；存储沿用本地 data/ 模式（store.ts），可导出。

---

## 12. 首页 UX（DI §24）

~~~text
你现在处于哪一步？

┌─────────────────────┐
│ 我只有一个研究问题    │
│ 帮我开始检索    →    │
└─────────────────────┘

┌─────────────────────┐
│ 我已经搜到一些论文    │
│ 帮我筛这些论文  →    │
└─────────────────────┘

┌─────────────────────┐
│ 我已经有关键论文      │
│ 从这篇继续找    →    │
└─────────────────────┘

────────────────────
只是想先看看？
[快速发现一些论文]   ← 次级快捷入口（基于开放学术数据源）

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

| Phase | 内容 | 验收要点 | 第一版（v1.1） |
|---|---|---|---|
| **A** | Search Guide：入口「帮我开始检索」+ SearchPlan 生成（单 primary action）+ 数据库策略（GS/WoS/S2/arXiv）+ compileWosQuery + 复制/深链 + Return Path + 轻量解释 + Research Session 骨架 | §6 六条 | **MVP 1 必做** |
| **B-lite** | Candidate Inbox（大文本框混贴 + BibTeX/RIS/WoS export）+ dedupe + metadata enrichment + 基础 Paper Triage（角色/深度/为什么，带 evidenceLevel） | §7 六条 | **MVP 1 必做** |
| **C** | Seed Paper + Literature Map：入口「从这篇论文继续找」+ 三关系 + 关系解释 + 阅读路线 | §8 四条 | 保留设计，**不进入第一版** |
| **D** | Quick Discovery：入口「快速发现」（首页次级）+ OpenAlex/S2/arXiv + RRF/BM25 + UI 明示降级 | §9 四条 | **不进入第一版**（旧 search_papers 继续存在） |
| **E** | Optional Accelerators（WoS API / SerpApi / Grok / Exa / Tavily / 浏览器扩展 / alerts） | 按需 | 以后 |

**MVP 1 范围（v1.1 锁定）：Phase A（完整）+ Phase B-lite（Candidate Inbox + enrichment + 基础 Triage）。**

~~~text
自然语言研究问题 → SearchIntent → 生成 1 个推荐当前动作 + GS/WoS 策略
→ 复制 / 打开真实网站 → 回来 → 一次贴入多个标题/DOI/URL 或导入 BibTeX/RIS/WoS export
→ Normalize / Dedupe → 补 metadata/abstract → AI 判断（角色 / 相关程度 / 阅读深度 / 为什么）
→ 选择 1–3 篇 seed papers
~~~

**做到这里停**：第一版不做 Literature Map / RRF / BM25 / S2 自动图扩展 / Grok / Exa / SerpApi / WoS API / 浏览器扩展 / alerts。C/D/E 完整保留设计与 schema，等 MVP 1 闭环验证后再进入。

依赖关系：A 是地基（SearchPlan/ResearchSession 被后续复用）；B-lite 的 dedupe 复用 Step 1；C 需要 B 的候选/种子；D 可并行但依赖 Step 1 模型。A→B-lite 为第一版主链路。

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

**MVP 1 成功标准（v1.1，用 "world model in robotics" 做一次真实测试）**——一个第一次用产品的人应能走完 8 步闭环：

~~~text
1. 不知道怎么搜
2. 系统告诉他现在先去 Scholar，给出具体查询
3. 他真的能打开 Scholar 并执行
4. 带回来 20 篇
5. 系统去重并解释其中哪些值得读
6. 最后留下 3–5 篇
7. 用户知道为什么读这几篇
8. 系统告诉他下一步应从其中哪篇继续展开
~~~

这 8 步好用 → 产品成立，再做 Phase C（把那 3 篇种子论文展开成发展地图）。

---

## 16. 与复现模块的关系 + 成本原则

~~~text
文献发现：Human question → Search Plan → 真实数据库检索 → Candidate Inbox → Triage → Map → Next Step
复现模块：Paper → Reproduction Spec → Codex Tasks
共同风格：先把模糊目标「编译」成结构化任务，再调用外部工具（这里是把研究意图编译成检索策略）。
本方案不动复现模块；两模块共享的只有论文库（library.json）入口。
~~~

成本硬原则（DI §26，v1.1 精确化）：**核心工作流不依赖额外付费 Search API**；Optional Accelerator 只是加速，不是依赖。这不等于「整套功能零成本」——LLM 策略生成使用项目已有 DeepSeek（既有运行成本）；「零依赖」特指不新增付费检索 API。

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

v1.1（2026-08-27）hardening patch（用户四角度审核后锁定，产品方向不再改）：
- A/B/C 主入口、Quick Discovery 降级为首页次级快捷入口（§4/§12）
- SearchPlan 一次只推荐一个 primary action（priority/recommendedNow），其余折叠（§5.3/§6）
- WoS：LLM 只产结构化 intent，compileWosQuery() 确定性编译 TS=/PY=；>5 年跨度提示拆两轮（§6）
- Google Scholar：多条短 query，不追求复杂 Boolean；与 WoS 性格区分（§6）
- Return Path：外链前固定「这一轮任务 ①–④」+「我搜完了，开始导入论文」；Session 不丢（§6）
- PaperTriage 增加 evidenceLevel/roleConfidence/roleEvidence；无全文不得编造 keySections/skipSections（§5.3/§7）
- Map 底层关系改 cites/related/author-continuity；forward/backward 只作 UI 视角（§5.3/§8）
- nextStep 改 derived state（deriveNextStep）；visitedDatabases 改 databaseActions（§5.3/§11）
- 成本原则精确为「核心工作流不依赖额外付费 Search API」（§1/§16）
- 第一版范围锁定 MVP 1 = Phase A + Phase B-lite；C/D/E 保留设计不进入第一版（§14）
- 新增 MVP 1 成功标准（8 步闭环，world model in robotics）（§15）

v1.1.1（2026-08-27）Phase A hardening patch（进入 B-lite 前）：
- 路由修复：/api/literature 拆为真实子路由 plan / action / session（原单 route.ts 只匹配 /api/literature，
  子路径请求不会命中）；新增真实 HTTP 集成测试 scripts/test-literature-http.mjs（dev server 实测 14 项全过）
- SearchIntent 语义修正：concepts → conceptGroups（组内 OR、组间 AND）；WoS 与 GS query 均由结构化 groups 编译
- 年份注入：planner 显式注入当前年份；resolveYearRange 相对时间稳定（2026 最近三年 → [2024,2026]，clamp 未来年份）
- goal → primary 数据库确定性规则（recent→arXiv、foundational→WoS、其余→Scholar）；支持 RA_PLANNER_MOCK 确定性集成测试

v1.1.2（2026-08-27）Phase A 封板 hardening：
- landingUrl 全覆盖：所有数据库必有确定性可打开入口（WoS=Advanced Search 入口页）；deepLinkUrl 仅带
  query 深链的库有（GS/S2/arXiv/OpenAlex）；UI 打开 deepLinkUrl ?? landingUrl，真实打开才记录 opened
- context 定义为 soft context：不进主 WoS query（硬约束组 = conceptGroups）；仅用于 GS 短 query 多样化
- 新增 API 级 goal 路由测试 scripts/test-literature-goals.mjs（六 goal：foundational→WoS / recent→arXiv /
  follow_paper→S2 primary + landingUrl + deep-link 区分 + context 不污染 WoS，42 项全过）；
  HTTP 集成测试补 primary landingUrl 断言（15/15）；单测 68/68

v1.2（2026-08-27）Phase B-lite 实现（MVP 1 = A + B-lite 落成）：
- Candidate Inbox：大文本框混贴（标题/DOI/arXiv URL/论文 URL/BibTeX/RIS/WoS export）自动拆分，
  deterministic parser 无 LLM；无法识别条目进 unknown + warnings，绝不静默丢失（scripts/test-importer.mjs 16 项）
- Dedupe：复用 Step 1 canonicalIdFor（DOI > arXiv > title），不重新造身份体系；标题相同但标识不同 →
  两条都保留并标注「可能为不同版本」（保守不激进）
- Enrichment：Crossref（仅按 DOI 校验）+ OpenAlex（DOI 或严格标题匹配）；只补不覆盖；
  provenance 分来源（title/abstract/venue/citations 各自记录来源），citation 不跨源合并；
  单篇失败只记 warnings，不进整批失败（B4）
- Triage：evidenceLevel 由候选实际证据判定（abstract/metadata）；LLM 声称 fulltext 被 clamp；
  evidenceLevel !== fulltext 时 keySections/skipSections 代码强制为空（B5）；输出角色/深度/为什么，
  无总分排行榜（B6）
- Session 状态机新增 screening（awaiting-import → screening）；importStats/importBatch 持久化，
  刷新后候选/triage/种子/统计不丢（B8）
- API：/api/literature/import + /api/literature/triage + action select-seeds（≤3）
- UI：导入框 → 统计（导入N/识别N/合并N/候选N）→ 候选列表（未核实标红）→ AI 筛选 →
  建议先读 / 建立背景 / 可以暂缓 三组 → 选种子
- 测试：importer 16 + enrich/triage 18 + B-lite e2e（live :3000）24 项全过；回归 68+42+30+23+59+15 全绿；tsc 干净

v1.3（2026-08-27）B-lite identity/grounding hardening：
- Triage 显式接收 session.question + SearchIntent；buildTriageUserPrompt 首行输出研究问题，
  role/relationToQuestion 相对该问题判断（单测：同一候选在不同问题下 prompt 各自包含对应问题）
- Candidate identity lifecycle：URL-only → url: 规范化身份（不再全部落 title:untitled）；
  canonicalFromImport 注册 title:/doi:/arxiv: 别名；enrichment 新获 DOI/arXiv 并入 aliases；
  dedupe 按 canonicalId+别名索引复核（title:id 与 doi:id 不并存；单测：title-only enrich 出 DOI
  后按 DOI 再导入不新增）
- importer：同 record 的 title+DOI+arXiv+URL 合成一条 ImportedPaperCandidate（detectedType 取最强
  标识，其余作为字段）；只有「无 title 且多个标识」才各拆一条
- candidates/evidence 变化后旧 triage/seeds 一律清空（防旧筛选伪装成当前结果；handler 级测试覆盖）
- roleEvidence 与真实 provenance 对齐：fulltext 一律剔除；citation-graph 仅当有分源引用数；
  abstract 仅当有摘要且来源匹配 enrichment；metadata 仅当来源在 provenance 或 import 中（虚构剔除）
- 测试：importer 20 + enrich/triage 28 + hardening（handler 级）14 + B-lite e2e 24 + 回归 68+42+30+23+59+15 全绿；tsc 干净

v1.4（2026-08-27）Phase A.5：Academic Term Mapper + Query Ladder（Phase C 前插入，实机暴露的术语对齐缺口）：
- AcademicConceptMap：coreTasks / methods / broaderFields / applicationTerms / adjacentTerms / ambiguousTerms，
  每 canonical 带 alternatives + confidence；normalizeConceptMap 强制「用户原词逐条落位」，未映射原词自动进
  ambiguous（显式标注，不可静默当标准术语）
- planner 流程：用户问题 → conceptMapper（LLM 语义判断）→ buildLadderFromMap → intentForTier → plan；
  非 mock 路径绝不把用户原词直接放进 conceptGroups；LLM 绝不产出最终 query（仍由确定性 compiler 编译）
- Query Ladder 三层：broad-domain（上位领域+核心任务）→ method-task（方法+核心任务）→ application-narrow
  （应用场景）；每层只有一组 conceptGroups，仍满足「一次只一个 recommendedNow=true」；
  ambiguous 词即使出现在 alternatives 也被确定性剔除（stripAmbiguous）
- UI：显示「系统如何理解你的问题」（核心任务/方法/上位领域/应用场景/歧义），并解释应用场景第一轮不锁死；
  「之后可以」折叠显示第 2/3 层 query 预览
- B-lite term calibration：基于真实候选 title/abstract 统计（termsConfirmed / termsSuggested / termsWeakOrRare），
  ambiguous 用户表达在候选集中罕见也提示换词；只建议，不改研究目标
- 回归案例（机器人大击剑）：robotic fencing → application；human motion recognition → ambiguous；
  第一轮 query 为 HRI AND human intention/action recognition（canonical），不再生成
  "robotic fencing" "human motion recognition"；第三层才加入 fencing（test-term-mapper 25 项）
- 测试：term-mapper 25 + 全量 68/42/20/28/14/30/23/59 + live 15/24 全绿；tsc 干净
~~~



