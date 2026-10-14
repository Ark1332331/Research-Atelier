import crypto from "node:crypto";
import { updateProject, type SyncRecord } from "@/lib/project";
export async function appendHistory(projectId: string, evidence: unknown, explanation?: unknown): Promise<SyncRecord | null> {
  const record: SyncRecord = { id: crypto.randomUUID(), evidence, explanation }; const project = await updateProject(projectId, (item) => { item.history.push(record); }); return project ? record : null;
}
export async function removeHistory(projectId: string, historyId: string): Promise<boolean> {
  let removed = false; await updateProject(projectId, (project) => { const before = project.history.length; project.history = project.history.filter((record) => record.id !== historyId); removed = project.history.length !== before; }); return removed;
}
