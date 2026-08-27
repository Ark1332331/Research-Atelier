/**
 * Metadata Enrichment（B4，v1.2）：Crossref + OpenAlex，只补不覆盖，provenance 分来源。
 * 原则：
 *  - 没有就是「未核实」；Crossref 仅按 DOI 校验（不按标题猜）；
 *  - OpenAlex 标题匹配必须严格归一后才信；
 *  - citation 分源保存，绝不跨源合并；
 *  - 单篇失败只记 warnings，不影响整批导入。
 */
import type { CanonicalPaper, EnrichmentProvenance } from "./types.ts";
import { normalizeDoi, normalizeArxivId, normalizedTitle } from "./types.ts";

const CROSSREF = "https://api.crossref.org/works/";
const OPENALEX = "https://api.openalex.org/works";
const UA = "ResearchAtelier/0.1 (mailto:research@atelier.local)";

export interface EnrichmentResult {
  patch: Partial<{
    title: string; authors: string[]; year: number; venue: string;
    abstract: string; doi: string; arxivId: string; oaPdfUrl: string; publisherUrl: string;
  }>;
  evidence: EnrichmentProvenance;   // 每字段来源列表 + citations 分源值
  warnings: string[];
}

export function emptyEvidence(): EnrichmentProvenance {
  return { title: [], authors: [], year: [], venue: [], abstract: [], doi: [], oa: [], citations: {} };
}

/** OpenAlex 摘要倒排索引 → 文本 */
export function rebuildAbstract(inv?: Record<string, number[]>): string {
  if (!inv) return "";
  const pos: [number, string][] = [];
  for (const [w, ps] of Object.entries(inv)) for (const p of ps) pos.push([p, w]);
  pos.sort((a, b) => a[0] - b[0]);
  return pos.map((x) => x[1]).join(" ").slice(0, 1200);
}

/** 纯函数：候选已有字段优先，缺失才补；citation 分源合并（不跨源加总）；
 *  v1.3：enrichment 新获 DOI/arXiv → 并入 aliases（身份复核，避免 title:id 与 doi:id 并存） */
export function applyEnrichment(c: CanonicalPaper, r: EnrichmentResult): CanonicalPaper {
  const p = r.patch;
  const aliases = [...(c.aliases ?? [])];
  const pd = p.doi ? normalizeDoi(p.doi) : undefined;
  if (pd) { const a = "doi:" + pd; if (a !== c.canonicalId && !aliases.includes(a)) aliases.push(a); }
  const pa = p.arxivId ? normalizeArxivId(p.arxivId) : undefined;
  if (pa) { const a = "arxiv:" + pa; if (a !== c.canonicalId && !aliases.includes(a)) aliases.push(a); }
  return {
    ...c,
    ...(aliases.length ? { aliases } : {}),
    title: c.title && c.title !== "(未识别标题)" ? c.title : (p.title ?? c.title),
    ...(!c.authors?.length && p.authors?.length ? { authors: p.authors } : {}),
    ...(c.year === undefined && p.year !== undefined ? { year: p.year } : {}),
    ...(!c.venue && p.venue ? { venue: p.venue } : {}),
    ...(!c.abstract && p.abstract ? { abstract: p.abstract } : {}),
    ...(!c.doi && p.doi ? { doi: p.doi } : {}),
    ...(!c.links?.oaPdfUrl && p.oaPdfUrl ? { links: { isOa: true, oaPdfUrl: p.oaPdfUrl, ...(c.links?.publisherUrl ? { publisherUrl: c.links.publisherUrl } : {}) } } : {}),
    metrics: { citations: { ...c.metrics.citations, ...r.evidence.citations } },
    enrichment: r.evidence,
  };
}

/** 单篇 enrichment；失败只记 warnings，不抛错 */
export async function enrichCandidate(c: CanonicalPaper): Promise<{ paper: CanonicalPaper; warnings: string[] }> {
  const patch: EnrichmentResult["patch"] = {};
  const evidence = emptyEvidence();
  const warnings: string[] = [];
  const doi = normalizeDoi(c.doi);

  if (doi) {
    try {
      const res = await fetch(CROSSREF + encodeURIComponent(doi) + "?select=DOI,title,author,container-title,published,type", {
        signal: AbortSignal.timeout(10000), headers: { "User-Agent": UA },
      });
      if (res.ok) {
        const d = await res.json();
        const m = d?.message;
        if (m) {
          const t = Array.isArray(m.title) ? String(m.title[0] ?? "") : String(m.title ?? "");
          if (t) { patch.title = t; evidence.title.push("crossref"); }
          const auths = (Array.isArray(m.author) ? m.author : []).slice(0, 10)
            .map((a: any) => [a?.given, a?.family].filter(Boolean).join(" "))
            .filter(Boolean);
          if (auths.length) { patch.authors = auths; evidence.authors.push("crossref"); }
          const dp = m?.published?.["date-parts"]?.[0];
          if (Array.isArray(dp) && dp[0]) { patch.year = Number(dp[0]); evidence.year.push("crossref"); }
          const cont = Array.isArray(m["container-title"]) ? String(m["container-title"][0] ?? "") : "";
          if (cont) { patch.venue = cont; evidence.venue.push("crossref"); }
          evidence.doi.push("crossref");
        } else warnings.push("Crossref 未核实（无 message）");
      } else warnings.push("Crossref 未核实（HTTP " + res.status + "）");
    } catch { warnings.push("Crossref 未核实（网络）"); }
  } else {
    warnings.push("无 DOI：Crossref 仅按 DOI 校验，不按标题猜测（未核实）");
  }

  try {
    const url = doi
      ? OPENALEX + "?filter=doi:" + encodeURIComponent(doi) + "&select=display_name,authorships,publication_year,primary_location,abstract_inverted_index,cited_by_count,open_access,ids&mailto=research@atelier.local"
      : OPENALEX + "?filter=title.search:" + encodeURIComponent(c.title) + "&per-page=8&select=display_name,publication_year,cited_by_count,abstract_inverted_index&mailto=research@atelier.local";
    const res = await fetch(url, { signal: AbortSignal.timeout(10000), headers: { "User-Agent": UA } });
    if (res.ok) {
      const d = await res.json();
      const results: any[] = d?.results ?? [];
      const hit = doi ? results[0] : results.find((r) => normalizedTitle(r?.display_name) === normalizedTitle(c.title));
      if (hit) {
        if (!patch.title && hit.display_name) { patch.title = String(hit.display_name); evidence.title.push("openalex"); }
        if (!patch.authors?.length) {
          const auths = (hit.authorships ?? []).slice(0, 10).map((a: any) => a?.author?.display_name).filter(Boolean);
          if (auths.length) { patch.authors = auths; evidence.authors.push("openalex"); }
        }
        if (patch.year === undefined && hit.publication_year) { patch.year = Number(hit.publication_year); evidence.year.push("openalex"); }
        if (!patch.venue && hit.primary_location?.source?.display_name) { patch.venue = String(hit.primary_location.source.display_name); evidence.venue.push("openalex"); }
        if (!patch.abstract && hit.abstract_inverted_index) { patch.abstract = rebuildAbstract(hit.abstract_inverted_index); evidence.abstract.push("openalex"); }
        if (typeof hit.cited_by_count === "number") evidence.citations.openAlex = hit.cited_by_count;
        if (hit.open_access?.oa_url) { patch.oaPdfUrl = String(hit.open_access.oa_url); evidence.oa.push("openalex"); }
        if (hit.ids?.doi && !doi) { const nd = normalizeDoi(hit.ids.doi); if (nd) { patch.doi = nd; evidence.doi.push("openalex"); } }
        if (hit.ids?.arxiv && !c.arxivId) { const na = normalizeArxivId(hit.ids.arxiv); if (na) patch.arxivId = na; }
      } else {
        warnings.push(doi ? "OpenAlex 未核实（DOI 无结果）" : "OpenAlex 未核实（无严格标题匹配）");
      }
    } else warnings.push("OpenAlex 未核实（HTTP " + res.status + "）");
  } catch { warnings.push("OpenAlex 未核实（网络）"); }

  return { paper: applyEnrichment(c, { patch, evidence, warnings }), warnings };
}

/** 并发执行 enrichment（默认 4 并发），单篇失败不影响整体 */
export async function enrichAll(candidates: CanonicalPaper[], concurrency = 4): Promise<{
  papers: CanonicalPaper[]; warnings: { canonicalId: string; warnings: string[] }[];
}> {
  const warnings: { canonicalId: string; warnings: string[] }[] = [];
  const out: CanonicalPaper[] = [];
  for (let i = 0; i < candidates.length; i += concurrency) {
    const slice = candidates.slice(i, i + concurrency);
    const results = await Promise.all(slice.map((c) => enrichCandidate(c).catch(() => ({ paper: c, warnings: ["enrich 意外失败"] }))));
    for (const r of results) {
      if (r.warnings.length) warnings.push({ canonicalId: r.paper.canonicalId, warnings: r.warnings });
      out.push(r.paper);
    }
  }
  return { papers: out, warnings };
}

