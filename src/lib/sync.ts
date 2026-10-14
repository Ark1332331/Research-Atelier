import crypto from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readNewMessages, type SessionMessage } from "@/lib/execution-session";
import type { PaperProject, SyncRecord } from "@/lib/project";
import { readStore, writeStore } from "@/lib/store";

const execFileAsync = promisify(execFile);
const pendingFile = (id: string) => `sync-pending/${id}.json`;
const baselineFile = (id: string) => `sync-baselines/${id}.json`;

export interface SyncEvidence {
  code?: { available: boolean; changedFiles: string[]; message?: string };
  conversations: { sessionId: string; provider: "codex" | "dsh"; messages: SessionMessage[] }[];
}
export interface PendingSync { projectId: string; evidence: SyncEvidence; sessionCursors: Record<string, number>; hasEvidence: boolean }

async function git(repoPath: string, args: string[]) {
  const { stdout } = await execFileAsync("git", ["-C", repoPath, ...args], { timeout: 8000 });
  return stdout.trim();
}
function changedFiles(status: string) {
  return status.split("\n").filter(Boolean).map((line) => line.slice(3).split(" -> ").at(-1)?.trim() ?? "").filter(Boolean).slice(0, 30);
}
async function codeEvidence(project: PaperProject): Promise<{ evidence?: SyncEvidence["code"]; baseline?: { head: string; status: string } }> {
  const repoPath = project.workspace?.repoPath;
  if (!repoPath) return {};
  try {
    const [head, status, raw] = await Promise.all([git(repoPath, ["rev-parse", "HEAD"]), git(repoPath, ["status", "--porcelain=v1"]), readStore(baselineFile(project.id))]);
    const old = raw ? JSON.parse(raw) as { head?: string; status?: string } : {};
    return { evidence: { available: true, changedFiles: !old.head || old.head !== head || old.status !== status ? changedFiles(status) : [] }, baseline: { head, status } };
  } catch { return { evidence: { available: false, changedFiles: [], message: "关联目录不是可读取的 Git 仓库，已跳过代码版本比对。" } }; }
}

export async function collectPendingSync(project: PaperProject): Promise<PendingSync> {
  const [code, reads] = await Promise.all([codeEvidence(project), Promise.all(project.executionSessions.map(async (session) => ({ session, result: await readNewMessages(session) })))]);
  const conversations = reads.map(({ session, result }) => ({ sessionId: session.id, provider: session.provider, messages: result.messages.slice(-20) }));
  const sessionCursors = Object.fromEntries(reads.map(({ session, result }) => [session.id, result.cursor]));
  const pending: PendingSync = { projectId: project.id, evidence: { code: code.evidence, conversations }, sessionCursors, hasEvidence: Boolean(code.evidence?.changedFiles.length || conversations.some((item) => item.messages.length)) };
  // Persist evidence before advancing any cursor or code baseline.
  await writeStore(pendingFile(project.id), JSON.stringify(pending, null, 2));
  if (code.baseline) await writeStore(baselineFile(project.id), JSON.stringify(code.baseline, null, 2));
  return pending;
}
export async function readPendingSync(projectId: string): Promise<PendingSync | null> {
  const raw = await readStore(pendingFile(projectId));
  if (!raw) return null;
  try { const value = JSON.parse(raw) as PendingSync; return value.projectId === projectId ? value : null; } catch { return null; }
}
export function stateFor(pending: PendingSync) {
  const messages = pending.evidence.conversations.reduce((sum, item) => sum + item.messages.length, 0);
  const files = pending.evidence.code?.changedFiles.length ?? 0;
  const completed = pending.evidence.conversations.flatMap((item) => item.messages).reverse().find((item) => item.role === "assistant" && /(复现目标已完成|最终验收通过|最终评估[\s\S]*通过|已通过目标)/.test(item.text));
  if (completed) {
    const score = completed.text.match(/(\d+(?:\.\d+)?\s*±\s*\d+(?:\.\d+)?)/)?.[1];
    return {
      current: score ? `复现已完成：最终独立评估 ${score}，已通过验收。` : "复现已完成：执行会话已记录最终验收通过。",
      why: "最新执行会话给出了可复核的最终评估和完成结论；项目当前不再处于待复现状态。",
      nextStep: "归档复现命令、权重和环境证据；如需扩展，建立新的验证任务。",
      whyNow: "复现目标已有最终验收证据，应先固定结果而不是继续重复训练。",
      question: "是否需要对最终结果进行独立复核或扩展到新的研究问题？",
    };
  }
  if (!pending.hasEvidence) return { current: "已完成同步检查，暂无新增证据。", why: pending.evidence.code?.message ?? "没有检测到新的执行会话内容或 Git 变更。", nextStep: "继续执行或记录新的实验进展后再同步", whyNow: "本轮没有可写入项目历史的新证据。", question: "下一次实验最需要验证什么？" };
  const found = [messages ? `${messages} 条新的执行会话消息` : "", files ? `${files} 个 Git 工作区文件变更` : ""].filter(Boolean).join("，");
  return { current: `已同步：${found}。`, why: "同步只记录本地可验证的会话与代码证据，不将它们自动等同于实验已成功。", nextStep: messages ? "阅读本轮会话结论，确认下一项可验证实验" : "检查代码变更并运行对应验证", whyNow: "新的证据已写入项目历史，避免后续重复处理同一轮进展。", question: "这些新增证据最直接支持或否定了哪个假设？" };
}
export async function explainPendingSync(project: PaperProject, pending: PendingSync): Promise<{ record: SyncRecord; state: ReturnType<typeof stateFor> }> {
  const state = stateFor(pending);
  const record: SyncRecord = { id: crypto.randomUUID(), evidence: pending.evidence, explanation: state };
  return { record, state };
}
export async function clearPendingSync(projectId: string): Promise<void> {
  await writeStore(pendingFile(projectId), "");
}
