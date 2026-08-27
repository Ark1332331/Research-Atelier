/**
 * 复现记录存储层（复现工作台数据层）：data/reproduction.json —— { records: ReproductionSpec[] }
 * 纯 spec 类型与幂等迁移 normalizeReproduction 在 ./reproduction-spec.ts（无副作用，可单测）。
 * 本文件负责：读写 JSON、摘要列表、增删改查——全部经过 normalize 保证 v2 结构。
 */
import { readStore, writeStore } from "@/lib/store";
import { normalizeReproduction, SPEC_VERSION, type ReproductionSpec } from "@/lib/reproduction-spec";

export * from "@/lib/reproduction-spec";

const FILE = "reproduction.json";

interface Store { records: ReproductionSpec[] }

async function readStore2(): Promise<Store> {
  const raw = await readStore(FILE);
  if (raw) {
    try {
      const d = JSON.parse(raw);
      if (d && Array.isArray(d.records)) return d as Store;
    } catch { /* 忽略坏数据 */ }
  }
  return { records: [] };
}

async function writeStore2(s: Store): Promise<void> {
  await writeStore(FILE, JSON.stringify(s, null, 2));
}

export function idFor(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}${Math.floor(Math.random() * 1000).toString(36)}`;
}

/** 返回摘要列表（不含 pitfalls 正文，避免过大） */
export async function listReproductions(): Promise<{ slug: string; title: string; sourceUrl?: string; repoUrl?: string; pathCount: number; doneCount: number; pitfallCount: number; updatedAt?: string }[]> {
  const s = await readStore2();
  return s.records.map((r) => ({
    slug: r.slug,
    title: r.title,
    sourceUrl: r.sourceUrl,
    repoUrl: r.repoUrl,
    pathCount: r.path.length,
    doneCount: r.path.filter((x) => x.status === "done").length,
    pitfallCount: r.pitfalls.length,
    updatedAt: r.updatedAt,
  }));
}

export async function getReproduction(slug: string): Promise<ReproductionSpec | null> {
  const s = await readStore2();
  const r = s.records.find((x) => x.slug === slug);
  return r ? normalizeReproduction(r) : null;
}

/** 宽松输入：允许 v1/部分字段（create 等旧调用路径），内部 normalize 补全 */
export type ReproductionInput = Partial<ReproductionSpec> & { slug: string; title?: string };

export async function upsertReproduction(r: ReproductionInput): Promise<Store> {
  const s = await readStore2();
  const normalized = normalizeReproduction(r);
  normalized.updatedAt = new Date().toISOString();
  const i = s.records.findIndex((x) => x.slug === normalized.slug);
  if (i >= 0) s.records[i] = normalized;
  else s.records.push(normalized);
  await writeStore2(s);
  return s;
}

export async function deleteReproduction(slug: string): Promise<Store> {
  const s = await readStore2();
  s.records = s.records.filter((x) => x.slug !== slug);
  await writeStore2(s);
  return s;
}
