/**
 * Analyze orchestrator（阶段②）—— 服务端一次性编排，避免前端串联多个 API 导致半新半旧。
 *
 * 固定本轮 revision：
 *  - paperRevision = 论文正文页文件内容 hash（sha1，读 data/papers/<slug>/page_*.txt）
 *  - repoRevision = getRepoRevision(root)（commit/branch/dirty）
 * 同一轮内所有步骤（extraction → repo analyzer → facts → mapping → gaps）使用同一 revision。
 *
 * 产物持久化：
 *  - facts：merge（不覆盖已有不同值；不丢另一侧）
 *  - mappings：merge（identity 去重；confirmed 不被降级）
 *  - analysis state：status/ranAt/revision/summary 写入 record.analysis（防半新半旧）
 *
 * 返回摘要区分两类待处理问题：
 *  - need_scan：required not_scanned / coverage_unknown —— blocker 但不可用户 Decision（只能补扫描）
 *  - need_decision：value_conflict / source_conflict / not_found / uncomparable —— 可用户 Decision
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { promises as fs } from "node:fs";
import { createHash } from "node:crypto";
import { DATA_DIR } from "@/lib/store";
import { extractPaperFacts, extractRepoFacts } from "@/lib/fact-extract";
import { proposeMappings } from "@/lib/mapping";
import { blockingGaps, resolvableGaps, detectWithDecisions } from "@/lib/gap-detector";
import { buildRepositorySnapshot, getRepoRevision } from "@/lib/code-reader";
import type { ReproductionSpec, AnalysisState, Gap } from "@/lib/reproduction-spec";

/** 读论文正文页（按页码数字排序），返回 { pages, hash } */
export async function readPaperPages(slug: string, altTitle?: string): Promise<{ pages: string[]; hash: string }> {
  const dirs = [slug, altTitle ? altTitle.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40) : ""].filter(Boolean);
  for (const d of dirs) {
    const base = path.join(DATA_DIR, "papers", d);
    try {
      const names = (await fs.readdir(base)).filter((n) => /^page_\d+\.txt$/.test(n));
      names.sort((a, b) => {
        const na = Number((a.match(/page_(\d+)/) ?? [])[1] ?? 0);
        const nb = Number((b.match(/page_(\d+)/) ?? [])[1] ?? 0);
        return na - nb;
      });
      if (!names.length) continue;
      const pages: string[] = [];
      for (const n of names) pages.push(await readFile(path.join(base, n), "utf-8"));
      const hash = createHash("sha1").update(pages.join("\n")).digest("hex").slice(0, 16);
      return { pages, hash };
    } catch { /* 下一个候选目录 */ }
  }
  return { pages: [], hash: "" };
}

/** 区分两类待处理问题 */
export function classifyGaps(gaps: Gap[]): { needScan: Gap[]; needDecision: Gap[] } {
  return {
    needScan: gaps.filter((g) => g.type === "not_scanned"),
    needDecision: resolvableGaps(gaps),
  };
}

export interface AnalyzeInput {
  slug: string;
  title: string;
  rootId?: string;
  root?: string;
}

export interface AnalyzeResult {
  ok: boolean;
  analysis: AnalysisState;
  paperRevision: string;
  repoRevision: ReturnType<typeof getRepoRevision>;
  summary: NonNullable<AnalysisState["summary"]>;
  needScan: number;
  needDecision: number;
  error?: string;
}

/** 执行一轮完整分析并持久化产物到 record（返回 record 需要被调用方 upsert 或本函数 upsert） */
export async function runAnalysis(
  rec: ReproductionSpec,
  input: { root: string },
): Promise<AnalyzeResult> {
  const t0 = Date.now();
  const fail = (err: unknown): AnalyzeResult => ({
    ok: false,
    analysis: { status: "failed", ranAt: new Date().toISOString(), paperRevision: "", error: err instanceof Error ? err.message : String(err) },
    paperRevision: "", repoRevision: getRepoRevision(input.root),
    summary: { paperFacts: 0, repoFacts: 0, mappings: 0, gaps: 0, blocking: 0 },
    needScan: 0, needDecision: 0,
    error: err instanceof Error ? err.message : String(err),
  });

  try {
    // 1) 固定 revision + 本轮 run id
    const repoRev = getRepoRevision(input.root);
    const { pages, hash } = await readPaperPages(rec.slug, rec.title);
    const runId = `run-${Date.now().toString(36)}${Math.floor(Math.random() * 1000).toString(36)}`;

    // 2) paper extraction → paper facts（**保留 missing**：not_found/not_scanned/ambiguous/not_applicable 是 coverage 语义，不能丢）
    let paperFacts: Awaited<ReturnType<typeof extractPaperFacts>>["facts"] = [];
    if (pages.length) {
      const r = await extractPaperFacts(pages);
      paperFacts = r.facts;
    }

    // 3) repo analyzer snapshot → repo facts（沿 snapshot 候选，确定性）
    const snap = await buildRepositorySnapshot(input.root);
    const { facts: repoFacts } = await extractRepoFacts(snap, input.root);

    // 4) mapping propose（LLM 基于 paper facts + snapshot anchors）
    const mappings = await proposeMappings({ facts: paperFacts.filter((f) => f.status === "observed" || f.status === "inferred"), snapshot: snap, root: input.root });

    // 5) gaps：**用 detectWithDecisions（effective）**——当前 facts + 已有 decisions，避免 raw 与 effective 不一致
    const allFacts = [...paperFacts, ...repoFacts].map((f) => ({ ...f, runId }));
    const { effectiveGaps, staleDecisions } = detectWithDecisions(allFacts, rec.decisions ?? []);
    const blocking = blockingGaps(effectiveGaps);
    const { needScan, needDecision } = classifyGaps(effectiveGaps);

    // 6) 持久化：**替换而非 blind merge**（③）
    //    - facts：清掉上一轮系统生成的（runId 非当前 / user 保留），写入本轮（带 runId）
    //    - mappings：保留 confirmed（用户已确认），未确认的 proposed 用本轮替换
    const userFacts = (rec.facts ?? []).filter((f) => f.source?.kind === "user");
    rec.facts = [...userFacts, ...allFacts];
    const confirmedMappings = (rec.mappings ?? []).filter((m) => m.status === "confirmed");
    rec.mappings = [...confirmedMappings, ...mappings];
    rec.analysis = {
      status: "done", ranAt: new Date().toISOString(),
      paperRevision: hash || undefined,
      repoRevision: repoRev,
      summary: { paperFacts: paperFacts.length, repoFacts: repoFacts.length, mappings: mappings.length, gaps: effectiveGaps.length, blocking: blocking.length },
    };
    rec.paperRevision = { fileHash: hash || undefined };
    rec.repoRevision = repoRev;

    return {
      ok: true,
      analysis: rec.analysis,
      paperRevision: hash,
      repoRevision: repoRev,
      summary: rec.analysis.summary!,
      needScan: needScan.length,
      needDecision: needDecision.length,
    };
  } catch (e) {
    return fail(e);
  }
}
