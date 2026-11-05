import {randomUUID, createHash} from 'node:crypto';
import {promises as fs} from 'node:fs';
import path from 'node:path';
import {unified} from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import {DATA_DIR} from './store.ts';
import {mutateLocalArray, readLocalArray} from './local-json.ts';
import type {StudyDocument, StudyImportResult, StudyLibraryResult, StudyNode} from './study-library-types.ts';

export const STUDY_IMPORT_LIMITS = {files: 3000, fileBytes: 16 * 1024 * 1024, batchBytes: 128 * 1024 * 1024};
const INDEX = 'study-library/index.json';
const ROOT = path.join(DATA_DIR, 'study-library');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
type Source = {id: string; importId: string; sourcePath: string; sha256: string; mime: string};
type State = {version: 1; nodes: StudyNode[]; sources: Source[]};
type Upload = {path: string; file: File; integrity?: {bytes: number; sha256: string}};

export class StudyLibraryError extends Error {
  status: number;
  constructor(message: string, status = 400) { super(message); this.status = status; }
}
function fail(message: string): never { throw new StudyLibraryError(message); }
function stateFrom(items: State[]): State {
  if (items.length === 0) return {version: 1, nodes: [], sources: []};
  const state = items[0];
  if (items.length !== 1 || state.version !== 1 || !Array.isArray(state.nodes) || !Array.isArray(state.sources)) {
    throw new Error('学习库索引格式异常，原文件未覆盖');
  }
  return state;
}
const readState = async () => stateFrom(await readLocalArray<State>(INDEX));
async function mutate<T>(fn: (state: State) => T): Promise<T> {
  return mutateLocalArray<State, T>(INDEX, items => {
    const state = stateFrom(items);
    const result = fn(state);
    items.splice(0, items.length, state);
    return result;
  });
}
function nodeById(state: State, id: unknown): StudyNode {
  const node = state.nodes.find(node => node.id === id);
  if (!node) fail('学习库项目不存在或已删除');
  return node;
}
function parentNode(state: State, id: unknown): StudyNode {
  const node = nodeById(state, id);
  if (node.kind === 'document') fail('文档不能作为父目录');
  return node;
}
function nameValue(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 200 || /[\u0000-\u001f\u007f]/.test(value)) fail('名称不能为空，且不能超过 200 个字符或包含控制字符');
  return value.trim();
}
function newNode(state: State, kind: StudyNode['kind'], name: string, parentId: string | null, id: string = randomUUID()): StudyNode {
  const now = new Date().toISOString();
  const node: StudyNode = {id, parentId, kind, name, order: state.nodes.filter(node => node.parentId === parentId).length, createdAt: now, updatedAt: now};
  state.nodes.push(node);
  return node;
}
function reorder(state: State, parentId: string | null) {
  state.nodes.filter(node => node.parentId === parentId).sort((a, b) => a.order - b.order).forEach((node, order) => {node.order = order;});
}
export async function listStudyNodes(): Promise<StudyNode[]> { return (await readState()).nodes; }

export async function mutateStudyTree(input: unknown): Promise<StudyLibraryResult> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail('无效的学习库请求');
  const body = input as Record<string, unknown>;
  return mutate(state => {
    if (body.action === 'create') {
      if (body.kind !== 'library' && body.kind !== 'folder') fail('只能新建学习库或文件夹');
      const parentId = body.parentId ?? null;
      if (body.kind === 'library' ? parentId !== null : parentId === null) fail('学习库必须位于根目录，文件夹必须位于学习库内');
      if (parentId !== null) parentNode(state, parentId);
      const created = newNode(state, body.kind, nameValue(body.name), parentId as string | null);
      return {nodes: state.nodes, createdId: created.id};
    } else if (body.action === 'rename') {
      const node = nodeById(state, body.id);
      node.name = nameValue(body.name);
      node.updatedAt = new Date().toISOString();
    } else if (body.action === 'move') {
      const node = nodeById(state, body.id);
      const parentId = body.parentId;
      if (node.kind === 'library' ? parentId !== null : typeof parentId !== 'string') fail('学习库必须位于根目录，文件夹和文档必须位于学习库内');
      if (parentId !== null) {
        let ancestor: StudyNode | undefined = parentNode(state, parentId);
        const seen = new Set<string>();
        while (ancestor) {
          if (ancestor.id === node.id || seen.has(ancestor.id)) fail('不能移动到自身或自己的子目录');
          seen.add(ancestor.id);
          ancestor = ancestor.parentId ? nodeById(state, ancestor.parentId) : undefined;
        }
      }
      const siblings = state.nodes.filter(item => item.parentId === parentId && item.id !== node.id).sort((a, b) => a.order - b.order);
      let position = siblings.length;
      if (body.beforeId !== undefined) {
        if (body.beforeId === node.id && parentId === node.parentId) return {nodes: state.nodes};
        position = siblings.findIndex(item => item.id === body.beforeId);
        if (position < 0) fail('排序目标必须位于同一目录');
      }
      const oldParent = node.parentId;
      node.parentId = parentId as string | null;
      node.updatedAt = new Date().toISOString();
      siblings.splice(position, 0, node);
      siblings.forEach((item, order) => {item.order = order;});
      if (oldParent !== node.parentId) reorder(state, oldParent);
    } else if (body.action === 'delete') {
      const node = nodeById(state, body.id);
      const deleted = new Set([node.id]);
      let previous = 0;
      while (previous !== deleted.size) {
        previous = deleted.size;
        for (const item of state.nodes) if (item.parentId && deleted.has(item.parentId)) deleted.add(item.id);
      }
      state.nodes = state.nodes.filter(item => !deleted.has(item.id));
      const documents = new Set(state.nodes.filter(item => item.kind === 'document').map(item => item.id));
      const activeImports = new Set(state.sources.filter(source => documents.has(source.id)).map(source => source.importId));
      state.sources = state.sources.filter(source => activeImports.has(source.importId) && (source.mime !== 'text/markdown' || documents.has(source.id)));
      reorder(state, node.parentId);
      // Immutable blob files are retained. Never remove a shared asset while another document
      // or an in-flight reader can still refer to it; metadata controls all public access.
    } else fail('未知的学习库操作');
    return {nodes: state.nodes};
  });
}

function importPath(value: unknown): string {
  if (typeof value !== 'string' || !value || value.length > 1500 || /[\\:\u0000-\u001f\u007f]/.test(value) || value.startsWith('/')) fail('导入路径无效');
  const segments = value.normalize('NFC').split('/');
  if (segments.length > 40 || segments.some(part => !part || part === '.' || part === '..' || part.length > 200)) fail('导入路径不能包含空段、相对跳转或过深目录');
  return segments.join('/');
}
function imageMime(extension: string, bytes: Buffer): string {
  const mime = ({'.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp'} as Record<string, string>)[extension];
  const valid = extension === '.png' ? bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))
    : extension === '.jpg' || extension === '.jpeg' ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
    : extension === '.gif' ? ['GIF87a', 'GIF89a'].includes(bytes.subarray(0, 6).toString('ascii'))
    : extension === '.webp' && bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP';
  if (!mime || !valid) fail('图片格式与文件内容不匹配');
  return mime;
}
function blobPath(importId: string, id: string): string {
  if (!UUID.test(importId) || !UUID.test(id)) throw new Error('学习库文件标识损坏');
  return path.join(ROOT, 'imports', importId, id);
}

export async function importStudyFiles(parentId: unknown, uploads: Upload[]): Promise<StudyImportResult> {
  if (typeof parentId !== 'string' || !parentId) fail('请先选择导入目标学习库或文件夹');
  parentNode(await readState(), parentId);
  if (!Array.isArray(uploads) || !uploads.length || uploads.length > STUDY_IMPORT_LIMITS.files) fail('每次请导入 1 至 3000 个文件');
  let total = 0;
  const paths = new Set<string>();
  const checked = uploads.map(upload => {
    const sourcePath = importPath(upload.path);
    const key = sourcePath.toLocaleLowerCase('en-US');
    if (paths.has(key)) fail('同一批导入存在重复路径');
    paths.add(key);
    if (!(upload.file instanceof File) || upload.file.size > STUDY_IMPORT_LIMITS.fileBytes) fail('单个文件不能超过 16 MiB');
    total += upload.file.size;
    if (total > STUDY_IMPORT_LIMITS.batchBytes) fail('单次导入不能超过 128 MiB');
    if (upload.integrity !== undefined && (!upload.integrity || !Number.isSafeInteger(upload.integrity.bytes) || upload.integrity.bytes < 0 || typeof upload.integrity.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(upload.integrity.sha256))) fail('导入完整性校验信息无效');
    return {sourcePath, file: upload.file, integrity: upload.integrity};
  });
  const directories = new Map<string, string>();
  for (const file of checked) {
    const parts = file.sourcePath.split('/');
    while (parts.length > 1) {
      parts.pop();
      const directory = parts.join('/');
      const key = directory.toLocaleLowerCase('en-US');
      if (paths.has(key)) fail('导入路径中文件与文件夹重名');
      if (directories.has(key) && directories.get(key) !== directory) fail('导入目录存在大小写冲突');
      directories.set(key, directory);
    }
  }
  const importId = randomUUID();
  const prepared: {source: Source; bytes: Buffer}[] = [];
  const warnings: string[] = [];
  for (const {sourcePath, file, integrity} of checked) {
    const extension = path.posix.extname(sourcePath).toLowerCase();
    if (extension === '.svg') fail('暂不支持 SVG；请转换为 PNG、JPG 或 WebP');
    if (!['.md', '.markdown', '.png', '.jpg', '.jpeg', '.gif', '.webp'].includes(extension)) {
      warnings.push(`已跳过不支持的文件：${sourcePath}`);
      continue;
    }
    const bytes = Buffer.from(await file.arrayBuffer());
    if (integrity && (bytes.length !== integrity.bytes || createHash('sha256').update(bytes).digest('hex') !== integrity.sha256)) fail(`内容完整性校验失败，未保存；请重新粘贴全文：${sourcePath}`);
    const markdown = extension === '.md' || extension === '.markdown';
    if (markdown) {
      try { new TextDecoder('utf-8', {fatal: true}).decode(bytes); } catch { fail(`Markdown 必须使用 UTF-8 编码：${sourcePath}`); }
      if (bytes.includes(0)) fail(`Markdown 包含无效字符：${sourcePath}`);
    }
    prepared.push({source: {id: randomUUID(), importId, sourcePath, sha256: createHash('sha256').update(bytes).digest('hex'), mime: markdown ? 'text/markdown' : imageMime(extension, bytes)}, bytes});
  }
  if (!prepared.some(item => item.source.mime === 'text/markdown')) fail('导入内容中没有 Markdown 文档');
  // Blobs are invisible until the index is atomically committed under the existing store lock.
  const batchDirectory = path.dirname(blobPath(importId, randomUUID()));
  await fs.mkdir(batchDirectory, {recursive: true});
  try {
    for (const item of prepared) {
      const dest = blobPath(importId, item.source.id);
      await fs.writeFile(dest, item.bytes, {flag: 'wx', mode: 0o600});
      if (createHash('sha256').update(await fs.readFile(dest)).digest('hex') !== item.source.sha256) throw new StudyLibraryError('保存后的内容完整性校验失败，请重试', 500);
    }
    return await mutate(state => {
      parentNode(state, parentId); // The target may have been deleted while files were being read.
      const folders = new Map<string, string>();
      const documentIds: string[] = [];
      for (const {source} of prepared) {
        if (source.mime !== 'text/markdown') continue;
        let parent = parentId;
        const parts = source.sourcePath.split('/');
        for (let depth = 0; depth < parts.length - 1; depth++) {
          const key = parts.slice(0, depth + 1).join('/');
          if (!folders.has(key)) folders.set(key, newNode(state, 'folder', parts[depth], parent).id);
          parent = folders.get(key)!;
        }
        newNode(state, 'document', parts[parts.length - 1], parent, source.id);
        documentIds.push(source.id);
      }
      state.sources.push(...prepared.map(item => item.source));
      return {nodes: state.nodes, documentIds, ...(warnings.length ? {warnings} : {})};
    });
  } catch (error) {
    // batchDirectory contains only generated UUID segments under our dedicated imports root.
    await fs.rm(batchDirectory, {recursive: true, force: true});
    throw error;
  }
}

const markdownParser = unified().use(remarkParse).use(remarkGfm).use(remarkMath);
type MarkdownNode = {type: string; url?: string; children?: MarkdownNode[]};
function markdownDestinations(content: string): string[] {
  const values = new Set<string>();
  const pending: MarkdownNode[] = [markdownParser.parse(content)];
  while (pending.length) {
    const node = pending.pop()!;
    // Use the reader's grammar: definitions can occur inside nested lists/quotes,
    // while code blocks and escaped Markdown must not produce navigable links.
    if ((node.type === 'link' || node.type === 'image' || node.type === 'definition') && node.url) values.add(node.url);
    if (node.children) pending.push(...node.children);
  }
  return [...values];
}
function documentLinks(state: State, source: Source, content: string): Record<string, string> {
  const links: Record<string, string> = Object.create(null);
  const targets = new Map(state.sources.filter(item => item.importId === source.importId).map(item => [item.sourcePath, item]));
  for (const raw of markdownDestinations(content)) {
    if (/^(?:[a-z][a-z\d+.-]*:|\/|#)/i.test(raw)) continue;
    const split = raw.search(/[?#]/);
    const href = split < 0 ? raw : raw.slice(0, split);
    const suffix = split < 0 ? '' : raw.slice(split);
    let decoded: string;
    try {decoded = decodeURIComponent(href);} catch {continue;}
    if (/[\\\u0000-\u001f]/.test(decoded) || decoded.startsWith('/')) continue;
    const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(source.sourcePath), decoded)).normalize('NFC');
    if (resolved === '..' || resolved.startsWith('../')) continue;
    const target = targets.get(resolved);
    if (!target) continue;
    const url = target.mime === 'text/markdown' ? `/study/${target.id}${suffix}` : `/api/study-library/asset?id=${target.id}${suffix.startsWith('#') ? suffix : ''}`;
    links[raw] = url;
    // Markdown renderers commonly percent-encode Unicode and spaces in destinations.
    links[encodeURI(raw)] = url;
  }
  return links;
}
export async function readStudyDocument(id: string): Promise<StudyDocument> {
  const state = await readState();
  const node = state.nodes.find(item => item.id === id && item.kind === 'document');
  const source = state.sources.find(item => item.id === id && item.mime === 'text/markdown');
  if (!node || !source) throw new StudyLibraryError('文档不存在或已删除', 404);
  const content = await fs.readFile(blobPath(source.importId, source.id), 'utf8');
  return {node, content, links: documentLinks(state, source, content)};
}
export async function readStudyAsset(id: string): Promise<{bytes: Uint8Array; mime: string}> {
  const state = await readState();
  const source = state.sources.find(item => item.id === id && item.mime.startsWith('image/'));
  if (!source) throw new StudyLibraryError('图片不存在或已删除', 404);
  return {bytes: new Uint8Array(await fs.readFile(blobPath(source.importId, source.id))), mime: source.mime};
}
export function studyErrorResponse(error: unknown): Response {
  const status = error instanceof StudyLibraryError ? error.status : error instanceof SyntaxError ? 400 : 500;
  const message = error instanceof StudyLibraryError ? error.message : error instanceof SyntaxError ? '请求数据格式无效' : '学习库操作失败，请重试';
  return Response.json({error: message}, {status, headers: {'Cache-Control': 'no-store'}});
}
