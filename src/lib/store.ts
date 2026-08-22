/**
 * 存储适配器（数据层地基）：
 * - 本地开发：读写 data/ 文件（现状不变，data/ 仍是本地真相源与种子数据）
 * - 桌面壳（Electron）：环境变量 RA_DATA_DIR 指向用户可写目录（app.getPath('userData')/data），
 *   打包后数据落在用户目录、不写死在安装目录；dev 不设该变量则行为与现状完全一致
 * - 生产（Vercel）：读写 Vercel KV（配置 VERCEL_KV_REST_API_URL + VERCEL_KV_REST_API_TOKEN 即自动切换）
 * - KV 首次为空时自动从 data/ 种子文件播种，保证部署后数据不丢
 * 依据：node_modules/next/dist/docs/01-app/01-getting-started/15-route-handlers.md
 */
import { promises as fs } from "node:fs";
import path from "node:path";

export const DATA_DIR = process.env.RA_DATA_DIR ?? path.join(process.cwd(), "data");
const KV_URL = process.env.VERCEL_KV_REST_API_URL;
const KV_TOKEN = process.env.VERCEL_KV_REST_API_TOKEN;
const useKV = Boolean(KV_URL && KV_TOKEN);

/** KV key = data/ 下的相对文件路径（如 glossary.json、profile.md、notes/screening.md） */
function kvKey(rel: string): string {
  return `data:${rel}`;
}

async function kvGet(rel: string): Promise<string | null> {
  try {
    const res = await fetch(`${KV_URL}/get/${encodeURIComponent(kvKey(rel))}`, {
      headers: { Authorization: `Bearer ${KV_TOKEN}` },
      cache: "no-store",
    });
    if (!res.ok) return null;
    const data = await res.json();
    return typeof data.result === "string" ? data.result : null;
  } catch {
    return null;
  }
}

async function kvSet(rel: string, value: string): Promise<void> {
  await fetch(`${KV_URL}/set/${encodeURIComponent(kvKey(rel))}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${KV_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(value),
  });
}

async function readSeed(rel: string): Promise<string | null> {
  try {
    return await fs.readFile(path.join(DATA_DIR, rel), "utf-8");
  } catch {
    return null;
  }
}

/** 读：KV 优先；KV 为空时读种子并自动播种（部署后首次访问不丢数据） */
export async function readStore(rel: string): Promise<string | null> {
  if (useKV) {
    const v = await kvGet(rel);
    if (v !== null) return v;
    const seed = await readSeed(rel);
    if (seed !== null) {
      await kvSet(rel, seed);
      return seed;
    }
    return null;
  }
  return readSeed(rel);
}

/** 写（覆盖）：KV 或文件 */
export async function writeStore(rel: string, content: string): Promise<void> {
  if (useKV) {
    await kvSet(rel, content);
    return;
  }
  const full = path.join(DATA_DIR, rel);
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, content, "utf-8");
}

/** 追加（带时间戳节）：用于筛选笔记、交接词 */
export async function appendStore(rel: string, block: string): Promise<void> {
  const stamp = new Date().toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" });
  const section = `\n\n## ${stamp}\n\n${block.trim()}\n`;
  if (useKV) {
    const existing = (await kvGet(rel)) ?? (await readSeed(rel)) ?? "";
    await kvSet(rel, existing ? existing.trimEnd() + section : section);
    return;
  }
  const full = path.join(DATA_DIR, rel);
  await fs.mkdir(path.dirname(full), { recursive: true });
  const existing = await fs.readFile(full, "utf-8").catch(() => "");
  await fs.writeFile(full, existing ? existing.trimEnd() + section : section, "utf-8");
}

export { useKV };
