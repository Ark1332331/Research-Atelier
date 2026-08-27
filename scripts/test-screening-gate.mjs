/**
 * v1.6 证据门控 + Screening 重定义测试（handler 级，mock，无网络）：
 * gateForCandidate 四级；screen 只对有摘要候选出 AI rec；无摘要 → 不可筛；
 * 全无摘要 → 400；userDecision Keep/Maybe/Exclude；calibration 证据门槛（≥8 有摘要）。
 * 运行：RA_DATA_DIR=<tmp> node scripts/test-screening-gate.mjs
 */
import { createSession } from "../src/lib/search/session.ts";
import { saveSession } from "../src/lib/search/session-storage.ts";
import { handleScreen, handleAction } from "../src/lib/search/literature-api.ts";
import { gateForCandidate } from "../src/lib/search/resolve.ts";
import { calibrateTerms, normalizeConceptMap } from "../src/lib/search/terms.ts";

let pass = 0, fail = 0;
function ok(cond, name) { if (cond) { pass++; console.log("  ✓ " + name); } else { fail++; console.log("  ✗ " + name); } }
const mk = (over) => ({ canonicalId: "x", title: "T", authors: [], sources: [], metrics: { citations: {} }, hits: [], ...over });

console.log("== 1. gateForCandidate（candidate exists ≠ screenable） ==");
ok(gateForCandidate(mk({})) === "title-only", "无任何元数据 → title-only");
ok(gateForCandidate(mk({ doi: "10.1/a" })) === "metadata", "仅 DOI → metadata");
ok(gateForCandidate(mk({ abstract: "ab" })) === "abstract", "有摘要 → abstract");
ok(gateForCandidate(mk({ fulltext: true })) === "fulltext", "全文 → fulltext");

console.log("== 2. screen：只对有摘要候选出 AI rec ==");
const s = createSession("world model in robotics");
s.candidates = [
  mk({ canonicalId: "c1", title: "Paper A", abstract: "abs1" }),
  mk({ canonicalId: "c2", title: "Paper B", abstract: "abs2" }),
  mk({ canonicalId: "c3", title: "Paper C" }),
];
await saveSession(s);
process.env.RA_TRIAGE_MOCK = JSON.stringify([
  { paperId: "c1", role: "core", depth: "deep", evidenceLevel: "abstract", verdict: "读", relationToQuestion: "high", roleReason: "r", worthReading: "w", roleEvidence: [], keySections: [], skipSections: [], d: {} },
  { paperId: "c2", role: "survey", depth: "targeted", evidenceLevel: "abstract", verdict: "扫读", relationToQuestion: "medium", roleReason: "", worthReading: "", roleEvidence: [], keySections: [], skipSections: [], d: {} },
]);
const res = await handleScreen({ sessionId: s.id });
const body = await res.json();
ok(res.status === 200, "screen HTTP 200");
const scr = body.session.screening;
ok(scr.length === 3, "screening 覆盖全部候选（3）");
const s1 = scr.find((r) => r.canonicalId === "c1");
ok(s1.screenable === true && s1.ai?.role === "core", "有摘要 → screenable + AI rec");
const s3 = scr.find((r) => r.canonicalId === "c3");
ok(s3.screenable === false && (s3.reason ?? "").includes("仅标题"), "无摘要 → 不可筛（仅标题，可能相关）");
ok(s3.ai === undefined, "无摘要候选无 AI 结论（不会伪装成已筛选）");

console.log("== 3. userDecision：AI 只建议，用户 Keep/Maybe/Exclude ==");
const dec = await handleAction({ sessionId: s.id, action: "set-decision", canonicalId: "c1", decision: "keep" });
const decBody = await dec.json();
ok(decBody.session.screening.find((r) => r.canonicalId === "c1").userDecision === "keep", "userDecision=keep 已存");
const bad = await handleAction({ sessionId: s.id, action: "set-decision", canonicalId: "c1", decision: "nope" });
ok(bad.status === 400, "未知 decision → 400");

console.log("== 4. 全无摘要 → 无法初筛 ==");
const s2 = createSession("x");
s2.candidates = [mk({ canonicalId: "d1", title: "Paper D" })];
await saveSession(s2);
const noAbs = await handleScreen({ sessionId: s2.id });
ok(noAbs.status === 400, "0 摘要 → 400（宁可停下说不知道，不拿标题生成完整判断）");

console.log("== 5. calibration 证据门槛（≥8 篇有摘要才 ready） ==");
const map = normalizeConceptMap({ rawTerms: ["a"], coreTasks: [{ canonical: "human action recognition", alternatives: [], confidence: "high", sourceTerm: "a" }], broaderFields: [], methods: [], applicationTerms: [], adjacentTerms: [], ambiguousTerms: [] });
const few = Array.from({ length: 3 }, (_, i) => mk({ canonicalId: "k" + i, title: "Paper " + i }));
const calFew = calibrateTerms(few, map);
ok(calFew.status === "insufficient" && calFew.termsConfirmed.length === 0, "<8 有摘要 → insufficient，不做校准");
const many = Array.from({ length: 9 }, (_, i) => mk({ canonicalId: "m" + i, title: "Human Action Recognition " + i, abstract: "we study human action recognition" }));
const calMany = calibrateTerms(many, map);
ok(calMany.status === "ready" && calMany.termsConfirmed.length >= 1, "≥8 有摘要 → ready（初步术语趋势）");

console.log("\n结果：" + pass + " 通过 / " + fail + " 失败");
process.exit(fail ? 1 : 0);

