# Research Atelier → 论文检索管线（Paper Search Pipeline）实现方案

> 状态：**方案 v0.1 —— 待确认，未开始实现**。用户确认后按 §10 开发顺序进入 Step 1。
> 本方案只动「论文筛选（P0）」的检索侧；复现模块（REPRO_SPEC_IMPLEMENTATION.md，已确认）与精读/术语卡/论文库保持不动。
> 所有「现状」均核对过真实代码（行号见 §1）；所有「API 能力」均于 2026-08-27 实测（见 §4.3 / §5）。

---

## 0. 产品核心（一句话定调）

> Research Atelier 的论文筛选，不是「多接几个数据库」，而是把现在 **search_papers 一次搜 6 条、原样丢给 LLM 挑** 的链路，改成一条**检索管线**：LLM 把模糊研究意图**编译成检索策略** → 多数据源建立**高召回候选池**（50–150）→ **规则硬过滤**（30–50）→ **语义重排**（15–25）→ **证据富化** → LLM 科研筛选（最终 5–10）。

核心转变：

    query → OpenAlex search=query → 前 6 篇 → LLM 从错误的 6 篇里挑好的
    （升级为）用户研究问题 → Query Planner → Providers（OpenAlex/S2/Crossref/arXiv）
    → Candidate Pool 50–150 → Normalize + Dedupe → Hard Filters 30–50
    → Semantic Rerank 15–25 → Evidence Enrichment → LLM Screening → 5–10

**LLM 不再负责「从错误的 6 篇里面挑好的」，而负责「从已经高召回、高相关的候选池里做科研判断」。**

两条贯穿性原则（与复现模块同一风格）：

    1. 模糊的人类目标先被「编译」成结构化任务，再调用外部工具，而不是直接让 AI 凭感觉回答；
    2. 检索过程的每个阶段可追溯：每条候选携带来源 provider、命中 query、引用量来源，
       不允许出现「无法核实是从哪来的」论文。

---

## 1. 现状盘点（已核对真实代码）

| 模块 | 现状（真实代码位置） | 判断 |
|---|---|---|
| searchPapers() | src/lib/paper-tools.ts:57 — 原始字符串直接 works?search=<query>&per-page=≤10；select 不含 relevance_score / cited_by_count / type / topics；已有 3 次指数退避重试 + 25s 超时 | **重写为 Provider + 管线**；重试/超时/mailto/User-Agent 保留 |
| PaperHit | paper-tools.ts:25 — 只有 id/arxivId/title/authors/year/abstract/doi/isOa/oaPdfUrl/publisherUrl/publisherName | **升级为 PaperHitV2**（§4.1）：补 type/venue/citationCount/relevanceScore/topics/sourceProvider |
| P0 Prompt 的信息赤字 | src/lib/data.ts:32-33 — 要求 D5 可复现性、D6 引用量「可核实」，但 PaperHit 不提供引用量/类型/venue | **prompt 与数据层同步改**（§4.7），否则 D6 永远是「未知」 |
| 工具定义 | src/app/api/chat/route.ts:20-53 — search_papers(query) 单参数；download_paper(pdf_url/arxiv_id/title) | search_papers 升级多参数 + 管线执行；download_paper **字段名保持兼容** |
| 工具循环 | chat/route.ts:150 — MAX_TOOL_ROUNDS = 3 | 保持；管线在单次工具调用内完成，不额外占轮次 |
| P0 筛选入口 | src/app/page.tsx「论文筛选」视图 — ChatPanel toolKey="p0" enableToolcall，system prompt 来自 data.ts TOOLS.p0 | 保留；候选呈现方式不变（markdown 列表 + 可点链接），v1 不加新组件 |
| 提示词可编辑 | src/components/chat-panel.tsx — /api/prompts 可自定义/重置 | 保留；prompt 升级后自定义版本需重置（§10 Step 3 验收注明） |
| 论文库/精读/下载导入 | /api/paper + paper-tools.ts downloadPaper | **不动**（download 依赖的字段名不破坏） |
| 复现模块 | REPRO_SPEC_IMPLEMENTATION.md（已确认，Step 1/2 已合入） | 不动，本方案与之并行 |

---

## 2. 目标架构：Search Pipeline

    用户真实研究问题
            │
            ▼
      Query Planner（LLM 编译：goal/concepts/context/exclude/type/yearRange → ≥4 条 query）
            │
            ▼
      Providers（并行）：OpenAlex keyword/phrase/semantic ｜ Semantic Scholar ｜ arXiv ｜ Crossref(校验)
            │
            ▼
      Candidate Pool  50–150 篇（每篇带 providerId + 命中 query + relevanceScore）
            │
            ▼
      Normalize + Deduplicate  →  CanonicalPaper（canonicalId: doi > arxivId > normalizedTitle）
            │
            ▼
      Hard Filters（exclude 命中剔除 / 年份窗 / preferredTypes 降级）→ 30–50 篇
            │
            ▼
      Semantic Rerank（relevance + 时间衰减 + 模式权重；可选 LLM 批排）→ 15–25 篇
            │
            ▼
      Evidence Enrichment（Crossref DOI 校验 / 分源引用数 / 可点链接）
            │
            ▼
      LLM Research Screening（P0 六维评分，D5/D6 由数据提供）→ 最终 5–10 篇

**数字预算（为什么不是 100 篇全进 DeepSeek）：**

    Recruit 50–100（规则层面，token 便宜）→ 硬过滤 30–50 → 语义重排 15–25（标题+摘要 ≈ 4–8k token）
    → LLM 深筛 5–10（2 轮内完成，总成本与现在「6 篇反复试」相当或更低）

检索系统最大的忌讳之一是 **在 recall 很低的时候提前截断**；本方案在第一层就拉高召回，把截断放到有依据的过滤器/重排器。

---

## 3. 三阶段路线（不是一次接十个平台）

| 阶段 | 做什么 | 价值 | 完成标志 |
|---|---|---|---|
| **Search v1** | Query Planner + OpenAlex 用对（phrase/boolean/semantic + 50–100 候选 + 硬过滤 + rerank + 富元数据）+ P0 prompt 对齐 | **立刻解决截图问题**（"world model" 不再混入 mental-health 调查） | §10 Step 4 验收 |
| **Search v2** | ScholarlyProvider 接口 + Semantic Scholar（搜索 + recommendations）+ Crossref 校验器 + arXiv + 多源 dedupe + **Seed Paper → Citation Graph** | 从「关键词搜索」升级为真正科研检索（雪球式找论文） | §10 Step 8 验收 |
| **Search v3** | IEEE Xplore（API key）+ WoS（可选、机构授权）+ Google Scholar 仅外部跳转/导入 | 覆盖专业数据库；不默认依赖付费源 | 按需触发 |

**明确不在第一版做的事**：接 Web of Science。当前瓶颈不是「少了 WoS 的数据库」，而是「无论给你哪个数据库，都只是拿原 query 搜 6 条丢给 LLM」——WoS 接上也会被这套逻辑浪费（§6 详述定位）。

---

## 4. Search v1 详细设计

### 4.1 数据模型

新文件 src/lib/search/types.ts（核心 schema；PaperHitV2 是给 LLM/工具的返回形态，必须兼容现有 download_paper）：

    /** 检索意图：Query Planner 的输出（用户不需要学习检索语法） */
    interface SearchIntent {
      goal: "explore" | "recent" | "foundational" | "survey" | "reproducible" | "follow_paper";
      concepts: string[];        // 核心概念，如 ["world model"]
      context: string[];         // 语境约束，如 ["LLM agent", "robotics", "embodied AI"]
      exclude: string[];         // 明确排除，如 ["mental health", "world development report"]
      preferredTypes?: string[]; // 如 ["review", "conference-paper", "journal-article"]
      yearRange?: [number, number];
      seedPaper?: { provider: string; id: string; title?: string }; // v2 的「从这篇论文继续找」
    }

    /** 单条检索请求（planner 产出，provider 消费） */
    interface ProviderQuery {
      providerId: string;
      mode: "keyword" | "phrase" | "boolean" | "semantic" | "title";
      raw: string;               // 该 provider 的具体查询串
      intent: SearchIntent;
      limit: number;             // 该路取多少（25–50）
    }

    /** provider 原始返回，未归一化 */
    interface ProviderPaper {
      providerId: string;        // "openalex" | "semantic-scholar" | "arxiv" | "crossref"
      externalId: string;        // 源内 id
      doi?: string; arxivId?: string;
      title: string; authors: string[];
      year?: number; venue?: string; type?: string;
      abstract?: string;
      citationCount?: number;    // 分源，不合并
      relevanceScore?: number;   // provider 自带（OpenAlex 实测有）
      isOa?: boolean; oaPdfUrl?: string; publisherUrl?: string;
      topics?: string[];
      raw?: unknown;             // 诊断用，不发给 LLM
    }

    /** 去重后的规范形态 */
    interface CanonicalPaper {
      canonicalId: string;       // doi 规范化 > arxivId > normalizedTitle
      doi?: string; arxivId?: string;
      title: string; authors: string[];
      year?: number; type?: string; venue?: string; abstract?: string;
      sources: string[];         // ["openalex", "semantic-scholar", ...]
      metrics: Record<string, number>;  // { openalex: 382, semanticScholar: 351 } —— 分源
      links?: { isOa: boolean; oaPdfUrl?: string; publisherUrl?: string };
      topics?: string[];
      hits: ProviderPaper[];     // 证据保留
    }

    /** 工具返回给 LLM 的形态（名字与现有 prompt 使用的 oa_pdf_url / publisher_url 保持一致） */
    interface PaperHitV2 {
      id: string;
      arxivId?: string;
      title: string;
      authors: string;           // 展示用（前 4 位）
      year: string;
      abstract: string;
      doi?: string;
      isOa: boolean;
      oaPdfUrl?: string;         // 兼容 download_paper
      publisherUrl: string;      // 兼容
      publisherName: string;
      type?: string;             // 新增：article/review/preprint/...
      venue?: string;            // 新增
      citationCount?: number;    // 新增（标注来源，见 sourceProvider）
      relevanceScore?: number;   // 新增
      topics?: string[];         // 新增
      sourceProvider: string;    // 新增：主来源
      sources?: string[];        // 新增：全部命中来源
    }

### 4.2 Query Planner（新文件 src/lib/search/planner.ts）

- **职责**：把用户一句话（或 P0 澄清后的目标+子问题）编译成 SearchIntent + ≥4 条 ProviderQuery。只产出查询，**不产出论文**，不自己编来源。
- **实现**：一次 deepseek-chat 调用（低温、JSON 输出），复用 chat/route.ts 的 API key / 120s 超时 / 重试模式（抽共享小函数或按需复制，plan 阶段不引入抽象负担）。
- **"world model" 案例**（用户走查案例，写入验收）:

    Q1 exact  : "world model" AND (agent OR robotics OR embodied)
    Q2 boolean: ("world model" OR "world models") AND (model-based RL OR predictive model)   [filter=... + search=]
    Q3 semantic: learned internal predictive models for autonomous agents, robotics,
                 or model-based reinforcement learning      [search.semantic=，已实测可用]
    Q4 survey : "world model" AND (survey OR review)
    排除       : mental health / world development report 由 exclude 过滤兜底
    时间窗     : 默认近 5 年（explore 模式）

### 4.3 OpenAlex Provider（新文件 src/lib/search/providers/openalex.ts）

把 searchPapers() 的重试/mailto/UA/超时保留，查询方式与字段升级：

    mode keyword / phrase → search=<编码串>（支持引号精确短语、AND/OR/NOT）
    mode boolean         → search= + filter=display_name.search:<词>,from_publication_date:<年>-01-01
                           排除用 OpenAlex filter 的 ! 前缀（如 filter=!title.search:mental health）
    mode semantic        → search.semantic=<自然语言句>
    select               → id,doi,display_name,publication_year,type,primary_location,authorships,
                           abstract_inverted_index,open_access,cited_by_count,relevance_score,topics,ids
    分页                 → per-page=50，page 1..2（每 query 25–50 条）

**已实测（2026-08-27）**：search= 返回 relevance_score（如 2513.02）、cited_by_count、type、ids；search.semantic= 可用（49 条结果，相关性合理）；filter=display_name.search:world model,from_publication_date:2020-01-01 可用（12k 条）。当前代码的 select 只取 6 个字段，这些能力**一个都没用上**。

### 4.4 Normalize + Dedupe（src/lib/search/dedupe.ts）

- canonicalId 优先级：**DOI（规范化：去 https://doi.org/ 前缀）> arxivId > normalizedTitle**（小写、去标点/空白、去版本后缀）。
- 合并：sources 累加、metrics 分源记录、hits 保留全部证据。
- **不同数据库的引用数绝不合并成一个「唯一正确数字」**（覆盖范围不同）；展示为 OpenAlex 382 · S2 351 或默认显示一个并标来源。

### 4.5 Hard Filters（src/lib/search/filters.ts）

    exclude 命中（标题/摘要含词）  → 剔除
    yearRange 外                  → 剔除
    preferredTypes 不匹配          → 降级（不剔除；survey 模式下 review 优先）
    abstract 缺失                 → 标「无摘要」，不剔除（可能仍值得读）
    预算                          → 50–100 → 30–50

### 4.6 Semantic Reranker（src/lib/search/rerank.ts）

v1 **不引入外部 embedding 依赖**，两层方案：

    方案 A（默认，零成本）：OpenAlex relevance_score（已按相关性+引用排序）为基底
      + 时间衰减（越新加权，explore/recent 模式）
      + type 加分（review 在 survey 模式、journal-article 在 explore 模式）
      → top 15–25
    方案 B（可选 LLM 批排）：把 30–50 篇标题+摘要分 2–3 批，每批 2k token 预算，
      让 LLM 打 0–3 相关性分，再取 top。成本可控（40 篇 × ~200 词 ≈ 8k token）。

不采用「统一论文质量分」（见 §7）。

### 4.7 工具与提示词改动（v1 一起提交）

src/app/api/chat/route.ts：

    search_papers 参数升级：
      query（保留，必填）
      goal / concepts / context / exclude / year_from / year_to（可选；不填则由 planner 从 query 推断）
      seed_paper（v2 预留）
    executeTool("search_papers") → runSearchPipeline(query, intent?)
      内部：planner → providers → dedupe → filters → rerank
      返回：{ report, hits: PaperHitV2[] }
    report = {
      intent: SearchIntent,                    // 让用户看到系统理解了什么
      queries: [{ mode, provider, raw, hits }] // 每路召回数
      candidateCount / afterDedupe / afterFilter / afterRerank,
      warnings: string[]                       // 如「Semantic Scholar 限流，已降级」
    }

src/lib/data.ts P0 prompt 同步（步骤 2 重写）：

    旧：调用 search_papers 工具联网检索 5–10 篇候选论文
    新：调用 search_papers（会先编译检索策略，再多路检索并去重/重排）拿到 15–25 篇候选，
        从中逐篇筛选；候选必须携带可点链接（oa_pdf_url / publisher_url / arXiv 链接），
        引用量/类型/venue 来自检索结果，缺失则标「未知」——禁止凭印象填写。

MAX_TOOL_ROUNDS = 3 保持（管线在单次工具调用内完成；planner 是服务端内部调用，不占对话轮次）。

### 4.8 UI（v1 最小改动）

- 筛选页仍用 ChatPanel（page.tsx「论文筛选」视图，toolKey="p0"）；候选仍以 markdown 列表呈现，每条带可点链接（现有纪律）。
- report 以 markdown 呈现「正在理解检索目标 → 系统扩展了 N 个方向 → 各源召回数 → 合并去重 → 主题初筛」，让用户看到检索发生了什么（**截图问题的直接回应**）。
- 不做新组件、不动布局；download_paper 交互不变。

---

## 5. Search v2 详细设计

### 5.1 Provider 接口（src/lib/search/providers/types.ts）

    interface ScholarlyProvider {
      id: "openalex" | "semantic-scholar" | "crossref" | "arxiv" | "ieee" | "web-of-science";
      capabilities: {
        keywordSearch: boolean; semanticSearch: boolean; citations: boolean;
        references: boolean; openAccess: boolean; recommendations: boolean;
      };
      search(q: ProviderQuery): Promise<ProviderPaper[]>;
    }

目录结构（**禁止**以后在 paper-tools.ts 里 if (source === ...) 堆砌）：

    src/lib/search/
      types.ts          // SearchIntent / ProviderQuery / ProviderPaper / CanonicalPaper / PaperHitV2
      planner.ts        // Query Planner
      pipeline.ts       // runSearchPipeline 编排
      dedupe.ts         // canonicalId + 合并
      filters.ts        // 硬过滤
      rerank.ts         // 重排
      providers/
        types.ts        // ScholarlyProvider
        openalex.ts
        semantic-scholar.ts
        crossref.ts
        arxiv.ts
        ieee.ts         // v3
        web-of-science.ts  // v3

### 5.2 Semantic Scholar（v2 第一优先级）

- 搜索：GET https://api.semanticscholar.org/graph/v1/paper/search?query=...&limit=50&fields=title,abstract,year,venue,externalIds,citationCount,publicationTypes,authors
- **已实测：无 key 会 429**（2026-08-27 实测 Too Many Requests）。因此必须：
  - 限速 + 退避（请求间隔 ≥500ms，429 时指数退避）；
  - 可选 S2_API_KEY（.env.local，提示配 key 提高额度）；
  - **失败降级**：该 provider 缺失不算整体失败，进 report.warnings。
- Recommendations API（/graph/v1/paper/{paperId}/recommendations）：seed-paper 扩展（§5.6）。
- 引用数入 metrics.semanticScholar，不合并。

### 5.3 Crossref 校验器（不是主搜索引擎）

- 职责：按 DOI 核对**正式标题/作者/出版日期/journal/publisher/type**；用于「arXiv 版 vs 会议版 vs 期刊版」的版本归一，避免同一工作被当三篇。
- 接口：GET https://api.crossref.org/works/{doi}?select=DOI,title,author,container-title,published,type,publisher（已实测 select 可用，2026-08-27）。
- 输出：CanonicalPaper.crossrefCheck = { status: "match"|"mismatch"|"missing"; fields }；mismatch 进 report 供筛选时参考。

### 5.4 arXiv Provider

- https://export.arxiv.org/api/query?search_query=...（**https**；Atom 响应，用轻量 XML 解析，不引新依赖）。
- 预印本源：标 type="preprint"，不冒充正式出版；arxivId 直接复用现有 download_paper 的 arxiv 下载路径。

### 5.5 Dedupe 升级

多源同篇 → 一张卡片显示 sources 徽标（openalex · s2 · arxiv）与分源引用数；版本链由 §5.3 辅助识别。

### 5.6 Seed Paper → Citation Graph（新搜索入口，v2 重点）

科研找论文真正有效的方式常常是 **Seed Paper → Citation Graph → Snowballing**，而不是无限换关键词。新增：

    入口：「论文库」卡片 / 筛选候选卡片 上出现「从这篇论文继续找」
    输入：seed paper（provider + id）
    扩展：
      references      → S2 /paper/{id}/references 或 OpenAlex referenced_works
      citations       → S2 /paper/{id}/citations 或 OpenAlex cited_by_api_url
      related/recommended → S2 /paper/{id}/recommendations
    聚类展示：奠基工作 / 直接后续 / 相似路线 / 最新进展 —— 各走不同排序（§7）

价值定位：**比「多接两个关键词搜索网站」高**；用户不再需要重新输入关键词。

---

## 6. Search v3（可选 Provider，不在 v1/v2 前做）

| 数据源 | 定位 | 接入方式 |
|---|---|---|
| **OpenAlex** | 主源 | 保留（v1 已彻底升级查询方式） |
| **Semantic Scholar** | 主源 | v2 第一优先级 |
| **Crossref** | 校验器 | v2 |
| **arXiv** | 预印本源 | v2 |
| **IEEE Xplore** | 工科专业源 | v3，Metadata Search API，需注册 API key；工科价值高于 WoS，优先于 WoS 实现 |
| **Web of Science** | 可选机构源 | v3，官方 Expanded/Starter API 需要付费 license / 机构授权（权限随学校合同），**做成可选 Provider，不默认依赖** |
| **Google Scholar** | **外部入口，不做后台 Provider** | 产品内「在 Google Scholar 中继续搜索 ↗」外链 + 导入 BibTeX / EndNote / DOI。官方不支持批量检索；自动抓取 HTML → 验证码 / IP block，维护成本不可接受 |

数据源面板（可选展示）：

    数据源        ✓ OpenAlex   ✓ Semantic Scholar   ✓ Crossref   ✓ arXiv
    可选机构源    ○ IEEE Xplore [API Key]   ○ Web of Science [机构授权]

---

## 7. RankingProfile：按目的排序，不做统一「论文质量分」

不采用 Score = 0.4*relevance + 0.2*citation + 0.2*venue + ...：最新进展场景里，一篇刚发 2 个月、只有 3 引的论文完全可能比 2019 年 3000 引的更有用；可复现场景里代码/数据完整性比引用数重要得多。

    探索领域     explore       → relevance + citation + 领域覆盖
    最新进展     recent        → relevance + recency（时间衰减权重最高）
    奠基论文     foundational  → citation + 引用图中心性（v2 起用 citation graph）
    找综述       survey        → type(review) + 覆盖度 + citation
    找可复现     reproducible  → relevance + code/data 信号（v3：GitHub 链接检测 + 关键词）
    从论文继续   follow_paper  → 图距离 + 模式匹配（v2 §5.6）

v1 只落地 explore 与 recent；其余模式随 v2/v3 的 citation graph 与 code 信号一起启用。

---

## 8. 成本与超时预算

    Query Planner    1 次 LLM 调用（~1k token in / ~600 out）
    候选池 50–100    标题+摘要 ≈ 15–25k token —— 但只有 rerank 后的 15–25 篇（4–8k）发给 LLM
    LLM 批排（可选） 2–3 批 × 2k 预算
    S2 限流          ≥500ms 间隔；429 → 退避 + 降级 warnings
    单次工具执行     预算 < 60s；provider 超时各自独立，超时降级不阻塞整体

（与当前「6 篇反复重试 + 多轮 tool call」相比，总 token 不必然更贵，且召回质量显著提升。）

---

## 9. 与复现模块的对称关系（本方案不重复实现）

    论文检索：Human question → Search Plan → Providers → Candidate Set → Screened Papers
    复现模块：Paper → Reproduction Spec → Codex Tasks

    共同风格：先把模糊的人类目标「编译」成结构化任务，再调用外部工具 —— Research Atelier 的主线。
    本方案只实现检索侧；复现侧由 REPRO_SPEC_IMPLEMENTATION.md 负责，两者不交叉。

---

## 10. 开发顺序（每步有独立验收；确认后从 Step 1 开始）

| Step | 内容 | 验收 |
|---|---|---|
| **1** | src/lib/search/types.ts + PaperHitV2；chat/route.ts 工具接线（先不换行为） | 现有筛选对话无回归；download_paper 字段兼容；全量测试通过 |
| **2** | Query Planner + OpenAlex Provider 升级 + report 输出 | 「world model」走查：report 显示 4 路 query、候选 50+、排除词生效；relevance_score/cited_by_count/type 在返回中 |
| **3** | Hard Filters + Rerank + P0 prompt 同步 | 「world model」最终 15–25 篇中无 mental-health 类噪声；D5/D6 数据来自检索结果；**自定义 prompt 用户重置提示** |
| **4** | v1 验收（§12 全项） | 验收总则 6 条全过，截图问题复现对比：旧链路 vs 新链路同一 query |
| **5** | ScholarlyProvider 接口 + S2（限流/降级）+ arXiv | S2 无 key 时 429 被降级进 warnings 不阻塞；arXiv 预印本可下载 |
| **6** | Crossref 校验器 + dedupe 升级 + 分源引用展示 | 同一工作多源命中只显示一次；引用数分源标注；arXiv/会议/期刊版本归一 |
| **7** | Seed Paper → Citation Graph + 五种搜索入口 | 从一篇 seed 可得到 奠基/后续/相似/最新 四组；「从这篇论文继续找」入口可用 |
| **8** | v2 验收（§12 全项） | 雪球式找论文闭环；各 provider 独立降级 |
| **9** | IEEE（key）+ WoS（机构）+ Scholar 外链/导入 | 按需触发，不在默认链路 |

---

## 11. 明确不做（防止膨胀成「大聊天框 + 更多 API」）

    1. 不做 Google Scholar 后台爬取（验证码/IP block，官方不支持批量）
    2. 不做统一「论文质量分」
    3. 不在 paper-tools.ts 里 if(source===...) 堆 provider（必须走 ScholarlyProvider 接口）
    4. 不引入外部 embedding 服务/向量库（v1 用 OpenAlex relevance + 规则；当前规模不需要本地索引）
    5. 不把 100 篇全部塞给 LLM 深筛（分层截断，见 §2 预算）
    6. 不改复现模块 / 术语卡 / 精读讲解 / 论文库导入
    7. 第一版不接 WoS（§3/§6）
    8. 不做多轮「关键词重写」循环（planner 一次编译，用户可改 report 后重跑，不自动迭代）

---

## 12. 验收总则

1. **「world model」案例**：不再混入 World Mental Health Survey 类噪声，或明确被 exclude 并说明；候选池 50+，最终 15–25 篇全部与 agent/robotics 语境相关。
2. **可溯源**：每条候选带来源 provider、命中 query、可点链接；引用量标注来源（分源），缺失标「未知」。
3. **去重**：同一篇论文多源命中只展示一次（sources 徽标）；arXiv/会议/期刊版本不重复。
4. **用户无需学习检索语法**：自然语言进，结构化候选出；planner 输出（intent + queries）可见、可修改后重跑。
5. **零回归**：download_paper 字段兼容、会话历史、提示词可编辑、论文库/精读不受影响；全量 regression 通过（现有测试 + 新增 planner/dedupe/filter/rerank 单测）。
6. **成本可控**：单次筛选工具执行 < 60s，LLM 深筛 token 与现状相当或更低。

---

## 13. 修订记录

    v0.1（2026-08-27）初稿：
    - 现状逐条核对真实代码（paper-tools.ts:25,57；chat/route.ts:20-53,150；data.ts:13-59；page.tsx 筛选视图）
    - API 能力实测：OpenAlex search.semantic / relevance_score / filter=...search 可用；
      Semantic Scholar 无 key 429；Crossref select= 可用
    - 采纳用户走查结论：问题在 retrieval/recall 阶段而非 LLM 判断；PaperHit 信息赤字；
      Query Planner 先行；分阶段召回；引用数分源；不做统一质量分；Scholar 不做后台 Provider；
      v1/v2/v3 三阶段而非一次接十个平台
    - 对齐复现模块风格：REPRO_SPEC_IMPLEMENTATION.md 的「现状盘点 → 核心 schema → 开发顺序 → 明确不做 → 验收」结构

