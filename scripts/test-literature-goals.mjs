/**
 * v1.1.2 API 级测试：goal → primary 路由 + landingUrl 全覆盖 + deep-link 区分 + context 不污染 WoS。
 * 运行：RA_DATA_DIR=<tmp> node scripts/test-literature-goals.mjs
 * 说明：RA_PLANNER_MOCK 在脚本内按 goal 设置（plannerIntent 每次请求时读取 env，无需真实 key/网络）。
 */
import { handlePlan, handleAction } from "../src/lib/search/literature-api.ts";

let pass = 0, fail = 0;
function ok(cond, name) { if (cond) { pass++; console.log("  ✓ " + name); } else { fail++; console.log("  ✗ " + name); } }

const GROUPS = [["world model", "world models"], ["robotics", "embodied agent"]];
const EXPECT_PRIMARY = {
  explore: "google-scholar",
  survey: "google-scholar",
  reproducible: "google-scholar",
  recent: "arxiv",
  foundational: "web-of-science",
  follow_paper: "semantic-scholar",
};

for (const [goal, expectId] of Object.entries(EXPECT_PRIMARY)) {
  process.env.RA_PLANNER_MOCK = JSON.stringify({
    intent: { goal, conceptGroups: GROUPS, context: ["learning", "survey"], exclude: ["mental health"], yearRange: null },
  });
  const res = await handlePlan({ question: "world model in robotics" });
  ok(res.status === 200, goal + " → HTTP 200");
  const body = await res.json();
  const plan = body?.session?.plan;
  const prim = (plan?.databases ?? []).find((d) => d.recommendedNow);
  ok(prim && prim.id === expectId, goal + " → primary=" + expectId + "（实际 " + (prim ? prim.id : "无") + "）");
  ok((plan?.databases ?? []).filter((d) => d.recommendedNow).length === 1, goal + " 恰好一个 recommendedNow");
  ok(typeof prim?.landingUrl === "string" && prim.landingUrl.startsWith("http"), goal + " primary 有 landingUrl");
  if (expectId === "web-of-science") {
    ok(prim.deepLinkUrl === undefined && prim.landingUrl === "https://www.webofscience.com/wos/woscc/advanced-search", goal + " WoS 无 deepLinkUrl、landing=Advanced Search 入口");
  } else {
    ok(typeof prim.deepLinkUrl === "string" && prim.deepLinkUrl.startsWith("http"), goal + " " + expectId + " 有 deepLinkUrl");
  }
  const wos = (plan?.databases ?? []).find((d) => d.id === "web-of-science");
  if (wos) {
    ok(!wos.queries[0].includes("learning") && !wos.queries[0].includes("survey"), goal + " context 不进 WoS 主 query");
  }
  // 只有真实打开动作才记录状态：open-external → external-opened（API 层状态机）
  const actRes = await handleAction({ sessionId: body.session.id, action: "open-external" });
  const actBody = await actRes.json();
  ok(actRes.status === 200 && actBody?.session?.stage === "external-opened", goal + " open-external → external-opened");
}

console.log("\n结果：" + pass + " 通过 / " + fail + " 失败");
process.exit(fail ? 1 : 0);

