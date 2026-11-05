import { searchPapers, type PaperHit } from "@/lib/paper-tools";

const ARXIV_ID = /^(?:\d{4}\.\d{4,5}|[a-z-]+(?:\.[a-z]{2})?\/\d{7})(?:v\d+)?$/i;

function arxivIdentifier(value: string): string | undefined {
  const id = value.trim().replace(/^(?:arxiv:\s*|https?:\/\/(?:www\.|export\.)?arxiv\.org\/(?:abs|pdf)\/)/i, "").replace(/\.pdf$/i, "");
  return ARXIV_ID.test(id) ? id.toLowerCase() : undefined;
}

function doiIdentifier(value: string): string | undefined {
  const doi = value.trim().replace(/^(?:doi:\s*|https?:\/\/(?:dx\.)?doi\.org\/)/i, "");
  return /^10\.\d{4,9}\/\S+$/i.test(doi) ? doi.toLowerCase() : undefined;
}

function normalizedTitle(value: string): string {
  return value.normalize("NFKC").toLowerCase().replace(/[\p{P}\p{Z}\s]/gu, "");
}

/** Recover a leading paper name from a pasted list item without changing identifiers. */
export function importSearchName(query: string): string {
  if (arxivIdentifier(query) || doiIdentifier(query)) return query.trim();
  let value = query.trim().replace(/^\s*(?:[-*•]\s+|\d+[.)、]\s*)/, "").replace(/\*\*|__/g, "").trim();
  if (arxivIdentifier(value) || doiIdentifier(value)) return value;
  value = value.replace(/^[\u3400-\u9fff\s]+[:：]\s*(?=[A-Za-z])/, "");
  // Chinese annotations commonly follow an English project name, separated by a colon,
  // dash, parentheses, or whitespace. English subtitles remain part of the title.
  const annotated = value.match(/^([A-Za-z][A-Za-z0-9 ._+&'’/()\-]*?)(?:\s*[:：,，;；（(—–-]\s*|\s+)[\u3400-\u9fff]/);
  if (annotated) value = annotated[1].trim();
  return value.replace(/^["“`]|["”`]$/g, "").trim();
}

function titlePrefix(title: string): string {
  return title.match(/^([^:：]+)[:：]/)?.[1]?.trim() || "";
}

/** Unique full titles, explicit named prefixes, and exact identifiers authorize selection. */
export function automaticImportCandidate(query: string, hits: PaperHit[]): string | undefined {
  const name = importSearchName(query);
  const doi = doiIdentifier(name);
  const arxiv = arxivIdentifier(name);
  const title = normalizedTitle(name);
  if (!title) return undefined;
  const matches = hits.filter((hit) => {
    if (!hit.id) return false;
    if (doi) return doiIdentifier(hit.doi || "") === doi;
    if (arxiv) {
      const candidate = arxivIdentifier(hit.arxivId || "");
      return candidate !== undefined && (/v\d+$/.test(arxiv) ? candidate === arxiv : candidate.replace(/v\d+$/, "") === arxiv);
    }
    return normalizedTitle(hit.title) === title || normalizedTitle(titlePrefix(hit.title)) === title;
  });
  return matches.length === 1 ? matches[0].id : undefined;
}

function containsPhrase(value: string, query: string): boolean {
  const words = query.normalize("NFKC").toLowerCase().match(/[\p{L}\p{N}]+/gu) || [];
  const text = ` ${value.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ")} `;
  return words.length > 0 && text.includes(` ${words.join(" ")} `);
}

function relevance(hit: PaperHit, query: string): number {
  const title = normalizedTitle(query);
  if (normalizedTitle(hit.title) === title) return 4;
  if (normalizedTitle(titlePrefix(hit.title)) === title) return 3;
  if (containsPhrase(hit.title, query)) return 2;
  return containsPhrase(hit.abstract, query) ? 1 : 0;
}

function subtitle(title: string): string {
  const suffix = title.replace(/^[^:：]+[:：]\s*/, "");
  return suffix !== title && suffix.split(/\s+/).length >= 4 ? normalizedTitle(suffix) : "";
}

function mergeHits(hits: PaperHit[]): PaperHit[] {
  const merged: PaperHit[] = [];
  for (const hit of hits) {
    const existing = merged.find((other) => {
      const otherArxiv = arxivIdentifier(other.arxivId || "")?.replace(/v\d+$/, "");
      const hitArxiv = arxivIdentifier(hit.arxivId || "")?.replace(/v\d+$/, "");
      const otherDoi = doiIdentifier(other.doi || "");
      const hitDoi = doiIdentifier(hit.doi || "");
      if (other.id === hit.id || (otherArxiv && otherArxiv === hitArxiv) || (otherDoi && otherDoi === hitDoi)) return true;
      if ((otherArxiv && hitArxiv && otherArxiv !== hitArxiv) || (otherDoi && hitDoi && otherDoi !== hitDoi)) return false;
      const author = normalizedTitle(other.authors.split(",")[0]);
      if (!author || author !== normalizedTitle(hit.authors.split(",")[0]) || !other.year.trim() || other.year.trim() !== hit.year.trim()) return false;
      return normalizedTitle(other.title) === normalizedTitle(hit.title) || Boolean(subtitle(other.title) && subtitle(other.title) === subtitle(hit.title));
    });
    if (!existing) { merged.push({ ...hit }); continue; }
    existing.arxivId ||= hit.arxivId;
    existing.doi ||= hit.doi;
    existing.oaPdfUrl ||= hit.oaPdfUrl;
    existing.isOa ||= hit.isOa;
    existing.authors ||= hit.authors;
    existing.abstract ||= hit.abstract;
    existing.publisherUrl ||= hit.publisherUrl;
  }
  return merged;
}

function xmlText(value: string): string {
  return value.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/<[^>]*>/g, "").replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (match, entity: string) => {
    const named: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
    if (entity.startsWith("#")) {
      const number = entity[1].toLowerCase() === "x" ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
      return number > 0 && number <= 0x10ffff ? String.fromCodePoint(number) : match;
    }
    return named[entity] ?? match;
  }).replace(/\s+/g, " ").trim();
}

function element(xml: string, name: string): string {
  return xmlText(xml.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, "i"))?.[1] || "");
}

async function searchArxiv(query: string, identifier?: string): Promise<PaperHit[]> {
  const url = new URL("https://export.arxiv.org/api/query");
  if (identifier) url.searchParams.set("id_list", identifier);
  else {
    const phrase = query.replace(/["\\]/g, " ");
    url.searchParams.set("search_query", `ti:"${phrase}" OR abs:"${phrase}"`);
  }
  url.searchParams.set("max_results", identifier ? "1" : "20");
  const response = await fetch(url, { signal: AbortSignal.timeout(25000), headers: { "User-Agent": "ResearchAtelier/1.0 (scholarly paper search)", Accept: "application/atom+xml" } });
  if (!response.ok) throw new Error(`arXiv 检索失败（HTTP ${response.status}）`);
  const xml = await response.text();
  if (!/<feed(?:\s[^>]*)?>/i.test(xml) || !/<\/feed\s*>/i.test(xml)) throw new Error("arXiv 返回了无效的检索响应");
  const hits: PaperHit[] = [];
  for (const match of xml.matchAll(/<entry(?:\s[^>]*)?>([\s\S]*?)<\/entry>/gi)) {
    const entry = match[1];
    const id = arxivIdentifier(element(entry, "id"));
    const title = element(entry, "title");
    if (!id || !title) continue;
    if (identifier && (identifier.match(/v\d+$/) ? id !== identifier : id.replace(/v\d+$/, "") !== identifier)) continue;
    let pdf: string | undefined;
    for (const link of entry.matchAll(/<link\b([^>]*?)\/?\s*>/gi)) {
      const attributes: Record<string, string> = {};
      for (const attribute of link[1].matchAll(/([\w:-]+)\s*=\s*(["'])(.*?)\2/g)) attributes[attribute[1].toLowerCase()] = xmlText(attribute[3]);
      if ((attributes.type === "application/pdf" || attributes.title === "pdf") && attributes.href) {
        try {
          const linkUrl = new URL(attributes.href);
          if (["http:", "https:"].includes(linkUrl.protocol) && ["arxiv.org", "export.arxiv.org", "www.arxiv.org"].includes(linkUrl.hostname) && arxivIdentifier(attributes.href) === id) pdf = attributes.href;
        } catch { /* Ignore malformed links from the feed. */ }
      }
    }
    hits.push({
      id: `https://arxiv.org/abs/${id}`, arxivId: id, title,
      authors: [...entry.matchAll(/<author(?:\s[^>]*)?>([\s\S]*?)<\/author>/gi)].map((author) => element(author[1], "name")).filter(Boolean).join(", "),
      year: element(entry, "published").slice(0, 4), abstract: element(entry, "summary"),
      doi: doiIdentifier(element(entry, "arxiv:doi")), isOa: true, oaPdfUrl: pdf,
      publisherUrl: `https://arxiv.org/abs/${id}`, publisherName: "arXiv",
    });
  }
  return hits;
}

/** Resolve metadata only. Import/download remains a separate, server-controlled action. */
export async function resolveImportQuery(query: string): Promise<PaperHit[]> {
  const value = typeof query === "string" ? query.trim() : "";
  if (!value || value.length > 500) throw new Error("请输入 1–500 个字符的论文完整标题、DOI 或 arXiv 编号");
  const name = importSearchName(value);
  if (!/[\p{L}\p{N}]/u.test(name)) throw new Error("请输入论文名称、DOI 或 arXiv 编号");
  const arxiv = arxivIdentifier(name);
  if (arxiv) return searchArxiv(name, arxiv);
  const doi = doiIdentifier(name);
  if (doi) return searchPapers(`https://doi.org/${doi}`);
  let primaryError: unknown;
  let primary: PaperHit[] = [];
  try {
    primary = (await searchPapers(name)).filter((hit) => relevance(hit, name) > 0);
    const clearMatches = primary.filter((hit) => relevance(hit, name) >= 3);
    if (clearMatches.length && clearMatches.every((hit) => hit.oaPdfUrl)) return mergeHits(primary).sort((a, b) => relevance(b, name) - relevance(a, name));
  } catch (error) { primaryError = error; }
  try {
    const secondary = await searchArxiv(name);
    let merged = mergeHits([...primary, ...secondary]);
    // A conference project can have a different short name than its preprint. Use
    // the provider's full subtitle to locate it, rather than a curated alias map.
    if (!merged.some((hit) => relevance(hit, name) >= 3 && hit.oaPdfUrl)) {
      const renamed = primary.find((hit) => relevance(hit, name) >= 3 && subtitle(hit.title));
      if (renamed) {
        const description = renamed.title.replace(/^[^:：]+[:：]\s*/, "");
        const alternatives = await searchArxiv(description);
        merged = mergeHits([...merged, ...alternatives]);
      }
    }
    return merged.filter((hit) => relevance(hit, name) > 0).sort((a, b) => relevance(b, name) - relevance(a, name));
  }
  catch (error) {
    if (primary.length) return mergeHits(primary).sort((a, b) => relevance(b, name) - relevance(a, name));
    if (primaryError) throw new Error("OpenAlex 和 arXiv 检索暂时不可用，请稍后重试", { cause: error });
    throw error;
  }
}
