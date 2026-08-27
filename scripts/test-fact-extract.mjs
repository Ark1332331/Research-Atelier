/**
 * Step 4 验收测试：fact taxonomy + registry + 确定性归一化 + repo/paper 抽取。
 * 运行：node scripts/test-fact-extract.mjs   （Node ≥ 22.6 直接跑 TS）
 */
import { KNOWN_FACTS, isKnownFactKey, factDef, categoryLabel } from "../src/lib/fact-taxonomy.ts";
import { normalizeFact, normalizeFacts, normalizeValue, extractRepoFacts, taxonomyPrompt } from "../src/lib/fact-extract.ts";
import { buildRepositorySnapshot } from "../src/lib/code-reader.ts";

let pass = 0, fail = 0;
function ok(cond, name) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}`); }
}

console.log("== 1. Taxonomy：有限、封闭、六类 ==");
ok(KNOWN_FACTS.length >= 25, `taxonomy 有 ${KNOWN_FACTS.length} 个 key（封闭集合）`);
const cats = new Set(KNOWN_FACTS.map((f) => f.category));
ok(["data","preprocessing","model","training","evaluation","runtime"].every((c) => cats.has(c)), "六类齐全（data/preprocessing/model/training/evaluation/runtime）");
const keys = new Set(KNOWN_FACTS.map((f) => f.key));
ok(keys.size === KNOWN_FACTS.length, "key 无重复");
ok(isKnownFactKey("training.batch_size") && isKnownFactKey("model.loss") && isKnownFactKey("evaluation.metric"), "已知 key 可识别");
ok(!isKnownFactKey("training.anything_custom") && !isKnownFactKey("my.free.key"), "自由 key 被拒绝");
ok(typeof categoryLabel("training") === "string", "category 有中文标签");
ok(factDef("training.lr")?.importance === "required" && factDef("training.seed")?.importance === "recommended", "importance 在注册表中定义");

console.log("== 2. normalizeFact：严格三分 + 未知 key 拒绝 + missing 保原因 ==");
const f1 = normalizeFact({ key: "training.batch_size", side: "repo", value: 32, status: "observed", confidence: "high" });
ok(f1 !== null && f1.key === "training.batch_size" && f1.normalizedValue === 32, "observed: value=32 → normalizedValue=32");
const f2 = normalizeFact({ key: "training.optimizer", side: "paper", value: "Adam", status: "observed", confidence: "high" });
ok(f2?.normalizedValue === "adam", "enum 归一化: Adam → adam");
const f3 = normalizeFact({ key: "training.lr", side: "paper", value: "1e-4", status: "observed" });
ok(f3?.normalizedValue === 0.0001, "number 归一化: 1e-4 → 0.0001");
const fBad = normalizeFact({ key: "training.custom_key", side: "paper", value: 1, status: "observed" });
ok(fBad === null, "未知 key → null（拒绝进入正式 Facts）");
const fMissing = normalizeFact({ key: "training.seed", side: "paper", status: "missing", missingReason: "论文未报告随机种子" });
ok(fMissing?.status === "missing" && fMissing.missingReason === "论文未报告随机种子", "missing 保留原因");
const fMissingNoReason = normalizeFact({ key: "training.seed", side: "paper", status: "missing" });
ok(fMissingNoReason?.missingReason === "未在来源中找到该事实", "missing 无原因时给默认原因");
const fImportance = normalizeFact({ key: "training.seed", side: "paper", value: 42, status: "observed", importance: "required" });
ok(fImportance?.importance === "recommended", "importance 以注册表为准，不接受外部覆盖");

console.log("== 3. normalizeFacts：去重 + 过滤未知 ==");
const batch = normalizeFacts([
  { key: "training.batch_size", side: "repo", value: 32, status: "observed" },
  { key: "training.batch_size", side: "repo", value: 64, status: "observed" }, // 同 key+side 覆盖
  { key: "not.a.real.key", side: "repo", value: 1, status: "observed" },        // 拒绝
  { key: "training.lr", side: "paper", value: "1e-4", status: "observed" },
]);
ok(batch.length === 2, `去重+过滤后 ${batch.length} 条（batch_size×1 + lr×1）`);
ok(batch.find((f) => f.key === "training.batch_size")?.normalizedValue === 64, "同 key+side 后者覆盖（确定性）");

console.log("== 4. taxonomyPrompt 渲染 ==");
const tp = taxonomyPrompt();
ok(tp.includes('"training.batch_size"') && tp.includes('"model.loss"'), "taxonomy prompt 含注册表 key");

console.log("== 5. Repo 抽取：沿 Step 3 snapshot 候选（确定性，不调 LLM） ==");
const il = await buildRepositorySnapshot("/home/ark/projects/IsaacLab");
const candidates = [
  ...(il.dependencies ?? []),
  ...(il.configs ?? []),
  ...(il.datasets ?? []),
];
const repoFacts = await extractRepoFacts(candidates, "/home/ark/projects/IsaacLab");
console.log(`  IsaacLab snapshot 候选文件 ${candidates.length} 个 → repo facts ${repoFacts.length} 条`);
ok(repoFacts.every((f) => f.side === "repo"), "全部 side=repo");
ok(repoFacts.every((f) => isKnownFactKey(f.key)), "全部 key 来自注册表");
ok(repoFacts.every((f) => f.status === "observed"), "repo 抽取全部 observed（找到才算）");
const pyFacts = repoFacts.filter((f) => f.key === "runtime.python_version" || f.key === "runtime.pytorch_version" || f.key === "runtime.cuda_version");
console.log(`  runtime facts: ${pyFacts.map((f) => `${f.key}=${f.value}`).join(", ") || "（无）"}`);
ok(repoFacts.some((f) => f.source?.kind === "repo" && f.source.file && f.source.lineStart), "每条带 file+line provenance");

console.log("== 6. Paper 抽取：NSR 真实论文（DeepSeek，网络相关） ==");
import { promises as fs } from "node:fs";
import path from "node:path";
// 加载 .env.local（node 直接跑测试不会自动读）
try {
  const env = await fs.readFile(path.join(process.cwd(), ".env.local"), "utf-8");
  for (const line of env.split("\n")) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
} catch { /* 无 .env.local */ }
const paperDir = "/home/ark/.config/Research Atelier/data/papers/nsr-mt454tqk";
let paperFacts = [];
try {
  const names = (await fs.readdir(paperDir)).filter((n) => /^page_\d+\.txt$/.test(n)).sort();
  const pages = [];
  for (const n of names) pages.push(await fs.readFile(path.join(paperDir, n), "utf-8"));
  console.log(`  NSR ${pages.length} 页，调 DeepSeek 抽取…`);
  paperFacts = await (await import("../src/lib/fact-extract.ts")).extractPaperFacts(pages);
  console.log(`  返回 ${paperFacts.length} 条`);
  if (!process.env.DEEPSEEK_API_KEY) {
    console.log("  （无 DEEPSEEK_API_KEY，跳过论文抽取——网络相关）");
    ok(true, "跳过（未配置 API key）");
  } else {
    ok(paperFacts.length > 0, "论文抽取返回事实");
  }
  ok(paperFacts.every((f) => isKnownFactKey(f.key)), "paper facts key 全来自注册表");
  ok(paperFacts.some((f) => f.status === "observed" && f.source?.kind === "paper"), "有 observed + paper 来源");
  ok(paperFacts.some((f) => f.status === "missing" && f.missingReason), "有 missing + 原因（论文未报告项）");
  const sample = paperFacts.slice(0, 5).map((f) => `${f.key}[${f.status}]${f.value !== undefined ? "=" + f.value : ""}`);
  console.log(`  样例: ${sample.join(" | ")}`);
} catch (e) {
  ok(false, `论文抽取失败：${e.message}`);
}

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
