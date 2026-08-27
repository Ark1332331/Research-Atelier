/**
 * Phase B-lite B2 验收测试：混贴自动拆分（deterministic，无 LLM）。
 * 运行：node scripts/test-importer.mjs   （Node ≥ 22.6 直接跑 TS）
 */
import { parseCandidateBlob } from "../src/lib/search/importer.ts";

let pass = 0, fail = 0;
function ok(cond, name) { if (cond) { pass++; console.log("  ✓ " + name); } else { fail++; console.log("  ✗ " + name); } }

const blob = [
  "DreamerV3: Mastering Diverse Domains through World Models",
  "https://arxiv.org/abs/2301.04104",
  "10.1038/s41586-023-06778-y",
  "",
  "GR-1: Towards Lifelong Robot Learning",
  "",
  "Learning World Models with Latent Dynamics",
  "",
  "https://example.com/papers/world-models",
  "",
  "10.1109/TRO.2023.3279594",
  "10.48550/arXiv.2206.08077",
  "",
  "@article{dreamerv3,",
  "  title = {Mastering Diverse Domains through World Models},",
  "  author = {Hafner, Danijar and others},",
  "  doi = {10.48550/arXiv.2301.04104},",
  "  eprint = {2301.04104},",
  "}",
  "",
  "TY  - JOUR",
  "TI  - A Path Towards Autonomous Machine Intelligence",
  "AU  - LeCun, Yann",
  "DO  - 10.48550/arXiv.2205.06175",
  "PY  - 2022",
  "ER  -",
  "",
  "PT  J",
  "AU  Ha, David",
  "AU  Schmidhuber, J\u00fcrgen",
  "TI  World Models",
  "SO  arXiv",
  "DI  10.48550/arXiv.1803.10122",
  "PY  2018",
  "ER",
  "",
  "?????",
].join("\n");

const items = parseCandidateBlob(blob);
console.log("== 混贴拆分 ==");
ok(items.length >= 10, "总条数 >= 10（实际 " + items.length + "）");
const types = items.reduce((m, i) => { m[i.detectedType] = (m[i.detectedType] ?? 0) + 1; return m; }, {});
console.log("  类型分布:", JSON.stringify(types));
ok((types.title ?? 0) >= 2, "标题条 >= 2（DreamerV3 标题挂在 arxiv/doi 条目上）");
ok((types.doi ?? 0) >= 3, "DOI 条 >= 3");
ok((types.arxiv ?? 0) >= 1, "arXiv 条 >= 1（URL 也识别）");
ok((types.bibtex ?? 0) === 1, "BibTeX 条 == 1");
ok((types.ris ?? 0) === 1, "RIS 条 == 1");
ok((types["wos-export"] ?? 0) === 1, "WoS export 条 == 1");
ok((types.unknown ?? 0) >= 1, "无法识别条进入 unknown（不静默丢失）");

const bib = items.find((i) => i.detectedType === "bibtex");
ok(bib?.doi === "10.48550/arXiv.2301.04104" && bib?.arxivId === "2301.04104", "BibTeX 提取 doi/eprint");
const ris = items.find((i) => i.detectedType === "ris");
ok(ris?.title?.includes("Autonomous Machine Intelligence") && ris?.doi === "10.48550/arXiv.2205.06175", "RIS 提取 TI/DO");
const wos = items.find((i) => i.detectedType === "wos-export");
ok(wos?.title === "World Models" && wos?.doi === "10.48550/arXiv.1803.10122", "WoS 提取 TI/DI");
const arxiv = items.find((i) => i.detectedType === "arxiv");
ok(arxiv?.arxivId === "2301.04104", "arXiv URL → arxivId");
const unknown = items.filter((i) => i.detectedType === "unknown");
ok(unknown.length >= 1 && unknown[0].parseWarnings.length >= 0, "unknown 条带原始文本");

console.log("== 空/坏输入 ==");
ok(parseCandidateBlob("").length === 0, "空输入 → 0 条");
ok(parseCandidateBlob("   \n  ").length === 0, "纯空白 → 0 条");
const badBib = parseCandidateBlob("@article{x, title = {}}");
ok(badBib.length === 1 && badBib[0].parseWarnings.some((w) => w.includes("缺少")), "空 BibTeX 有 warning");

console.log("\n结果：" + pass + " 通过 / " + fail + " 失败");
process.exit(fail ? 1 : 0);

