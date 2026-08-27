/**
 * ResearchSession 存储薄层（引入 store 适配器；仅供路由使用，测试不 import 本文件）。
 */
import { readStore, writeStore } from "../store.ts";
import { normalizeSession } from "./session.ts";
import type { ResearchSession } from "./types.ts";

function key(id: string): string { return "research-sessions/" + id + ".json"; }

export async function loadSession(id: string): Promise<ResearchSession | null> {
  const raw = await readStore(key(id));
  if (!raw) return null;
  try { return normalizeSession(JSON.parse(raw)); } catch { return null; }
}

export async function saveSession(s: ResearchSession): Promise<void> {
  await writeStore(key(s.id), JSON.stringify(s, null, 2));
}

