/**
 * Paper Search Step 1 验收测试：src/lib/search/types.ts（纯类型 + 纯函数）。
 * 运行：node scripts/test-search-types.mjs   （Node ≥ 22.6 直接跑 TS）
 * 覆盖（PAPER_SEARCH_IMPLEMENTATION.md §4.1 / §12）：
 *   - 归一化：normalizeDoi / normalizeArxivId / normalizedTitle / canonicalIdFor 优先级
 *   - coverage 语义（v0.2 封板补丁）：完整筛选 = GS 已覆盖 AND WoS 已覆盖；
 *     partial 文案；not-wired（○ 尚未接入）≠ missing（⚠ 未覆盖）≠ 0 命中
 */
import {
  normalizeDoi,
  normalizeArxivId,
  normalizedTitle,
  canonicalIdFor,
  hardSourcesCovered,
  uncoveredHardSources,
  partialRetrievalWarning,
  coverageStatusLabel,
  HARD_SOURCES,
} from "../src/lib/search/types.ts";

let pass = 0, fail = 0;
function ok(cond, name) {
  if (cond) { pass++; console.log("  ✓ " + name); }
  else { fail++; console.log("  ✗ " + name); }
}

console.log("== 1. DOI 归一化 ==");
ok(normalizeDoi("https://doi.org/10.1000/xyz") === "10.1000/xyz", "doi URL 去前缀");
ok(normalizeDoi("https://dx.doi.org/10.1000/xyz") === "10.1000/xyz", "dx.doi.org 前缀");
ok(normalizeDoi("DOI: 10.1000/xyz") === "10.1000/xyz", "DOI: 前缀");
ok(normalizeDoi(undefined) === undefined && normalizeDoi("") === undefined, "空输入 → undefined");

console.log("== 2. arXiv id 归一化 ==");
ok(normalizeArxivId("https://arxiv.org/abs/2206.08077") === "2206.08077", "abs URL");
ok(normalizeArxivId("https://arxiv.org/pdf/2206.08077v3") === "2206.08077v3", "pdf URL 保留版本");
ok(normalizeArxivId("2206.08077.pdf") === "2206.08077", "去 .pdf 后缀");
ok(normalizeArxivId(undefined) === undefined, "空输入 → undefined");

console.log("== 3. 标题归一化 ==");
ok(normalizedTitle("  The World Model  v2 ") === "the world model", "小写/去标点/去版本/去空白");
ok(normalizedTitle("World Models: A Survey") === "world models a survey", "冒号去掉");
ok(normalizedTitle(undefined) === "", "空 → 空串");

console.log("== 4. canonicalId 优先级：DOI > arxivId > normalizedTitle ==");
ok(canonicalIdFor({ doi: "https://doi.org/10.1/a", arxivId: "2206.1", title: "X" }) === "doi:10.1/a", "doi 优先");
ok(canonicalIdFor({ arxivId: "2206.08077", title: "X" }) === "arxiv:2206.08077", "arxiv 次之");
ok(canonicalIdFor({ title: "World Models" }) === "title:world models", "标题兜底");
ok(canonicalIdFor({}) === "", "全空 → 空 canonicalId");
ok(canonicalIdFor({ doi: "https://doi.org/10.1000/xyz", title: "Y" }) === canonicalIdFor({ doi: "10.1000/xyz" }), "同 DOI 不同写法同 key");

console.log("== 5. coverage 完整语义（v0.2 封板补丁） ==");
const full = { googleScholar: "api", webOfScience: "imported", openAlex: "api", semanticScholar: "api", arxiv: "not-wired" };
ok(hardSourcesCovered(full), "GS=api + WoS=imported → 完整覆盖");
ok(partialRetrievalWarning(full) === null, "完整时无部分检索警告");
ok(HARD_SOURCES.length === 2 && HARD_SOURCES.includes("googleScholar") && HARD_SOURCES.includes("webOfScience"), "硬来源 = GS + WoS");

const partial = { googleScholar: "missing", webOfScience: "missing", openAlex: "api", semanticScholar: "api", arxiv: "not-wired" };
ok(!hardSourcesCovered(partial), "GS/WoS 均 missing → 不完整");
const w = partialRetrievalWarning(partial);
ok(w !== null && w.includes("Google Scholar") && w.includes("Web of Science"), "部分检索文案列出两个硬来源");

console.log("== 6. not-wired ≠ missing ≠ 0（v0.2 封板补丁） ==");
ok(coverageStatusLabel("not-wired") === "○ 尚未接入", "not-wired 显示尚未接入");
ok(coverageStatusLabel("missing") === "⚠ 未覆盖", "missing 显示未覆盖");
ok(coverageStatusLabel("api") === "✓ 已检索", "api 显示已检索");
ok(coverageStatusLabel("imported") === "✓ 已导入", "imported 显示已导入");
ok(coverageStatusLabel("not-wired") !== coverageStatusLabel("missing"), "not-wired 与 missing 文案不同（0 命中是第三种语义）");
const unwired = { googleScholar: "not-wired", webOfScience: "not-wired", openAlex: "api", semanticScholar: "not-wired", arxiv: "not-wired" };
ok(!hardSourcesCovered(unwired), "not-wired 也不计为完整");
ok(partialRetrievalWarning(unwired)?.includes("Google Scholar") === true, "not-wired 也触发部分检索标注");
const half = { googleScholar: "api", webOfScience: "missing", openAlex: "api", semanticScholar: "api", arxiv: "not-wired" };
ok(partialRetrievalWarning(half)?.includes("Web of Science") === true && !partialRetrievalWarning(half)?.includes("Google Scholar"), "只缺 WoS 时只列 WoS");
ok(uncoveredHardSources(half).length === 1 && uncoveredHardSources(half)[0].key === "webOfScience", "uncoveredHardSources 只含 webOfScience");

console.log("\n结果：" + pass + " 通过 / " + fail + " 失败");
process.exit(fail ? 1 : 0);

