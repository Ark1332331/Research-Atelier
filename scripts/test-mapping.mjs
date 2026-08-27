/**
 * Step 5 验收测试：Paper↔Code Mapping（归一化 + 校验 + 提议 + 确认/驳回）。
 * 运行：node scripts/test-mapping.mjs   （Node ≥ 22.6 直接跑 TS）
 */
import { normalizeMapping, normalizeMappings, codeRefsInSnapshot, confirmMapping, rejectMapping, proposeMappings } from "../src/lib/mapping.ts";
import { normalizeFacts } from "../src/lib/fact-extract.ts";
import { buildRepositorySnapshot } from "../src/lib/code-reader.ts";

let pass = 0, fail = 0;
function ok(cond, name) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}`); }
}

console.log("== 1. normalizeMapping：relation 枚举 / codeRef 必填 / confidence 三分 ==");
const m1 = normalizeMapping({
  concept: "Multi-scale feature aggregation",
  codeRefs: [{ file: "models/fusion.py", symbol: "MultiScaleFusion", lineStart: 74 }],
  relation: "implements", confidence: "high",
  paperRefs: [{ section: "3.2", page: 4, quote: "multi-scale aggregation" }],
});
ok(m1?.relation === "implements" && m1.confidence === "high" && m1.status === "proposed", "合法 mapping 归一化正确");
ok(m1?.codeRefs[0].file === "models/fusion.py" && m1.paperRefs[0]?.section === "3.2", "codeRef/paperRef 保留");
const mBad = normalizeMapping({ concept: "x", codeRefs: [{ file: "" }], relation: "implements" });
ok(mBad === null, "无有效 codeRef → null（拒绝）");
const mRel = normalizeMapping({ concept: "x", codeRefs: [{ file: "a.py" }], relation: "wat", confidence: "impossible" });
ok(mRel?.relation === "implements" && mRel.confidence === "medium", "坏 relation/confidence 回退默认");
const mEmpty = normalizeMapping({ concept: "", codeRefs: [{ file: "a.py" }] });
ok(mEmpty === null, "空 concept → null");

console.log("== 2. normalizeMappings：去重 + 保留不同 codeRef ==");
const arr = normalizeMappings([
  { concept: "Loss", codeRefs: [{ file: "loss.py" }], relation: "implements" },
  { concept: "Loss", codeRefs: [{ file: "loss.py" }], relation: "implements" }, // 真重复
  { concept: "Loss", codeRefs: [{ file: "models/loss_v2.py" }], relation: "implements" }, // 不同文件 → 保留
]);
ok(arr.length === 2, `去重后 ${arr.length} 条（真重复去，不同文件保留）`);

console.log("== 3. codeRefsInSnapshot：防 AI 编造文件 ==");
const filtered = codeRefsInSnapshot([{ file: "real.py" }, { file: "fake.py" }], ["real.py", "other.py"]);
ok(filtered.length === 1 && filtered[0].file === "real.py", "只保留 snapshot 里真实存在的文件");

console.log("== 4. confirm / reject ==");
const three = normalizeMappings([
  { concept: "A", codeRefs: [{ file: "a.py" }] },
  { concept: "B", codeRefs: [{ file: "b.py" }] },
]);
const confirmed = confirmMapping(three, three[0].id);
ok(confirmed[0].status === "confirmed" && confirmed[1].status === "proposed", "confirm 只改目标条目");
const rejected = rejectMapping(three, three[1].id);
ok(rejected.length === 1 && rejected[0].concept === "A", "reject 移除目标条目");

console.log("== 5. propose（DeepSeek，网络相关；mock 校验 path） ==");
process.env.DEEPSEEK_API_KEY = "mock-key";
// 先 mock fetch 验证：codeRef 必须来自 snapshot，status=proposed
{
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: `[{"concept":"Input preprocessing","codeRefs":[{"file":"datasets/kitti.py","symbol":"build_pipeline"},{"file":"NOT_IN_SNAPSHOT.py"}],"relation":"preprocesses","confidence":"high","paperRefs":[{"section":"4.1"}]}]` } }] }) });
  const snap = { datasets: [{ path: "datasets/kitti.py" }], configs: [{ path: "configs/base.yaml" }] };
  const m = await proposeMappings({ facts: [], snapshot: snap });
  globalThis.fetch = realFetch;
  ok(m.length === 1, "mock 提议 1 条");
  ok(m[0].codeRefs.length === 1 && m[0].codeRefs[0].file === "datasets/kitti.py", "编造文件 NOT_IN_SNAPSHOT.py 被剔除");
  ok(m[0].status === "proposed", "提议不自动确认（用户确认）");
  ok(m[0].relation === "preprocesses", "relation 保留");
}
delete process.env.DEEPSEEK_API_KEY;

console.log("== 6. 真实 NSR propose（DeepSeek） ==");
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
  console.log("  （无 DEEPSEEK_API_KEY，跳过真实提议）");
  ok(true, "跳过（未配置 API key）");
} else {
  // 先抽 NSR 论文事实（网络），再用 IsaacLab snapshot 提议 mapping
  const { extractPaperFacts } = await import("../src/lib/fact-extract.ts");
  const paperDir = "/home/ark/.config/Research Atelier/data/papers/nsr-mt454tqk";
  const names = (await fs.readdir(paperDir)).filter((n) => /^page_\d+\.txt$/.test(n)).sort();
  const pages = [];
  for (const n of names) pages.push(await fs.readFile(path.join(paperDir, n), "utf-8"));
  const { facts } = await extractPaperFacts(pages);
  console.log(`  论文事实 ${facts.length} 条，调 DeepSeek 提议 mapping…`);
  const snap = await buildRepositorySnapshot("/home/ark/projects/IsaacLab");
  const ms = await proposeMappings({ facts, snapshot: snap });
  console.log(`  提议 ${ms.length} 条`);
  ok(ms.every((m) => m.codeRefs.length > 0), "每条都有代码锚点");
  ok(ms.every((m) => m.status === "proposed"), "全部 proposed（等用户确认）");
  for (const m of ms.slice(0, 6)) console.log(`   - ${m.concept} [${m.relation}/${m.confidence}] → ${m.codeRefs.map((c) => c.file).join(", ")}`);
  ok(ms.length > 0, "真实提议返回 mapping");
}

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
