/**
 * Step 1 迁移测试：normalizeReproduction 幂等 + 数据保全 + v1→v2。
 * 运行：node scripts/test-reproduction-migration.mjs   （Node ≥ 22.6 直接跑 TS）
 */
import { readFileSync } from "node:fs";
import { normalizeReproduction, specsEqual, SPEC_VERSION } from "../src/lib/reproduction-spec.ts";

let pass = 0, fail = 0;
function ok(cond, name) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}`); }
}

/* ---------- 夹具：真实旧 v1 数据（形状来自用户目录 reproduction.json 的 nsr-mt454tqk） ---------- */
const v1 = {
  createdAt: "2026-08-01T10:00:00.000Z",
  note: "NSR 复现：无官方代码，独立实现",
  path: [
    { id: "st-a", title: "L1 数据表示", status: "done", note: "R1" },
    { id: "st-b", title: "L2 输入预处理", status: "doing" },
    { id: "st-c", title: "L3 模型结构", status: "todo" },
  ],
  pitfalls: [
    { id: "pf-1", text: "MinkowskiEngine __to_address 编译失败", env: true, stage: "R4", createdAt: "2026-08-02T00:00:00.000Z" },
    { id: "pf-2", text: "stride 坐标直接除 factor 错位", env: false, stage: "R7", createdAt: "2026-08-03T00:00:00.000Z" },
  ],
  repoUrl: "https://github.com/nsr-locomotion/nsr",
  slug: "nsr-mt454tqk",
  sourceUrl: "https://arxiv.org/abs/2206.08077",
  title: "Neural Scene Representation for Locomotion on Structured Terrain",
  updatedAt: "2026-08-10T00:00:00.000Z",
};

console.log("== 1. v1 → v2 迁移 ==");
const v2 = normalizeReproduction(v1);
ok(v2.schemaVersion === SPEC_VERSION, "schemaVersion = 2");
ok(v2.slug === v1.slug && v2.title === v1.title, "slug/title 保留");
ok(v2.sourceUrl === v1.sourceUrl && v2.repoUrl === v1.repoUrl, "sourceUrl/repoUrl 保留");
ok(v2.note === v1.note, "note 保留");
ok(JSON.stringify(v2.path) === JSON.stringify(v1.path), "path 完整保留（含 status/note/id）");
ok(JSON.stringify(v2.pitfalls) === JSON.stringify(v1.pitfalls), "pitfalls 完整保留");
ok(Array.isArray(v2.facts) && v2.facts.length === 0, "新字段 facts 默认 []");
ok(Array.isArray(v2.mappings) && v2.mappings.length === 0, "新字段 mappings 默认 []");
ok(Array.isArray(v2.decisions) && v2.decisions.length === 0, "新字段 decisions 默认 []");
ok(Array.isArray(v2.evidence) && v2.evidence.length === 0, "新字段 evidence 默认 []");
ok(v2.target === undefined && v2.constraints === undefined && v2.acceptance === undefined, "target/constraints/acceptance 未定义（无数据时不虚造）");
ok(v2.repoRevision === undefined && v2.paperRevision === undefined, "revision 未定义（无数据时不虚造）");

console.log("== 2. 幂等：normalize(v2) === v2 ==");
const v2b = normalizeReproduction(v2);
ok(specsEqual(v2, v2b), "normalize(normalize(x)) 不再改变数据（JSON 深等）");

console.log("== 3. 已带 schemaVersion:2 的数据幂等 ==");
const manual2 = { ...v2, schemaVersion: 2, target: { scope: "table", name: "Table 2", metrics: [{ name: "Accuracy", expected: 84.7, tolerance: 0.5 }] } };
const manual2n = normalizeReproduction(manual2);
ok(specsEqual(manual2, manual2n), "带 target 的 v2 数据 normalize 后不变");

console.log("== 4. 残缺/坏数据不崩、不丢 ==");
const empty = normalizeReproduction({});
ok(empty.slug === "" && empty.title === "" && empty.path.length === 0, "空对象 → 合法空 spec");
const nullInput = normalizeReproduction(null);
ok(nullInput.slug === "" && nullInput.schemaVersion === SPEC_VERSION, "null → 合法空 spec");
const withBad = normalizeReproduction({ ...v1, path: [{ id: "x", title: 123, status: "weird" }], pitfalls: [{ id: "p", text: "t", env: 1, createdAt: 0 }] });
ok(withBad.path[0].status === "todo" && withBad.path[0].title === "123", "坏 status 回退 todo、title 字符串化");
ok(withBad.pitfalls[0].env === true, "env 强制布尔");

console.log("== 5. 真实旧数据（用户目录）迁移 ==");
try {
  const raw = JSON.parse(readFileSync("/home/ark/.config/Research Atelier/data/reproduction.json", "utf-8"));
  const recs = raw.records ?? [];
  ok(recs.length >= 1, `读到 ${recs.length} 条真实记录`);
  for (const r of recs) {
    const n = normalizeReproduction(r);
    ok(n.schemaVersion === 2, `[${r.slug}] schemaVersion=2`);
    ok(n.title === r.title && JSON.stringify(n.path) === JSON.stringify(r.path ?? []), `[${r.slug}] title/path 保全`);
    ok(JSON.stringify(n.pitfalls) === JSON.stringify(r.pitfalls ?? []), `[${r.slug}] pitfalls 保全`);
    ok(specsEqual(n, normalizeReproduction(n)), `[${r.slug}] 幂等`);
  }
} catch (e) {
  ok(false, `真实数据读取失败：${e.message}`);
}

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
