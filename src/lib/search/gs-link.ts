/**
 * 学术数据库链接 builder（v1.1 guardrail #2 + v1.1.2 landingUrl 全覆盖）：
 * - deepLinkUrl：带 query 的直达深链（GS / S2 / arXiv / OpenAlex）
 * - landingUrl：所有数据库必有的可打开入口（WoS = Advanced Search 入口页，复制检索式后进入粘贴）
 * LLM 返回的 URL 一律不可信；所有链接由本纯模块确定性生成。
 */

/** WoS Advanced Search 入口页（官方 URL 不支持 query 参数；复制检索式后进入粘贴） */
export const WOS_LANDING_URL = "https://www.webofscience.com/wos/woscc/advanced-search";

export function googleScholarUrl(query: string): string {
  const q = String(query ?? "").trim();
  if (!q) return "https://scholar.google.com/";
  return "https://scholar.google.com/scholar?q=" + encodeURIComponent(q);
}

export function arxivSearchUrl(query: string): string {
  const q = String(query ?? "").trim();
  if (!q) return "https://arxiv.org/";
  return "https://arxiv.org/search/?searchtype=all&query=" + encodeURIComponent(q);
}

export function semanticScholarUrl(query: string): string {
  const q = String(query ?? "").trim();
  if (!q) return "https://www.semanticscholar.org/";
  return "https://www.semanticscholar.org/search?q=" + encodeURIComponent(q);
}

export function openAlexSearchUrl(query: string): string {
  const q = String(query ?? "").trim();
  if (!q) return "https://openalex.org/";
  return "https://openalex.org/search?q=" + encodeURIComponent(q);
}

/** 每个数据库的可打开入口（必定存在）：有 query 深链的直接给深链，无的给入口页 */
export function landingUrlFor(id: string, query: string): string {
  switch (id) {
    case "google-scholar": return googleScholarUrl(query);
    case "web-of-science": return WOS_LANDING_URL;
    case "semantic-scholar": return semanticScholarUrl(query);
    case "arxiv": return arxivSearchUrl(query);
    case "openalex": return openAlexSearchUrl(query);
    default: return googleScholarUrl(query);
  }
}

/** 是否有带 query 的直达深链（决定 UI 是「复制并打开」还是「复制检索式并打开入口」） */
export function hasDeepLink(id: string): boolean {
  return id !== "web-of-science";
}

/** 查询串清洗：仅保留可安全放入 URL 的关键词（不做任何语法转换，Scholar 用短 query） */
export function scholarSafeQuery(q: string): string {
  return String(q ?? "").trim();
}

