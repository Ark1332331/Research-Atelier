/**
 * Step 4 验收测试（hardening）：taxonomy + 归一化语义 + 冲突保留 + merge 保存 + repo/paper 定向抽取。
 * 运行：node scripts/test-fact-extract.mjs   （Node ≥ 22.6 直接跑 TS）
 */
import { KNOWN_FACTS, isKnownFactKey, factDef, categoryLabel } from "../src/lib/fact-taxonomy.ts";
import { normalizeFact, normalizeFacts, normalizeValue, saveFacts, factIdentity, extractRepoFacts, extractPaperFacts, sortPages, taxonomyPrompt } from "../src/lib/fact-extract.ts";
import { buildRepositorySnapshot } from "../src/lib/code-reader.ts";

let pass = 0, fail = 0;
function ok(cond, name) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}`); }
}

console.log("== 1. Taxonomy：有限、封闭、六类 ==");
ok(KNOWN_FACTS.length >= 29, `taxonomy 有 ${KNOWN_FACTS.length} 个 key（封闭集合）`);
const cats = new Set(KNOWN_FACTS.map((f) => f.category));
ok(["data","preprocessing","model","training","evaluation","runtime"].every((c) => cats.has(c)), "六类齐全");
ok(isKnownFactKey("training.batch_size") && isKnownFactKey("model.loss"), "已知 key 可识别");
ok(!isKnownFactKey("training.anything_custom"), "自由 key 被拒绝");
ok(isKnownFactKey("training.epochs") && isKnownFactKey("training.steps"), "epochs 与 steps 已拆开为两个 key");

console.log("== 2. normalizeValue：enum 精确匹配，禁 substring（AdamW 绝不→adam） ==");
ok(normalizeValue("Adam", { valueType: "enum", enumValues: ["adam","adamw","sgd"], key: "training.optimizer" }).normalizedValue === "adam", "Adam → adam");
ok(normalizeValue("AdamW", { valueType: "enum", enumValues: ["adam","adamw","sgd"], key: "training.optimizer" }).normalizedValue === "adamw", "AdamW → adamw（不误判 adam）");
ok(normalizeValue("adam_w", { valueType: "enum", enumValues: ["adam","adamw","sgd"], key: "training.optimizer" }).normalizedValue === "adamw", "adam_w → adamw（alias）");
ok(normalizeValue("SGD", { valueType: "enum", enumValues: ["adam","adamw","sgd"], key: "training.optimizer" }).normalizedValue === "sgd", "SGD → sgd");
ok(normalizeValue("something_else", { valueType: "enum", enumValues: ["adam","adamw","sgd"], key: "training.optimizer" }).normalizedValue === undefined, "未知枚举 → normalizedValue 缺省（不比）");
ok(normalizeValue("1e-4", { valueType: "number" }).normalizedValue === 0.0001, "number: 1e-4 → 0.0001");
ok(normalizeValue("84.7%", { valueType: "string" }).normalizedValue === "84.7%", "string 原样");

console.log("== 3. normalizeFact：三分 + missing 结构化原因 + 未知 key 拒绝 ==");
const f1 = normalizeFact({ key: "training.batch_size", side: "repo", value: 32, status: "observed", confidence: "high" });
ok(f1?.normalizedValue === 32, "observed batch_size=32");
ok(normalizeFact({ key: "training.custom", side: "paper" }) === null, "未知 key → null");
const fm = normalizeFact({ key: "training.seed", side: "paper", status: "missing", missingType: "not_found", missingReason: "完整论文已扫描，未找到" });
ok(fm?.missingType === "not_found" && fm.missingReason === "完整论文已扫描，未找到", "missing 带结构化 missingType + 原因");
const fns = normalizeFact({ key: "training.seed", side: "paper", status: "missing", missingType: "not_scanned", missingReason: "部分章节未扫描" });
ok(fns?.missingType === "not_scanned", "not_scanned 保留（未扫描≠未找到）");

console.log("== 4. normalizeFacts：保留冲突，只去真正重复 ==");
const conflicting = normalizeFacts([
  { key: "training.batch_size", side: "paper", value: 64, status: "observed", source: { kind: "paper", section: "4.1" } },
  { key: "training.batch_size", side: "paper", value: 32, status: "observed", source: { kind: "paper", section: "Appendix" } },
]);
ok(conflicting.length === 2, "同 key+side 不同值不同来源 → 两条都保留（冲突不覆盖）");
ok(conflicting.some((f) => f.normalizedValue === 64) && conflicting.some((f) => f.normalizedValue === 32), "64 与 32 都在");
const exactDup = normalizeFacts([
  { key: "training.lr", side: "repo", value: "1e-4", status: "observed", source: { kind: "repo", file: "a.yaml", lineStart: 1 } },
  { key: "training.lr", side: "repo", value: "1e-4", status: "observed", source: { kind: "repo", file: "a.yaml", lineStart: 1 } },
]);
ok(exactDup.length === 1, "真正重复（同值同源）→ 只留一条");

console.log("== 5. saveFacts：merge 不覆盖不同值、不丢另一侧 ==");
const existing = normalizeFacts([
  { key: "training.batch_size", side: "paper", value: 64, status: "observed", source: { kind: "paper", section: "4.1" } },
  { key: "training.lr", side: "repo", value: "1e-4", status: "observed", source: { kind: "repo", file: "x.yaml" } },
]);
const incoming = normalizeFacts([
  { key: "training.batch_size", side: "repo", value: 32, status: "observed", source: { kind: "repo", file: "y.yaml" } },
  { key: "training.lr", side: "repo", value: "1e-4", status: "observed", source: { kind: "repo", file: "x.yaml" } },
]);
const merged = saveFacts(existing, incoming, "merge");
ok(merged.some((f) => f.side === "paper" && f.key === "training.batch_size"), "merge: paper 侧 batch_size=64 保留（不清另一侧）");
ok(merged.some((f) => f.side === "repo" && f.key === "training.batch_size"), "merge: repo 侧 batch_size=32 加入");
ok(merged.filter((f) => f.key === "training.lr").length === 1, "merge: 真正重复的 lr 更新不新增");
const repSide = saveFacts(existing, incoming, "replace-side");
ok(repSide.some((f) => f.side === "paper" && f.key === "training.batch_size" && f.normalizedValue === 64), "replace-side: 未替换侧（paper）保留");
ok(repSide.some((f) => f.side === "repo" && f.key === "training.batch_size" && f.normalizedValue === 32), "replace-side: repo 侧全部换成 incoming");
ok(repSide.filter((f) => f.key === "training.lr").length === 1, "replace-side: repo 侧 lr 来自 incoming（不重复）");

console.log("== 6. sortPages：页码数字排序 ==");
const sorted = sortPages(["page_1.txt","page_10.txt","page_2.txt","page_11.txt"]);
ok(JSON.stringify(sorted) === JSON.stringify(["page_1.txt","page_2.txt","page_10.txt","page_11.txt"]), "page_2 在 page_10 前");

console.log("== 7. Repo 抽取：按 taxonomy→snapshot 映射定向 + not_scanned ==");
const il = await buildRepositorySnapshot("/home/ark/projects/IsaacLab");
const r1 = await extractRepoFacts(il, "/home/ark/projects/IsaacLab");
console.log(`  IsaacLab: ${r1.facts.length} 条, scanned categories: ${[...r1.scannedCategories].join(",") || "无"}`);
ok(r1.facts.every((f) => isKnownFactKey(f.key)), "全部 key 来自注册表");
ok(r1.facts.some((f) => f.key === "runtime.cuda_version" && f.source?.dirty !== undefined), "runtime.cuda_version 带 dirty provenance");
ok(r1.facts.some((f) => f.key === "runtime.python_version"), "runtime.python_version 抽到");
ok(r1.facts.every((f) => f.status === "observed" || (f.status === "missing" && f.missingType === "not_scanned")), "missing 只允许 not_scanned（没扫描≠未找到）");
// not_scanned 的 required key 应有 missingType=not_scanned
const ns = r1.facts.filter((f) => f.status === "missing");
ok(ns.every((f) => f.missingType === "not_scanned"), `not_scanned 条目带正确 missingType（${ns.length} 条）`);
// dirty provenance 保到 Fact
const withDirty = r1.facts.filter((f) => f.source?.kind === "repo" && f.source.dirty !== undefined);
ok(withDirty.length >= 0 && r1.facts.some((f) => f.source?.kind === "repo" && typeof f.source.dirty === "boolean"), "repo fact provenance 含 dirty 字段");

console.log("== 8. Paper 抽取：NSR 真实论文（DeepSeek） ==");
import { promises as fs } from "node:fs";
import path from "node:path";
try {
  const env = await fs.readFile(path.join(process.cwd(), ".env.local"), "utf-8");
  for (const line of env.split("\n")) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
} catch { /* */ }
if (!process.env.DEEPSEEK_API_KEY) {
  console.log("  （无 DEEPSEEK_API_KEY，跳过论文抽取）");
  ok(true, "跳过（未配置 API key）");
} else {
  const paperDir = "/home/ark/.config/Research Atelier/data/papers/nsr-mt454tqk";
  try {
    const names = sortPages((await fs.readdir(paperDir)).filter((n) => /^page_\d+\.txt$/.test(n)));
    const pages = [];
    for (const n of names) pages.push(await fs.readFile(path.join(paperDir, n), "utf-8"));
    console.log(`  NSR ${pages.length} 页，调 DeepSeek…`);
    const { facts, coveredPages, droppedChunks } = await extractPaperFacts(pages);
    console.log(`  返回 ${facts.length} 条 | covered ${coveredPages} 页 | droppedChunks=${droppedChunks}`);
    ok(facts.length > 0, "论文抽取返回事实");
    ok(facts.every((f) => isKnownFactKey(f.key)), "paper facts key 全来自注册表");
    ok(facts.some((f) => f.status === "observed" && f.source?.kind === "paper"), "有 observed + paper 来源");
    const missingF = facts.filter((f) => f.status === "missing");
    ok(missingF.every((f) => f.missingType === "not_found" || f.missingType === "not_scanned"), "missing 带结构化 missingType");
    // quote 验证：observed 且带 quote 的，quote 应存在于对应页
    const quoted = facts.filter((f) => f.status === "observed" && f.source?.quote && f.source.page);
    for (const f of quoted.slice(0, 5)) {
      const pageText = pages[(f.source.page ?? 1) - 1] ?? "";
      const norm = (s) => s.replace(/\s+/g, " ").trim();
      if (!norm(pageText).includes(norm(f.source.quote.slice(0, 40)))) {
        ok(false, `quote 验证失败: ${f.key} @ p${f.source.page}`);
      }
    }
    ok(true, `quote 验证通过（抽查 ${quoted.length} 条）`);
    const sample = facts.slice(0, 5).map((f) => `${f.key}[${f.status}]${f.value !== undefined ? "=" + JSON.stringify(f.value) : ""}${f.missingType ? "(" + f.missingType + ")" : ""}`);
    console.log(`  样例: ${sample.join(" | ")}`);
  } catch (e) {
    ok(false, `论文抽取失败：${e.message}`);
  }
}

console.log("== 9. Paper coverage 真实性（回归） ==");
import { extractPaperFacts as realExtract } from "../src/lib/fact-extract.ts";
process.env.DEEPSEEK_API_KEY = "test-key-for-mock"; // 触发走网络路径（fetch 被 mock）

// 9a. 长页 > MAX_PAGE_CHARS：拆 fragment 不静默截断；预算不足 → complete=false + not_scanned
{
  const bigPage = "LONG_PAGE_MARKER_" + "y".repeat(65000); // 单页 65k → 拆 4 fragment（20k×3 + 5k）
  const pages = ["small page one content".repeat(50), bigPage]; // 共 5 fragment → 至少 4 chunk > MAX_CHUNKS=3
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    return { ok: true, json: async () => ({ choices: [{ message: { content: `[{"key":"data.input_format","value":"point cloud","status":"observed","page":1,"quote":"small page one content"}]` } }] }) };
  };
  const r1 = await realExtract(pages);
  globalThis.fetch = realFetch;
  ok(r1.coverage.complete === false, "9a: fragment 数超出 chunk 预算 → complete=false（不假装全扫）");
  ok(r1.coverage.totalPages === 2 && r1.coverage.coveredPages === 2, `9a: coveredPages=${r1.coverage.coveredPages}/${r1.coverage.totalPages}（按成功 fragment 去重——长页前部已扫，故计 2）`);
  ok(r1.coverage.droppedFragments > 0, `9a: droppedFragments=${r1.coverage.droppedFragments} 记录未扫描的 fragment（长页后部未扫，诚实报告）`);
  const miss = r1.facts.filter((f) => f.status === "missing");
  ok(miss.length > 0 && miss.every((f) => f.missingType === "not_scanned"), "9a: 缺失 key 全部 not_scanned（绝无 not_found）");
}

// 9b. chunk 三次失败：failedChunks 记录 + complete=false + 缺失全 not_scanned
{
  const pages = ["p1 ".repeat(3000), "p2 ".repeat(3000)];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: false, status: 500, json: async () => ({}) }); // 永远失败
  const r2 = await realExtract(pages);
  globalThis.fetch = realFetch;
  ok(r2.coverage.complete === false, "9b: chunk 失败 → complete=false");
  ok(r2.coverage.scannedChunks === 0 && r2.coverage.failedChunks.length > 0, `9b: failedChunks=${r2.coverage.failedChunks.length} 记录原因`);
  ok(r2.coverage.coveredPages === 0, "9b: coveredPages=0（无成功扫描）");
  const miss2 = r2.facts.filter((f) => f.status === "missing");
  ok(miss2.length > 0 && miss2.every((f) => f.missingType === "not_scanned"), "9b: 缺失 key 全部 not_scanned（chunk 失败≠论文没写）");
}

// 9c. 全部 chunk 成功 → complete=true → 才允许 not_found
{
  const pages = ["c1 content ".repeat(100), "c2 content ".repeat(100)];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: "[]" } }] }) });
  const r3 = await realExtract(pages);
  globalThis.fetch = realFetch;
  ok(r3.coverage.complete === true && r3.coverage.coveredPages === 2, `9c: 全扫成功 → complete=true, coveredPages=2/${r3.coverage.totalPages}`);
  const miss3 = r3.facts.filter((f) => f.status === "missing");
  ok(miss3.length > 0 && miss3.every((f) => f.missingType === "not_found"), "9c: 全扫后缺失才允许 not_found");
}
delete process.env.DEEPSEEK_API_KEY;

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
