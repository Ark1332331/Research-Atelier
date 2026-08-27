/**
 * Phase B-lite v1.6 端到端 HTTP 测试（真实 dev server）：
 * plan → open → returned-import → 批量预览（识别 N 篇）→ 确认导入（显式 items）→
 * resolution（resolved/pending）→ screen（仅摘要候选）→ userDecision → seeds → 刷新恢复。
 */
const BASE = process.env.NEXT_URL ?? "http://127.0.0.1:3000";

let pass = 0, fail = 0;
function ok(cond, name) { if (cond) { pass++; console.log("  ✓ " + name); } else { fail++; console.log("  ✗ " + name); } }

async function jfetch(path, opts) {
  const res = await fetch(BASE + path, { headers: { "Content-Type": "application/json" }, ...opts });
  let body = null;
  try { body = await res.json(); } catch { /* 非 JSON */ }
  return { status: res.status, body };
}

console.log("== 1. session：plan → open → returned-import ==");
const plan = await jfetch("/api/literature/plan", { method: "POST", body: JSON.stringify({ question: "world model in robotics" }) });
ok(plan.status === 200 && plan.body?.session?.stage === "ready-to-search", "plan → ready-to-search");
const sid = plan.body.session.id;
await jfetch("/api/literature/action", { method: "POST", body: JSON.stringify({ sessionId: sid, action: "open-external" }) });
const back = await jfetch("/api/literature/action", { method: "POST", body: JSON.stringify({ sessionId: sid, action: "returned-import" }) });
ok(back.body?.session?.stage === "awaiting-import", "returned-import → awaiting-import");

console.log("== 2. 批量预览 → 识别 N 篇（先预览，确认后才导入） ==");
const blob = [
  "DreamerV3: Mastering Diverse Domains through World Models",
  "https://arxiv.org/abs/2301.04104",
  "10.48550/arXiv.2301.04104",
  "",
  "World Models",
  "",
  "?????",
].join("\n");
const prev = await jfetch("/api/literature/preview", { method: "POST", body: JSON.stringify({ raw: blob }) });
ok(prev.status === 200 && prev.body?.recognized >= 3, "预览识别 >= 3 篇（实际 " + prev.body?.recognized + "）");
ok((prev.body?.items ?? []).every((it) => it.importId), "预览 items 带 importId（显式边界）");

console.log("== 3. 确认导入（显式 items）→ resolution ==");
const imp = await jfetch("/api/literature/import", { method: "POST", body: JSON.stringify({ sessionId: sid, items: prev.body.items }) });
ok(imp.status === 200, "import HTTP 200");
const st = imp.body?.stats;
ok(st && st.rawItems === prev.body.recognized, "rawItems = 预览识别数");
ok(imp.body?.session?.stage === "screening", "导入后 → screening");
const candidates = imp.body?.session?.candidates ?? [];
ok(candidates.length >= 1, "至少 1 篇 resolved 进 candidates（实际 " + candidates.length + "）");
ok((imp.body?.session?.pending ?? []).length >= 1, "无法识别/歧义 → pending（不静默）");
ok(candidates.every((c) => c.resolution && c.resolution.status === "resolved"), "candidates 全部带 resolution=resolved");
ok(candidates.some((c) => c.abstract && c.abstract.trim()), "至少 1 篇解析出摘要（可初筛）");

console.log("== 4. screen：仅摘要候选出 AI rec；无摘要不伪装 ==");
const scr = await jfetch("/api/literature/screen", { method: "POST", body: JSON.stringify({ sessionId: sid }) });
ok(scr.status === 200, "screen HTTP 200");
const screening = scr.body?.session?.screening ?? [];
ok(screening.length === candidates.length, "screening 覆盖全部候选");
const sAbs = screening.filter((r) => r.screenable);
ok(sAbs.length >= 1, "screenable 候选 >= 1（有摘要）");
ok(sAbs.every((r) => r.ai), "screenable 候选都有 AI recommendation");
const sNoAbs = screening.filter((r) => !r.screenable);
ok(sNoAbs.every((r) => r.ai === undefined && r.reason), "不可筛候选无 AI 结论，只有 reason（可能相关）");
ok(screening.every((r) => !("score" in (r.ai ?? {}))), "无总分");

console.log("== 5. userDecision + 种子 + 刷新恢复 ==");
const k1 = sAbs[0].canonicalId;
const dec = await jfetch("/api/literature/action", { method: "POST", body: JSON.stringify({ sessionId: sid, action: "set-decision", canonicalId: k1, decision: "keep" }) });
ok(dec.body?.session?.screening?.find((r) => r.canonicalId === k1)?.userDecision === "keep", "userDecision=keep 已存");
const seeds = await jfetch("/api/literature/action", { method: "POST", body: JSON.stringify({ sessionId: sid, action: "select-seeds", seedPaperIds: [k1] }) });
ok(seeds.body?.session?.seedPapers?.length === 1, "种子已保存");
const restored = await jfetch("/api/literature/session?id=" + encodeURIComponent(sid));
ok(restored.body?.session?.stage === "screening", "刷新后仍 screening");
ok(restored.body?.session?.candidates?.length === candidates.length, "刷新后候选不丢");
ok(restored.body?.session?.screening?.length === screening.length, "刷新后 screening 不丢");
ok(restored.body?.session?.screening?.find((r) => r.canonicalId === k1)?.userDecision === "keep", "刷新后 userDecision 不丢");
ok(restored.body?.session?.pending?.length >= 1, "刷新后 pending 不丢");

console.log("\n结果：" + pass + " 通过 / " + fail + " 失败");
process.exit(fail ? 1 : 0);

