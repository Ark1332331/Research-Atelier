/**
 * 翻译结果的落盘与状态读取（/api/paper 与 paper-tools 共用）：
 * - 成功 → translation.md（并清掉旧的错误标记）
 * - 失败 → translation.error.txt（原因可读化，阅读页据此展示并可重试）
 * 失败必须落盘可见：曾经静默跳过导致「导入提示正在翻译」但永远不出现，且无任何报错。
 */
import { promises as fs } from "node:fs";
import path from "node:path";

/** 判定 translateDocument 的返回是否为失败标记（未配置 key / 翻译失败） */
export function isTranslationFailure(translation: string): boolean {
  return !translation || translation.startsWith("（未配置") || translation.includes("（翻译失败");
}

export async function saveTranslationResult(dir: string, translation: string): Promise<"ok" | "error"> {
  if (isTranslationFailure(translation)) {
    await fs.writeFile(path.join(dir, "translation.error.txt"), translation || "（翻译失败：空结果）", "utf-8");
    return "error";
  }
  await fs.writeFile(path.join(dir, "translation.md"), translation, "utf-8");
  await fs.rm(path.join(dir, "translation.error.txt"), { force: true });
  return "ok";
}

/** 读错误标记（无则返回空串），供 GET /api/paper 返回给阅读页 */
export async function readTranslationError(dir: string): Promise<string> {
  return fs.readFile(path.join(dir, "translation.error.txt"), "utf-8").catch(() => "");
}

/** 生成中占位标记：防并发重复生成；超过 15 分钟视为残留（进程曾被杀），允许重新触发生成 */
export async function translationRunning(dir: string): Promise<boolean> {
  const marker = path.join(dir, "translation.running");
  try {
    const st = await fs.stat(marker);
    return Date.now() - st.mtimeMs < 15 * 60 * 1000;
  } catch {
    return false;
  }
}

export async function markTranslationRunning(dir: string): Promise<void> {
  await fs.writeFile(path.join(dir, "translation.running"), new Date().toISOString(), "utf-8");
}

export async function clearTranslationRunning(dir: string): Promise<void> {
  await fs.rm(path.join(dir, "translation.running"), { force: true });
}
