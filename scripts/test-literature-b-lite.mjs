/**
 * Phase B-lite 端到端 HTTP 测试（真实 dev server，验收 8 条）。
 * 前置：dev server 在 NEXT_URL（.env.local 含 DeepSeek key；enrich 用开放 API）。
 */
const BASE = process.env.NEXT_URL ?? "http://127.0.0.1:3000";

let pass = 0, fail = 0;
function ok(cond, name) { if (cond) { pass++; console.log("  ✓ " + name); } else { fail++; console.log("  ✗ " + name); } }

async function jfetch(path, opts) {
  const res = await fetch(BASE + path, {
    headers: { "Content-Type": "application/json" },
    ...opts,
  });
  let body = null;
  try { body = await res.json(); } catch { /* 非 JSON */ }
  return { status: res.status, body };
}

const blob = [
  "DreamerV3: Mastering Diverse Domains through World Models",
  "https://arxiv.org/abs/2301.04104",
  "10.1038/s41586-023-06778-y",
  "",
  "World Models",
  "",
  "@article{dreamerv3,",
  "  title = {Mastering Diverse Domains through World Models},",
  "  doi = {10.48550/arXiv.2301.04104},",
  "}",
  "",
  "?????",
].join("\n");

console.log("== 1. session：plan → open → returned-import ==");
const plan = await jfetch("/api/literature/plan", { method: "POST", body: JSON.stringify({ question: "world model in robotics" }) });
ok(plan.status === 200 && plan.body?.session?.stage === "ready-to-search", "plan → ready-to-search");
const sid = plan.body.session.id;
await jfetch("/api/literature/action", { method: "POST", body: JSON.stringify({ sessionId: sid, action: "open-external" }) });
const back = await jfetch("/api/literature/action", { method: "POST", body: JSON.stringify({ sessionId: sid, action: "returned-import" }) });
ok(back.body?.session?.stage === "awaiting-import", "returned-import → awaiting-import");

console.log("== 2. 混贴导入（B1/B2/B3/B4） ==");
const imp = await jfetch("/api/literature/import", { method: "POST", body: JSON.stringify({ sessionId: sid, raw: blob }) });
ok(imp.status === 200, "import HTTP 200");
const st = imp.body?.stats;
ok(st && st.rawItems >= 5, "rawItems >= 5（实际 " + (st && st.rawItems) + "）");
ok(st && st.unknown >= 1, "unknown >= 1（????? 不静默丢失）");
ok(st && st.unique >= 1, "去重后 unique >= 1");
ok(imp.body?.session?.stage === "screening", "导入后 → screening");
ok(imp.body?.session?.candidates?.length === st.unique, "candidates 数量 = unique");
ok((imp.body?.session?.candidates ?? []).every((c) => c.importInfo?.importId), "每个候选绑定 importInfo");
ok((imp.body?.unparsed ?? []).length >= 1, "unparsed 返回（unknown 可见）");
const enriched = (imp.body?.session?.candidates ?? []).filter((c) => c.enrichment);
ok(enriched.length >= 1, "至少 1 篇完成 enrichment");
const e0 = enriched[0]?.enrichment;
ok(e0 && (e0.citations?.openAlex > 0 || e0.title?.length >= 1), "enrichment 带来源 provenance（title/openAlex 引用）");

console.log("== 3. Triage（B5/B6） ==");
const tri = await jfetch("/api/literature/triage", { method: "POST", body: JSON.stringify({ sessionId: sid }) });
ok(tri.status === 200, "triage HTTP 200");
const triage = tri.body?.triage ?? [];
ok(triage.length >= 1, "triage 有结果");
const ids = new Set((tri.body?.session?.candidates ?? []).map((c) => c.canonicalId));
ok(triage.every((t) => ids.has(t.paperId)), "triage 全部绑定真实候选 id");
ok(triage.every((t) => t.evidenceLevel === "metadata" || t.evidenceLevel === "abstract"), "evidenceLevel 不越权（无 fulltext）");
ok(triage.every((t) => t.keySections.length === 0 && t.skipSections.length === 0), "无 fulltext → 章节代码强制为空");
ok(triage.every((t) => !("score" in t) && !("rank" in t)), "无总分/排名");

console.log("== 4. 选种子 + 刷新恢复（B8） ==");
const seeds = (tri.body?.session?.candidates ?? []).slice(0, Math.min(2, tri.body?.session?.candidates?.length ?? 0)).map((c) => c.canonicalId);
const seedRes = await jfetch("/api/literature/action", { method: "POST", body: JSON.stringify({ sessionId: sid, action: "select-seeds", seedPaperIds: seeds }) });
ok(seedRes.status === 200 && seedRes.body?.session?.seedPapers?.length === seeds.length, "选种子保存");
const restored = await jfetch("/api/literature/session?id=" + encodeURIComponent(sid));
ok(restored.body?.session?.stage === "screening", "刷新后仍 screening");
ok(restored.body?.session?.candidates?.length === tri.body.session.candidates.length, "刷新后候选不丢");
ok(restored.body?.session?.triage?.length === triage.length, "刷新后 triage 不丢");
ok(restored.body?.session?.seedPapers?.length === seeds.length, "刷新后种子不丢");
ok(restored.body?.session?.importStats?.unique === st.unique, "刷新后导入统计不丢");

console.log("\n结果：" + pass + " 通过 / " + fail + " 失败");
process.exit(fail ? 1 : 0);

