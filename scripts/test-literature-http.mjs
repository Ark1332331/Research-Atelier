/**
 * Literature Discovery HTTP 集成测试（真实 dev server + 真实子路由，v1.1.1 hardening）。
 * 前置：dev server 已在 NEXT_URL 运行（建议 RA_DATA_DIR=临时目录；RA_PLANNER_MOCK 可选）。
 * 覆盖：/api/literature/plan → 200 + stage=ready-to-search + 恰好一个 recommendedNow；
 *       /api/literature/action open-external → external-opened；
 *       returned-import → awaiting-import；GET session → 刷新恢复 awaiting-import；
 *       负路径：未知 action 400、不存在 session 404。
 */
const BASE = process.env.NEXT_URL ?? "http://127.0.0.1:3199";

let pass = 0, fail = 0;
function ok(cond, name) { if (cond) { pass++; console.log("  ✓ " + name); } else { fail++; console.log("  ✗ " + name); } }

async function jfetch(path, opts) {
  const res = await fetch(BASE + path, {
    headers: { "Content-Type": "application/json" },
    ...opts,
  });
  let body = null;
  try { body = await res.json(); } catch { /* 非 JSON 响应 */ }
  return { status: res.status, body };
}

console.log("== 1. POST /api/literature/plan ==");
const plan = await jfetch("/api/literature/plan", { method: "POST", body: JSON.stringify({ question: "world model in robotics" }) });
ok(plan.status === 200, "HTTP 200");
ok(plan.body?.session?.stage === "ready-to-search", "stage=ready-to-search");
ok(plan.body?.session?.schemaVersion === 1, "schemaVersion=1");
ok(plan.body?.session?.question === "world model in robotics", "question 保留");
const recs = plan.body?.session?.plan?.databases?.filter((d) => d.recommendedNow) ?? [];
ok(recs.length === 1, "恰好一个 recommendedNow");
const sessionId = plan.body?.session?.id;
ok(typeof sessionId === "string" && sessionId.length > 0, "有 sessionId");

console.log("== 2. POST /api/literature/action open-external ==");
const open = await jfetch("/api/literature/action", { method: "POST", body: JSON.stringify({ sessionId, action: "open-external" }) });
ok(open.status === 200 && open.body?.session?.stage === "external-opened", "→ external-opened");
ok((open.body?.session?.databaseActions ?? []).some((a) => a.action === "opened"), "记录 opened 动作");

console.log("== 3. POST /api/literature/action returned-import ==");
const back = await jfetch("/api/literature/action", { method: "POST", body: JSON.stringify({ sessionId, action: "returned-import" }) });
ok(back.status === 200 && back.body?.session?.stage === "awaiting-import", "→ awaiting-import");

console.log("== 4. GET /api/literature/session（刷新恢复） ==");
const get = await jfetch("/api/literature/session?id=" + encodeURIComponent(sessionId));
ok(get.status === 200 && get.body?.session?.stage === "awaiting-import", "刷新后仍 awaiting-import（不重新生成计划）");
ok(typeof get.body?.nextStep?.action === "string" && get.body.nextStep.action.includes("带回来"), "nextStep derived");

console.log("== 5. 负路径 ==");
const bad = await jfetch("/api/literature/action", { method: "POST", body: JSON.stringify({ sessionId, action: "nope" }) });
ok(bad.status === 400, "未知 action → 400");
const missing = await jfetch("/api/literature/session?id=no-such");
ok(missing.status === 404, "不存在 session → 404");
const emptyQ = await jfetch("/api/literature/plan", { method: "POST", body: JSON.stringify({ question: "" }) });
ok(emptyQ.status === 400, "空问题 → 400");

console.log("\n结果：" + pass + " 通过 / " + fail + " 失败");
process.exit(fail ? 1 : 0);

