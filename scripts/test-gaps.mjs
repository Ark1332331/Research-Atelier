/**
 * Step 6 验收测试：Gap Detector（确定性）+ Decision Ledger。
 * 运行：node scripts/test-gaps.mjs   （Node ≥ 22.6 直接跑 TS）
 */
import { detectGaps, blockingGaps, resolvableGaps, decisionForGap } from "../src/lib/gap-detector.ts";
import { normalizeFacts } from "../src/lib/fact-extract.ts";

let pass = 0, fail = 0;
function ok(cond, name) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}`); }
}

console.log("== 1. value_conflict：跨侧 normalizedValue 不同 ==");
const f1 = normalizeFacts([
  { key: "training.batch_size", side: "paper", value: 64, status: "observed", source: { kind: "paper", section: "4.1" } },
  { key: "training.batch_size", side: "repo", value: 32, status: "observed", source: { kind: "repo", file: "cfg.yaml", lineStart: 1 } },
]);
const g1 = detectGaps(f1);
ok(g1.some((g) => g.type === "value_conflict" && g.key === "training.batch_size"), "value_conflict 检出（paper 64 vs repo 32）");
const vc = g1.find((g) => g.type === "value_conflict");
ok(vc?.paperNormalized === 64 && vc?.repoNormalized === 32, "normalizedValue 正确（比较依据）");
ok(vc?.blocksReady === true, "required 的 value_conflict → blocksReady");

console.log("== 2. source_conflict：同侧不同来源 ==");
const f2 = normalizeFacts([
  { key: "training.batch_size", side: "paper", value: 64, status: "observed", source: { kind: "paper", section: "4.1" } },
  { key: "training.batch_size", side: "paper", value: 32, status: "observed", source: { kind: "paper", section: "Appendix" } },
]);
const g2 = detectGaps(f2);
ok(g2.some((g) => g.type === "source_conflict" && g.key === "training.batch_size"), "source_conflict 检出（论文 §4.1=64 vs Appendix=32）");
const sc = g2.find((g) => g.type === "source_conflict");
ok(sc?.paperFacts.length === 2, "同侧两个来源都在 gap 里");

console.log("== 3. not_found vs not_scanned（区分，且 not_scanned 不可消解） ==");
const f3 = normalizeFacts([
  { key: "training.seed", side: "paper", value: 42, status: "observed" },
  { key: "training.seed", side: "repo", status: "missing", missingType: "not_found", missingReason: "扫过没找到" },
  { key: "model.loss", side: "paper", value: "BCE", status: "observed" },
  { key: "model.loss", side: "repo", status: "missing", missingType: "not_scanned", missingReason: "未扫描" },
]);
const g3 = detectGaps(f3);
ok(g3.some((g) => g.type === "not_found" && g.key === "training.seed"), "not_found 检出（repo 扫过没找到）");
ok(g3.some((g) => g.type === "not_scanned" && g.key === "model.loss"), "not_scanned 检出（repo 未扫描）");
ok(resolvableGaps(g3).some((g) => g.key === "training.seed"), "not_found 可消解");
ok(!resolvableGaps(g3).some((g) => g.key === "model.loss"), "not_scanned 不可消解（不生成 Decision）");

console.log("== 4. uncomparable：一方无 normalizedValue ==");
const f4 = normalizeFacts([
  { key: "training.optimizer", side: "paper", value: "some custom opt", status: "observed" }, // enum 无法归一化
  { key: "training.optimizer", side: "repo", value: "Adam", status: "observed" },
]);
const g4 = detectGaps(f4);
ok(g4.some((g) => g.type === "uncomparable" && g.key === "training.optimizer"), "uncomparable 检出（paper 无 normalizedValue）");

console.log("== 5. missing_required：两侧都没有 ==");
const g5 = detectGaps(normalizeFacts([]));
ok(g5.some((g) => g.type === "missing_required" && g.key === "training.batch_size"), "required 两侧缺失 → missing_required");

console.log("== 6. blockingGaps：required unresolved 进 Ready 阻塞 ==");
const mixed = detectGaps([
  ...f1, // batch_size value_conflict (required → blocks)
  ...f3, // seed not_found (required → blocks), loss not_scanned (不 block)
  ...normalizeFacts([{ key: "training.seed", side: "paper", value: 7, status: "observed" }]), // seed 其实 paper 有了
]);
const blockers = blockingGaps(mixed);
ok(blockers.some((g) => g.key === "training.batch_size"), "value_conflict 进 blocker");
ok(!blockers.some((g) => g.type === "not_scanned"), "not_scanned 不进 blocker");

console.log("== 7. Decision：引用 gapId + 真实 fact ids，不存裸值 ==");
const vcGap = detectGaps(f1).find((g) => g.type === "value_conflict");
const d = decisionForGap(vcGap);
ok(d.gapId === vcGap.id, "decision 引用 gapId");
ok(JSON.stringify(d.paperFactIds) === JSON.stringify(vcGap.paperFacts.map((f) => f.id)), "decision 引用真实 paperFactIds");
ok(JSON.stringify(d.repoFactIds) === JSON.stringify(vcGap.repoFacts.map((f) => f.id)), "decision 引用真实 repoFactIds");
ok(d.key === "training.batch_size" && d.status === "pending" && d.blocksReady === true, "pending + blocksReady");
ok(d.paperValue === undefined && d.repoValue === undefined, "decision 不存裸值（只有 fact id 引用）");

console.log("== 8. 确定性：同一输入两次 detect 结果一致（LLM 不参与） ==");
const g1b = detectGaps(f1);
ok(JSON.stringify(g1.map((g) => g.id + g.type + g.description)) === JSON.stringify(g1b.map((g) => g.id + g.type + g.description)), "detect 确定性（同输入同输出）");

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
