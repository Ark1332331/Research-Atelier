/**
 * v1.6：Bibliographic Resolution（逐篇解析真实身份）+ 证据门控。
 *  - resolveCandidate：一行一篇 → canonicalFromImport → Crossref（仅 DOI）/
 *    OpenAlex（DOI 或严格标题匹配）；0 命中 → unresolved；≥2 同标题 → ambiguous（choices 供用户选）；
 *    1 命中 → resolved（带 matchConfidence 与 enrichment provenance）
 *  - gateForCandidate：title-only / metadata / abstract / fulltext（candidate exists ≠ screenable）
 */
import type { CanonicalPaper, CandidateInput, CandidateResolution, EvidenceGate } from "./types.ts";
import { canonicalFromImport } from "./inbox.ts";
import { enrichCandidate, applyEnrichment, emptyEvidence, rebuildAbstract } from "./enrich.ts";
import { normalizedTitle, normalizeDoi, normalizeArxivId } from "./types.ts";

const OPENALEX = "https://api.openalex.org/works";
const UA = "ResearchAtelier/0.1 (mailto:research@atelier.local)";

/** 证据门控：abstract/fulltext 才可初筛；title-only/metadata 只能「可能相关」 */
export function gateForCandidate(c: CanonicalPaper): EvidenceGate {
  if (c.fulltext) return "fulltext";
  if (c.abstract && c.abstract.trim().length > 0) return "abstract";
  if (c.year !== undefined || c.venue || (c.authors?.length ?? 0) > 0 || c.doi || c.arxivId) return "metadata";
  return "title-only";
}

export function hasAbstract(c: CanonicalPaper): boolean {
  return Boolean(c.abstract && c.abstract.trim().length > 0);
}

export interface ResolveOutcome {
  resolution: CandidateResolution;
  canon: CanonicalPaper | null;   // resolved 时返回（已 enrichment）；ambiguous/unresolved 时返回基础 canon 或 null
}

/** v1.6：把已解析候选并入既有候选集（别名命中 → 补证据合并，不新增重复身份） */
export function mergeResolvedInto(existing: CanonicalPaper[], canon: CanonicalPaper): { candidates: CanonicalPaper[]; merged: boolean } {
  const index = new Map<string, string>();
  for (const c of existing) {
    index.set(c.canonicalId, c.canonicalId);
    for (const a of c.aliases ?? []) index.set(a, c.canonicalId);
  }
  const hitKey = [canon.canonicalId, ...(canon.aliases ?? [])].find((k) => index.has(k));
  if (!hitKey) return { candidates: [...existing, canon], merged: false };
  const survivor = existing.find((c) => c.canonicalId === index.get(hitKey)!);
  if (!survivor) return { candidates: [...existing, canon], merged: false };
  const merged: CanonicalPaper = {
    ...survivor,
    ...(survivor.title === "(未识别标题)" && canon.title ? { title: canon.title } : {}),
    ...(survivor.authors?.length ? {} : canon.authors?.length ? { authors: canon.authors } : {}),
    ...(survivor.year === undefined && canon.year !== undefined ? { year: canon.year } : {}),
    ...(!survivor.venue && canon.venue ? { venue: canon.venue } : {}),
    ...(!survivor.abstract && canon.abstract ? { abstract: canon.abstract } : {}),
    ...(!survivor.doi && canon.doi ? { doi: canon.doi } : {}),
    ...(!survivor.arxivId && canon.arxivId ? { arxivId: canon.arxivId } : {}),
    aliases: [...new Set([...(survivor.aliases ?? []), ...(canon.aliases ?? []), canon.canonicalId].filter((a) => a !== survivor.canonicalId))],
    ...(!survivor.enrichment && canon.enrichment ? { enrichment: canon.enrichment } : {}),
    ...(!survivor.resolution && canon.resolution ? { resolution: canon.resolution } : {}),
  };
  return { candidates: existing.map((c) => (c.canonicalId === survivor.canonicalId ? merged : c)), merged: true };
}

/** 逐篇解析：返回 resolution + canon。不抛错（网络失败 → unresolved + warnings）。 */
export async function resolveCandidate(input: CandidateInput): Promise<ResolveOutcome> {
  const base = canonicalFromImport(input);
  if (!base) {
    return {
      resolution: {
        status: "unresolved",
        matchConfidence: "low",
        resolvedAt: new Date().toISOString(),
        warnings: ["无法识别为论文（无标题/DOI/URL）"],
      },
      canon: null,
    };
  }
  const warnings: string[] = [];
  const doi = normalizeDoi(base.doi);

  // 1) DOI 强解析（Crossref + OpenAlex）
  if (doi) {
    const { paper, warnings: w } = await enrichCandidate(base);
    if (paper.enrichment && (paper.enrichment.title.length || paper.enrichment.doi.length)) {
      const resolution: CandidateResolution = {
        status: "resolved",
        matchConfidence: "high",
        resolvedAt: new Date().toISOString(),
        warnings: w,
      };
      return { resolution, canon: { ...paper, resolution } };
    }
    warnings.push("DOI 存在但 Crossref/OpenAlex 未返回身份（已标记 unresolved，不猜）");
    const r1: CandidateResolution = { status: "unresolved", matchConfidence: "low", resolvedAt: new Date().toISOString(), warnings };
    return { resolution: r1, canon: { ...base, resolution: r1 } };
  }

  // 2) 标题严格匹配（OpenAlex）
  const title = base.title && base.title !== "(未识别标题)" ? base.title : undefined;
  if (title) {
    try {
      const res = await fetch(
        OPENALEX + "?filter=title.search:" + encodeURIComponent(title) +
        "&per-page=8&select=display_name,publication_year,primary_location,authorships,abstract_inverted_index,cited_by_count,ids,open_access&mailto=research@atelier.local",
        { signal: AbortSignal.timeout(12000), headers: { "User-Agent": UA } },
      );
      if (res.ok) {
        const d = await res.json();
        const results: any[] = (d?.results ?? []).filter((r: any) => normalizedTitle(r?.display_name) === normalizedTitle(title));
        if (results.length === 0) {
          warnings.push("OpenAlex 无严格标题匹配：真实身份未解析（不猜）");
          const r0: CandidateResolution = { status: "unresolved", matchConfidence: "low", resolvedAt: new Date().toISOString(), warnings };
          return { resolution: r0, canon: { ...base, resolution: r0 } };
        }
        if (results.length >= 2) {
          const r2: CandidateResolution = {
            status: "ambiguous",
            matchConfidence: "low",
            resolvedAt: new Date().toISOString(),
            choices: results.map((r) => ({
              title: String(r.display_name ?? ""),
              ...(r.ids?.doi ? { doi: String(r.ids.doi) } : {}),
              ...(r.ids?.arxiv ? { arxivId: String(r.ids.arxiv) } : {}),
              ...(r.publication_year ? { year: Number(r.publication_year) } : {}),
              ...(r.primary_location?.source?.display_name ? { venue: String(r.primary_location.source.display_name) } : {}),
            })),
            warnings: ["存在多篇同名候选，请选择真实身份"],
          };
          return { resolution: r2, canon: { ...base, resolution: r2 } };
        }
        // 唯一命中 → resolved（构造 enrichment 结果）
        const hit = results[0];
        const evidence = emptyEvidence();
        const patch: any = {};
        const authors = (hit.authorships ?? []).slice(0, 10).map((a: any) => a?.author?.display_name).filter(Boolean);
        if (hit.display_name) { patch.title = String(hit.display_name); evidence.title.push("openalex"); }
        if (authors.length) { patch.authors = authors; evidence.authors.push("openalex"); }
        if (hit.publication_year) { patch.year = Number(hit.publication_year); evidence.year.push("openalex"); }
        if (hit.primary_location?.source?.display_name) { patch.venue = String(hit.primary_location.source.display_name); evidence.venue.push("openalex"); }
        if (hit.abstract_inverted_index) { patch.abstract = rebuildAbstract(hit.abstract_inverted_index); evidence.abstract.push("openalex"); }
        if (hit.ids?.doi) { const nd = normalizeDoi(hit.ids.doi); if (nd) { patch.doi = nd; evidence.doi.push("openalex"); } }
        if (hit.ids?.arxiv) { const na = normalizeArxivId(hit.ids.arxiv); if (na) patch.arxivId = na; }
        if (typeof hit.cited_by_count === "number") evidence.citations.openAlex = hit.cited_by_count;
        if (hit.open_access?.oa_url) { patch.oaPdfUrl = String(hit.open_access.oa_url); evidence.oa.push("openalex"); }
        const paper = applyEnrichment(base, { patch, evidence, warnings: [] });
        const r3: CandidateResolution = {
          status: "resolved",
          matchConfidence: paper.abstract ? "high" : "medium",
          resolvedAt: new Date().toISOString(),
          warnings: [],
        };
        return { resolution: r3, canon: { ...paper, resolution: r3 } };
      }
      warnings.push("OpenAlex 未核实（HTTP " + res.status + "）");
    } catch { warnings.push("OpenAlex 未核实（网络）"); }
  } else {
    warnings.push("无标题/DOI：无法解析真实身份（不猜）");
  }

  const r4: CandidateResolution = { status: "unresolved", matchConfidence: "low", resolvedAt: new Date().toISOString(), warnings };
  return { resolution: r4, canon: { ...base, resolution: r4 } };
}

