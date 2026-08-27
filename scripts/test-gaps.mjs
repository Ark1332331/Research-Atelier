/**
 * Step 6 验收测试（resolution hardening）：确定性 Gap + effective view + Decision 生命周期。
 * 运行：node scripts/test-gaps.mjs   （Node ≥ 22.6 直接跑 TS）
 */
import { detectGaps, blockingGaps, resolvableGaps, decisionForGap, isDecisionStale, applyDecisions, detectWithDecisions, gapFingerprint } from "../src/lib/gap-detector.ts";
import { normalizeFacts } from "../src/lib/fact-extract.ts";

let pass = 0, fail = 0;
function ok(cond, name) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}`); }
}

console.log("== 1. value_conflict / source_conflict / not_found / not_scanned / uncomparable / missing_required ==");
const f1 = normalizeFacts([
  { key: "training.batch_size", side: "paper", value: 64, status: "observed", source: { kind: "paper", section: "4.1" } },
  { key: "training.batch_size", side: "repo", value: 32, status: "observed", source: { kind: "repo", file: "cfg.yaml", lineStart: 1 } },
]);
const g1 = detectGaps(f1);
ok(g1.some((g) => g.type === "value_conflict" && g.key === "training.batch_size"), "value_conflict（paper 64 vs repo 32）");
const f2 = normalizeFacts([
  { key: "training.batch_size", side: "paper", value: 64, status: "observed", source: { kind: "paper", section: "4.1" } },
  { key: "training.batch_size", side: "paper", value: 32, status: "observed", source: { kind: "paper", section: "Appendix" } },
  { key: "training.batch_size", side: "repo", value: 48, status: "observed", source: { kind: "repo", file: "a.yaml" } },
  { key: "training.batch_size", side: "repo", value: 16, status: "observed", source: { kind: "repo", file: "b.yaml" } },
]);
const g2 = detectGaps(f2);
const scPaper = g2.filter((g) => g.type === "source_conflict" && g.id.includes("-paper"));
const scRepo = g2.filter((g) => g.type === "source_conflict" && g.id.includes("-repo"));
ok(scPaper.length === 1 && scRepo.length === 1, "两侧 source conflict 都报告（paper 与 repo）");
ok(scPaper[0]?.paperFacts.length === 2, "paper source conflict 保留全部候选（2 个）");
ok(scRepo[0]?.repoFacts.length === 2, "repo source conflict 保留全部候选（2 个）");

console.log("== 2. not_scanned 阻塞 but 不可 Decision 消解 ==");
const f3 = normalizeFacts([
  { key: "training.seed", side: "paper", value: 42, status: "observed" },
  { key: "training.seed", side: "repo", status: "missing", missingType: "not_found", missingReason: "扫过没找到" },
  { key: "model.loss", side: "paper", value: "BCE", status: "observed" },
  { key: "model.loss", side: "repo", status: "missing", missingType: "not_scanned", missingReason: "未扫描" },
]);
const g3 = detectGaps(f3);
const ns = g3.find((g) => g.type === "not_scanned");
ok(Boolean(ns) && ns.blocksReady === true, "required not_scanned → blocksReady=true（Ready blocker）");
ok(!resolvableGaps(g3).some((g) => g.type === "not_scanned"), "not_scanned 不在 resolvable（不可 Decision 消解）");
ok(blockingGaps(g3).some((g) => g.type === "not_scanned"), "not_scanned 在 blocking（阻塞 Ready）");

console.log("== 3. 单侧完全 absent → not_found；ambiguous → source_conflict；not_applicable 不报 ==");
const fAbsent = normalizeFacts([
  { key: "training.batch_size", side: "paper", value: 64, status: "observed" }, // repo 侧完全没有该 key
]);
const gAbsent = detectGaps(fAbsent);
ok(gAbsent.some((g) => g.type === "not_found" && g.key === "training.batch_size"), "一侧有值、另一侧完全 absent → not_found");
const fAmb = normalizeFacts([
  { key: "training.seed", side: "paper", value: 42, status: "observed" },
  { key: "training.seed", side: "repo", status: "missing", missingType: "ambiguous", missingReason: "repo 有两处不同值" },
]);
const gAmb = detectGaps(fAmb);
ok(gAmb.some((g) => g.type === "source_conflict" && g.key === "training.seed"), "ambiguous → source_conflict（需判定）");
const fNA = normalizeFacts([
  { key: "data.dataset_name", side: "paper", value: "KITTI", status: "observed" },
  { key: "data.dataset_name", side: "repo", status: "missing", missingType: "not_applicable", missingReason: "代码不下载数据" },
]);
ok(!detectGaps(fNA).some((g) => g.key === "data.dataset_name"), "not_applicable → 不报 gap");

console.log("== 4. effective view：source_conflict 选 32 后产生新跨侧 conflict（不假 Ready） ==");
// paper{64,32} + repo{64}：选 paper 32 → effective: paper 32 vs repo 64 → value_conflict 新 gap
const f4 = normalizeFacts([
  { key: "training.batch_size", side: "paper", value: 64, status: "observed", source: { kind: "paper", section: "4.1" } },
  { key: "training.batch_size", side: "paper", value: 32, status: "observed", source: { kind: "paper", section: "Appendix" } },
  { key: "training.batch_size", side: "repo", value: 64, status: "observed", source: { kind: "repo", file: "r.yaml" } },
]);
const rawG4 = detectGaps(f4);
const scG4 = rawG4.find((g) => g.type === "source_conflict" && g.id.includes("-paper"));
const chosen32 = scG4.paperFacts.find((f) => f.normalizedValue === 32);
const dec4 = { ...decisionForGap(scG4), status: "accepted", choice: { kind: "fact", factId: chosen32.id } };
const eff4 = applyDecisions(f4, [dec4], rawG4);
const g4eff = detectGaps(eff4);
ok(g4eff.some((g) => g.type === "value_conflict" && g.key === "training.batch_size"), "选 paper=32 后 → effective 产生新 value_conflict（paper 32 vs repo 64），不假 Ready");
ok(!g4eff.some((g) => g.type === "source_conflict"), "同侧 source conflict 已解决（effective 中消失）");

console.log("== 5. accept decision 后 blocker 真消失（value_conflict 收敛） ==");
const dec5 = { ...decisionForGap(g1[0]), status: "accepted", choice: { kind: "fact", factId: f1.find((f) => f.side === "repo").id } };
const eff5 = applyDecisions(f1, [dec5], g1);
ok(detectGaps(eff5).filter((g) => g.key === "training.batch_size" && g.blocksReady).length === 0, "accept 后该 key 无 blocker");

console.log("== 6. Fact 改变 → Decision stale、blocker 回来 ==");
// 先 accept 一个 decision；然后改变 facts（新 batch_size 值）→ fingerprint 变化 → stale
const dec6 = { ...decisionForGap(g1[0]), status: "accepted", choice: { kind: "fact", factId: f1.find((f) => f.side === "repo").id } };
const newFacts = normalizeFacts([
  { key: "training.batch_size", side: "paper", value: 64, status: "observed", source: { kind: "paper", section: "4.1" } },
  { key: "training.batch_size", side: "repo", value: 128, status: "observed", source: { kind: "repo", file: "cfg.yaml", lineStart: 1 } }, // 值变了
]);
const g6 = detectGaps(newFacts);
ok(isDecisionStale(dec6, g6) === true, "fact 值变化 → decision stale");
const { effectiveFacts: eff6, effectiveGaps: g6eff, staleDecisions } = detectWithDecisions(newFacts, [dec6]);
ok(staleDecisions.length === 1, "stale decision 被标记");
ok(g6eff.some((g) => g.type === "value_conflict" && g.key === "training.batch_size" && g.blocksReady), "stale 不消解 → 新 gap blocker 回来");

console.log("== 7. gapFingerprint 确定性 + 变化敏感 ==");
ok(gapFingerprint(g1[0]) === gapFingerprint(detectGaps(f1)[0]), "同输入 fingerprint 一致");
ok(gapFingerprint(g1[0]) !== gapFingerprint(g6[0]), "证据变化 → fingerprint 不同");

console.log("== 8. custom choice：合成 user fact 收敛两侧 ==");
const dec8 = { ...decisionForGap(g1[0]), status: "accepted", choice: { kind: "custom", value: 32 } };
const eff8 = applyDecisions(f1, [dec8], g1);
const g8 = detectGaps(eff8);
ok(!g8.some((g) => g.key === "training.batch_size" && g.blocksReady), "custom=32 → 收敛（无 blocker）");
ok(eff8.filter((f) => f.key === "training.batch_size" && f.source?.kind === "user").length >= 1, "合成 user fact 存在（可追溯）");

console.log("== 9. proposeDecision 类型限制（not_scanned / missing_required 拒绝） ==");
// 通过 resolvableGaps 验证：missing_required 不可消解
const gMissing = detectGaps(normalizeFacts([]));
ok(!resolvableGaps(gMissing).some((g) => g.type === "missing_required"), "missing_required 不在 resolvable（propose 拒绝）");
ok(!resolvableGaps(g3).some((g) => g.type === "not_scanned"), "not_scanned 不在 resolvable");

console.log("== 10. accept 无 choice 拒绝（API 层校验在 route；此处验证 choice 必须有效） ==");
const decNoChoice = decisionForGap(g1[0]);
ok(decNoChoice.choice === undefined, "pending decision 无 choice（accept 时必须提供）");

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
