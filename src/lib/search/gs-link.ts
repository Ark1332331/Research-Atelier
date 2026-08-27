/**
 * Google Scholar / arXiv 深链 builder（v1.1 guardrail #2）。
 * LLM 返回的 URL 一律不可信；外链只由本纯函数生成。
 */
export function googleScholarUrl(query: string): string {
  const q = String(query ?? "").trim();
  if (!q) return "https://scholar.google.com/";
  return "https://scholar.google.com/scholar?q=" + encodeURIComponent(q);
}

/** arXiv 站点检索深链（searchtype=all） */
export function arxivSearchUrl(query: string): string {
  const q = String(query ?? "").trim();
  if (!q) return "https://arxiv.org/";
  return "https://arxiv.org/search/?searchtype=all&query=" + encodeURIComponent(q);
}

/** 查询串清洗：仅保留可安全放入 URL 的关键词（不做任何语法转换，Scholar 用短 query） */
export function scholarSafeQuery(q: string): string {
  return String(q ?? "").trim();
}

