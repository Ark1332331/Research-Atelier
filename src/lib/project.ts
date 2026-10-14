import crypto from "node:crypto";
import { readStore, writeStore } from "@/lib/store";

const FILE = "projects.json";
export type ProjectModule = "pdf" | "repro" | "notes" | "environment";
export interface ProjectNote { id: string; projectId: string; title: string; content: string; tags: string[]; pinned?: boolean; source?: string }
export interface SyncRecord { id: string; evidence: unknown; explanation?: unknown }
export interface ExecutionSession { id: string; provider: "codex" | "dsh"; threadId: string; deepLink: string; cursor: number }
export interface ProjectChatMessage { role: "user" | "assistant"; content: string; learningRunId?:string }
export interface PaperProject {
  id: string; title: string; venue?: string; year?: string; group?: string; paperSlug?: string;
  workspace?: { repoRootId?: string; repoPath: string };
  reproState: { current: string; why?: string; nextStep?: string; whyNow?: string; question?: string };
  lastModule: ProjectModule; notes: ProjectNote[]; history: SyncRecord[];
  executionSessions: ExecutionSession[]; environmentRefs: string[]; currentEnvironmentId?: string;
  aiMessages: ProjectChatMessage[];
  legacy?: { reproductionSlug?: string; libraryPaperId?: string };
}
interface ProjectStore { projects: PaperProject[]; groups: string[] }
function emptyProject(input: Pick<PaperProject, "title"> & Partial<PaperProject>): PaperProject {
  return {
    id: input.id ?? crypto.randomUUID(), title: input.title.trim() || "未命名项目",
    venue: input.venue, year: input.year, group: input.group, paperSlug: input.paperSlug, workspace: input.workspace,
    reproState: { current: input.reproState?.current ?? "尚未同步执行进展。", why: input.reproState?.why, nextStep: input.reproState?.nextStep, whyNow: input.reproState?.whyNow, question: input.reproState?.question },
    lastModule: input.lastModule ?? "repro", notes: Array.isArray(input.notes) ? input.notes : [],
    history: Array.isArray(input.history) ? input.history : [], executionSessions: Array.isArray(input.executionSessions) ? input.executionSessions : [],
    environmentRefs: Array.isArray(input.environmentRefs) ? input.environmentRefs : [], currentEnvironmentId: input.currentEnvironmentId, aiMessages: Array.isArray(input.aiMessages) ? input.aiMessages.filter((message): message is ProjectChatMessage => Boolean(message && (message.role === "user" || message.role === "assistant") && typeof message.content === "string")) : [], legacy: input.legacy,
  };
}
async function readProjects(): Promise<ProjectStore> {
  const raw = await readStore(FILE);
  if (!raw) return { projects: [], groups: [] };
  try {
    const data = JSON.parse(raw);
    const projects = Array.isArray(data?.projects) ? data.projects.filter((p: unknown) => p && typeof (p as PaperProject).title === "string").map((p: PaperProject) => emptyProject(p)) : [];
    const declared = Array.isArray(data?.groups) ? data.groups.filter((group: unknown) => typeof group === "string").map((group: string) => group.trim()).filter(Boolean) : [];
    const assigned = projects.map((project: PaperProject) => project.group?.trim() ?? "").filter(Boolean);
    return { projects, groups: [...new Set([...declared, ...assigned])] };
  } catch { return { projects: [], groups: [] }; }
}
async function save(store: ProjectStore): Promise<void> { await writeStore(FILE, JSON.stringify(store, null, 2)); }
export async function listProjects(): Promise<PaperProject[]> { return (await readProjects()).projects; }
export async function listProjectGroups(): Promise<string[]> { return (await readProjects()).groups; }
export async function createProjectGroup(name: string): Promise<string[]> {
  const group = name.trim().slice(0, 60);
  if (!group) throw new Error("请填写分组名称");
  const store = await readProjects();
  if (!store.groups.includes(group)) { store.groups.push(group); await save(store); }
  return store.groups;
}
export async function getProject(id: string): Promise<PaperProject | null> { return (await readProjects()).projects.find((project) => project.id === id) ?? null; }
export async function createProject(input: Pick<PaperProject, "title"> & Partial<PaperProject>): Promise<PaperProject> {
  const store = await readProjects(); const project = emptyProject(input); store.projects.push(project); await save(store); return project;
}
export async function updateProject(id: string, apply: (project: PaperProject) => void): Promise<PaperProject | null> {
  const store = await readProjects(); const project = store.projects.find((item) => item.id === id);
  if (!project) return null; apply(project); await save(store); return project;
}
export async function assignProjectGroup(id: string, name: string): Promise<PaperProject | null> {
  const store = await readProjects(); const project = store.projects.find((item) => item.id === id);
  if (!project) return null;
  const group = name.trim().slice(0, 60);
  project.group = group || undefined;
  if (group && !store.groups.includes(group)) store.groups.push(group);
  await save(store);
  return project;
}
/** Attach an imported PDF to a pre-created project without discarding its existing work. */
export async function attachPaperToProject(id: string, input: { slug: string; title: string; venue?: string; year?: string }): Promise<PaperProject | null> {
  const store = await readProjects();
  const project = store.projects.find((item) => item.id === id);
  if (!project) return null;
  if (project.paperSlug && project.paperSlug !== input.slug) throw new Error("这个项目已经关联了另一篇论文");
  project.paperSlug = input.slug;
  project.title = input.title || project.title;
  if (input.venue !== undefined) project.venue = input.venue;
  if (input.year !== undefined) project.year = input.year;
  await save(store);
  return project;
}
export async function deleteProject(id: string): Promise<boolean> {
  const store = await readProjects(); const length = store.projects.length; store.projects = store.projects.filter((project) => project.id !== id);
  if (store.projects.length === length) return false; await save(store); return true;
}
export async function ensureProjectForPaper(input: { slug: string; title: string; venue?: string; year?: string; libraryPaperId?: string }): Promise<PaperProject> {
  const store = await readProjects(); const existing = store.projects.find((project) => project.paperSlug === input.slug);
  if (existing) {
    let changed = false;
    if (input.title && existing.title !== input.title) { existing.title = input.title; changed = true; }
    if (input.venue !== undefined && existing.venue !== input.venue) { existing.venue = input.venue; changed = true; }
    if (input.year !== undefined && existing.year !== input.year) { existing.year = input.year; changed = true; }
    if (input.libraryPaperId && existing.legacy?.libraryPaperId !== input.libraryPaperId) { existing.legacy = { ...existing.legacy, libraryPaperId: input.libraryPaperId }; changed = true; }
    if (changed) await save(store); return existing;
  }
  const project = emptyProject({ title: input.title, paperSlug: input.slug, venue: input.venue, year: input.year, legacy: input.libraryPaperId ? { libraryPaperId: input.libraryPaperId } : undefined });
  store.projects.push(project); await save(store); return project;
}
