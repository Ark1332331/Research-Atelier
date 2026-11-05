import crypto from "node:crypto";
import { readStore, writeStore, DATA_DIR, useKV } from "@/lib/store";
import { promises as fs } from "node:fs";
import path from "node:path";
import { withProjectLock } from "@/lib/project-lock";

const FILE = "projects.json";
export type ProjectModule = "pdf" | "repro" | "notes" | "environment";
export interface ProjectNote { id: string; projectId: string; title: string; content: string; tags: string[]; pinned?: boolean; source?: string }
export interface SyncRecord { id: string; evidence: unknown; explanation?: unknown }
export interface ExecutionSession { id: string; provider: "codex" | "dsh"; threadId: string; deepLink: string; cursor: number }
export interface ProjectChatMessage { role: "user" | "assistant"; content: string; learningRunId?:string }
export interface PaperProject {
  id: string; title: string; venue?: string; year?: string; group?: string; paperSlug?: string; pdfAvailable?: boolean;
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
    if(!Array.isArray(data?.projects))throw Error("invalid project store");
    const projects = Array.isArray(data?.projects) ? data.projects.filter((p: unknown) => p && typeof (p as PaperProject).title === "string").map((p: PaperProject) => emptyProject(p)) : [];
    const declared = Array.isArray(data?.groups) ? data.groups.filter((group: unknown) => typeof group === "string").map((group: string) => group.trim()).filter(Boolean) : [];
    const assigned = projects.map((project: PaperProject) => project.group?.trim() ?? "").filter(Boolean);
    return { projects, groups: [...new Set([...declared, ...assigned])] };
  } catch { throw Error("项目记录格式异常，未覆盖原文件"); }
}
async function save(store: ProjectStore): Promise<void> {
  const content=JSON.stringify(store,null,2);if(useKV){await writeStore(FILE,content);return;}
  await fs.mkdir(DATA_DIR,{recursive:true});const temp=path.join(DATA_DIR,`projects.${crypto.randomUUID()}.tmp`);
  try{await fs.writeFile(temp,content,'utf8');await fs.rename(temp,path.join(DATA_DIR,FILE));}finally{await fs.rm(temp,{force:true});}
}
export async function listProjects(): Promise<PaperProject[]> { return (await readProjects()).projects; }
export async function listProjectGroups(): Promise<string[]> { return (await readProjects()).groups; }
export async function createProjectGroup(name: string): Promise<string[]> {
  return withProjectLock(async()=>{
    const group = name.trim().slice(0, 60);
    if (!group) throw new Error("请填写分组名称");
    const store = await readProjects();
    if (!store.groups.includes(group)) { store.groups.push(group); await save(store); }
    return store.groups;
  });
}
export async function getProject(id: string): Promise<PaperProject | null> { return (await readProjects()).projects.find((project) => project.id === id) ?? null; }
export async function createProject(input: Pick<PaperProject, "title"> & Partial<PaperProject>): Promise<PaperProject> {
  return withProjectLock(async()=>{
    const store = await readProjects(); const project = emptyProject(input); store.projects.push(project); await save(store); return project;
  });
}
export async function updateProject(id: string, apply: (project: PaperProject) => void): Promise<PaperProject | null> {
  return withProjectLock(async()=>{
    const store = await readProjects(); const project = store.projects.find((item) => item.id === id);
    if (!project) return null; apply(project); await save(store); return project;
  });
}
export async function assignProjectGroup(id: string, name: string): Promise<PaperProject | null> {
  return withProjectLock(async()=>{
    const store = await readProjects(); const project = store.projects.find((item) => item.id === id);
    if (!project) return null;
    const group = name.trim().slice(0, 60);
    project.group = group || undefined;
    if (group && !store.groups.includes(group)) store.groups.push(group);
    await save(store);
    return project;
  });
}
/** Attach an imported PDF to a pre-created project without discarding its existing work. */
export async function attachPaperToProject(id: string, input: { slug: string; title: string; venue?: string; year?: string }): Promise<PaperProject | null> {
  return withProjectLock(async()=>{
    const store = await readProjects();
    const project = store.projects.find((item) => item.id === id);
    if (!project) return null;
    if (project.paperSlug && project.paperSlug !== input.slug && await fs.stat(path.join(DATA_DIR,'papers',project.paperSlug,'original.pdf')).then(s=>s.isFile()).catch(()=>false)) throw new Error("这个项目已经关联了另一篇论文");
    if (store.projects.some(item => item.id !== id && item.paperSlug === input.slug)) throw new Error("这份 PDF 已有论文项目，请从论文库打开已有项目；当前笔记仍保留在这里。");
    project.paperSlug = input.slug;
    project.title = input.title || project.title;
    if (input.venue !== undefined) project.venue = input.venue;
    if (input.year !== undefined) project.year = input.year;
    await save(store);
    return project;
  });
}
export async function deleteProject(id: string): Promise<boolean> {
  return withProjectLock(async()=>{
    const store = await readProjects(); const length = store.projects.length; store.projects = store.projects.filter((project) => project.id !== id);
    if (store.projects.length === length) return false; await save(store); return true;
  });
}
export async function ensureProjectForPaper(input: { slug: string; title: string; venue?: string; year?: string; libraryPaperId?: string }): Promise<PaperProject> {
  return withProjectLock(async()=>{
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
  });
}

/** Batch lifecycle edits share the same lock as grouping, notes and imports. */
export async function removeProjectsForPaper(slug:string):Promise<string[]> {
  return withProjectLock(async()=>{const store=await readProjects();const ids=store.projects.filter(p=>p.paperSlug===slug).map(p=>p.id);store.projects=store.projects.filter(p=>p.paperSlug!==slug);if(ids.length)await save(store);return ids;});
}
export async function renameProjectsForPaper(slug:string,title:string):Promise<void> {
  return withProjectLock(async()=>{const store=await readProjects();for(const project of store.projects)if(project.paperSlug===slug)project.title=title;await save(store);});
}
