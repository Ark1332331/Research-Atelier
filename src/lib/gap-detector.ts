/**
 * Gap Detector（Step 6）—— 完全确定性，LLM 不参与是否冲突的判定。
 *
 * 按 taxonomy key 分组比较 normalizedValue：
 *  - value_conflict：跨侧（paper vs repo）同 key normalizedValue 不同（都有值）
 *  - source_conflict：同侧（paper 内 或 repo 内）不同来源 normalizedValue 不同（Step 4 冲突保留的候选）
 *  - not_found：一侧 required missing（missingType=not_found）→ 另一侧有值
 *  - not_scanned：一侧 missing 且 missingType=not_scanned（未扫描）→ 不可消解，不生成 Decision
 *  - uncomparable：一侧有值但无 normalizedValue（enum 无法归一化等）
 *  - missing_required：该 key 两侧都无 observed/inferred 且 importance=required
 *
 * 输出：Gap[]（derived，不持久化；每次 GET 动态算）。
 */
import { factDef, KNOWN_FACTS } from "./fact-taxonomy.ts";
import type { Fact, Gap, GapType, Decision } from "@/lib/reproduction-spec";

export function gapId(key: string, type: GapType, salt = ""): string {
  return `gap-${key.replace(/[^a-z0-9]+/gi, "-")}-${type}${salt}`;
}

function severityOf(key: string, type: GapType): Gap["severity"] {
  const def = factDef(key);
  const importance = def?.importance ?? "recommended";
  if (type === "not_scanned" || type === "uncomparable") return importance === "required" ? "high" : "low";
  if (type === "value_conflict" || type === "source_conflict") return importance === "required" ? "critical" : "medium";
  return importance === "required" ? "high" : "low"; // not_found / missing_required
}

function blocksReadyOf(key: string, type: GapType): boolean {
  const def = factDef(key);
  const importance = def?.importance ?? "recommended";
  if (type === "not_scanned") return false; // 未扫描不可消解，但也不该靠它 block（待扫描后重算）
  if (type === "uncomparable") return importance === "required";
  return importance === "required"; // value_conflict / source_conflict / not_found / missing_required
}

const observed = (f: Fact) => f.status === "observed" || f.status === "inferred";

/** 确定性 Gap 检测：按 taxonomy key 分组，比较 normalizedValue */
export function detectGaps(facts: Fact[]): Gap[] {
  const gaps: Gap[] = [];
  const byKey = new Map<string, Fact[]>();
  for (const f of facts) {
    const arr = byKey.get(f.key) ?? [];
    arr.push(f);
    byKey.set(f.key, arr);
  }

  for (const [key, all] of byKey) {
    const def = factDef(key);
    if (!def) continue; // 未知 key 不应存在于正式 facts
    const category = def.category;
    const paper = all.filter((f) => f.side === "paper" && observed(f));
    const repo = all.filter((f) => f.side === "repo" && observed(f));
    const paperMissing = all.filter((f) => f.side === "paper" && f.status === "missing");
    const repoMissing = all.filter((f) => f.side === "repo" && f.status === "missing");

    // 1) 同侧 source conflict（Step 4 冲突保留的候选）
    const paperNorm = new Map<string, Fact>();
    for (const f of paper) paperNorm.set(JSON.stringify(f.normalizedValue), f);
    if (paperNorm.size > 1) {
      const [a, b] = [...paperNorm.values()];
      gaps.push({
        id: gapId(key, "source_conflict", "-paper"), key, category,
        type: "source_conflict", severity: severityOf(key, "source_conflict"), blocksReady: blocksReadyOf(key, "source_conflict"),
        paperFacts: [a, b], repoFacts: [],
        paperValue: a.value, paperNormalized: a.normalizedValue,
        description: `论文侧对 ${key} 有多个不同值（${a.value} vs ${b.value}），需用户判定哪个为准`,
      });
      continue;
    }
    const repoNorm = new Map<string, Fact>();
    for (const f of repo) repoNorm.set(JSON.stringify(f.normalizedValue), f);
    if (repoNorm.size > 1) {
      const [a, b] = [...repoNorm.values()];
      gaps.push({
        id: gapId(key, "source_conflict", "-repo"), key, category,
        type: "source_conflict", severity: severityOf(key, "source_conflict"), blocksReady: blocksReadyOf(key, "source_conflict"),
        paperFacts: [], repoFacts: [a, b],
        repoValue: a.value, repoNormalized: a.normalizedValue,
        description: `仓库侧对 ${key} 有多个不同值（${a.value} vs ${b.value}，如不同 config），需用户判定哪个为准`,
      });
      continue;
    }

    // 2) 跨侧 value conflict：paper 有值且 repo 有值
    if (paper.length && repo.length) {
      const p = paper[0], r = repo[0];
      if (p.normalizedValue !== undefined && r.normalizedValue !== undefined) {
        if (JSON.stringify(p.normalizedValue) !== JSON.stringify(r.normalizedValue)) {
          gaps.push({
            id: gapId(key, "value_conflict"), key, category,
            type: "value_conflict", severity: severityOf(key, "value_conflict"), blocksReady: blocksReadyOf(key, "value_conflict"),
            paperFacts: paper, repoFacts: repo,
            paperValue: p.value, repoValue: r.value, paperNormalized: p.normalizedValue, repoNormalized: r.normalizedValue,
            description: `论文说 ${key}=${p.value}，代码说 ${key}=${r.value}（normalized: ${p.normalizedValue} vs ${r.normalizedValue}）`,
          });
        }
        continue;
      }
      // 3) uncomparable：一方有值但无 normalizedValue
      gaps.push({
        id: gapId(key, "uncomparable"), key, category,
        type: "uncomparable", severity: severityOf(key, "uncomparable"), blocksReady: blocksReadyOf(key, "uncomparable"),
        paperFacts: paper, repoFacts: repo,
        paperValue: p.value, repoValue: r.value, paperNormalized: p.normalizedValue, repoNormalized: r.normalizedValue,
        description: `论文说 ${key}=${p.value}，代码说 ${key}=${r.value}，但至少一方无法归一化（normalizedValue 缺失），无法自动比较`,
      });
      continue;
    }

    // 4) 一侧有值，另一侧 missing
    if (paper.length && repoMissing.some((f) => f.missingType === "not_found")) {
      gaps.push({
        id: gapId(key, "not_found"), key, category,
        type: "not_found", severity: severityOf(key, "not_found"), blocksReady: blocksReadyOf(key, "not_found"),
        paperFacts: paper, repoFacts: repoMissing,
        paperValue: paper[0].value,
        description: `论文说 ${key}=${paper[0].value}，但仓库侧扫描后未找到（not_found）`,
      });
      continue;
    }
    if (paper.length && repoMissing.some((f) => f.missingType === "not_scanned")) {
      gaps.push({
        id: gapId(key, "not_scanned"), key, category,
        type: "not_scanned", severity: severityOf(key, "not_scanned"), blocksReady: false,
        paperFacts: paper, repoFacts: repoMissing,
        paperValue: paper[0].value,
        description: `论文说 ${key}=${paper[0].value}，但仓库侧未扫描到相关文件（not_scanned，不可消解；待扫描后重算）`,
      });
      continue;
    }
    if (repo.length && paperMissing.some((f) => f.missingType === "not_found")) {
      gaps.push({
        id: gapId(key, "not_found"), key, category,
        type: "not_found", severity: severityOf(key, "not_found"), blocksReady: blocksReadyOf(key, "not_found"),
        paperFacts: paperMissing, repoFacts: repo,
        repoValue: repo[0].value,
        description: `代码说 ${key}=${repo[0].value}，但论文完整扫描后未找到（not_found）`,
      });
      continue;
    }
    if (repo.length && paperMissing.some((f) => f.missingType === "not_scanned")) {
      gaps.push({
        id: gapId(key, "not_scanned"), key, category,
        type: "not_scanned", severity: severityOf(key, "not_scanned"), blocksReady: false,
        paperFacts: paperMissing, repoFacts: repo,
        repoValue: repo[0].value,
        description: `代码说 ${key}=${repo[0].value}，但论文侧未扫描到（not_scanned，不可消解；待扫描后重算）`,
      });
      continue;
    }
  }

  // 5) missing_required：required key 两侧都无 observed/inferred（且未出现在上面任何分支）
  const seenKeys = new Set(gaps.map((g) => g.key));
  for (const def of KNOWN_FACTS) {
    if (def.importance !== "required") continue;
    if (!byKey.has(def.key)) {
      gaps.push({
        id: gapId(def.key, "missing_required"), key: def.key, category: def.category,
        type: "missing_required", severity: "high", blocksReady: true,
        paperFacts: [], repoFacts: [],
        description: `论文与仓库两侧都没有 ${def.key}（required），完全缺失`,
      });
      continue;
    }
    // key 存在但所有 fact 都是 missing
    const allF = byKey.get(def.key)!;
    if (allF.every((f) => f.status === "missing") && !seenKeys.has(def.key)) {
      gaps.push({
        id: gapId(def.key, "missing_required"), key: def.key, category: def.category,
        type: "missing_required", severity: "high", blocksReady: true,
        paperFacts: allF.filter((f) => f.side === "paper"), repoFacts: allF.filter((f) => f.side === "repo"),
        description: `论文与仓库两侧都没有 ${def.key}（required；两侧均 missing）`,
      });
    }
  }

  return gaps;
}

/** 参与 Ready Gate 的 blockers：required unresolved gap（不含 not_scanned） */
export function blockingGaps(gaps: Gap[]): Gap[] {
  return gaps.filter((g) => g.blocksReady && g.type !== "not_scanned");
}

/** 可被 Decision 消解的 gap：value_conflict / source_conflict / not_found / uncomparable；
 *  not_scanned 不可通过 Decision 消解（未扫描≠不存在，需先扫描）。 */
export function resolvableGaps(gaps: Gap[]): Gap[] {
  return gaps.filter((g) => g.type !== "not_scanned" && g.type !== "missing_required");
}

/** 为 gap 生成一条待决 Decision（引用 gapId + 真实 fact ids，不存裸值） */
export function decisionForGap(gap: Gap, rationaleHint?: string): Decision {
  return {
    id: `d-${Date.now().toString(36)}${Math.floor(Math.random() * 1000).toString(36)}`,
    gapId: gap.id,
    key: gap.key,
    paperFactIds: gap.paperFacts.map((f) => f.id),
    repoFactIds: gap.repoFacts.map((f) => f.id),
    chosen: undefined,
    rationale: rationaleHint,
    impact: undefined,
    status: "pending",
    blocksReady: gap.blocksReady,
  };
}
