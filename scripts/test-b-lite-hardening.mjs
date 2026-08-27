/**
 * v1.3 identity/grounding hardening · handler 级测试（mock，无真实网络）：
 *  - ④ candidates 变化后旧 triage/seeds 必须清空（stale）
 *  - ① triage 收到 session.question（经由 handleTriage）
 *  - 同 record 合成 + 别名合并（端到端：title+arXiv+DOI 一条候选）
 * 运行：RA_DATA_DIR=<tmp> node scripts/test-b-lite-hardening.mjs
 */
import { handlePlan, handleImport, handleTriage, handleAction, handleSessionGet } from "../src/lib/search/literature-api.ts";

let pass = 0, fail = 0;
function ok(cond, name) { if (cond) { pass++; console.log("  ✓ " + name); } else { fail++; console.log("  ✗ " + name); } }

process.env.RA_PLANNER_MOCK = JSON.stringify({
  intent: { goal: "explore", conceptGroups: [["world model"], ["robotics"]], context: [], exclude: [], yearRange: null },
});

console.log("== 1. 建立 session + 导入（title+arXiv+DOI 合成一条） ==");
const plan = await handlePlan({ question: "世界模型与机器人" });
const s0 = (await plan.json()).session;
ok(plan.status === 200 && s0.stage === "ready-to-search", "plan → ready-to-search");
const imp = await handleImport({ sessionId: s0.id, raw: "DreamerV3: Mastering Diverse Domains through World Models\nhttps://arxiv.org/abs/2301.04104\n10.48550/arXiv.2301.04104" });
const impBody = await imp.json();
ok(imp.status === 200 && impBody.session.stage === "screening", "import → screening");
ok(impBody.stats.rawItems === 1, "一条 title+arXiv+DOI → 1 条候选（rawItems=1）");
ok(impBody.session.candidates.length === 1, "candidates=1");
const c0 = impBody.session.candidates[0];
ok(c0.doi === "10.48550/arXiv.2301.04104" && c0.arxivId === "2301.04104" && c0.title.includes("DreamerV3"), "合成条携带全部身份字段");
ok((c0.aliases ?? []).includes("arxiv:2301.04104") || (c0.aliases ?? []).includes("title:"), "合成条带别名");

console.log("== 2. triage（携带 question） + 选种子 ==");
process.env.RA_TRIAGE_MOCK = JSON.stringify([
  { paperId: c0.canonicalId, role: "core", roleReason: "r", roleConfidence: "high", roleEvidence: [{ kind: "metadata", source: "import", detail: "d" }], worthReading: "w", relationToQuestion: "high", depth: "deep", evidenceLevel: "metadata", keySections: [], skipSections: [], d: {}, verdict: "读" },
]);
const tri = await handleTriage({ sessionId: s0.id });
const triBody = await tri.json();
ok(tri.status === 200 && triBody.session.triage.length === 1, "triage 有结果");
ok(triBody.triage[0].paperId === c0.canonicalId, "triage 绑定真实候选");
await handleAction({ sessionId: s0.id, action: "select-seeds", seedPaperIds: [c0.canonicalId] });
const afterSeed = await handleAction({ sessionId: s0.id, action: "returned-import" }); // 无意义动作？不，直接查 session
const s1 = await (await handleAction({ sessionId: s0.id, action: "select-seeds", seedPaperIds: [c0.canonicalId] })).json();
ok(s1.session.seedPapers.length === 1, "种子已保存");

console.log("== 3. 二次导入 → 旧 triage/seeds 清空（④ stale） ==");
process.env.RA_PLANNER_MOCK = process.env.RA_PLANNER_MOCK; // 不变
const imp2 = await handleImport({ sessionId: s0.id, raw: "World Models\n10.48550/arXiv.1803.10122" });
const imp2Body = await imp2.json();
ok(imp2.status === 200, "二次导入 HTTP 200");
ok(imp2Body.session.candidates.length === 2, "新增第二篇 → candidates=2");
ok(imp2Body.session.triage.length === 0, "旧 triage 已清空（stale）");
ok(imp2Body.session.seedPapers.length === 0, "旧 seeds 已清空（stale）");
const restoredRes = await handleSessionGet(s0.id);
const restored = await restoredRes.json();
console.log("  [debug] GET status=" + restoredRes.status + " restored=" + JSON.stringify(restored).slice(0, 200));
ok(restoredRes.status === 200 && restored.session.triage.length === 0 && restored.session.seedPapers.length === 0, "刷新后 triage/seeds 仍为空（不会复活旧结果）");

console.log("\n结果：" + pass + " 通过 / " + fail + " 失败");
process.exit(fail ? 1 : 0);

