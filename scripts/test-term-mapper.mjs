/**
 * Phase A.5 验收测试（v1.4）：Academic Term Mapper + Query Ladder + term calibration。
 * 真实回归案例：机器人大击剑 —— 不允许再直接生成 "robotic fencing" "human motion recognition"。
 * 运行：node scripts/test-term-mapper.mjs
 */
import { normalizeConceptMap, buildLadderFromMap, intentForTier, calibrateTerms } from "../src/lib/search/terms.ts";
import { planFromIntent } from "../src/lib/search/plan.ts";

let pass = 0, fail = 0;
function ok(cond, name) { if (cond) { pass++; console.log("  ✓ " + name); } else { fail++; console.log("  ✗ " + name); } }
function flat(groups) { return (groups ?? []).flat().join(" ").toLowerCase(); }

// 模拟 LLM 对「机器人大击剑相关领域、人体动作识别和意图判定、机器人安全交互、高动态运动控制」的映射输出
const rawMap = {
  rawTerms: ["机器人大击剑相关领域", "人体动作识别和意图判定", "机器人安全交互", "高动态运动控制"],
  coreTasks: [
    { canonical: "human intention recognition", alternatives: ["intent recognition"], confidence: "high", sourceTerm: "人体动作识别和意图判定" },
    { canonical: "human action recognition", alternatives: ["action recognition"], confidence: "high", sourceTerm: "人体动作识别和意图判定" },
    { canonical: "human motion prediction", alternatives: ["motion prediction"], confidence: "medium", sourceTerm: "人体动作识别和意图判定" },
  ],
  methods: [
    { canonical: "skeleton-based action recognition", alternatives: [], confidence: "medium", sourceTerm: "人体动作识别和意图判定" },
  ],
  broaderFields: [
    { canonical: "human-robot interaction", alternatives: ["human robot interaction"], confidence: "high", sourceTerm: "机器人安全交互" },
    { canonical: "human-robot collaboration", alternatives: [], confidence: "high", sourceTerm: "机器人安全交互" },
  ],
  applicationTerms: [
    { canonical: "robotic fencing", alternatives: ["robot fencing"], confidence: "high", sourceTerm: "机器人大击剑相关领域" },
  ],
  adjacentTerms: [
    { canonical: "safe physical human-robot interaction", alternatives: ["safe physical HRI"], confidence: "medium", sourceTerm: "机器人安全交互" },
    { canonical: "high-dynamic motion control", alternatives: ["high dynamic motion control"], confidence: "medium", sourceTerm: "高动态运动控制" },
  ],
  ambiguousTerms: [
    { term: "human motion recognition", note: "领域更常用 human action recognition / human motion prediction", suggestedCanonical: "human action recognition" },
  ],
};

console.log("== 1. normalizeConceptMap：术语分类真实生效 ==");
const map = normalizeConceptMap(rawMap);
ok(map.applicationTerms.some((c) => c.canonical === "robotic fencing"), "robotic fencing → application term");
ok(map.coreTasks.some((c) => c.canonical === "human action recognition") && map.coreTasks.some((c) => c.canonical === "human motion prediction") && map.coreTasks.some((c) => c.canonical === "human intention recognition"), "coreTasks 含 action/motion prediction/intention recognition");
ok(map.broaderFields.some((c) => c.canonical === "human-robot interaction") && map.broaderFields.some((c) => c.canonical === "human-robot collaboration"), "broaderFields 含 HRI/HRC");
ok(map.methods.some((c) => c.canonical === "skeleton-based action recognition"), "methods 含 skeleton-based action recognition");
ok(map.ambiguousTerms.some((a) => a.term === "human motion recognition" && a.suggestedCanonical), "human motion recognition → ambiguous + 建议标准表达");
const uncovered = normalizeConceptMap({ rawTerms: ["某个完全没映射的词"], coreTasks: [] });
ok(uncovered.ambiguousTerms.some((a) => a.term === "某个完全没映射的词"), "未映射原词自动进入 ambiguous（不可静默当标准术语）");

console.log("== 2. Query Ladder：broad → method → application，application 不进第一层 ==");
const ladder = buildLadderFromMap(map);
ok(ladder.tiers.length === 3 && ladder.activeTier === 0, "三层阶梯，活跃层=0");
ok(ladder.tiers[0].tier === "broad-domain", "第一层 = broad-domain");
const t1 = flat(ladder.tiers[0].conceptGroups);
const t3 = flat(ladder.tiers[2].conceptGroups);
ok(!t1.includes("robotic fencing") && !t1.includes("fencing"), "第一层不含 robotic fencing（应用词不硬约束）");
ok(!t1.includes("human motion recognition"), "第一层不含 human motion recognition（歧义词不进入）");
ok(t1.includes("human-robot interaction"), "第一层含 HRI（上位领域）");
ok(t1.includes("human intention recognition"), "第一层含 human intention recognition（核心任务）");
ok(t3.includes("robotic fencing"), "第三层（应用场景）才含 robotic fencing");
// ambiguous 词即使出现在 alternatives 里也被确定性剔除
const leakMap = normalizeConceptMap({
  rawTerms: ["x"],
  coreTasks: [{ canonical: "human action recognition", alternatives: ["human motion recognition"], confidence: "high", sourceTerm: "x" }],
  broaderFields: [{ canonical: "human-robot interaction", alternatives: [], confidence: "high", sourceTerm: "x" }],
  ambiguousTerms: [{ term: "human motion recognition", note: "非标准", suggestedCanonical: "human action recognition" }],
});
const leakLadder = buildLadderFromMap(leakMap);
ok(!flat(leakLadder.tiers[0].conceptGroups).includes("human motion recognition"), "ambiguous 词作为 alternative 也被剔除（不进任何层）");

console.log("== 3. 第一轮 query 由确定性 compiler 生成，不再锁死应用词/歧义词 ==");
const intent0 = intentForTier(map, 0);
const plan0 = planFromIntent(intent0, 2026);
ok(plan0.databases.filter((d) => d.recommendedNow).length === 1, "恰好一个 recommendedNow（单 primary action）");
const gsQ = plan0.databases.find((d) => d.recommendedNow)?.recommendedFirst ?? "";
ok(!gsQ.toLowerCase().includes("fencing") && !gsQ.toLowerCase().includes("motion recognition"), "第一轮 GS query 不含 fencing / human motion recognition");
ok(gsQ.toLowerCase().includes("human-robot interaction") && gsQ.toLowerCase().includes("human intention recognition"), "第一轮 GS query 含 HRI + human intention recognition（canonical）");
const wosDb = plan0.databases.find((d) => d.id === "web-of-science");
ok(wosDb && !wosDb.queries[0].toLowerCase().includes("fencing"), "第一轮 WoS query 不含 fencing");
const intent2 = intentForTier(map, 2);
const plan2 = planFromIntent(intent2, 2026);
ok((plan2.databases.find((d) => d.recommendedNow)?.recommendedFirst ?? "").toLowerCase().includes("fencing"), "第三层才加入 robotic fencing");

console.log("== 4. B-lite term calibration：基于真实候选证据 ==");
const cands = [
  { canonicalId: "a", title: "Human Action Recognition for Safe Human-Robot Interaction", authors: [], sources: [], metrics: { citations: {} }, hits: [] },
  { canonicalId: "b", title: "Human Motion Prediction in Human-Robot Collaboration", authors: [], sources: [], metrics: { citations: {} }, hits: [] },
  { canonicalId: "c", title: "Skeleton-Based Human Action Recognition with Transformers", authors: [], sources: [], metrics: { citations: {} }, hits: [] },
  { canonicalId: "d", title: "Intention-Aware Human Motion Prediction for Physical HRI", abstract: "we study human action recognition and human motion prediction for safe physical human-robot interaction", authors: [], sources: [], metrics: { citations: {} }, hits: [] },
  { canonicalId: "e", title: "Robot Learning for Human Action Recognition", authors: [], sources: [], metrics: { citations: {} }, hits: [] },
  { canonicalId: "f", title: "Robot Learning in Human-Robot Interaction", authors: [], sources: [], metrics: { citations: {} }, hits: [] },
];
const cal = calibrateTerms(cands, map);
ok(cal.termsConfirmed.some((t) => t.term === "human action recognition" && t.count >= 2), "human action recognition → confirmed（候选证据）");
ok(cal.termsConfirmed.some((t) => t.term === "human motion prediction" && t.count >= 2), "human motion prediction → confirmed");
ok(cal.termsWeakOrRare.some((t) => t.term === "human motion recognition"), "human motion recognition → weakOrRare（建议换词，不改研究目标）");
ok(cal.termsWeakOrRare.some((t) => t.term === "robotic fencing"), "robotic fencing → weakOrRare（候选集没有，验证未误当 canonical）");
ok(cal.termsSuggested.length >= 1, "termsSuggested 从真实候选高频短语提取（非 LLM 空猜）");
ok(cal.basedOn === cands.length, "basedOn = 候选数");

console.log("\n结果：" + pass + " 通过 / " + fail + " 失败");
process.exit(fail ? 1 : 0);

