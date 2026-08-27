# Research Atelier → 论文检索管线（Paper Search Pipeline）实现方案

> 状态：**方案 v0.2 —— 待确认，未开始实现**。用户确认后按 §10 开发顺序进入 Step 1。
> 本方案只动「论文筛选（P0）」的检索侧；复现模块（REPRO_SPEC_IMPLEMENTATION.md，已确认）与精读/术语卡/论文库保持不动。
> v0.1 → v0.2：**用户硬约束修订**（2026-08-27）——Web of Science 与 Google Scholar 必须是一等检索来源，
> 不得放在 v3 或只做外链；总体管线不推翻，Provider 层与开发顺序重排。修订记录见 §13。

---

## 0. 产品核心（一句话定调）

> Research Atelier 的论文筛选，不是「多接几个数据库」，而是把现在 **search_papers 一次搜 6 条、原样丢给 LLM 挑** 的链路，改成一条**检索管线**：LLM 把模糊研究意图**编译成检索策略** → 多数据源（含 **Web of Science 与 Google Scholar 两个一等来源**）建立**高召回候选池**（50–150）→ **规则硬过滤**（30–50）→ **语义重排**（15–25）→ **证据富化** → LLM 科研筛选（最终 5–10）。

**用户硬约束（2026-08-27 确认，全方案的最高优先级）：**

```text
1. Web of Science：一等检索来源。官方 Starter/Expanded API 优先；
   无 API entitlement 时走「WoS 网页导出 → 导入管线」fallback。
   绝不静默用 OpenAlex 顶替 WoS，然后界面还显示「WoS」。
2. Google Scholar：一等检索来源。不直接爬 scholar.google.com（官方禁止批量抓取，
   会验证码/IP 限制/HTML 改版）；首选第三方 SerpApi 的 Google Scholar API，
   无 Key 时保留「Scholar 引用导入 + 外部检索入口」fallback。
3. 每个来源的 provenance 必须可分：sourceProvider（这条记录来自哪个学术索引）
   与 accessProvider（通过什么渠道拿到的：official-api / serpapi / user-import）分离。
4. 引用量分源展示、绝不合并（GS 1250 / WoS 730 / OpenAlex 980 / S2 901 各自成立）。
```

核心转变：

```text
现在（问题所在）：
query → OpenAlex search=query → 前 6 篇 → LLM 从错误的 6 篇里挑好的

目标（本方案）：
用户研究问题 → Query Planner → Providers（WoS · Google Scholar · OpenAlex · S2 · arXiv · Crossref 校验）
  → Candidate Pool 50–150 → Normalize + Dedupe → Hard Filters 30–50
  → Semantic Rerank 15–25 → Evidence Enrichment → LLM Screening → 5–10
```

**LLM 不再负责「从错误的 6 篇里面挑好的」，而负责「从已经高召回、高相关的候选池里做科研判断」。**

两条贯穿性原则（与复现模块同一风格）：

```text
1. 模糊的人类目标先被「编译」成结构化任务，再调用外部工具，而不是直接让 AI 凭感觉回答；
2. 检索过程的每个阶段可追溯：每条候选携带 sourceProvider + accessProvider + 命中 query +
   分源引用量，不允许出现「无法核实是从哪来的」论文。
```

---

## 1. 现状盘点（已核对真实代码）

| 模块 | 现状（真实代码位置） | 判断 |
|---|---|---|
| searchPapers() | src/lib/paper-tools.ts:57 — 原始字符串直接 works?search=<query>&per-page=≤10；select 不含 relevance_score / cited_by_count / type / topics；已有 3 次指数退避重试 + 25s 超时 | **重写为 Provider + 管线**；重试/超时/mailto/User-Agent 保留 |
| PaperHit | paper-tools.ts:25 — 只有 id/arxivId/title/authors/year/abstract/doi/isOa/oaPdfUrl/publisherUrl/publisherName | **升级为 PaperHitV2**（§4.1）：补 type/venue/citationCount/relevanceScore/topics/sourceProvider/accessProvider/分源引用 |
| P0 Prompt 的信息赤字 | src/lib/data.ts:32-33 — 要求 D5 可复现性、D6 引用量「可核实」，但 PaperHit 不提供引用量/类型/venue | **prompt 与数据层同步改**（§4.7），否则 D6 永远是「未知」 |
| 工具定义 | src/app/api/chat/route.ts:20-53 — search_papers(query) 单参数；download_paper(pdf_url/arxiv_id/title) | search_papers 升级多参数 + 管线执行；download_paper **字段名保持兼容** |
| 工具循环 | chat/route.ts:150 — MAX_TOOL_ROUNDS = 3 | 保持；管线在单次工具调用内完成，不额外占轮次 |
| P0 筛选入口 | src/app/page.tsx「论文筛选」视图 — ChatPanel toolKey="p0" enableToolcall，system prompt 来自 data.ts TOOLS.p0 | 保留；候选呈现方式升级（§4.8/§5.7），不推翻现有交互 |
| 提示词可编辑 | src/components/chat-panel.tsx — /api/prompts 可自定义/重置 | 保留；prompt 升级后自定义版本需重置（§10 Step 3 验收注明） |
| 论文库/精读/下载导入 | /api/paper + paper-tools.ts downloadPaper | **不动**（download 依赖的字段名不破坏） |
| 复现模块 | REPRO_SPEC_IMPLEMENTATION.md（已确认，Step 1/2 已合入） | 不动，本方案与之并行 |
| 外部来源配置 | 目前不存在；DEEPSEEK_API_KEY 走 .env.local 先例（chat/route.ts:139） | **新增数据源配置页 + 服务端 /api/sources**（§5.7）；key 只存 .env.local / 服务端，不进 JSON、不发 LLM |

---

## 2. 目标架构：Search Pipeline

```text
用户真实研究问题
        │
        ▼
  Query Planner（LLM 编译：goal/concepts/context/exclude/type/yearRange → ≥4 条 query）
        │
        ▼
  Providers（并行，一等 + 公共来源）：
     Web of Science（Starter/Expanded API ｜ 导出导入 fallback）
     Google Scholar（SerpApi ｜ 引用导入 fallback）
     OpenAlex · Semantic Scholar · arXiv
     Crossref（仅元数据校验）
        │
        ▼
  Candidate Pool  50–150 篇（每篇带 sourceProvider + accessProvider + 命中 query + 分源引用）
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
```

**数字预算（为什么不是 100 篇全进 DeepSeek）：**

```text
Recruit 50–100（规则层面，token 便宜）→ 硬过滤 30–50 → 语义重排 15–25（标题+摘要 ≈ 4–8k token）
→ LLM 深筛 5–10（2 轮内完成，总成本与现在「6 篇反复试」相当或更低）
```

检索系统最大的忌讳之一是 **在 recall 很低的时候提前截断**；本方案在第一层就拉高召回，把截断放到有依据的过滤器/重排器。

---

## 3. 三阶段路线（v0.2 按用户硬约束重排）

| 阶段 | 做什么 | 价值 | 完成标志 |
|---|---|---|---|
| **Search v1** | 检索管线「发动机」：Query Planner + OpenAlex + Normalize/Dedupe + Hard Filter + Rerank + PaperHitV2 + Prompt 对齐 | 立刻解决截图问题（"world model" 不再混入 mental-health 调查）；为所有 Provider 打好公共管线 | §10 Step 4 验收 |
| **Search v2** | **满足真实来源要求**：Google Scholar Provider（SerpApi + 导入 fallback）、Web of Science Provider（API + 导入 fallback）、Semantic Scholar、Crossref、arXiv → 真正 Multi-source Candidate Pool + 数据源配置页 | WoS 与 Scholar 成为**真的一等检索来源**，不再是外链摆设 | §10 Step 9 验收 |
| **Search v3** | Citation Graph / seed-paper snowballing / IEEE Xplore / 更高级 RankingProfile / 长期检索 alerts | 从「多源检索」升级为「科研发现」；按需触发 | 按需 |

**为什么 Citation Graph 后移（v3）**：不是不重要，而是硬需求已明确——「WoS 和 Scholar 要真正成为搜索来源」。先满足真实使用需求，再叠科研发现能力。v0.1 中 v3 的「Scholar 外部跳转」删除：Scholar 的接入路径（SerpApi/导入）已整体并入 v2。

---

## 4. Search v1 详细设计（发动机）

### 4.1 数据模型

新文件 src/lib/search/types.ts（核心 schema；PaperHitV2 是给 LLM/工具的返回形态，必须兼容现有 download_paper）：

```ts
/** 检索意图：Query Planner 的输出（用户不需要学习检索语法） */
interface SearchIntent {
  goal: "explore" | "recent" | "foundational" | "survey" | "reproducible" | "follow_paper";
  concepts: string[];        // 核心概念，如 ["world model"]
  context: string[];         // 语境约束，如 ["LLM agent", "robotics", "embodied AI"]
  exclude: string[];         // 明确排除，如 ["mental health", "world development report"]
  preferredTypes?: string[]; // 如 ["review", "conference-paper", "journal-article"]
  yearRange?: [number, number];
  seedPaper?: { provider: string; id: string; title?: string }; // v3 的「从这篇论文继续找」
}

/** 单条检索请求（planner 产出，provider 消费） */
interface ProviderQuery {
  providerId: string;        // openalex | semantic-scholar | google-scholar | web-of-science | arxiv | crossref
  mode: "keyword" | "phrase" | "boolean" | "semantic" | "title";
  raw: string;               // 该 provider 的具体查询串
  intent: SearchIntent;
  limit: number;             // 该路取多少（25–50）
}

/** provider 原始返回，未归一化。sourceProvider 与 accessProvider 分离（v0.2 硬约束） */
interface ProviderPaper {
  sourceProvider:
    | "openalex" | "semantic-scholar" | "google-scholar" | "web-of-science"
    | "arxiv" | "crossref";  // 这条记录来自哪个学术索引（对科研用户真正重要）
  accessProvider?:           // 通过什么渠道拿到：official-api / serpapi / user-import
    | "official-api" | "serpapi" | "user-import";
  externalId: string;        // 源内 id（WoS 的 UT / Scholar 的 cluster / OpenAlex 的 W...）
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
  sources: string[];         // ["google-scholar", "web-of-science", "openalex", "semantic-scholar"]
  metrics: {                 // 引用量分源记录，绝不合并
    citations: {
      googleScholar?: number; webOfScience?: number;
      openAlex?: number; semanticScholar?: number;
    };
  };
  links?: { isOa: boolean; oaPdfUrl?: string; publisherUrl?: string };
  topics?: string[];
  hits: ProviderPaper[];     // 证据保留（含各自 accessProvider）
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
  sourceProvider: string;    // 主来源（openalex / google-scholar / web-of-science / ...）
  accessProvider?: string;   // 主来源的访问渠道（official-api / serpapi / user-import）
  sources?: string[];        // 全部命中来源徽标
  relevanceScore?: number;   // 新增
  topics?: string[];         // 新增
  citations?: {              // 分源引用（v0.2 硬约束：不合并）
    source: string; count: number; access: string;
  }[];
}
```

### 4.2 Query Planner（新文件 src/lib/search/planner.ts）

- **职责**：把用户一句话（或 P0 澄清后的目标+子问题）编译成 SearchIntent + ≥4 条 ProviderQuery。只产出查询，**不产出论文**，不自己编来源。
- **实现**：一次 deepseek-chat 调用（低温、JSON 输出），复用 chat/route.ts 的 API key / 120s 超时 / 重试模式（抽共享小函数或按需复制，plan 阶段不引入抽象负担）。
- **"world model" 案例**（用户走查案例，写入验收）:

```text
Q1 exact  : "world model" AND (agent OR robotics OR embodied)
Q2 boolean: ("world model" OR "world models") AND (model-based RL OR predictive model)
Q3 semantic: learned internal predictive models for autonomous agents, robotics,
             or model-based reinforcement learning      [search.semantic=，已实测可用]
Q4 survey : "world model" AND (survey OR review)
排除       : mental health / world development report 由 exclude 过滤兜底
时间窗     : 默认近 5 年（explore 模式）
```

### 4.3 OpenAlex Provider（新文件 src/lib/search/providers/openalex.ts）

把 searchPapers() 的重试/mailto/UA/超时保留，查询方式与字段升级：

```text
mode keyword / phrase → search=<编码串>（支持引号精确短语、AND/OR/NOT）
mode boolean         → search= + filter=display_name.search:<词>,from_publication_date:<年>-01-01
                       排除用 OpenAlex filter 的 ! 前缀（如 filter=!title.search:mental health）
mode semantic        → search.semantic=<自然语言句>
select               → id,doi,display_name,publication_year,type,primary_location,authorships,
                       abstract_inverted_index,open_access,cited_by_count,relevance_score,topics,ids
分页                 → per-page=50，page 1..2（每 query 25–50 条）
```

**已实测（2026-08-27）**：search= 返回 relevance_score（如 2513.02）、cited_by_count、type、ids；search.semantic= 可用（49 条结果，相关性合理）；filter=display_name.search:world model,from_publication_date:2020-01-01 可用（12k 条）。当前代码的 select 只取 6 个字段，这些能力**一个都没用上**。

### 4.4 Normalize + Dedupe（src/lib/search/dedupe.ts）

- canonicalId 优先级：**DOI（规范化：去 https://doi.org/ 前缀）> arxivId > normalizedTitle**（小写、去标点/空白、去版本后缀）。
- 合并：sources 累加、metrics.citations 分源记录、hits 保留全部证据（含 accessProvider）。
- **不同数据库的引用数绝不合并成一个「唯一正确数字」**（覆盖范围不同）；展示为 Google Scholar 1,250 · WoS 730 · OpenAlex 980 · S2 901，或默认显示一两个并展开「其他来源」。

### 4.5 Hard Filters（src/lib/search/filters.ts）

```text
exclude 命中（标题/摘要含词）  → 剔除
yearRange 外                  → 剔除
preferredTypes 不匹配          → 降级（不剔除；survey 模式下 review 优先）
abstract 缺失                 → 标「无摘要」，不剔除（可能仍值得读）
预算                          → 50–100 → 30–50
```

### 4.6 Semantic Reranker（src/lib/search/rerank.ts）

v1 **不引入外部 embedding 依赖**，两层方案：

```text
方案 A（默认，零成本）：OpenAlex relevance_score（已按相关性+引用排序）为基底
  + 时间衰减（越新加权，explore/recent 模式）
  + type 加分（review 在 survey 模式、journal-article 在 explore 模式）
  → top 15–25
方案 B（可选 LLM 批排）：把 30–50 篇标题+摘要分 2–3 批，每批 2k token 预算，
  让 LLM 打 0–3 相关性分，再取 top。成本可控（40 篇 × ~200 词 ≈ 8k token）。
```

不采用「统一论文质量分」（见 §7）。

### 4.7 工具与提示词改动（v1 一起提交）

src/app/api/chat/route.ts：

```text
search_papers 参数升级：
  query（保留，必填）
  goal / concepts / context / exclude / year_from / year_to（可选；不填则由 planner 从 query 推断）
  seed_paper（v3 预留）
executeTool("search_papers") → runSearchPipeline(query, intent?)
  内部：planner → providers → dedupe → filters → rerank
  返回：{ report, hits: PaperHitV2[] }
report = {
  intent: SearchIntent,                    // 让用户看到系统理解了什么
  queries: [{ mode, provider, access, raw, hits }] // 每路召回数（含 accessProvider）
  candidateCount / afterDedupe / afterFilter / afterRerank,
  sources: [{ source, access, status, hits }],   // 各来源状态与命中数（v0.2 硬约束可见）
  warnings: string[]                       // 如「Google Scholar 未配置 SerpApi，已用导入 fallback」
}
```

src/lib/data.ts P0 prompt 同步（步骤 2 重写）：

```text
旧：调用 search_papers 工具联网检索 5–10 篇候选论文
新：调用 search_papers（会先编译检索策略，再从 Web of Science / Google Scholar / OpenAlex /
    Semantic Scholar 等多源检索并去重/重排）拿到 15–25 篇候选，从中逐篇筛选；
    候选必须携带可点链接与来源（sourceProvider + 分源引用量），缺失标「未知」——禁止凭印象填写。
```

MAX_TOOL_ROUNDS = 3 保持（管线在单次工具调用内完成；planner 是服务端内部调用，不占对话轮次）。

### 4.8 UI（v1 最小改动）

- 筛选页仍用 ChatPanel（page.tsx「论文筛选」视图，toolKey="p0"）；候选仍以 markdown 列表呈现，每条带可点链接（现有纪律）。
- report 以 markdown 呈现「正在理解检索目标 → 系统扩展了 N 个方向 → 各源召回数（含 WoS/Scholar）→ 合并去重 → 主题初筛」——**截图问题的直接回应，也是 v0.2 的来源可见性要求**。
- v2 起每篇候选卡片显示来源徽标 + 分源引用（§5.7），v1 先由 markdown 承担。

---

## 5. Search v2 详细设计（一等来源接入，v0.2 重排后成为第二优先级）

### 5.1 Provider 接口（src/lib/search/providers/types.ts）

```ts
interface ScholarlyProvider {
  id: "openalex" | "semantic-scholar" | "google-scholar" | "web-of-science" | "arxiv" | "crossref";
  capabilities: {
    keywordSearch: boolean; semanticSearch: boolean; citations: boolean;
    references: boolean; openAccess: boolean; recommendations: boolean;
    importSupport: boolean;   // WoS 导出 / Scholar 引用导入
  };
  search(q: ProviderQuery): Promise<ProviderPaper[]>;
  import?(file: ImportedSourceFile): Promise<ProviderPaper[]>;  // v2 fallback 路径
}
```

目录结构（**禁止**以后在 paper-tools.ts 里 if (source === ...) 堆砌）：

```text
src/lib/search/
  types.ts          // SearchIntent / ProviderQuery / ProviderPaper / CanonicalPaper / PaperHitV2
  planner.ts        // Query Planner
  pipeline.ts       // runSearchPipeline 编排
  dedupe.ts         // canonicalId + 合并（含 accessProvider 证据）
  filters.ts        // 硬过滤
  rerank.ts         // 重排
  importers/        // 文件导入解析（v0.2 新增）
    wos-export.ts   // WoS 网页导出的 tab-delimited / plain text
    bibtex.ts       // BibTeX / EndNote 引用导入（Scholar fallback）
  providers/
    types.ts        // ScholarlyProvider
    google-scholar.ts  // SerpApi + import fallback
    web-of-science.ts  // Starter/Expanded API + import fallback
    openalex.ts
    semantic-scholar.ts
    crossref.ts
    arxiv.ts
    ieee.ts         // v3
```

### 5.2 Google Scholar Provider（一等来源；不直接爬 scholar.google.com）

**接入总则**：Google Scholar 官方明确不支持批量检索、不提供 bulk access，自动大量下载会被阻止（验证码/IP 限制），robots.txt 也禁止自动抓取。因此**绝不**写 fetch("https://scholar.google.com/scholar?q=...") 或 Puppeteer/Playwright 抓页面。两条正式路径：

```text
路径 A（首选）SerpApi Google Scholar API：
  GET https://serpapi.com/search.json?engine=google_scholar&q=<query>&api_key=<key>
  返回 organic_results（title / link / publication_info / snippet / cited_by / versions /
  related_pages / cluster）；支持 cites=<cluster_id> 做 cited-by 查询。
  已验证（2026-08-27）：SerpApi 官网仍维护 google_scholar engine，字段含上述内容；
  按搜索次数计费（有免费额度，具体价格以官网为准）。
  provenance：sourceProvider="google-scholar"，accessProvider="serpapi"。

路径 B（无 Key fallback）：
  用户在 Scholar 页面搜索 → 用 Scholar 自带的「引用 → BibTeX」导出 → 导入管线
  （importers/bibtex.ts，sourceProvider="google-scholar"，accessProvider="user-import"）；
  同时保留「在 Google Scholar 中继续搜索 ↗」外链入口。
  provenance 必须写清楚：这条记录来自 Google Scholar 索引，渠道是用户导入，不是 SerpApi。
```

**绝不允许**：把 sourceProvider 写成 "serpapi"——对科研用户重要的是「来自 Google Scholar 索引」，SerpApi 只是访问渠道。

### 5.3 Web of Science Provider（一等来源；绝不静默替代）

```text
模式 A（API，优先）：
  官方 Starter API（Clarivate Developer Portal 注册 + API Key）：
    检索 WoS Core Collection 元数据 + times-cited；端点以官方 OpenAPI 为准
    （api.clarivate.com/apis/wos-starter/...，官方提供 Python client：
    github.com/clarivate/wosstarter_python_client，2026 仍在维护）。
  官方 Expanded API：完整检索 / 引用 / 参考文献 / 机构 / 基金（权限随机构订阅合同）。
  provenance：sourceProvider="web-of-science"，accessProvider="official-api"。

模式 B（无 API entitlement fallback）：
  用户在学校 WoS 网页检索 → 导出检索结果（tab-delimited / plain text，含
  author/title/source/DOI/times cited）→ importers/wos-export.ts 解析 → 进入同一 Candidate Pool。
  provenance：sourceProvider="web-of-science"，accessProvider="user-import"。
```

**UI 状态必须是显式的三态，不能假装已连接：**

```text
Web of Science
● 已连接 API          → 模式 A

Web of Science
⚠ 当前没有 API 权限   → 模式 B（提供 [配置 API Key] 与 [导入 WoS 检索结果] 两个入口）
```

**绝不允许**：没有 WoS API Key 时悄悄用 OpenAlex 结果顶替并显示「WoS 已检索」。

### 5.4 Semantic Scholar（公共来源）

- 搜索：GET https://api.semanticscholar.org/graph/v1/paper/search?query=...&limit=50&fields=title,abstract,year,venue,externalIds,citationCount,publicationTypes,authors
- **已实测：无 key 会 429**（2026-08-27 实测 Too Many Requests）。因此必须：
  - 限速 + 退避（请求间隔 ≥500ms，429 时指数退避）；
  - 可选 S2_API_KEY（.env.local，提示配 key 提高额度）；
  - **失败降级**：该 provider 缺失不算整体失败，进 report.warnings。
- Recommendations API（/graph/v1/paper/{paperId}/recommendations）：v3 seed-paper 扩展用。

### 5.5 Crossref 校验器（不是主搜索引擎）

- 职责：按 DOI 核对**正式标题/作者/出版日期/journal/publisher/type**；用于「arXiv 版 vs 会议版 vs 期刊版」的版本归一，避免同一工作被当三篇。
- 接口：GET https://api.crossref.org/works/{doi}?select=DOI,title,author,container-title,published,type,publisher（已实测 select 可用，2026-08-27）。
- 输出：CanonicalPaper.crossrefCheck = { status: "match"|"mismatch"|"missing"; fields }；mismatch 进 report 供筛选时参考。

### 5.6 arXiv Provider

- https://export.arxiv.org/api/query?search_query=...（**https**；Atom 响应，用轻量 XML 解析，不引新依赖）。
- 预印本源：标 type="preprint"，不冒充正式出版；arxivId 直接复用现有 download_paper 的 arxiv 下载路径。

### 5.7 数据源配置页 + 来源可见 UI（v0.2 新增，硬约束落地）

**配置页**（新视图或「论文筛选」页内卡片，服务端 /api/sources 提供状态）：

```text
论文数据源

Google Scholar
● 已连接   Access: SerpApi            [配置 API Key] [测试连接]
  或 ⚠ 未配置 → 提示「SerpApi Key 未配置，将使用引用导入 fallback」

Web of Science
● 已连接   Access: Starter API        [测试连接]
  或 ⚠ 未配置 → 提示「机构 WoS 网页权限不一定包含 API 权限」[配置 API Key] [导入 WoS 检索结果]

OpenAlex         ● 可用，无需配置
Semantic Scholar ● 可用（限流降级）    [配置 API Key 提升额度]
```

**Key 安全（硬规则）**：所有 API key 只存 .env.local / 服务端环境变量；/api/sources 只返回「已配置/未配置/最近测试结果」，**绝不把 key 写进普通 JSON 或发给 LLM**。

**检索过程可见性（用户可见即真实）**：

```text
正在检索 4 个学术来源

Google Scholar      ✓ 42
Web of Science      ✓ 31
OpenAlex            ✓ 67
Semantic Scholar    ✓ 48

共召回 188 条记录 → 去重后 103 篇 → 主题筛选后 24 篇
```

**每篇候选卡片**（筛选对话内 markdown 呈现，v2 起）：

```text
DreamerV3: Mastering Diverse Domains through World Models   (2023 · ICML)
来源：Google Scholar · Web of Science · OpenAlex · Semantic Scholar
引用：GS 1,2xx · WoS 8xx   （展开：OpenAlex 980 · S2 901）
[看摘要] [看来源证据] [加入论文库]
```

---

## 6. Search v3（后移，按需触发）

```text
1. Citation Graph / seed-paper snowballing：
   references / citations / related（S2 recommendations、OpenAlex referenced_works/cited_by）
   → 奠基工作 / 直接后续 / 相似路线 / 最新进展 四组，各走不同 RankingProfile（§7）
2. IEEE Xplore Provider（Metadata Search API，注册 API key；工科价值高，但先满足 WoS/Scholar 硬需求）
3. 更高级 RankingProfile（foundational 用引用图中心性、reproducible 用 code/data 信号）
4. 长期检索 / alerts（新论文到达通知）
```

后移理由（同 §3）：硬需求优先；Citation Graph 是增值不是替代。

---

## 7. RankingProfile：按目的排序，不做统一「论文质量分」

不采用 Score = 0.4*relevance + 0.2*citation + 0.2*venue + ...：最新进展场景里，一篇刚发 2 个月、只有 3 引的论文完全可能比 2019 年 3000 引的更有用；可复现场景里代码/数据完整性比引用数重要得多。

```text
探索领域     explore       → relevance + citation + 领域覆盖（v1 落地）
最新进展     recent        → relevance + recency（时间衰减权重最高）（v1 落地）
奠基论文     foundational  → citation + 引用图中心性（v3 起用 citation graph）
找综述       survey        → type(review) + 覆盖度 + citation
找可复现     reproducible  → relevance + code/data 信号（v3：GitHub 链接检测 + 关键词）
从论文继续   follow_paper  → 图距离 + 模式匹配（v3）
```

v2 起，WoS 的 times-cited 与 Scholar 的 cited_by 成为 citation 信号的组成部分（分源，不合并）。

---

## 8. 成本与超时预算

```text
Query Planner    1 次 LLM 调用（~1k token in / ~600 out）
候选池 50–100    标题+摘要 ≈ 15–25k token —— 但只有 rerank 后的 15–25 篇（4–8k）发给 LLM
LLM 批排（可选） 2–3 批 × 2k 预算
S2 限流          ≥500ms 间隔；429 → 退避 + 降级 warnings
SerpApi         付费（按搜索次数计费，有免费额度；价格以官网为准）——仅在配置了 key 时启用，
                未配置自动走导入 fallback，不阻塞管线
WoS API         费用/权限随机构订阅合同；无 entitlement 走导入路径（免费）
单次工具执行     预算 < 60s；provider 超时各自独立，超时降级不阻塞整体
```

（与当前「6 篇反复重试 + 多轮 tool call」相比，总 token 不必然更贵，且召回质量显著提升。）

---

## 9. 与复现模块的对称关系（本方案不重复实现）

```text
论文检索：Human question → Search Plan → Providers → Candidate Set → Screened Papers
复现模块：Paper → Reproduction Spec → Codex Tasks

共同风格：先把模糊的人类目标「编译」成结构化任务，再调用外部工具 —— Research Atelier 的主线。
本方案只实现检索侧；复现侧由 REPRO_SPEC_IMPLEMENTATION.md 负责，两者不交叉。
```

---

## 10. 开发顺序（每步有独立验收；确认后从 Step 1 开始）

| Step | 内容 | 验收 |
|---|---|---|
| **1** | src/lib/search/types.ts + PaperHitV2；chat/route.ts 工具接线（先不换行为） | 现有筛选对话无回归；download_paper 字段兼容；全量测试通过 |
| **2** | Query Planner + OpenAlex Provider 升级 + report 输出 | 「world model」走查：report 显示 4 路 query、候选 50+、排除词生效；relevance_score/cited_by_count/type 在返回中 |
| **3** | Hard Filters + Rerank + P0 prompt 同步 | 「world model」最终 15–25 篇中无 mental-health 类噪声；D5/D6 数据来自检索结果；自定义 prompt 用户重置提示 |
| **4** | v1 验收（§12 全项） | 验收总则全过；截图问题复现对比：旧链路 vs 新链路同一 query |
| **5** | Provider 接口（sourceProvider/accessProvider）+ Google Scholar Provider（SerpApi + BibTeX 导入 fallback） | SerpApi 未配置时走导入 fallback 且 provenance 正确；配置后 organic_results 进入候选池；绝不出现 sourceProvider="serpapi" |
| **6** | WoS Provider（Starter/Expanded API + wos-export 导入 fallback）+ 三态状态 | 无 API key 时 UI 显示 ⚠ 未配置 + 导入入口；导出文件解析后进入同一候选池；无任何静默 OpenAlex 顶替路径 |
| **7** | Semantic Scholar + arXiv | S2 无 key 时 429 被降级进 warnings 不阻塞；arXiv 预印本可下载 |
| **8** | Crossref 校验器 + dedupe 升级 + 分源引用 UI + /api/sources 配置页 | 同一工作多源命中只显示一次；引用分源标注（GS/WoS/OpenAlex/S2）；key 不进 JSON、不发 LLM |
| **9** | v2 验收（§12 全项） | 多源候选池（WoS + Scholar + OpenAlex + S2）命中数在检索过程可见；两条 fallback 路径均走通 |
| **10** | v3：Citation Graph / seed-paper / IEEE / 高级 RankingProfile / alerts | 按需触发，不在默认链路 |

---

## 11. 明确不做（防止膨胀成「大聊天框 + 更多 API」）

```text
1. 不直接爬 scholar.google.com（fetch HTML / Puppeteer / Playwright）——官方禁止批量抓取；
   Scholar 只走 SerpApi 或用户导入
2. 不用 OpenAlex（或任何其他源）静默顶替 WoS 并显示「WoS」；无权限时必须显式三态
3. 不写 sourceProvider="serpapi"（渠道与索引分离；SerpApi 只是访问渠道）
4. 不做统一「论文质量分」（§7）
5. 不在 paper-tools.ts 里 if(source===...) 堆 provider（必须走 ScholarlyProvider 接口）
6. 不引入外部 embedding 服务/向量库（v1 用 OpenAlex relevance + 规则；当前规模不需要本地索引）
7. 不把 100 篇全部塞给 LLM 深筛（分层截断，见 §2 预算）
8. API key 不进普通 JSON、不进 LLM 上下文（只存 .env.local / 服务端，/api/sources 只报状态）
9. 不改复现模块 / 术语卡 / 精读讲解 / 论文库导入
10. 不做多轮「关键词重写」循环（planner 一次编译，用户可改 report 后重跑，不自动迭代）
```

---

## 12. 验收总则

1. **「world model」案例**：不再混入 World Mental Health Survey 类噪声，或明确被 exclude 并说明；候选池 50+，最终 15–25 篇全部与 agent/robotics 语境相关。
2. **一等来源真实接入**：Google Scholar 与 Web of Science 是正式检索来源（SerpApi / WoS API 或对应导入 fallback），命中数在检索过程可见；不是外链摆设。
3. **来源可溯源**：每条候选带 sourceProvider + accessProvider + 命中 query + 可点链接；引用量分源标注（GS/WoS/OpenAlex/S2 各自成立），缺失标「未知」。
4. **不静默替代**：WoS 无 API 权限时 UI 显式 ⚠ 未配置 + 导入入口；任何路径都不存在「无 WoS 却显示 WoS 命中」。
5. **去重**：同一篇论文多源命中只展示一次（sources 徽标）；arXiv/会议/期刊版本不重复。
6. **用户无需学习检索语法**：自然语言进，结构化候选出；planner 输出（intent + queries）可见、可修改后重跑。
7. **Key 安全**：所有 API key 只存 .env.local / 服务端；/api/sources 只返回状态，不发 LLM。
8. **零回归**：download_paper 字段兼容、会话历史、提示词可编辑、论文库/精读不受影响；全量 regression 通过（现有测试 + 新增 planner/dedupe/filter/rerank/importer 单测）。
9. **成本可控**：单次筛选工具执行 < 60s；SerpApi 未配置不阻塞管线；LLM 深筛 token 与现状相当或更低。

---

## 13. 修订记录

```text
v0.1（2026-08-27）初稿：
- 现状逐条核对真实代码（paper-tools.ts:25,57；chat/route.ts:20-53,150；data.ts:13-59；page.tsx 筛选视图）
- API 能力实测：OpenAlex search.semantic / relevance_score / filter=...search 可用；
  Semantic Scholar 无 key 429；Crossref select= 可用
- 采纳用户走查结论：问题在 retrieval/recall 阶段而非 LLM 判断；PaperHit 信息赤字；
  Query Planner 先行；分阶段召回；引用数分源；不做统一质量分；v1/v2/v3 三阶段
- 对齐复现模块风格：REPRO_SPEC_IMPLEMENTATION.md 的「现状盘点 → 核心 schema → 开发顺序 → 明确不做 → 验收」结构

v0.2（2026-08-27）用户硬约束修订：
- 硬约束：Web of Science 与 Google Scholar 升为一等检索来源，移出 v3/外链（§0）
- Google Scholar：不爬 scholar.google.com；首选 SerpApi google_scholar engine（已核实官网仍在维护），
  无 Key 走 BibTeX 引用导入 + 外链 fallback；schema 强制 sourceProvider="google-scholar" 与
  accessProvider="serpapi"|"user-import" 分离（§5.2）
- Web of Science：官方 Starter/Expanded API 优先（Clarivate Developer Portal + 官方 OpenAPI/Python client
  已核实），无 entitlement 走导出文件导入；三态 UI 状态，禁止静默 OpenAlex 顶替（§5.3）
- 数据模型：ProviderPaper 拆分 sourceProvider/accessProvider；metrics.citations 分源（§4.1）
- 阶段重排：v1=公共管线发动机，v2=一等来源接入（Scholar/WoS/S2/Crossref/arXiv），v3=Citation Graph/IEEE/高级 Ranking/alerts（§3/§6）
- 新增：数据源配置页 + /api/sources + Key 安全规则（§5.7）；检索过程各源命中可见（§5.7）
- 验收总则扩充 9 条（§12）；明确不做扩充（§11）

