/**
 * Step 6 验收测试（resolution-chain hardening）：fixed-point engine + effective view + Decision 生命周期。
 * 运行：node scripts/test-gaps.mjs   （Node ≥ 22.6 直接跑 TS）
 */
import { detectGaps, blockingGaps, resolvableGaps, decisionForGap, isDecisionStale, resolveToFixedPoint, detectWithDecisions, gapFingerprint, resolvedFactId } from "../src/lib/gap-detector.ts";
import { normalizeFacts } from "../src/lib/fact-extract.ts";

let pass = 0, fail = 0;
function ok(cond, name) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}`); }
}

console.log("== 1. 基础六类 + 两侧 source conflict ==");
const f1 = normalizeFacts([
  { key: "training.batch_size", side: "paper", value: 64, status: "observed", source: { kind: "paper", section: "4.1" } },
  { key: "training.batch_size", side: "repo", value: 32, status: "observed", source: { kind: "repo", file: "cfg.yaml", lineStart: 1 } },
]);
const g1 = detectGaps(f1);
ok(g1.some((g) => g.type === "value_conflict"), "value_conflict");
const f2 = normalizeFacts([
  { key: "training.batch_size", side: "paper", value: 64, status: "observed", source: { kind: "paper", section: "4.1" } },
  { key: "training.batch_size", side: "paper", value: 32, status: "observed", source: { kind: "paper", section: "Appendix" } },
  { key: "training.batch_size", side: "repo", value: 48, status: "observed", source: { kind: "repo", file: "a.yaml" } },
  { key: "training.batch_size", side: "repo", value: 16, status: "observed", source: { kind: "repo", file: "b.yaml" } },
]);
const g2 = detectGaps(f2);
ok(g2.filter((g) => g.type === "source_conflict" && g.id.includes("-paper")).length === 1, "paper source conflict");
ok(g2.filter((g) => g.type === "source_conflict" && g.id.includes("-repo")).length === 1, "repo source conflict 也报告");
ok(g2.find((g) => g.type === "source_conflict" && g.id.includes("-paper")).paperFacts.length === 2, "保留全部候选（2 个）");

console.log("== 2. not_scanned 阻塞 but 不可 Decision；完全 absent → not_scanned ==");
const f3 = normalizeFacts([
  { key: "model.loss", side: "paper", value: "BCE", status: "observed" },
  { key: "model.loss", side: "repo", status: "missing", missingType: "not_scanned", missingReason: "未扫描" },
]);
const g3 = detectGaps(f3);
const ns = g3.find((g) => g.type === "not_scanned");
ok(Boolean(ns) && ns.blocksReady === true, "required not_scanned → blocksReady");
ok(!resolvableGaps(g3).some((g) => g.type === "not_scanned"), "not_scanned 不可 Decision 消解");
ok(blockingGaps(g3).some((g) => g.type === "not_scanned"), "not_scanned 阻塞 Ready");
const fAbsent = normalizeFacts([{ key: "training.batch_size", side: "paper", value: 64, status: "observed" }]);
const gAbsent = detectGaps(fAbsent);
const absentGap = gAbsent.find((g) => g.key === "training.batch_size");
ok(absentGap?.type === "not_scanned", "完全 absent → not_scanned（无扫描证据，不判 not_found）");
ok(absentGap?.blocksReady === true && !resolvableGaps([absentGap]).length, "absent not_scanned 阻塞且不可 Decision");

console.log("== 3. fixed-point：source_conflict 选 32 → 新 value_conflict → 第二层 Decision → 最终无 blocker ==");
const fChain = normalizeFacts([
  { key: "training.batch_size", side: "paper", value: 64, status: "observed", source: { kind: "paper", section: "4.1" } },
  { key: "training.batch_size", side: "paper", value: 32, status: "observed", source: { kind: "paper", section: "Appendix" } },
  { key: "training.batch_size", side: "repo", value: 64, status: "observed", source: { kind: "repo", file: "r.yaml" } },
]);
const rawChain = detectGaps(fChain);
const scChain = rawChain.find((g) => g.type === "source_conflict" && g.id.includes("-paper"));
const chosen32 = scChain.paperFacts.find((f) => f.normalizedValue === 32);
const d1 = { ...decisionForGap(scChain), status: "accepted", choice: { kind: "fact", factId: chosen32.id } };
const rp1 = resolveToFixedPoint(fChain, [d1]);
ok(rp1.applied.includes(d1.id), "第一层 decision 已应用");
ok(rp1.finalGaps.some((g) => g.type === "value_conflict"), "fixed-point 后暴露新 value_conflict");
const vcChain = rp1.finalGaps.find((g) => g.type === "value_conflict");
const d2 = { ...decisionForGap(vcChain), status: "accepted", choice: { kind: "fact", factId: vcChain.repoFacts[0].id } };
const rp2 = resolveToFixedPoint(fChain, [d1, d2]);
ok(rp2.applied.includes(d1.id) && rp2.applied.includes(d2.id), "两层 decision 都应用（fixed-point 链式）");
ok(!rp2.finalGaps.some((g) => g.key === "training.batch_size" && g.blocksReady), "第二层消解后该 key 无 blocker");

console.log("== 4. 确定性：重复 resolve effective Fact IDs 完全一致 ==");
const rpA = resolveToFixedPoint(fChain, [d1, d2]);
const rpB = resolveToFixedPoint(fChain, [d1, d2]);
ok(JSON.stringify(rpA.effectiveFacts.map((f) => f.id).sort()) === JSON.stringify(rpB.effectiveFacts.map((f) => f.id).sort()), "重复 resolve → effective Fact IDs 完全一致");
ok(resolvedFactId("training.batch_size", "fp123", "repo") === resolvedFactId("training.batch_size", "fp123", "repo"), "resolvedFactId 确定性");

console.log("== 5. custom choice 真实生效（source_conflict 侧生成 resolved fact + 跨侧比较） ==");
const dCustom = { ...decisionForGap(scChain), status: "accepted", choice: { kind: "custom", value: 48 } };
const rpC = resolveToFixedPoint(fChain, [dCustom]);
ok(rpC.applied.includes(dCustom.id), "custom decision 应用（不'accept 但无效果'）");
ok(rpC.effectiveFacts.some((f) => f.key === "training.batch_size" && f.side === "paper" && f.source?.kind === "user" && f.normalizedValue === 48), "paper 侧生成 custom resolved fact（48）");
ok(rpC.finalGaps.some((g) => g.type === "value_conflict" && g.key === "training.batch_size"), "custom 后继续跨侧比较 → 新 value_conflict");

console.log("== 6. 证据变化 → Decision stale；stale 后可 re-propose 新 fingerprint Decision ==");
const newFacts = normalizeFacts([
  { key: "training.batch_size", side: "paper", value: 64, status: "observed", source: { kind: "paper", section: "4.1" } },
  { key: "training.batch_size", side: "repo", value: 128, status: "observed", source: { kind: "repo", file: "cfg.yaml", lineStart: 1 } },
]);
const gNew = detectGaps(newFacts);
ok(isDecisionStale(d1, gNew) === true, "fact 变化 → decision stale");
const fresh = decisionForGap(gNew.find((g) => g.type === "value_conflict"));
ok(fresh.gapFingerprint !== d1.gapFingerprint, "re-propose 得到新 fingerprint Decision");
const rpNew = resolveToFixedPoint(newFacts, [d1, { ...fresh, status: "accepted", choice: { kind: "fact", factId: newFacts.find((f) => f.side === "repo").id } }]);
ok(rpNew.applied.includes(fresh.id), "新 decision 应用（stale 旧 decision 被跳过）");
ok(!rpNew.stale.includes(fresh.id), "新 decision 非 stale");

console.log("== 7. fact choice 不能选 missing marker；accept 无 choice ==");
const fMissing = normalizeFacts([
  { key: "training.seed", side: "paper", value: 42, status: "observed" },
  { key: "training.seed", side: "repo", status: "missing", missingType: "not_found", missingReason: "扫过没找到" },
]);
const gMissing = detectGaps(fMissing);
const nf = gMissing.find((g) => g.type === "not_found");
const missingMarker = nf.repoFacts.find((f) => f.status === "missing");
const badChoice = { ...decisionForGap(nf), status: "accepted", choice: { kind: "fact", factId: missingMarker.id } }; // 选 missing marker
const rpBad = resolveToFixedPoint(fMissing, [badChoice]);
ok(!rpBad.applied.includes(badChoice.id), "选 missing marker 的 decision 不应用（无效）");
const dNoChoice = decisionForGap(nf);
ok(dNoChoice.choice === undefined, "pending 无 choice（accept 必须提供）");

console.log("== 8. missing_required 不可消解 ==");
const gMR = detectGaps(normalizeFacts([]));
ok(!resolvableGaps(gMR).some((g) => g.type === "missing_required"), "missing_required 不可 Decision 消解");

console.log("== 9. 回归：stale accepted decision 不隐藏新 gap（②） ==");
const fR1 = normalizeFacts([
  { key: "training.lr", side: "paper", value: "1e-4", status: "observed", source: { kind: "paper", section: "4.1" } },
  { key: "training.lr", side: "repo", value: "1e-4", status: "observed", source: { kind: "repo", file: "cfg.yaml" } },
]);
const gR1 = detectGaps(fR1);
ok(!gR1.some((g) => g.key === "training.lr" && g.type === "value_conflict"), "同值无冲突（基线）");
const fR2 = normalizeFacts([
  { key: "training.lr", side: "paper", value: "1e-4", status: "observed", source: { kind: "paper", section: "4.1" } },
  { key: "training.lr", side: "repo", value: "5e-4", status: "observed", source: { kind: "repo", file: "cfg.yaml" } },
]);
const gR2 = detectGaps(fR2);
const vcR2 = gR2.find((g) => g.type === "value_conflict" && g.key === "training.lr");
ok(Boolean(vcR2), "repo 值改变 → 新 value_conflict 出现");
const oldDec = { ...decisionForGap(vcR2), gapFingerprint: "old-fingerprint", status: "accepted", choice: { kind: "fact", factId: fR2.find((f) => f.side === "paper").id } };
const { effectiveGaps: effR2 } = detectWithDecisions(fR2, [oldDec]);
ok(effR2.some((g) => g.key === "training.lr" && g.type === "value_conflict"), "stale decision 不隐藏重新出现的冲突（effective 仍含）");

console.log("== 10. 回归：repo 值改动后旧自动 fact 不污染当前 view（③ replace 语义） ==");
const run1 = [
  { key: "training.lr", side: "paper", value: "1e-4", status: "observed", runId: "run-1" },
  { key: "training.lr", side: "repo", value: "1e-4", status: "observed", runId: "run-1" },
];
const run2 = [
  { key: "training.lr", side: "paper", value: "1e-4", status: "observed", runId: "run-2" },
  { key: "training.lr", side: "repo", value: "5e-4", status: "observed", runId: "run-2" },
];
const userF = normalizeFacts([{ key: "training.seed", side: "paper", value: 42, status: "observed", source: { kind: "user", note: "user" } }]);
const currentView = [...userF, ...normalizeFacts(run2)];
ok(currentView.filter((f) => f.runId === "run-1").length === 0, "旧 run 事实不在当前 view（replace 未污染）");
ok(currentView.some((f) => f.source?.kind === "user"), "user 事实保留");
const gCur = detectGaps(currentView);
ok(gCur.some((g) => g.type === "value_conflict" && g.key === "training.lr"), "当前 view 反映 run2 冲突");

console.log("== 11. 回归：paper not_found/not_scanned/ambiguous/not_applicable 保留（④） ==");
const fMiss = normalizeFacts([
  { key: "training.batch_size", side: "paper", value: 64, status: "observed" },
  { key: "training.batch_size", side: "repo", status: "missing", missingType: "not_found", missingReason: "扫过没找到" },
  { key: "model.loss", side: "paper", value: "BCE", status: "observed" },
  { key: "model.loss", side: "repo", status: "missing", missingType: "not_scanned", missingReason: "未扫描" },
  { key: "training.seed", side: "paper", value: 42, status: "observed" },
  { key: "training.seed", side: "repo", status: "missing", missingType: "ambiguous", missingReason: "两处不同" },
  { key: "data.dataset_name", side: "paper", value: "KITTI", status: "observed" },
  { key: "data.dataset_name", side: "repo", status: "missing", missingType: "not_applicable", missingReason: "不适用" },
]);
const gMiss = detectGaps(fMiss);
ok(gMiss.some((g) => g.key === "training.batch_size" && g.type === "not_found"), "not_found 保留 → gap not_found");
ok(gMiss.some((g) => g.key === "model.loss" && g.type === "not_scanned"), "not_scanned 保留 → gap not_scanned（不可 Decision）");
ok(gMiss.some((g) => g.key === "training.seed" && g.type === "source_conflict"), "ambiguous 保留 → gap source_conflict");
ok(!gMiss.some((g) => g.key === "data.dataset_name"), "not_applicable → 不报 gap");

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
