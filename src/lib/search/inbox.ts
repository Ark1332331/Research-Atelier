/**
 * Candidate Inbox → Canonical 去重（B3，v1.2）：
 * 复用现有 canonicalIdFor（DOI > arXiv ID > normalizedTitle），不重新造身份体系。
 * 保守去重：arXiv 预印本 vs 会议版（不同 canonicalId）宁可保留两条；
 * 标题归一相同但标识不同的，两条都保留并标注「可能为不同版本」。
 */
import type { CanonicalPaper, ImportedPaperCandidate } from "./types.ts";
import { canonicalIdFor, normalizedTitle } from "./types.ts";

export function canonicalFromImport(it: ImportedPaperCandidate): CanonicalPaper | null {
  const title = it.title?.trim();
  if (!title && !it.doi && !it.arxivId && !it.url) return null; // 完全无法定位（unknown 由调用方单独收集）
  return {
    canonicalId: canonicalIdFor({ doi: it.doi, arxivId: it.arxivId, title: title ?? "untitled" }),
    ...(it.doi ? { doi: it.doi } : {}),
    ...(it.arxivId ? { arxivId: it.arxivId } : {}),
    title: title || "(未识别标题)",
    authors: [],
    sources: [],
    metrics: { citations: {} },
    hits: [],
    importInfo: { importId: it.importId, detectedType: it.detectedType, raw: it.raw },
  };
}

export interface DedupeResult {
  candidates: CanonicalPaper[];
  merged: number;              // 与已有候选/批内重复而被合并的条数
  versionNotes: { canonicalId: string; note: string }[];
}

/** 去重：已有候选优先（不覆盖）；批内同 canonicalId 合并计数 */
export function dedupeCandidates(items: ImportedPaperCandidate[], existing: CanonicalPaper[] = []): DedupeResult {
  const map = new Map<string, CanonicalPaper>();
  for (const c of existing) map.set(c.canonicalId, c);
  let merged = 0;
  const versionNotes: { canonicalId: string; note: string }[] = [];
  for (const it of items) {
    const canon = canonicalFromImport(it);
    if (!canon) continue;
    if (map.has(canon.canonicalId)) { merged++; continue; }
    // 保守版本提示：标题归一相同但 canonicalId 不同（如 arXiv vs 会议 DOI）→ 两条都保留并标注
    const sameTitle = [...map.values()].find(
      (c) => c.title && normalizedTitle(c.title) === normalizedTitle(canon.title) && c.canonicalId !== canon.canonicalId,
    );
    if (sameTitle) {
      versionNotes.push({ canonicalId: canon.canonicalId, note: "标题相同但标识不同，可能为不同版本（保留两条，未激进合并）" });
      versionNotes.push({ canonicalId: sameTitle.canonicalId, note: "与另一条标题相同的记录并存（可能为不同版本）" });
    }
    map.set(canon.canonicalId, canon);
  }
  return { candidates: [...map.values()], merged, versionNotes };
}

