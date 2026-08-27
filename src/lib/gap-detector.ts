/**
 * Gap Detector + Resolution（Step 6 resolution hardening）。
 *
 * 完全确定性，LLM 不参与是否冲突的判定。按 taxonomy key 分组比较 normalizedValue：
 *  - value_conflict：跨侧（paper vs repo）同 key normalizedValue 不同（都有值）
 *  - source_conflict：同侧（paper 内 或 repo 内）不同来源 normalizedValue 不同；**两侧的都要报告**，且保留全部候选（不只前两个）
 *  - not_found：一侧 required missing（missingType=not_found）→ 另一侧有值；或一侧有值、另一侧该 key **完全 absent**
 *  - not_scanned：一侧 missing 且 missingType=not_scanned（未扫描）→ **required 时是 Ready blocker，但不可通过 Decision 消解**（只能补扫描）
 *  - uncomparable：一侧有值但无 normalizedValue（enum 无法归一化等）
 *  - missing_required：该 key 两侧都无 observed/inferred 且 importance=required
 *  - ambiguous：一侧 missing 但 missingType=ambiguous（来源有歧义）→ 可消解（视同需决策）
 *  - not_applicable：一侧 missing 且 missingType=not_applicable（该 key 不适用此侧）→ 不报 gap
 *
 * Resolution：
 *  - gapFingerprint：type + key + 参与 Fact IDs + normalized/missing state（确定性）；
 *  - Decision 保存 gapFingerprint；证据变化后旧 Decision 标 stale，不得继续消解新 gap；
 *  - applyDecisions(facts, decisions) → effective facts：accepted + 非 stale 的 decision 把
 *    source_conflict 精简同侧候选（选中的保留、另一侧继续跨侧比较），value_conflict/not_found/uncomparable
 *    收敛为选择值（custom → 合成 user fact）；避免"选了 paper=32、repo=64 却因 source gap 已解决而假 Ready"。
 */
import { factDef, KNOWN_FACTS } from "./fact-taxonomy.ts";
import { createHash } from "node:crypto";
import type { Fact, Gap, GapType, Decision, DecisionChoice, FactMissingType } from "@/lib/reproduction-spec";

export function gapId(key: string, type: GapType, salt = ""): string {
  return `gap-${key.replace(/[^a-z0-9]+/gi, "-")}-${type}${salt}`;
}

/** 确定性指纹：type + key + 参与 Fact IDs + normalized/missing state */
export function gapFingerprint(g: Gap): string {
  const pf = [...g.paperFacts].map((f) => `${f.id}:${JSON.stringify(f.normalizedValue ?? f.value)}:${f.status}`).sort().join(",");
  const rf = [...g.repoFacts].map((f) => `${f.id}:${JSON.stringify(f.normalizedValue ?? f.value)}:${f.status}`).sort().join(",");
  return createHash("sha1").update(`${g.type}|${g.key}|P{${pf}}|R{${rf}}`).digest("hex").slice(0, 16);
}

function severityOf(key: string, type: GapType): Gap["severity"] {
  const def = factDef(key);
  const importance = def?.importance ?? "recommended";
  if (type === "not_scanned" || type === "uncomparable") return importance === "required" ? "high" : "low";
  if (type === "value_conflict" || type === "source_conflict") return importance === "required" ? "critical" : "medium";
  return importance === "required" ? "high" : "low";
}

/** required not_scanned → Ready blocker（但 resolvableGaps 排除它，不能 Decision 消解） */
function blocksReadyOf(key: string, type: GapType): boolean {
  const def = factDef(key);
  const importance = def?.importance ?? "recommended";
  return importance === "required"; // value/source/not_found/not_scanned/uncomparable/missing_required 的 required 都阻塞
}

const observed = (f: Fact) => f.status === "observed" || f.status === "inferred";

function mkGap(o: {
  key: string; type: GapType; salt?: string; paperFacts: Fact[]; repoFacts: Fact[];
  paperValue?: unknown; repoValue?: unknown; paperNormalized?: unknown; repoNormalized?: unknown; description: string;
}): Gap {
  const def = factDef(o.key);
  const category = def?.category ?? "training";
  return {
    id: gapId(o.key, o.type, o.salt), key: o.key, category,
    type: o.type, severity: severityOf(o.key, o.type), blocksReady: blocksReadyOf(o.key, o.type),
    paperFacts: o.paperFacts, repoFacts: o.repoFacts,
    paperValue: o.paperValue, repoValue: o.repoValue, paperNormalized: o.paperNormalized, repoNormalized: o.repoNormalized,
    description: o.description,
  };
}

/** 确定性 Gap 检测（raw facts） */
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
    if (!def) continue;
    const paper = all.filter((f) => f.side === "paper" && observed(f));
    const repo = all.filter((f) => f.side === "repo" && observed(f));
    const paperMissing = all.filter((f) => f.side === "paper" && f.status === "missing");
    const repoMissing = all.filter((f) => f.side === "repo" && f.status === "missing");
    const missingType = (f: Fact): FactMissingType | undefined => f.missingType;

    // —— 同侧 source conflict：paper 与 repo 两侧都报告，且保留全部候选 ——
    const groupByNorm = (arr: Fact[]) => {
      const m = new Map<string, Fact[]>();
      for (const f of arr) {
        const k = JSON.stringify(f.normalizedValue ?? `raw:${String(f.value)}`);
        (m.get(k) ?? m.set(k, []).get(k)!).push(f);
      }
      return m;
    };
    const paperGroups = groupByNorm(paper);
    if (paperGroups.size > 1) {
      const cands = [...paperGroups.values()].flat();
      gaps.push(mkGap({
        key, type: "source_conflict", salt: "-paper", paperFacts: cands, repoFacts: [],
        paperValue: cands[0].value, paperNormalized: cands[0].normalizedValue,
        description: `论文侧对 ${key} 有 ${cands.length} 个不同值（${cands.map((c) => `${c.value}@${c.source?.kind === "paper" ? c.source.section ?? "?" : "?"}`).join(" vs ")}），需用户选定一个`,
      }));
    }
    const repoGroups = groupByNorm(repo);
    if (repoGroups.size > 1) {
      const cands = [...repoGroups.values()].flat();
      gaps.push(mkGap({
        key, type: "source_conflict", salt: "-repo", paperFacts: [], repoFacts: cands,
        repoValue: cands[0].value, repoNormalized: cands[0].normalizedValue,
        description: `仓库侧对 ${key} 有 ${cands.length} 个不同值（${cands.map((c) => `${c.value}@${c.source?.kind === "repo" ? c.source.file : "?"}`).join(" vs ")}，如不同 config），需用户选定一个`,
      }));
    }

    // —— 跨侧比较（仅当同侧无 source conflict 时才有可比性）——
    const paperCmp = paper.length === 1 ? paper[0] : undefined;
    const repoCmp = repo.length === 1 ? repo[0] : undefined;
    if (paperCmp && repoCmp) {
      if (paperCmp.normalizedValue !== undefined && repoCmp.normalizedValue !== undefined) {
        if (JSON.stringify(paperCmp.normalizedValue) !== JSON.stringify(repoCmp.normalizedValue)) {
          gaps.push(mkGap({
            key, type: "value_conflict", paperFacts: [paperCmp], repoFacts: [repoCmp],
            paperValue: paperCmp.value, repoValue: repoCmp.value, paperNormalized: paperCmp.normalizedValue, repoNormalized: repoCmp.normalizedValue,
            description: `论文说 ${key}=${paperCmp.value}，代码说 ${key}=${repoCmp.value}（normalized: ${paperCmp.normalizedValue} vs ${repoCmp.normalizedValue}）`,
          }));
        }
        continue;
      }
      gaps.push(mkGap({
        key, type: "uncomparable", paperFacts: [paperCmp], repoFacts: [repoCmp],
        paperValue: paperCmp.value, repoValue: repoCmp.value, paperNormalized: paperCmp.normalizedValue, repoNormalized: repoCmp.normalizedValue,
        description: `论文说 ${key}=${paperCmp.value}，代码说 ${key}=${repoCmp.value}，但至少一方无法归一化，无法自动比较`,
      }));
      continue;
    }

    // —— 一侧有值、另一侧 missing / absent ——
    const otherSideMissing = (hasSide: Fact[], missingArr: Fact[], absentSide: "paper" | "repo") => {
      const notFound = missingArr.find((f) => missingType(f) === "not_found");
      const notScanned = missingArr.find((f) => missingType(f) === "not_scanned");
      const ambiguous = missingArr.find((f) => missingType(f) === "ambiguous");
      const notApplicable = missingArr.find((f) => missingType(f) === "not_applicable");
      const sideKey = absentSide === "paper" ? "repo" : "paper";
      const src = sideKey === "paper" ? paper : repo;
      const v = src[0]?.value;
      if (notFound) {
        gaps.push(mkGap({
          key, type: "not_found",
          paperFacts: absentSide === "paper" ? [notFound] : hasSide, repoFacts: absentSide === "repo" ? [notFound] : hasSide,
          paperValue: absentSide === "paper" ? undefined : v, repoValue: absentSide === "repo" ? undefined : v,
          description: `${sideKey} 说 ${key}=${v}，但${absentSide}侧扫描后未找到（not_found）`,
        }));
      } else if (notScanned) {
        gaps.push(mkGap({
          key, type: "not_scanned",
          paperFacts: absentSide === "paper" ? [notScanned] : hasSide, repoFacts: absentSide === "repo" ? [notScanned] : hasSide,
          paperValue: absentSide === "paper" ? undefined : v, repoValue: absentSide === "repo" ? undefined : v,
          description: `${sideKey} 说 ${key}=${v}，但${absentSide}侧未扫描到（not_scanned；不可 Decision 消解，只能补扫描）`,
        }));
      } else if (ambiguous) {
        gaps.push(mkGap({
          key, type: "source_conflict", salt: `-${absentSide}-amb`,
          paperFacts: absentSide === "paper" ? [ambiguous] : hasSide, repoFacts: absentSide === "repo" ? [ambiguous] : hasSide,
          paperValue: absentSide === "paper" ? undefined : v, repoValue: absentSide === "repo" ? undefined : v,
          description: `${absentSide}侧对 ${key} 来源有歧义（ambiguous），需用户判定`,
        }));
      } else if (!notApplicable) {
        // 一侧有值、另一侧**完全没有该 key 的 Fact record**：没有扫描证据，不得判 not_found；
        // 按 not_scanned（coverage_unknown）处理：required 阻塞且不可 Decision。
        gaps.push(mkGap({
          key, type: "not_scanned", salt: "-absent",
          paperFacts: absentSide === "paper" ? [] : hasSide, repoFacts: absentSide === "repo" ? [] : hasSide,
          paperValue: absentSide === "paper" ? undefined : v, repoValue: absentSide === "repo" ? undefined : v,
          description: `${sideKey} 说 ${key}=${v}，但${absentSide}侧完全没有该 key 的记录（coverage_unknown；需扫描确认，不可 Decision 消解）`,
        }));
      }
      // not_applicable → 不报 gap
    };
    if (paper.length && !repo.length) otherSideMissing(paper, repoMissing, "repo");
    else if (repo.length && !paper.length) otherSideMissing(repo, paperMissing, "paper");
  }

  // —— missing_required：required key 两侧都无 observed/inferred，且未在上面报告 ——
  const reported = new Set(gaps.map((g) => g.key + ":" + g.type));
  for (const def of KNOWN_FACTS) {
    if (def.importance !== "required") continue;
    const allF = byKey.get(def.key) ?? [];
    const hasObserved = allF.some(observed);
    const isNotApplicable = allF.length > 0 && allF.every((f) => f.status === "missing" && f.missingType === "not_applicable");
    if (!hasObserved && !reported.has(`${def.key}:missing_required`) && !isNotApplicable) {
      gaps.push(mkGap({
        key: def.key, type: "missing_required", salt: "",
        paperFacts: allF.filter((f) => f.side === "paper"), repoFacts: allF.filter((f) => f.side === "repo"),
        description: `论文与仓库两侧都没有 ${def.key}（required）`,
      }));
    }
  }

  return gaps;
}

/** Ready blockers：required unresolved（含 required not_scanned——阻塞但不可 Decision 消解） */
export function blockingGaps(gaps: Gap[]): Gap[] {
  return gaps.filter((g) => g.blocksReady);
}

/** 可 Decision 消解的 gap：value_conflict/source_conflict/not_found/uncomparable/ambiguous；
 *  not_scanned（只能补扫描）与 missing_required 不可消解。 */
export function resolvableGaps(gaps: Gap[]): Gap[] {
  return gaps.filter((g) => ["value_conflict", "source_conflict", "not_found", "uncomparable"].includes(g.type));
}

/* ================= Decision 生命周期 ================= */

/** 生成待决 Decision（引用 gapId + 真实 fact ids + fingerprint，不存裸值） */
export function decisionForGap(gap: Gap): Decision {
  return {
    id: `d-${Date.now().toString(36)}${Math.floor(Math.random() * 1000).toString(36)}`,
    gapId: gap.id, gapType: gap.type, gapFingerprint: gapFingerprint(gap),
    key: gap.key,
    paperFactIds: gap.paperFacts.map((f) => f.id),
    repoFactIds: gap.repoFacts.map((f) => f.id),
    status: "pending", blocksReady: gap.blocksReady,
  };
}

/** Decision 是否 stale：当前 gaps 里找不到对应 gap，或 fingerprint 不匹配（证据已变） */
export function isDecisionStale(d: Decision, currentGaps: Gap[]): boolean {
  const g = currentGaps.find((x) => x.id === d.gapId);
  if (!g) return true;
  if (d.gapFingerprint && g && gapFingerprint(g) !== d.gapFingerprint) return true;
  return false;
}

/** 合成 resolved fact 的确定性 id：由 key + gapFingerprint + side 派生（同 decision 重复 resolve 结果一致） */
export function resolvedFactId(key: string, gapFingerprint: string | undefined, side: "paper" | "repo"): string {
  return `f-res-${createHash("sha1").update(`${key}|${gapFingerprint ?? "no-fp"}|${side}`).digest("hex").slice(0, 12)}`;
}

/** 合成 resolved fact（custom choice 用；id 确定性派生，不用 Date.now/random） */
function makeResolvedFact(key: string, side: "paper" | "repo", value: unknown, fp?: string): Fact {
  const def = factDef(key);
  const { normalizedValue, unit } = normalizeValue(value, { valueType: def?.valueType ?? "string", enumValues: def?.enumValues, key });
  return {
    id: resolvedFactId(key, fp, side),
    key, side, value, normalizedValue, unit,
    status: "observed", confidence: "high", importance: def?.importance ?? "recommended",
    source: { kind: "user", note: `用户通过 Decision 定义（fingerprint ${fp?.slice(0, 8) ?? "?"}）` },
  };
}

import { normalizeValue } from "./fact-extract.ts";

/** 单个 Decision 应用：source_conflict 保留同侧选中（custom → 合成该侧 resolved fact）；其余收敛为选择值 */
function applyOneDecision(facts: Fact[], d: Decision, gap: Gap, fp: string): Fact[] {
  const out = [...facts];
  const remove = (id: string) => {
    const i = out.findIndex((f) => f.id === id);
    if (i >= 0) out.splice(i, 1);
  };
  const paperIds = new Set(gap.paperFacts.map((f) => f.id));
  const repoIds = new Set(gap.repoFacts.map((f) => f.id));
  const involved = [...gap.paperFacts, ...gap.repoFacts];
  const choice: DecisionChoice | undefined = d.choice;

  if (gap.type === "source_conflict") {
    // 冲突侧 = paper 有多个候选 → paper；否则 repo
    const conflictSide: "paper" | "repo" = paperIds.size > 1 ? "paper" : "repo";
    const sideIds = conflictSide === "paper" ? paperIds : repoIds;
    if (choice?.kind === "fact") {
      for (const id of sideIds) if (id !== choice.factId) remove(id);
    } else if (choice?.kind === "custom") {
      // 真实生效：该冲突侧全部移除，合成 deterministic resolved fact；另一侧保留 → 继续跨侧比较
      for (const id of sideIds) remove(id);
      out.push(makeResolvedFact(d.key, conflictSide, choice.value, fp));
    }
    return out;
  }

  // value_conflict / not_found / uncomparable：收敛为选择值
  if (choice?.kind === "fact") {
    const chosenFact = involved.find((f) => f.id === choice.factId);
    if (!chosenFact) return out;
    const chosenSide = chosenFact.side;
    for (const id of [...paperIds, ...repoIds]) if (id !== choice.factId) remove(id);
    // 另一侧若无 observed/inferred → 补 deterministic resolved fact（值取选中 fact）
    const otherSide: "paper" | "repo" = chosenSide === "paper" ? "repo" : "paper";
    if (!out.some((f) => f.side === otherSide && f.key === d.key && (f.status === "observed" || f.status === "inferred"))) {
      out.push(makeResolvedFact(d.key, otherSide, chosenFact.value, fp));
    }
  } else if (choice?.kind === "custom") {
    for (const id of [...paperIds, ...repoIds]) remove(id);
    out.push(makeResolvedFact(d.key, "paper", choice.value, fp));
    out.push(makeResolvedFact(d.key, "repo", choice.value, fp));
  }
  return out;
}

/** choice 有效性：fact choice 必须是参与且 observed/inferred 的真实事实（不能选 missing marker） */
function validChoiceFor(d: Decision, gap: Gap): boolean {
  const choice = d.choice;
  if (!choice) return false;
  if (choice.kind === "custom") return true;
  const f = [...gap.paperFacts, ...gap.repoFacts].find((x) => x.id === choice.factId);
  return Boolean(f && (f.status === "observed" || f.status === "inferred"));
}

/**
 * 迭代 fixed-point resolution engine：
 * 从 raw facts 出发，重复「detect gaps → 应用与当前 gaps 匹配的 accepted decisions」直到不动点。
 * source_conflict 决定后暴露的新 value_conflict 在下一轮被第二个 Decision 消解（多层链式消解）。
 * 只应用 accepted 且非 stale 的 decision；gap 不存在或 fingerprint 不匹配 → stale。
 */
export function resolveToFixedPoint(facts: Fact[], decisions: Decision[]): {
  effectiveFacts: Fact[]; finalGaps: Gap[]; applied: string[]; stale: Decision[];
} {
  let cur = [...facts];
  const applied = new Set<string>();
  const stale: Decision[] = [];
  // 确定性顺序：按 decision id 排序
  const sorted = [...decisions].sort((a, b) => (a.id ?? "").localeCompare(b.id ?? ""));
  for (let round = 0; round < 12; round++) {
    const gaps = detectGaps(cur);
    let progressed = false;
    for (const d of sorted) {
      if (d.status !== "accepted" || applied.has(d.id) || stale.some((s) => s.id === d.id)) continue;
      const gap = gaps.find((g) => g.id === d.gapId);
      if (!gap) continue; // gap 尚未出现（可能在后续轮次由其他 decision 应用后产生）——不标 stale
      const fp = gapFingerprint(gap);
      if (d.gapFingerprint && fp !== d.gapFingerprint) { stale.push(d); continue; }
      if (!validChoiceFor(d, gap)) { stale.push(d); continue; }
      cur = applyOneDecision(cur, d, gap, fp);
      applied.add(d.id);
      progressed = true;
    }
    if (!progressed) break;
  }
  // 到不动点仍未应用的 accepted decisions：其 gap 从未出现 → stale（证据已变/无法消解）
  for (const d of sorted) {
    if (d.status === "accepted" && !applied.has(d.id) && !stale.some((s) => s.id === d.id)) stale.push(d);
  }
  // applied 语义 = 真正消解成功（不含 stale 失败的）
  return { effectiveFacts: cur, finalGaps: detectGaps(cur), applied: [...applied], stale };
}

/** 完整流程：raw facts + decisions → fixed-point effective facts → gaps（含 stale 标注） */
export function detectWithDecisions(facts: Fact[], decisions: Decision[]): {
  effectiveFacts: Fact[]; rawGaps: Gap[]; effectiveGaps: Gap[]; staleDecisions: Decision[]; applied: string[];
} {
  const rawGaps = detectGaps(facts);
  const { effectiveFacts, finalGaps, applied, stale } = resolveToFixedPoint(facts, decisions);
  return { effectiveFacts, rawGaps, effectiveGaps: finalGaps, staleDecisions: stale, applied };
}
