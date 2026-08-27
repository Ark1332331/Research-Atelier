/**
 * Phase A 真实流程样例（world model in robotics）：
 * 真实 DeepSeek planner → 确定性 planFromIntent → session 持久化 + 状态机 + 刷新恢复。
 * 运行：RA_DATA_DIR=/tmp/ra-phase-a-sample bash -c 'set -a; . ./.env.local; set +a; node scripts/run-phase-a-sample.mjs'
 */
import { plannerIntent } from "../src/lib/search/planner.ts";
import { planFromIntent, deriveNextStep } from "../src/lib/search/plan.ts";
import { createSession, withPlan, transitionStage } from "../src/lib/search/session.ts";
import { saveSession, loadSession } from "../src/lib/search/session-storage.ts";

const question = "我想学习 robotics 中的 world model，最近三年为主，但也需要知道路线起点。";
let intent;
try {
  intent = await plannerIntent(question);
  console.log("== intent（LLM 产出，已 normalize） ==");
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
const s2 = await loadSession(s1.id);              // 模拟刷新：从磁盘恢复
const s3 = transitionStage(s2, "external-opened"); // 用户点了「复制并打开 Scholar」
await saveSession(s3);
const s4 = transitionStage(s3, "awaiting-import"); // 用户回来说「我搜完了」
await saveSession(s4);
const restored = await loadSession(s1.id);         // 再次刷新：应显示 awaiting-import，不重新生成计划
console.log("== session 状态机（持久化 + 刷新恢复） ==");
console.log(JSON.stringify({
  id: s1.id,
  schemaVersion: restored.schemaVersion,
  stageFlow: [s1.stage, s3.stage, s4.stage, "restored:" + restored.stage],
  databaseActions: restored.databaseActions,
  nextStep: deriveNextStep(restored),
}, null, 2));

