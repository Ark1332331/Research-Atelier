/**
 * v1.5 发现过程记录测试：ResearchSession.events 事件日志（append-only、顺序、刷新不丢）。
 * 运行：RA_DATA_DIR=<tmp> node scripts/test-discovery-events.mjs
 * 说明：RA_CONCEPT_MOCK 走真实 map→ladder 路径（plan 带 conceptMap/ladder，可 advance-tier）。
 */
import { handlePlan, handleImport, handleTriage, handleAction, handleSessionGet } from "../src/lib/search/literature-api.ts";

let pass = 0, fail = 0;
function ok(cond, name) { if (cond) { pass++; console.log("  ✓ " + name); } else { fail++; console.log("  ✗ " + name); } }

process.env.RA_CONCEPT_MOCK = JSON.stringify({
  rawTerms: ["机器人大击剑", "动作识别和意图判定"],
  coreTasks: [
    { canonical: "human intention recognition", alternatives: [], confidence: "high", sourceTerm: "动作识别和意图判定" },
    { canonical: "human action recognition", alternatives: [], confidence: "high", sourceTerm: "动作识别和意图判定" },
  ],
  methods: [{ canonical: "skeleton-based action recognition", alternatives: [], confidence: "medium", sourceTerm: "动作识别和意图判定" }],
  broaderFields: [{ canonical: "human-robot interaction", alternatives: [], confidence: "high", sourceTerm: "机器人大击剑" }],
  applicationTerms: [{ canonical: "robotic fencing", alternatives: [], confidence: "high", sourceTerm: "机器人大击剑" }],
  adjacentTerms: [],
  ambiguousTerms: [{ term: "human motion recognition", note: "非标准", suggestedCanonical: "human action recognition" }],
});

console.log("== 1. plan 生成 → 记录 plan-generated（含阶梯层） ==");
const planRes = await handlePlan({ question: "机器人大击剑与人体动作意图判定" });
const s0 = (await planRes.json()).session;
ok(planRes.status === 200 && (s0.events ?? []).length === 1, "events 恰好 1 条（plan-generated）");
ok(s0.events[0].kind === "plan-generated" && s0.events[0].detail.tier === 1 && s0.events[0].detail.totalTiers === 3, "plan-generated 记录第 1/3 层");
ok(s0.plan?.ladder?.activeTier === 0, "初始活跃层 0");

console.log("== 2. 进入下一层 → tier-advanced + plan 更新 ==");
const adv = await handleAction({ sessionId: s0.id, action: "advance-tier" });
const advBody = await adv.json();
ok(adv.status === 200 && advBody.session.plan.ladder.activeTier === 1, "advance-tier → 活跃层 1");
ok(advBody.session.events.some((e) => e.kind === "tier-advanced" && e.detail.from === 1 && e.detail.to === 2), "tier-advanced 记录 1→2");
ok(advBody.session.intent !== s0.intent, "intent 已切换（新层 conceptGroups）");
const adv2 = await handleAction({ sessionId: s0.id, action: "advance-tier" });
ok((await adv2.json()).session.plan.ladder.activeTier === 2, "第二次 advance → 层 2");
const adv3 = await handleAction({ sessionId: s0.id, action: "advance-tier" });
ok(adv3.status === 400, "已在最后一层 → 400");

console.log("== 3. 打开 → 回来 → 导入 → 筛选 → 种子：事件顺序 ==");
const open = await handleAction({ sessionId: s0.id, action: "open-external" });
ok((await open.json()).session.events.some((e) => e.kind === "external-opened" && e.detail.database), "external-opened 记录数据库");
const back = await handleAction({ sessionId: s0.id, action: "returned-import" });
ok((await back.json()).session.events.some((e) => e.kind === "returned-import"), "returned-import 记录");
const imp = await handleImport({ sessionId: s0.id, raw: "Human Action Recognition for Human-Robot Interaction\n10.48550/arXiv.1803.10122" });
const impBody = await imp.json();
ok(impBody.session.events.some((e) => e.kind === "batch-imported" && e.detail.unique >= 1), "batch-imported 记录统计");
ok(impBody.session.events.some((e) => e.kind === "calibration"), "calibration 记录（基于真实候选）");
process.env.RA_TRIAGE_MOCK = JSON.stringify([
  { paperId: impBody.session.candidates[0].canonicalId, role: "core", depth: "deep", evidenceLevel: "metadata", verdict: "读", relationToQuestion: "high", roleReason: "r", worthReading: "w", roleEvidence: [{ kind: "metadata", source: "import" }], keySections: [], skipSections: [], d: {} },
]);
const tri = await handleTriage({ sessionId: s0.id });
ok((await tri.json()).session.events.some((e) => e.kind === "triage-computed" && e.detail.count >= 1), "triage-computed 记录");
const seeds = await handleAction({ sessionId: s0.id, action: "select-seeds", seedPaperIds: [impBody.session.candidates[0].canonicalId] });
ok((await seeds.json()).session.events.some((e) => e.kind === "seeds-selected" && e.detail.ids.length === 1), "seeds-selected 记录");

console.log("== 4. 刷新恢复：事件不丢、顺序不变 ==");
const restored = (await (await handleSessionGet(s0.id)).json()).session;
ok(restored.events.length === (await (await handleSessionGet(s0.id)).json()).session.events.length, "事件数稳定");
const kinds = restored.events.map((e) => e.kind);
ok(kinds.includes("plan-generated") && kinds.includes("tier-advanced") && kinds.includes("external-opened") && kinds.includes("returned-import") && kinds.includes("batch-imported") && kinds.includes("calibration") && kinds.includes("triage-computed") && kinds.includes("seeds-selected"), "全部 8 类事件已记录");
ok(kinds[0] === "plan-generated", "首事件 = plan-generated（顺序保留）");

console.log("\n结果：" + pass + " 通过 / " + fail + " 失败");
process.exit(fail ? 1 : 0);

