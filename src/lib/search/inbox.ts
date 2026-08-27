/**
 * Candidate Inbox → Canonical 去重（B3 + v1.3 identity lifecycle hardening）：
 * - canonicalId 优先级：DOI > arXiv ID > URL（规范化）> normalizedTitle；
 *   URL-only 不得全部落到 title:untitled（两个不同 URL 不互相 dedupe）
 * - aliases：title:/doi:/arxiv: 别名注册；enrichment 新获 DOI/arXiv 后并入别名，
 *   后续按别名导入的同一工作合并进既有候选（避免 title:id 与 doi:id 并存）
 * - 保守版本提示：标题归一相同但标识不同且无别名联系 → 两条都保留并标注
 */
import type { CanonicalPaper, ImportedPaperCandidate } from "./types.ts";
import { canonicalIdFor, normalizedTitle, normalizeDoi, normalizeArxivId, normalizeUrl } from "./types.ts";

export function canonicalFromImport(it: ImportedPaperCandidate): CanonicalPaper | null {
  const title = it.title?.trim();
  const doi = normalizeDoi(it.doi);
  const arxiv = normalizeArxivId(it.arxivId);
  const url = normalizeUrl(it.url);
  if (!title && !doi && !arxiv && !url) return null; // unknown 由调用方单独收集

  let canonicalId = canonicalIdFor({ doi, arxivId: arxiv, title });
  if (!canonicalId && url) canonicalId = "url:" + url;
  if (!canonicalId) canonicalId = "import:" + it.importId;

  // 别名：title/doi/arxiv（url 不作为别名，避免跨页面误合并）
  const aliases: string[] = [];
  const pushAlias = (a: string) => { if (a && a !== canonicalId && !aliases.includes(a)) aliases.push(a); };
  if (title) pushAlias("title:" + normalizedTitle(title));
  if (doi) pushAlias("doi:" + doi);
  if (arxiv) pushAlias("arxiv:" + arxiv);

  return {
    canonicalId,
    ...(doi ? { doi } : {}),
    ...(arxiv ? { arxivId: arxiv } : {}),
    ...(url ? { url } : {}),
    title: title || "(未识别标题)",
    authors: [],
    sources: [],
    metrics: { citations: {} },
    hits: [],
    importInfo: { importId: it.importId, detectedType: it.detectedType, raw: it.raw },
    aliases,
  };
}

export interface DedupeResult {
  candidates: CanonicalPaper[];
  merged: number;
  versionNotes: { canonicalId: string; note: string }[];
}

/** 去重：已有候选优先；按 canonicalId + 别名索引复核（v1.3）；批内重复合并计数 */
export function dedupeCandidates(items: ImportedPaperCandidate[], existing: CanonicalPaper[] = []): DedupeResult {
  const map = new Map<string, CanonicalPaper>();
  const index = new Map<string, string>(); // key（canonicalId 或别名）→ canonicalId
  for (const c of existing) {
    map.set(c.canonicalId, c);
    for (const k of [c.canonicalId, ...(c.aliases ?? [])]) if (!index.has(k)) index.set(k, c.canonicalId);
  }
  let merged = 0;
  const versionNotes: { canonicalId: string; note: string }[] = [];
  for (const it of items) {
    const canon = canonicalFromImport(it);
    if (!canon) continue;
    const hitKey = [canon.canonicalId, ...(canon.aliases ?? [])].find((k) => index.has(k));
    if (hitKey) {
      const survivor = map.get(index.get(hitKey)!);
      merged++;
      if (survivor) {
        // 别名合并：被合并条目的 canonicalId 与别名一并并入幸存者（后续按这些身份导入不再新增）
        const added = [canon.canonicalId, ...(canon.aliases ?? [])]
          .filter((a) => a !== survivor.canonicalId && !(survivor.aliases ?? []).includes(a));
        if (added.length) {
          survivor.aliases = [...(survivor.aliases ?? []), ...added];
          for (const a of added) if (!index.has(a)) index.set(a, survivor.canonicalId);
        }
      }
      continue;
    }
    // 保守版本提示：标题归一相同但标识不同且无别名联系 → 两条都保留并标注
    const sameTitle = [...map.values()].find(
      (c) => c.title && normalizedTitle(c.title) === normalizedTitle(canon.title) && c.canonicalId !== canon.canonicalId,
    );
    if (sameTitle) {
      versionNotes.push({ canonicalId: canon.canonicalId, note: "标题相同但标识不同，可能为不同版本（保留两条，未激进合并）" });
      versionNotes.push({ canonicalId: sameTitle.canonicalId, note: "与另一条标题相同的记录并存（可能为不同版本）" });
    }
    map.set(canon.canonicalId, canon);
    index.set(canon.canonicalId, canon.canonicalId);
    for (const a of canon.aliases ?? []) index.set(a, canon.canonicalId);
  }
  return { candidates: [...map.values()], merged, versionNotes };
}

