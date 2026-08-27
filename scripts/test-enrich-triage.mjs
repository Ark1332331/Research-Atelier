/**
 * Phase B-lite B4/B5 纯逻辑测试：applyEnrichment provenance、evidenceLevelFor、
 * normalizeTriage 绑定 + 边界强制（evidenceLevel !== fulltext → keySections 强制空）。
 * 运行：node scripts/test-enrich-triage.mjs
 */
import { applyEnrichment, emptyEvidence, rebuildAbstract } from "../src/lib/search/enrich.ts";
import { evidenceLevelFor, enforceTriageEvidenceBoundary, normalizeTriage } from "../src/lib/search/triage.ts";
import { dedupeCandidates } from "../src/lib/search/inbox.ts";

let pass = 0, fail = 0;
function ok(cond, name) { if (cond) { pass++; console.log("  ✓ " + name); } else { fail++; console.log("  ✗ " + name); } }

const cand = {
  canonicalId: "doi:10.48550/arXiv.2301.04104",
  doi: "10.48550/arXiv.2301.04104",
  title: "Mastering Diverse Domains through World Models",
  authors: [],
  sources: [],
  metrics: { citations: {} },
  hits: [],
};

console.log("== applyEnrichment（B4：只补不覆盖、provenance 分来源、citation 不跨源合并） ==");
const r = {
  patch: { title: "Crossref Title", authors: ["A", "B"], year: 2023, venue: "ICML", abstract: "abs", doi: "10.1/x", oaPdfUrl: "https://x.pdf" },
  evidence: { title: ["crossref"], authors: ["openalex"], year: ["crossref"], venue: ["crossref"], abstract: ["openalex"], doi: [], oa: ["openalex"], citations: { openAlex: 312, semanticScholar: 98 } },
  warnings: [],
};
const enriched = applyEnrichment(cand, r);
ok(enriched.title === cand.title, "候选已有 title 不被覆盖");
ok(enriched.authors.length === 2 && enriched.authors[0] === "A", "缺失 authors 被补");
ok(enriched.year === 2023 && enriched.venue === "ICML", "缺失 year/venue 被补");
ok(enriched.abstract === "abs", "缺失 abstract 被补");
ok(enriched.enrichment?.citations.openAlex === 312 && enriched.enrichment.citations.semanticScholar === 98, "citation 分源保存（不合并）");
ok(enriched.metrics.citations.openAlex === 312 && enriched.metrics.citations.semanticScholar === 98, "metrics 分源合并，无跨源加总");
ok(enriched.enrichment.title[0] === "crossref" && enriched.enrichment.abstract[0] === "openalex", "provenance 每字段记录来源");

console.log("== evidenceLevelFor / 边界强制（B5） ==");
ok(evidenceLevelFor({ ...cand }) === "metadata", "无摘要 → metadata");
ok(evidenceLevelFor({ ...cand, abstract: "x" }) === "abstract", "有摘要 → abstract");
const fakeFull = enforceTriageEvidenceBoundary({ paperId: "x", role: "core", roleReason: "", roleConfidence: "high", roleEvidence: [], worthReading: "", relationToQuestion: "high", depth: "deep", evidenceLevel: "abstract", keySections: ["Method"], skipSections: ["Appendix"], d: { d1: "", d2: "", d3: "", d4: "", d5: "", d6: "" }, verdict: "读" });
ok(fakeFull.keySections.length === 0 && fakeFull.skipSections.length === 0, "evidenceLevel=abstract → keySections/skipSections 代码强制为空");

console.log("== normalizeTriage（B5/B6：只绑定真实候选、clamp evidenceLevel、无总分） ==");
const candidates = [cand, { ...cand, canonicalId: "arxiv:1803.10122", arxivId: "1803.10122", title: "World Models", abstract: "a" }];
const triage = normalizeTriage([
  { paperId: cand.canonicalId, role: "core", roleConfidence: "high", depth: "deep", evidenceLevel: "fulltext", keySections: ["Method"], skipSections: ["X"], verdict: "读", relationToQuestion: "high", roleReason: "r", worthReading: "w", roleEvidence: [], d: {} },
  { paperId: "not-a-real-id", role: "core", verdict: "读" },
  { paperId: "arxiv:1803.10122", role: "survey", depth: "targeted", evidenceLevel: "metadata", verdict: "扫读", relationToQuestion: "medium", roleReason: "", worthReading: "", roleEvidence: [], d: {} },
], candidates);
ok(triage.length === 2, "只绑定真实候选（虚构 id 丢弃）");
const t0 = triage[0];
ok(t0.evidenceLevel === "metadata", "无摘要候选：LLM 声称 fulltext 被 clamp 到 metadata");
ok(t0.keySections.length === 0 && t0.skipSections.length === 0, "clamp 后章节强制为空");
const t1 = triage[1];
ok(t1.evidenceLevel === "metadata" && t1.depth === "targeted", "有摘要但声明 metadata → 保留 metadata（允许降级）");
ok(!("score" in t0) && !("rank" in t0), "无总分/排名字段");

console.log("== inbox dedupe（B3：复用 canonicalIdFor，保守不激进） ==");
const items = [
  { importId: "i1", raw: "r1", detectedType: "title", title: "Mastering Diverse Domains through World Models" },
  { importId: "i2", raw: "r2", detectedType: "arxiv", arxivId: "2301.04104", title: "Mastering Diverse Domains through World Models" },
  { importId: "i3", raw: "r3", detectedType: "title", title: "Mastering Diverse Domains through World Models" },
];
const { candidates: d1, merged } = dedupeCandidates(items);
ok(merged === 1, "同 title 重复合并 1 条（i1/i3 同 title key）");
ok(d1.length === 2, "arXiv 版与 title 版不同 key → 两条都保留（保守）");
const notes = dedupeCandidates([{ importId: "i4", raw: "r4", detectedType: "doi", doi: "10.1000/xyz", title: "Mastering Diverse Domains through World Models" }], d1);
ok(notes.versionNotes.length >= 1, "标题相同但标识不同 → 标注可能为不同版本");

console.log("\n结果：" + pass + " 通过 / " + fail + " 失败");
process.exit(fail ? 1 : 0);

