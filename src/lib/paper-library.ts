/** 论文库（浏览器 IndexedDB 持久化）：上传的论文按名字存 blob，下次打开还在。
 *  内置 NSR 论文不打进库里（走 public/papers/nsr.pdf）。 */

const DB_NAME = "atelier-papers";
const STORE = "papers";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) {
        req.result.createObjectStore(STORE, { keyPath: "name" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export interface PaperMeta {
  name: string;
  size: number;
  ts: number;
}

export async function listPapers(): Promise<PaperMeta[]> {
  try {
    const db = await openDb();
    return await new Promise((resolve) => {
      const tx = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).getAll();
      req.onsuccess = () => resolve((req.result as PaperMeta[]).map(({ name, size, ts }) => ({ name, size, ts })));
      req.onerror = () => resolve([]);
    });
  } catch {
    return [];
  }
}

export async function savePaper(name: string, blob: Blob) {
  const db = await openDb();
  await new Promise<void>((resolve) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put({ name, size: blob.size, ts: Date.now(), blob });
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
  });
}

export async function loadPaper(name: string): Promise<Blob | null> {
  try {
    const db = await openDb();
    return await new Promise((resolve) => {
      const req = db.transaction(STORE, "readonly").objectStore(STORE).get(name);
      req.onsuccess = () => resolve((req.result as { blob?: Blob } | undefined)?.blob ?? null);
      req.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

export async function deletePaper(name: string) {
  const db = await openDb();
  await new Promise<void>((resolve) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(name);
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
  });
}
