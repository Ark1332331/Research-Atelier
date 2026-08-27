/**
 * 复现记录（复现工作台数据层）：data/reproduction.json —— { records: Reproduction[] }
 * Reproduction:
 *   { slug, title, sourceUrl?, repoUrl?, note?,
 *     path: Step[] (复现路径分层步骤，AI 草案→用户调整→勾状态),
 *     pitfalls: Pitfall[] (坑点：文本/是否环境相关/关联阶段/关联论文与线程/时间),
 *     createdAt, updatedAt }
 * Step:   { id, title, status: "todo"|"doing"|"done", note? }
 * Pitfall:{ id, text, env: boolean, stage?, papers?: string[], threads?: string[], createdAt }
 */
import { readStore, writeStore } from "@/lib/store";

const FILE = "reproduction.json";

export interface ReproductionStep { id: string; title: string; status: "todo" | "doing" | "done"; note?: string }
export interface ReproductionPitfall {
  id: string; text: string; env: boolean; stage?: string;
  papers?: string[]; threads?: string[]; createdAt: string;
}
export interface Reproduction {
  slug: string;
  title: string;
  sourceUrl?: string;
  repoUrl?: string;
  note?: string;
  path: ReproductionStep[];
  pitfalls: ReproductionPitfall[];
  createdAt?: string;
  updatedAt?: string;
}

interface Store { records: Reproduction[] }

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

export async function getReproduction(slug: string): Promise<Reproduction | null> {
  const s = await readStore2();
  return s.records.find((x) => x.slug === slug) ?? null;
}

export async function upsertReproduction(r: Reproduction): Promise<Store> {
  const s = await readStore2();
  const i = s.records.findIndex((x) => x.slug === r.slug);
  r.updatedAt = new Date().toISOString();
  if (i >= 0) s.records[i] = r;
  else s.records.push(r);
  await writeStore2(s);
  return s;
}

export async function deleteReproduction(slug: string): Promise<Store> {
  const s = await readStore2();
  s.records = s.records.filter((x) => x.slug !== slug);
  await writeStore2(s);
  return s;
}
