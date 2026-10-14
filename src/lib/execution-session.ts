import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import crypto from "node:crypto";
import type { ExecutionSession } from "@/lib/project";
const execFileAsync = promisify(execFile);
const SQLITE = process.env.RA_SQLITE_BIN ?? path.join(os.homedir(), "miniconda3", "bin", "sqlite3");
const CODEX_DB = path.join(os.homedir(), ".codex", "state_5.sqlite");
export interface SessionMessage { role: "user" | "assistant"; text: string }
export async function bindExecutionSession(deepLink: string): Promise<ExecutionSession> {
  const link = deepLink.trim(); const codex = link.match(/^codex:\/\/threads\/([\w-]+)$/);
  if (codex) return { id: crypto.randomUUID(), provider: "codex", threadId: codex[1], deepLink: link, cursor: 0 };
  if (link.endsWith(".jsonl")) return { id: crypto.randomUUID(), provider: "dsh", threadId: path.basename(link), deepLink: link, cursor: 0 };
  throw new Error("仅支持 codex://threads/<id> 或本地 .jsonl 会话文件");
}
async function rolloutPath(threadId: string): Promise<string | null> {
  try { const escaped = threadId.replace(/'/g, "''"); const { stdout } = await execFileAsync(SQLITE, [CODEX_DB, "SELECT rollout_path FROM threads WHERE id='" + escaped + "'"], { timeout: 6000 }); return stdout.trim() || null; } catch { return null; }
}
function readLines(text: string, dsh: boolean): SessionMessage[] {
  const messages: SessionMessage[] = [];
  const words = (value: unknown): string => Array.isArray(value) ? value.map(words).join(" ") : (value && typeof value === "object" ? String((value as { text?: string }).text ?? "") : "");
  for (const line of text.split("\n")) try {
    const item = JSON.parse(line);
    if (dsh && item?.type === "user/message") { const text = words(item.data?.content).trim(); if (text) messages.push({ role: "user", text }); }
    else if (dsh && item?.type === "assistant/message") { const text = words(item.data?.message?.content ?? item.data?.content).trim(); if (text) messages.push({ role: "assistant", text }); }
    else if (!dsh && item?.type === "response_item" && (item.payload?.role === "user" || item.payload?.role === "assistant")) {
      const text = (item.payload.content ?? []).map((part: { text?: string }) => part.text ?? "").join(" ").trim();
      if (text) messages.push({ role: item.payload.role, text });
    }
  } catch { /* invalid JSONL */ }
  return messages;
}
export async function readNewMessages(session: ExecutionSession, afterCursor = session.cursor): Promise<{ messages: SessionMessage[]; cursor: number }> {
  const source = session.provider === "codex" ? await rolloutPath(session.threadId) : session.deepLink;
  if (!source) return { messages: [], cursor: afterCursor };
  try { const all = readLines(await readFile(source, "utf-8"), session.provider === "dsh"); return { messages: all.slice(Math.max(0, afterCursor)), cursor: all.length }; } catch { return { messages: [], cursor: afterCursor }; }
}
