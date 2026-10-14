import crypto from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
const dataDir = process.env.RA_DATA_DIR || path.join(process.cwd(), "data");
const readJson = async (name, fallback) => { try { return JSON.parse(await readFile(path.join(dataDir, name), "utf8")); } catch { return fallback; } };
const library = await readJson("library.json", { papers: [] });
const reproduction = await readJson("reproduction.json", { records: [] });
const old = await readJson("projects.json", { projects: [] });
const records = Array.isArray(reproduction.records) ? reproduction.records : [];
const byTitle = (title) => records.find((record) => record.title === title);
const projects = [];
for (const paper of Array.isArray(library.papers) ? library.papers : []) {
  if (!paper.slug) continue;
  const legacy = byTitle(paper.title);
  projects.push({
    id: crypto.randomUUID(), title: paper.title, venue: paper.venue || undefined, year: paper.year || undefined, paperSlug: paper.slug,
    reproState: { current: "尚未同步执行进展。" }, lastModule: "repro",
    notes: (legacy?.pitfalls || []).map((pitfall) => ({ id: crypto.randomUUID(), projectId: "", title: "迁移的复现笔记", content: pitfall.text, tags: pitfall.stage ? [pitfall.stage] : [], pinned: false, source: "pitfall-migration" })),
    history: [], executionSessions: [], environmentRefs: [], legacy: { reproductionSlug: legacy?.slug, libraryPaperId: paper.id },
  });
}
for (const record of records) {
  if (projects.some((project) => project.legacy?.reproductionSlug === record.slug)) continue;
  projects.push({
    id: crypto.randomUUID(), title: record.title, reproState: { current: "尚未同步执行进展。" }, lastModule: "repro",
    workspace: record.repoArtifact?.repoPath ? { repoRootId: record.repoArtifact.repoRootId, repoPath: record.repoArtifact.repoPath } : undefined,
    notes: (record.pitfalls || []).map((pitfall) => ({ id: crypto.randomUUID(), projectId: "", title: "迁移的复现笔记", content: pitfall.text, tags: pitfall.stage ? [pitfall.stage] : [], source: "pitfall-migration" })),
    history: [], executionSessions: [], environmentRefs: [], legacy: { reproductionSlug: record.slug },
  });
}
for (const project of projects) for (const note of project.notes) note.projectId = project.id;
const existingBySlug = new Map((old.projects || []).filter((project) => project.paperSlug).map((project) => [project.paperSlug, project]));
for (const project of projects) {
  const existing = project.paperSlug && existingBySlug.get(project.paperSlug);
  if (existing) Object.assign(project, existing, { title: project.title, venue: project.venue, year: project.year, paperSlug: project.paperSlug });
}
await writeFile(path.join(dataDir, "projects.json"), JSON.stringify({ projects }, null, 2) + "\n", "utf8");
console.log("migrated " + projects.length + " projects");
