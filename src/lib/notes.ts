import crypto from "node:crypto";
import { getProject, updateProject, type ProjectNote } from "@/lib/project";
export async function listNotes(projectId: string): Promise<ProjectNote[] | null> { return (await getProject(projectId))?.notes ?? null; }
export async function saveNote(projectId: string, input: Partial<ProjectNote> & { title: string; content: string }): Promise<ProjectNote | null> {
  let saved: ProjectNote | null = null;
  await updateProject(projectId, (project) => {
    const existing = input.id ? project.notes.find((note) => note.id === input.id) : undefined;
    if (existing) { existing.title = input.title.trim() || existing.title; existing.content = input.content; existing.tags = Array.isArray(input.tags) ? input.tags.map(String).filter(Boolean) : existing.tags; existing.pinned = Boolean(input.pinned); saved = existing; return; }
    saved = { id: crypto.randomUUID(), projectId, title: input.title.trim() || "未命名笔记", content: input.content, tags: Array.isArray(input.tags) ? input.tags.map(String).filter(Boolean) : [], pinned: Boolean(input.pinned), source: input.source };
    project.notes.push(saved);
  });
  return saved;
}
export async function removeNote(projectId: string, noteId: string): Promise<boolean> {
  let removed = false; await updateProject(projectId, (project) => { const before = project.notes.length; project.notes = project.notes.filter((note) => note.id !== noteId); removed = project.notes.length !== before; }); return removed;
}
