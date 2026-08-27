/**
 * Phase B-lite B4/B5 纯逻辑测试：applyEnrichment provenance、evidenceLevelFor、
 * normalizeTriage 绑定 + 边界强制（evidenceLevel !== fulltext → keySections 强制空）。
 * 运行：node scripts/test-enrich-triage.mjs
 */
import { applyEnrichment, emptyEvidence, rebuildAbstract } from "../src/lib/search/enrich.ts";
import { evidenceLevelFor, enforceTriageEvidenceBoundary, normalizeTriage, buildTriageUserPrompt } from "../src/lib/search/triage.ts";
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

console.log("== v1.3 identity：别名复核合并（不保留重复身份） ==");
const items = [
  { importId: "i1", raw: "r1", detectedType: "title", title: "Mastering Diverse Domains through World Models" },
  { importId: "i2", raw: "r2", detectedType: "arxiv", arxivId: "2301.04104", title: "Mastering Diverse Domains through World Models" },
  { importId: "i3", raw: "r3", detectedType: "title", title: "Mastering Diverse Domains through World Models" },
];
const { candidates: d1, merged } = dedupeCandidates(items);
ok(d1.length === 1, "title/arxiv/title 同标题 → 别名复核合并为 1 条（避免 title:id 与 arxiv:id 并存）");
ok(merged === 2, "合并计数 2");
ok((d1[0].aliases ?? []).includes("arxiv:2301.04104"), "幸存者别名并入 arxiv 身份");

console.log("== v1.3 identity：URL-only 身份（两个不同 URL 不互相 dedupe） ==");
const u1 = dedupeCandidates([{ importId: "u1", raw: "r", detectedType: "url", url: "https://a.com/paper1" }]);
const u2 = dedupeCandidates([{ importId: "u2", raw: "r", detectedType: "url", url: "https://b.com/paper2" }], u1.candidates);
ok(u1.candidates[0].canonicalId === "url:a.com/paper1" && u1.candidates[0].title !== "untitled", "URL-only → url: 身份（非 title:untitled）");
ok(u2.candidates.length === 2 && u2.merged === 0, "两个不同 URL → 不互相 dedupe");
const u3 = dedupeCandidates([{ importId: "u3", raw: "r", detectedType: "url", url: "https://a.com/paper1" }], u1.candidates);
ok(u3.merged === 1 && u3.candidates.length === 1, "相同 URL → 合并");

console.log("== v1.3 identity：enrichment 获 DOI 后按 DOI 再次导入不新增 ==");
const cTitle = { importId: "t1", raw: "r", detectedType: "title", title: "World Models" };
const c1 = dedupeCandidates([cTitle]).candidates[0];
ok(c1.canonicalId === "title:world models", "title-only → title: 身份");
const enriched1 = applyEnrichment(c1, {
  patch: { doi: "10.48550/arXiv.1803.10122", title: "World Models" },
  evidence: { title: ["openalex"], authors: [], year: [], venue: [], abstract: [], doi: ["openalex"], oa: [], citations: { openAlex: 998 } },
  warnings: [],
});
ok((enriched1.aliases ?? []).includes("doi:10.48550/arXiv.1803.10122"), "enrichment 获 DOI → 别名并入");
const reImport = dedupeCandidates([{ importId: "t2", raw: "r", detectedType: "doi", doi: "10.48550/arXiv.1803.10122", title: "World Models" }], [enriched1]);
ok(reImport.merged === 1 && reImport.candidates.length === 1, "title-only 后按 DOI 再次导入 → 合并，不新增（title:id 与 doi:id 不并存）");

console.log("== v1.3 triage：roleEvidence 与真实 provenance 对齐（虚构剔除） ==");
const fakeEv = normalizeTriage([
  { paperId: cand.canonicalId, role: "core", depth: "deep", evidenceLevel: "metadata", verdict: "读", relationToQuestion: "high", roleReason: "r", worthReading: "w",
    roleEvidence: [
      { kind: "fulltext", source: "paper" },
      { kind: "citation-graph", source: "s2" },
      { kind: "abstract", source: "openalex" },
      { kind: "metadata", source: "import" },
    ], d: {} },
], [cand]);
ok(fakeEv[0].roleEvidence.length === 1 && fakeEv[0].roleEvidence[0].kind === "metadata" && fakeEv[0].roleEvidence[0].source === "import", "虚构 fulltext/citation-graph/abstract 证据被剔除，仅保留 metadata:import");
const absCand = { ...cand, abstract: "some abstract", metrics: { citations: { openAlex: 5 } }, enrichment: { title: [], authors: [], year: [], venue: [], abstract: ["openalex"], doi: [], oa: [], citations: { openAlex: 5 } } };
const absEv = normalizeTriage([
  { paperId: cand.canonicalId, role: "core", depth: "deep", evidenceLevel: "abstract", verdict: "读", relationToQuestion: "high", roleReason: "r", worthReading: "w",
    roleEvidence: [
      { kind: "abstract", source: "openalex" },
      { kind: "abstract", source: "crossref" },
      { kind: "citation-graph", source: "openAlex" },
    ], d: {} },
], [absCand]);
ok(absEv[0].roleEvidence.length === 2, "abstract:openalex + citation-graph:openAlex（有真实引用数）保留，abstract:crossref 剔除");

console.log("== v1.3 triage：prompt 显式包含研究问题 ==");
const p1 = buildTriageUserPrompt([cand], "机器人中的 world model");
const p2 = buildTriageUserPrompt([cand], "embodied agents");
ok(p1.includes("机器人中的 world model") && !p1.includes("embodied agents"), "prompt1 含问题1");
ok(p2.includes("embodied agents") && !p2.includes("机器人中的 world model"), "prompt2 含问题2");

console.log("\n结果：" + pass + " 通过 / " + fail + " 失败");
process.exit(fail ? 1 : 0);

