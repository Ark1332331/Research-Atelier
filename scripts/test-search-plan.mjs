/**
 * Paper Search Phase A 验收测试（v1.1 guardrail #1/#2/#4 + v1.1.1 hardening：
 * conceptGroups 组语义、resolveYearRange 年份注入、goal→primary 规则）。
 * 运行：node scripts/test-search-plan.mjs   （Node ≥ 22.6 直接跑 TS）
 */
import {
  compileWosQuery, topicGroup, excludeGroup, yearClause, MAX_YEAR_SPAN,
} from "../src/lib/search/compile-wos.ts";
import { googleScholarUrl, arxivSearchUrl } from "../src/lib/search/gs-link.ts";
import {
  normalizeSearchPlan, normalizeIntent, planFromIntent, deriveNextStep, displayDbName,
  resolveYearRange, gsQueriesFromIntent, primaryDbForGoal,
} from "../src/lib/search/plan.ts";
import {
  createSession, normalizeSession, transitionStage, SESSION_SCHEMA_VERSION,
} from "../src/lib/search/session.ts";

let pass = 0, fail = 0;
function ok(cond, name) { if (cond) { pass++; console.log("  ✓ " + name); } else { fail++; console.log("  ✗ " + name); } }
function same(a, b, name) { ok(JSON.stringify(a) === JSON.stringify(b), name); }

const intent = {
  goal: "explore",
  conceptGroups: [["world model", "world models"], ["robotics", "embodied agent"]],
  context: [],
  exclude: ["mental health"],
  yearRange: [2022, 2026],
};

console.log("== 1. compileWosQuery（组内 OR、组间 AND） ==");
const wos = compileWosQuery(intent);
ok(wos.query.includes('TS=("world model" OR "world models")'), "组1 内 OR");
ok(wos.query.includes('TS=(robotics OR "embodied agent")'), "组2 内 OR");
ok(wos.query.includes(' AND '), "组间 AND");
ok(wos.query.includes('NOT TS=("mental health")'), "排除组 NOT");
ok(wos.query.includes("PY=(2022-2026)"), "年份区间");
ok(wos.note === null, "五年内无提示");
const wide = compileWosQuery({ ...intent, yearRange: [2010, 2026] });
ok(wide.query.includes("PY=") === false && wide.note !== null, ">5 年不生成 PY 并给提示");
const empty = compileWosQuery({ conceptGroups: [], context: [], exclude: [], yearRange: undefined });
ok(empty.query === "" && empty.note === null, "空 intent → 空串");
ok(topicGroup(["cell growth", "robot*"]) === 'TS=("cell growth" OR robot*)', "带通配符不加引号");
ok(excludeGroup(["a b"]) === 'NOT TS=("a b")', "排除组");
ok(yearClause([2022, 2022]).clause === "PY=2022", "单年");
ok(MAX_YEAR_SPAN === 5, "MAX_YEAR_SPAN=5");

console.log("== 2. URL builder（guardrail #2） ==");
ok(googleScholarUrl('"world model" robotics') === "https://scholar.google.com/scholar?q=%22world%20model%22%20robotics", "GS URL 编码");
ok(googleScholarUrl("  ") === "https://scholar.google.com/", "GS 空查询回退主页");
ok(arxivSearchUrl("world model") === "https://arxiv.org/search/?searchtype=all&query=world%20model", "arXiv 深链");
ok(arxivSearchUrl("") === "https://arxiv.org/", "arXiv 空回退");

console.log("== 3. resolveYearRange（年份注入，相对时间稳定） ==");
ok(resolveYearRange({ ...intent, goal: "recent", yearRange: undefined }, 2026).yearRange?.join("-") === "2024-2026", "recent 无范围 → 最近三年 2024–2026");
ok(resolveYearRange({ ...intent, yearRange: undefined }, 2026).yearRange?.join("-") === "2022-2026", "explore 无范围 → 近五年");
ok(resolveYearRange({ ...intent, yearRange: [2020, 2030] }, 2026).yearRange?.join("-") === "2020-2026", "结束年 clamp 到当前年份");
ok(resolveYearRange({ ...intent, goal: "foundational", yearRange: undefined }, 2026).yearRange === undefined, "foundational 无范围不设");
ok(resolveYearRange({ ...intent, yearRange: [2030, 2020] }, 2026).yearRange === undefined, "倒置年份移除");
ok(resolveYearRange({ ...intent, goal: "recent", yearRange: [2024, 2026] }, 2026).yearRange?.join("-") === "2024-2026", "显式范围原样保留");

console.log("== 4. normalizeSearchPlan（guardrail #1：恰好一个 recommendedNow） ==");
const basePlan = {
  intent,
  stage: "plan-ready",
  databases: [
    { id: "google-scholar", purpose: "p", queries: ["a"], priority: "primary", recommendedNow: false, nextActions: [], why: "w" },
    { id: "web-of-science", purpose: "p", queries: ["b"], priority: "secondary", recommendedNow: false, nextActions: [], why: "w" },
  ],
};
const promoted = normalizeSearchPlan(basePlan);
ok(promoted.databases.filter((d) => d.recommendedNow).length === 1, "0 个 true → 恰好提升 1 个");
ok(promoted.databases[0].recommendedNow === true, "提升的是第一个 primary");
const twoTrue = normalizeSearchPlan({ ...basePlan, databases: basePlan.databases.map((d) => ({ ...d, recommendedNow: true })) });
ok(twoTrue.databases.filter((d) => d.recommendedNow).length === 1, "2 个 true → 收敛为 1 个");
const withBad = normalizeSearchPlan({ ...basePlan, databases: [...basePlan.databases, { id: "unknown-db", queries: ["x"] }] });
ok(withBad.databases.length === 2, "非法数据库被剔除");
let threw = false;
try { normalizeSearchPlan({ intent, databases: [] }); } catch { threw = true; }
ok(threw, "无有效数据库 → 抛错");
same(normalizeSearchPlan(promoted), promoted, "幂等");

console.log("== 5. planFromIntent（确定性 + goal→primary） ==");
const plan = planFromIntent(intent, 2026);
ok(plan.databases.filter((d) => d.recommendedNow).length === 1, "恰好一个 recommendedNow");
ok(plan.databases[0].id === "google-scholar", "explore → 主推 Google Scholar");
ok(plan.databases[0].deepLinkUrl.startsWith("https://scholar.google.com/"), "GS 深链由 builder 生成");
const wosDb = plan.databases.find((d) => d.id === "web-of-science");
ok(wosDb && wosDb.queries[0].includes(" AND ") && wosDb.queries[0].includes("PY=(2022-2026)"), "WoS 组间 AND 编译");
const recent = planFromIntent({ ...intent, goal: "recent", yearRange: undefined }, 2026);
ok(recent.databases[0].id === "arxiv", "recent → 主推 arXiv");
ok(recent.databases[0].deepLinkUrl.startsWith("https://arxiv.org/search/"), "arXiv 深链");
ok(recent.intent.yearRange?.join("-") === "2024-2026", "recent 年份解析 2024–2026");
const found = planFromIntent({ ...intent, goal: "foundational", yearRange: undefined }, 2026);
ok(found.databases[0].id === "web-of-science", "foundational → 主推 WoS");
ok(primaryDbForGoal("survey") === "google-scholar" && primaryDbForGoal("reproducible") === "google-scholar" && primaryDbForGoal("follow_paper") === "semantic-scholar", "primary 规则表");
ok(gsQueriesFromIntent(intent)[0] === '"world model" robotics', "GS q1 组间 AND");
ok(gsQueriesFromIntent(intent)[1] === '"world model" "embodied agent"', "GS q2 用第二组同义词/语境");
ok(gsQueriesFromIntent(intent)[2] === '"world model" review', "GS q3 review");
ok(plan.returnPath.length === 4, "Return Path 四步");
same(normalizeSearchPlan(plan), plan, "planFromIntent 产物幂等");

console.log("== 6. normalizeIntent（conceptGroups + 旧 concepts 兼容） ==");
const legacy = normalizeIntent({ goal: "explore", concepts: ["world model", "robotics"], context: [], exclude: [] });
ok(JSON.stringify(legacy.conceptGroups) === JSON.stringify([["world model"], ["robotics"]]), "旧 concepts → 单元素组");
const groups = normalizeIntent({ goal: "explore", conceptGroups: [["world model", "world models"], ["robotics"]], exclude: [] });
ok(groups.conceptGroups.length === 2 && groups.conceptGroups[0].length === 2, "conceptGroups 归一");
const bad = normalizeIntent({ goal: "hack", conceptGroups: "x", context: ["a", 2, null], exclude: [], yearRange: [2030, 2020] });
ok(bad.goal === "explore" && bad.conceptGroups.length === 0, "坏 goal/组回退");
ok(bad.yearRange === undefined, "倒置年份丢弃");
ok("preferredTypes" in bad === false, "空 preferredTypes 省略");

console.log("== 7. session 状态机 + schemaVersion（guardrail #3/#4） ==");
const s = createSession("world model in robotics");
ok(s.schemaVersion === SESSION_SCHEMA_VERSION && s.schemaVersion === 1, "schemaVersion=1");
ok(s.stage === "planning", "初始 planning");
const s1 = transitionStage(s, "ready-to-search");
ok(s1.stage === "ready-to-search" && s.stage === "planning", "planning → ready-to-search");
const s2 = transitionStage(s1, "external-opened");
ok(s2.stage === "external-opened", "ready-to-search → external-opened");
const s3 = transitionStage(s2, "awaiting-import");
ok(s3.stage === "awaiting-import", "external-opened → awaiting-import");
let direct = false;
try { transitionStage(s1, "awaiting-import"); } catch { direct = true; }
ok(direct === false, "ready-to-search → awaiting-import 合法");
let illegal = false;
try { transitionStage(s, "external-opened"); } catch { illegal = true; }
ok(illegal, "planning → external-opened 非法");
same(normalizeSession(s3), s3, "session 幂等归一化");
const ns = normalizeSession({ id: "x", question: 123 });
ok(ns.schemaVersion === 1 && ns.stage === "planning" && ns.question === "", "坏字段回退默认");

console.log("== 8. deriveNextStep（derived state） ==");
ok(deriveNextStep({ stage: "ready-to-search", plan }).action.includes("Google Scholar"), "ready-to-search → 打开推荐库");
ok(deriveNextStep({ stage: "external-opened", plan }).action.includes("我搜完了"), "external-opened → 回来导入");
ok(deriveNextStep({ stage: "awaiting-import", plan }).action.includes("带回来"), "awaiting-import → 带回来");
ok(displayDbName("google-scholar") === "Google Scholar", "展示名");

console.log("== 9. v1.1.2：landingUrl 全覆盖 / deep-link 区分 / context 不污染 WoS / follow_paper→S2 ==");
const ctxIntent = { ...intent, context: ["learning", "survey", "overview"] };
const wosCtx = compileWosQuery(ctxIntent);
ok(!wosCtx.query.includes("learning") && !wosCtx.query.includes("survey"), "context 不进 WoS 主 query（soft context）");
const pFound = planFromIntent({ ...intent, goal: "foundational" }, 2026);
ok(pFound.databases.every((d) => typeof d.landingUrl === "string" && d.landingUrl.startsWith("http")), "所有数据库都有 landingUrl");
const wosP = pFound.databases.find((d) => d.id === "web-of-science");
ok(wosP.landingUrl === "https://www.webofscience.com/wos/woscc/advanced-search", "WoS landingUrl = Advanced Search 入口页");
ok(wosP.deepLinkUrl === undefined, "WoS 无 deepLinkUrl（复制检索式 + 打开入口）");
ok(pFound.databases[0].id === "web-of-science" && pFound.databases[0].recommendedNow, "foundational → WoS primary");
const pRecent = planFromIntent({ ...intent, goal: "recent", yearRange: undefined }, 2026);
ok(pRecent.databases[0].id === "arxiv" && pRecent.databases[0].deepLinkUrl?.startsWith("https://arxiv.org/"), "recent → arXiv primary + deepLinkUrl");
const pFollow = planFromIntent({ ...intent, goal: "follow_paper" }, 2026);
ok(pFollow.databases[0].id === "semantic-scholar" && pFollow.databases[0].deepLinkUrl?.startsWith("https://www.semanticscholar.org/search"), "follow_paper → S2 primary + deepLinkUrl");
ok(plan.databases.find((d) => d.id === "google-scholar")?.deepLinkUrl?.startsWith("https://scholar.google.com/"), "GS deepLinkUrl 存在");

console.log("\n结果：" + pass + " 通过 / " + fail + " 失败");
process.exit(fail ? 1 : 0);

