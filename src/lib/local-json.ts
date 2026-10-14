import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { DATA_DIR, useKV } from "./store.ts";
export async function readLocalArray<T>(rel: string): Promise<T[]> {
  try { const data = JSON.parse(await fs.readFile(path.join(DATA_DIR, rel), "utf8")); if (!Array.isArray(data)) throw Error("数据格式异常，原文件未覆盖"); return data; }
  catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT") return []; throw e; }
}
async function reclaim(lock: string) {
  const recovery = lock + ".recovery";
  try { await fs.mkdir(recovery); } catch { return; }
  try { const owner = JSON.parse(await fs.readFile(path.join(lock, "owner.json"), "utf8")); if (!Number.isInteger(owner.pid) || owner.pid <= 0) return;
    try { process.kill(owner.pid, 0); } catch (e) { if ((e as NodeJS.ErrnoException).code === "ESRCH") await fs.rm(lock, { recursive: true, force: true }); }
  } catch { /* A fresh lock may still be acquiring its owner. */ } finally { await fs.rm(recovery, { recursive: true, force: true }); }
}
export async function mutateLocalArray<T, R>(rel: string, fn: (items: T[]) => R): Promise<R> {
  if (useKV) throw Error("此功能需要本地开发数据目录");
  const file = path.join(DATA_DIR, rel); const lock = file + ".lock";
  await fs.mkdir(path.dirname(file), { recursive: true }); const deadline = Date.now() + 10000;
  while (true) { try { await fs.mkdir(lock); await fs.writeFile(path.join(lock, "owner.json"), JSON.stringify({ pid: process.pid })); break; }
    catch (e) { if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e; await reclaim(lock); if (Date.now() > deadline) throw Error("数据正在写入，请重试"); await new Promise(r => setTimeout(r, 30)); } }
  const temp = `${file}.${randomUUID()}.tmp`;
  try { const items = await readLocalArray<T>(rel); const result = fn(items); const handle = await fs.open(temp, "wx", 0o600); try { await handle.writeFile(JSON.stringify(items, null, 2)); await handle.sync(); } finally { await handle.close(); } await fs.rename(temp, file); return result; }
  finally { await fs.rm(temp, { force: true }); await fs.rm(lock, { recursive: true, force: true }); }
}
