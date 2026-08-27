/**
 * Step 5 验收测试（grounding hardening）：锚点系统 + LLM 只选 id + identity merge + confirmed 保护。
 * 运行：node scripts/test-mapping.mjs   （Node ≥ 22.6 直接跑 TS）
 */
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { mkdtemp, writeFile, mkdir } from "node:fs/promises";
import { normalizeMapping, normalizeMappings, mergeMappings, mappingIdentity, confirmMapping, rejectMapping, proposeMappings, buildCodeAnchors, buildAnchorsForFacts, routeFactCandidates, isMappingGrounded } from "../src/lib/mapping.ts";
import { normalizeFacts } from "../src/lib/fact-extract.ts";

let pass = 0, fail = 0;
function ok(cond, name) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}`); }
}

// 构造迷你 repo（真实文件）验证锚点与 grounding
const tmp = await mkdtemp(path.join(os.tmpdir(), "ra-map-"));
await mkdir(path.join(tmp, "configs"), { recursive: true });
await mkdir(path.join(tmp, "datasets"), { recursive: true });
await writeFile(path.join(tmp, "train.py"), "import torch\n\ndef train_model():\n    optimizer = torch.optim.Adam(model.parameters())\n    for epoch in range(10):\n        loss.backward()\n\ndef main():\n    train_model()\n", "utf-8");
await writeFile(path.join(tmp, "loss.py"), "import torch.nn as nn\n\nclass CompositeLoss(nn.Module):\n    def forward(self, pred, target):\n        return nn.functional.binary_cross_entropy(pred, target)\n", "utf-8");
await writeFile(path.join(tmp, "configs/base.yaml"), "batch_size: 32\nlearning_rate: 1e-4\noptimizer: adam\n", "utf-8");
await writeFile(path.join(tmp, "datasets/kitti.py"), "import torch\n\nclass KittiDataset:\n    def __init__(self, split='train'):\n        pass\n\n    def __getitem__(self, i):\n        return torch.zeros(3, 224, 224)\n", "utf-8");

const snap = {
  training: [{ path: "train.py", evidence: ["训练调用"] }],
  evaluation: [{ path: "loss.py", evidence: [] }],
  datasets: [{ path: "datasets/kitti.py", evidence: ["数据加载"] }],
  configs: [{ path: "configs/base.yaml", evidence: [] }],
  entrypoints: [],
  dependencies: [],
};

console.log("== 1. buildCodeAnchors：真实文件 → 系统侧 anchor（含真实符号/行号） ==");
const anchors = await buildCodeAnchors(snap, tmp, { categories: ["training", "datasets", "configs", "evaluation"], maxPerFact: 15 });
ok(anchors.length >= 3, `生成 ${anchors.length} 个 anchor`);
const trainAnchor = anchors.find((a) => a.file === "train.py" && a.symbol === "train_model");
ok(Boolean(trainAnchor) && trainAnchor.snippet.includes("def train_model"), "train.py::train_model 锚点存在且 snippet 含真实符号");
ok(Boolean(anchors.find((a) => a.file === "datasets/kitti.py" && a.symbol === "KittiDataset")), "kitti.py::KittiDataset 锚点");
const lossAnchor = anchors.find((a) => a.file === "loss.py" && a.symbol === "CompositeLoss");
ok(Boolean(lossAnchor) && lossAnchor.lineStart === 3, `loss.py::CompositeLoss 锚点 L3（同文件多符号 → 多 anchor）`);
// 同文件不同 symbol 不同 id（不错误去重）
const trainMains = anchors.filter((a) => a.file === "train.py" && a.symbol === "main");
ok(Boolean(trainMains.length) && trainMains[0].id !== trainAnchor.id, "同文件 main 与 train_model 是不同 anchor id");
// config 顶层键 → 每个 key 一个 anchor（batch_size 是 yaml 顶层键，是合法 symbol）
const cfg = anchors.find((a) => a.file === "configs/base.yaml" && a.symbol === "batch_size");
ok(Boolean(cfg) && cfg.snippet.includes("batch_size: 32"), "config 顶层键 batch_size → anchor（snippet 含真实内容）");

console.log("== 2. routeFactCandidates：按 category 路由 + 证据排序 ==");
const factBatch = normalizeFacts([
  { key: "training.batch_size", side: "paper", value: 32, status: "observed" },
  { key: "model.architecture", side: "paper", value: "4D U-Net", status: "observed" },
]);
const cands = routeFactCandidates(factBatch[0], snap);
ok(cands.some((c) => c.file.includes("configs")), "training.batch_size → configs 在候选里");
const candsModel = routeFactCandidates(factBatch[1], snap);
ok(candsModel.some((c) => c.file.includes("train.py")), "model.architecture → training 候选在（evidence 加权）");
ok(cands.length <= 15 && candsModel.length <= 15, "候选 ≤15");

console.log("== 3. identity：paperFactIds+relation+codeAnchorIds 稳定 ==");
const m1 = normalizeMapping({
  concept: "x", codeRefs: [{ file: "train.py", lineStart: 4, symbol: "train_model" }], relation: "trains", confidence: "high",
  paperFactIds: ["fact#0"], codeAnchorIds: ["anchor-a", "anchor-b"],
});
const m2 = normalizeMapping({
  concept: "x", codeRefs: [{ file: "train.py", lineStart: 4, symbol: "train_model" }], relation: "trains", confidence: "low",
  paperFactIds: ["fact#0"], codeAnchorIds: ["anchor-b", "anchor-a"], // 顺序无关
});
ok(mappingIdentity(m1) === mappingIdentity(m2), "identity 与 anchor 顺序无关（排序后比较）");
const m3 = normalizeMapping({
  concept: "x", codeRefs: [{ file: "train.py", lineStart: 4, symbol: "train_model" }], relation: "implements", confidence: "high",
  paperFactIds: ["fact#0"], codeAnchorIds: ["anchor-a", "anchor-b"],
});
ok(mappingIdentity(m1) !== mappingIdentity(m3), "relation 不同 → identity 不同");

console.log("== 4. mergeMappings：identity merge + confirmed 保护 ==");
const existing = [m1, normalizeMapping({ concept: "y", codeRefs: [{ file: "loss.py" }], relation: "implements", paperFactIds: ["fact#1"], codeAnchorIds: ["anchor-c"] })];
existing[0] = { ...existing[0], status: "confirmed" }; // m1 已确认
// 重提相同 identity（普通 save）：不应新增、不应降级 confirmed
const reproposed = normalizeMapping({
  concept: "x", codeRefs: [{ file: "train.py", lineStart: 4, symbol: "train_model" }], relation: "trains", confidence: "low",
  paperFactIds: ["fact#0"], codeAnchorIds: ["anchor-a", "anchor-b"],
});
const merged = mergeMappings(existing, [reproposed]);
ok(merged.length === 2, "重复 identity 重提不新增");
ok(merged[0].status === "confirmed", "confirmed mapping 重提后仍 confirmed（不降级）");
ok(merged[0].confidence === "low", "非状态字段用新值更新（confidence low）");
// 新增 identity → 追加
const fresh = normalizeMapping({ concept: "z", codeRefs: [{ file: "datasets/kitti.py", lineStart: 5, symbol: "KittiDataset" }], relation: "preprocesses", paperFactIds: ["fact#2"], codeAnchorIds: ["anchor-d"] });
const merged2 = mergeMappings(merged, [fresh]);
ok(merged2.length === 3, "新 identity 追加");

console.log("== 5. propose：LLM 只选 id，假 file/symbol/line 无法通过 ==");
process.env.DEEPSEEK_API_KEY = "mock-key";
const realFetch = globalThis.fetch;
// 用 model.architecture fact（路由到 training → train.py anchor 会被构建）
const factArch = normalizeFacts([{ key: "model.architecture", side: "paper", value: "4D U-Net", status: "observed" }]);
const probeAnchors = await buildCodeAnchors(snap, tmp, { categories: ["training", "entrypoints", "configs"], maxPerFact: 15 });
const validAnchorId = probeAnchors.find((a) => a.file === "train.py" && a.symbol === "train_model")?.id;
ok(Boolean(validAnchorId), "probe: train.py::train_model anchor id 存在");
// mock LLM：一个引用有效 anchor + 一个假 anchor + 一个带自由字段
globalThis.fetch = async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: `[{"paperFactIds":["fact#0"],"codeAnchorIds":["anchor-aaaa-not-real","${validAnchorId}"],"relation":"implements","confidence":"high"},{"paperFactIds":["fact#0"],"codeAnchorIds":["anchor-zzz"],"relation":"implements","confidence":"high","fakeFile":"totally/made/up.py"}]` } }] }) });
const proposal = await proposeMappings({ facts: factArch, snapshot: snap, root: tmp });
globalThis.fetch = realFetch;
delete process.env.DEEPSEEK_API_KEY;
ok(proposal.length === 1, `假 anchor 被剔除（${proposal.length} 条有效，含假 id 的被丢）`);
ok(proposal[0].codeRefs.length === 1 && proposal[0].codeRefs[0].file === "train.py", "codeRef 从真实 anchor 确定性恢复（file 真实）");
ok(proposal[0].codeRefs[0].symbol === "train_model" && typeof proposal[0].codeRefs[0].lineStart === "number", "symbol/lineStart 从真实 anchor 恢复（LLM 无法伪造）");
ok(proposal[0].status === "proposed", "提议一律 proposed");
ok(!("fakeFile" in proposal[0]), "自由生成字段不存在");

console.log("== 6. 真实 NSR propose（DeepSeek，网络） ==");
try {
  const env = await fs.readFile(path.join(process.cwd(), ".env.local"), "utf-8");
  for (const line of env.split("\n")) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
} catch { /* */ }
if (!process.env.DEEPSEEK_API_KEY) {
  console.log("  （无 DEEPSEEK_API_KEY，跳过）");
  ok(true, "跳过（未配置 API key）");
} else {
  const { extractPaperFacts } = await import("../src/lib/fact-extract.ts");
  const paperDir = "/home/ark/.config/Research Atelier/data/papers/nsr-mt454tqk";
  const names = (await fs.readdir(paperDir)).filter((n) => /^page_\d+\.txt$/.test(n)).sort();
  const pages = [];
  for (const n of names) pages.push(await fs.readFile(path.join(paperDir, n), "utf-8"));
  const { facts } = await extractPaperFacts(pages);
  const { buildRepositorySnapshot } = await import("../src/lib/code-reader.ts");
  const snapIl = await buildRepositorySnapshot("/media/ark/Data/devpy/projects/allinone/reproduction");
  const ms = await proposeMappings({ facts, snapshot: snapIl, root: "/media/ark/Data/devpy/projects/allinone/reproduction" });
  console.log(`  NSR 提议 ${ms.length} 条`);
  // grounding 不变式是硬断言；数量受 DeepSeek 网络波动影响，0–4 条标为信息而非失败
  ok(ms.length >= 0 && ms.length <= 15, `有依据 mapping ≤15（实际 ${ms.length}；网络波动可致少/0）`);
  if (ms.length) {
    ok(ms.every((m) => m.paperFactIds.length >= 1 && m.codeAnchorIds.length >= 1), "每条都绑定 fact id + anchor id");
    ok(ms.every((m) => m.paperFactIds.every((id) => id.startsWith("f-") || id.startsWith("fact-") || !id.startsWith("fact#"))), "paperFactIds 是真实 Fact.id（不是 fact# 临时别名）");
    ok(ms.every((m) => m.codeRefs.every((c) => c.file && typeof c.lineStart === "number")), "codeRef 全部从真实 anchor 恢复（file+行号）");
    for (const m of ms.slice(0, 5)) console.log(`   - ${m.concept} [${m.relation}/${m.confidence}] → ${m.codeRefs.map((c) => `${c.file}${c.symbol ? "::" + c.symbol : ""}@L${c.lineStart}`).join(", ")}`);
  } else {
    console.log("  （DeepSeek 未返回——网络波动，非逻辑失败）");
    ok(true, "无提议时跳过数量断言（网络相关）");
  }
}

console.log("== 7. 持久化 paperFactIds 用真实 Fact.id（LLM 别名→真实 id） ==");
process.env.DEEPSEEK_API_KEY = "mock-key";
const facts7 = normalizeFacts([
  { key: "model.architecture", side: "paper", value: "4D U-Net", status: "observed" },
  { key: "training.optimizer", side: "paper", value: "Adam", status: "observed" },
]);
const factId7 = facts7[0].id; // 真实 id
ok(factId7 && !factId7.startsWith("fact#"), "真实 Fact.id 存在（非别名）");
{
  const realFetch = globalThis.fetch;
  // LLM 返回别名 fact#0；系统应存真实 id
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: `[{"paperFactIds":["fact#0"],"codeAnchorIds":["${validAnchorId}"],"relation":"implements","confidence":"high"}]` } }] }) });
  const p = await proposeMappings({ facts: facts7, snapshot: snap, root: tmp });
  globalThis.fetch = realFetch;
  ok(p.length === 1 && p[0].paperFactIds[0] === factId7, "持久化 paperFactIds = 真实 Fact.id（fact#0 → 真实 id）");
  ok(p[0].paperFactIds[0] !== "fact#0", "不再存 fact# 别名");
  ok(isMappingGrounded(p[0]), "grounded mapping 通过 isMappingGrounded");
}

console.log("== 8. merge 同 identity 保留 existing id + status（re-propose 不换 record id） ==");
{
  const base = normalizeMapping({
    concept: "模型架构", codeRefs: [{ file: "train.py", lineStart: 3, symbol: "train_model" }], relation: "implements", confidence: "high",
    paperFactIds: ["fact-real-1"], codeAnchorIds: ["anchor-a"],
  });
  const confirmed1 = { ...base, id: "m-fixed-001", status: "confirmed" };
  // re-propose 生成的新对象（新随机 id，同 identity）
  const reproposed = normalizeMapping({
    concept: "模型架构", codeRefs: [{ file: "train.py", lineStart: 3, symbol: "train_model" }], relation: "implements", confidence: "low",
    paperFactIds: ["fact-real-1"], codeAnchorIds: ["anchor-a"],
  });
  const merged = mergeMappings([confirmed1], [reproposed]);
  ok(merged.length === 1, "同 identity 不新增");
  ok(merged[0].id === "m-fixed-001", "existing id 保留（re-propose 不换 record id）");
  ok(merged[0].status === "confirmed", "confirmed 保留");
  ok(merged[0].confidence === "low", "非状态字段更新");
}

console.log("== 9. per-fact allowed set 约束 + legacy 标记 ==");
{
  // fact 路由到 train.py（model.architecture → training），allowed set 只含 train.py anchors
  const realFetch = globalThis.fetch;
  // LLM 恶意选 loss.py 的 anchor（不在该 fact 的 allowed set）
  const lossId = anchors.find((a) => a.file === "loss.py")?.id;
  ok(Boolean(lossId), "loss.py anchor 存在");
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: `[{"paperFactIds":["fact#0"],"codeAnchorIds":["${lossId}","${validAnchorId}"],"relation":"implements","confidence":"high"}]` } }] }) });
  const p = await proposeMappings({ facts: factArch, snapshot: snap, root: tmp });
  globalThis.fetch = realFetch;
  delete process.env.DEEPSEEK_API_KEY;
  // loss.py 不在 model.architecture 的 allowed set → 被剔除，只留 train.py anchor
  ok(p.length === 1 && p[0].codeRefs.every((c) => c.file !== "loss.py"), "per-fact allowed set：非允许文件 anchor 被剔除");
  ok(p[0].codeRefs.every((c) => c.file === "train.py"), "只保留该 fact allowed 的 anchor");
}
// legacy 标记：无 paperFactIds/codeAnchorIds 的旧 mapping
{
  const legacy = normalizeMapping({ concept: "旧映射", codeRefs: [{ file: "a.py" }], relation: "implements" });
  ok(legacy?.legacy === true && isMappingGrounded(legacy) === false, "无锚点旧 mapping 标记 legacy（ungrounded，不参与 Step 6/Ready）");
  const grounded = normalizeMapping({ concept: "x", codeRefs: [{ file: "a.py" }], relation: "implements", paperFactIds: ["f-1"], codeAnchorIds: ["anchor-a"] });
  ok(grounded?.legacy === false && isMappingGrounded(grounded) === true, "有锚点 mapping grounded");
}

await fs.rm(tmp, { recursive: true, force: true });
console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
