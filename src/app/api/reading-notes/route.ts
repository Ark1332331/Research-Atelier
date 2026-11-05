import { createHash, randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from '@/lib/store';
import { mutateLocalArray, readLocalArray } from '@/lib/local-json';
import { validateAnchor, type ReadingAnchor } from '@/lib/reading-memory';
import { validateNoteComment, type ReadingNote } from '@/lib/reading-notes';

export const runtime = 'nodejs';
const FILE = 'reading-notes.json';

async function verifyDocument(anchor: ReadingAnchor) {
  if (!anchor.docId) return;
  if (!anchor.slug) throw Error('缺少论文标识');
  let bytes: Buffer;
  try {
    bytes = await fs.readFile(path.join(DATA_DIR, 'papers', anchor.slug, 'original.pdf'));
  } catch {
    throw Error('论文文件不存在或无法读取，请重新打开论文后选择');
  }
  if (createHash('sha256').update(bytes).digest('hex') !== anchor.docId) {
    throw Error('论文文件已变化，请刷新后重新选择');
  }
}

export async function GET() {
  try {
    return Response.json({notes: await readLocalArray<ReadingNote>(FILE)}, {headers: {'Cache-Control': 'no-store'}});
  } catch {
    return Response.json({error: '笔记加载失败，请检查数据文件后重试'}, {status: 500});
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw Error('笔记请求无效');
    if (body.action === 'save') {
      const anchor = validateAnchor(body.anchor);
      // Backslashes and control characters can turn an apparent local path into an external URL.
      if (!anchor.scope.startsWith('/') || anchor.scope.startsWith('//') || /[\\\u0000-\u0020\u007f]/.test(anchor.scope)) {
        throw Error('笔记来源必须是应用内页面');
      }
      const comment = validateNoteComment(body.comment);
      await verifyDocument(anchor);
      return Response.json(await mutateLocalArray<ReadingNote, {note: ReadingNote}>(FILE, items => {
        const existing = items.find(({anchor: source}) => source.scope === anchor.scope && source.sourceKey === anchor.sourceKey && source.start === anchor.start && source.end === anchor.end && source.text === anchor.text);
        if (existing) return {note: existing};
        const now = new Date().toISOString();
        const note: ReadingNote = {id: randomUUID(), anchor, comment, createdAt: now, updatedAt: now};
        items.push(note);
        return {note};
      }));
    }
    if (body.action !== 'update' && body.action !== 'delete') throw Error('笔记操作无效');
    if (typeof body.id !== 'string' || !body.id.trim()) throw Error('笔记不存在');
    const comment = body.action === 'update' ? validateNoteComment(body.comment) : undefined;
    return Response.json(await mutateLocalArray<ReadingNote, {note: ReadingNote} | {ok: true}>(FILE, items => {
      const index = items.findIndex(note => note.id === body.id);
      if (index < 0) throw Error('笔记不存在，可能已被删除');
      if (body.action === 'delete') {
        items.splice(index, 1);
        return {ok: true};
      }
      const note = items[index];
      note.comment = comment!;
      note.updatedAt = new Date().toISOString();
      return {note};
    }));
  } catch (error) {
    const message = error instanceof SyntaxError ? '请求或笔记数据格式无效，请检查后重试' : error instanceof Error ? error.message : '笔记保存失败，请重试';
    return Response.json({error: message}, {status: 400});
  }
}
