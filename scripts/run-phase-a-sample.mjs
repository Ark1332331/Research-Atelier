/**
 * Phase A 真实流程样例（world model in robotics，v1.1.1 组语义版）：
 * 真实 DeepSeek planner → 确定性 planFromIntent → session 持久化 + 状态机 + 刷新恢复。
 */
import { plannerIntent } from "../src/lib/search/planner.ts";
import { planFromIntent, deriveNextStep } from "../src/lib/search/plan.ts";
import { createSession, withPlan, transitionStage } from "../src/lib/search/session.ts";
import { saveSession, loadSession } from "../src/lib/search/session-storage.ts";

const question = "我想学习 robotics 中的 world model，最近三年为主，但也需要知道路线起点。";
let intent;
try {
  intent = await plannerIntent(question);
  console.log("== intent（LLM 产出，已 normalize + 年份解析） ==");
  console.log(JSON.stringify(intent, null, 2));
} catch (e) {
  console.log("== plannerIntent 失败（网络/key）：" + (e instanceof Error ? e.message : String(e)));
  process.exit(2);
}

const plan = planFromIntent(intent);
console.log("== plan（全确定性，来自代码） ==");
console.log(JSON.stringify({
  suggestedFirstAction: plan.suggestedFirstAction,
  recommendedNowCount: plan.databases.filter((d) => d.recommendedNow).length,
  primary: plan.databases.find((d) => d.recommendedNow),
  others: plan.databases.filter((d) => !d.recommendedNow).map((d) => ({ id: d.id, query: d.queries[0], why: d.why })),
  returnPath: plan.returnPath,
  warnings: plan.warnings,
}, null, 2));

const s0 = createSession(question);
const s1 = withPlan(s0, intent, plan);
await saveSession(s1);
const s2 = await loadSession(s1.id);
const s3 = transitionStage(s2, "external-opened");
await saveSession(s3);
const s4 = transitionStage(s3, "awaiting-import");
await saveSession(s4);
const restored = await loadSession(s1.id);
console.log("== session 状态机（持久化 + 刷新恢复） ==");
console.log(JSON.stringify({
  id: s1.id,
  schemaVersion: restored.schemaVersion,
  stageFlow: [s1.stage, s3.stage, s4.stage, "restored:" + restored.stage],
  databaseActions: restored.databaseActions,
  nextStep: deriveNextStep(restored),
}, null, 2));

