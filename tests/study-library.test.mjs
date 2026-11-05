import test, {after} from 'node:test';
import assert from 'node:assert/strict';
import {promises as fs} from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'ra-study-library-'));
process.env.RA_DATA_DIR = directory;
after(() => fs.rm(directory, {recursive: true, force: true}));
const api = await import('../src/app/api/study-library/route.ts').catch(() => null);
const importer = await import('../src/app/api/study-library/import/route.ts').catch(() => null);
const documents = await import('../src/app/api/study-library/document/route.ts').catch(() => null);
const assets = await import('../src/app/api/study-library/asset/route.ts').catch(() => null);
const store = await import('../src/lib/study-library.ts').catch(() => null);
const post = body => api.POST(new Request('http://localhost/api/study-library', {method: 'POST', body: JSON.stringify(body)}));
const list = async () => (await (await api.GET()).json()).nodes;
async function create(kind, name, parentId = null) {
  const response = await post({action: 'create', kind, name, parentId});
  assert.equal(response.status, 200, JSON.stringify(await response.clone().json()));
  return (await response.json()).nodes.findLast(node => node.kind === kind && node.name === name && node.parentId === parentId);
}
async function upload(parentId, entries) {
  const form = new FormData();
  form.set('parentId', parentId);
  form.set('paths', JSON.stringify(entries.map(([name]) => name)));
  for (const [name, data] of entries) form.append('files', new File([data], name.split('/').at(-1)));
  return importer.POST(new Request('http://localhost/api/study-library/import', {method: 'POST', body: form}));
}
const getDocument = id => documents.GET(new Request(`http://localhost/api/study-library/document?id=${encodeURIComponent(id)}`));
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aBz8AAAAASUVORK5CYII=', 'base64');

test('study library routes exist and return an empty uncached tree', async () => {
  assert.ok(api && importer && documents && assets, 'The study-library API routes must be implemented');
  const response = await api.GET();
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.deepEqual(await response.json(), {nodes: []});
});

test('create identifies its own node even when another tab changed a stale tree snapshot', async () => {
  const staleNodes = await list();
  const other = await create('library', '其他标签页');
  const response = await post({action: 'create', kind: 'library', name: '本次新建', parentId: null});
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.nodes.find(node => !staleNodes.some(stale => stale.id === node.id)).id, other.id);
  assert.equal(typeof result.createdId, 'string');
  assert.notEqual(result.createdId, other.id);
  assert.equal(result.nodes.find(node => node.id === result.createdId).name, '本次新建');
  const folder = await (await post({action: 'create', kind: 'folder', name: '新目录', parentId: result.createdId})).json();
  assert.equal(folder.nodes.find(node => node.id === folder.createdId).parentId, result.createdId);
});

test('reference links in blockquotes and deeply nested lists follow the renderer Markdown grammar', async () => {
  const library = await create('library', '引用链接');
  const content = '> [Next][chapter]\n>\n> [chapter]: next.md\n\n> ![Figure][picture]\n>\n> [picture]: image.png\n\n- Outer\n  - [List][nested]\n\n    [nested]: nested.md\n\n[Entity](entity&#46;md)\n\n> [Multiline][continued]\n>\n> [continued]:\n>   continued.md\n\n```markdown\n[fake]: fake.md\n```\n';
  const response = await upload(library.id, [
    ['index.md', content], ['next.md', '# Next'], ['nested.md', '# Nested'], ['entity.md', '# Entity'],
    ['continued.md', '# Continued'], ['fake.md', '# Not a rendered link'], ['image.png', png],
  ]);
  assert.equal(response.status, 200);
  const result = await response.json();
  const document = await (await getDocument(result.nodes.find(node => node.name === 'index.md' && node.parentId === library.id).id)).json();
  for (const name of ['next.md', 'nested.md', 'entity.md', 'continued.md']) {
    const target = result.nodes.find(node => node.name === name && node.parentId === library.id);
    assert.equal(document.links[name], `/study/${target.id}`, name);
  }
  assert.match(document.links['image.png'], /^\/api\/study-library\/asset\?id=/);
  assert.equal(document.links['fake.md'], undefined, 'Code fences must not contribute Markdown destinations');
});

test('directory import resolves nested assets and Markdown links after rename and cross-library moves', async () => {
  const library = await create('library', '数学');
  const content = '# 条件极值\n\n![](../../attachments/图(1).png)\n\n[下一节](<../下一节.md#公式>)\n\n[参考][ref]\n\n[ref]: ../下一节.md\n';
  const response = await upload(library.id, [
    ['教材/第九章/9.4/条件极值.md', content],
    ['教材/第九章/下一节.md', '# 公式'],
    ['教材/attachments/图(1).png', png],
  ]);
  assert.equal(response.status, 200, JSON.stringify(await response.clone().json()));
  const result = await response.json();
  assert.equal(result.documentIds.length, 2);
  const node = result.nodes.find(item => item.name === '条件极值.md');
  const next = result.nodes.find(item => item.name === '下一节.md');
  const before = await (await getDocument(node.id)).json();
  const originalSource = JSON.parse(await fs.readFile(path.join(directory, 'study-library/index.json'), 'utf8'))[0].sources.find(source => source.id === node.id);
  assert.equal(before.content, content);
  assert.equal(before.links['../下一节.md#公式'], `/study/${next.id}#公式`);
  assert.equal(before.links['../下一节.md'], `/study/${next.id}`);
  assert.match(before.links['../../attachments/图(1).png'], /^\/api\/study-library\/asset\?id=/);
  const imageResponse = await assets.GET(new Request(`http://localhost${before.links['../../attachments/图(1).png']}`));
  assert.equal(imageResponse.headers.get('Content-Type'), 'image/png');
  assert.equal(imageResponse.headers.get('X-Content-Type-Options'), 'nosniff');
  assert.deepEqual(Buffer.from(await imageResponse.arrayBuffer()), png);
  const destination = await create('library', '移动目标');
  assert.equal((await post({action: 'rename', id: node.id, name: '重命名'})).status, 200);
  assert.equal((await post({action: 'move', id: node.id, parentId: destination.id})).status, 200);
  const afterMove = await (await getDocument(node.id)).json();
  assert.equal(afterMove.content, content);
  assert.deepEqual(afterMove.links, before.links);
  assert.equal(afterMove.node.name, '重命名');
  assert.equal(afterMove.node.parentId, destination.id);
  const movedSource = JSON.parse(await fs.readFile(path.join(directory, 'study-library/index.json'), 'utf8'))[0].sources.find(source => source.id === node.id);
  assert.deepEqual(movedSource, originalSource, 'Import paths and content fingerprints stay immutable');
  // Deleting the source library must retain shared assets used by the moved document.
  assert.equal((await post({action: 'delete', id: library.id})).status, 200);
  assert.equal((await assets.GET(new Request(`http://localhost${before.links['../../attachments/图(1).png']}`))).status, 200);
  assert.equal((await getDocument(node.id)).status, 200);
  assert.equal((await getDocument(next.id)).status, 404);
  assert.equal((await post({action: 'delete', id: destination.id})).status, 200);
  assert.equal((await assets.GET(new Request(`http://localhost${before.links['../../attachments/图(1).png']}`))).status, 404);
});

test('tree operations enforce hierarchy, reject cycles and preserve explicit sibling ordering', async () => {
  const library = await create('library', '排序');
  const a = await create('folder', 'A', library.id);
  const b = await create('folder', 'B', library.id);
  const child = await create('folder', '子目录', a.id);
  assert.equal((await post({action: 'move', id: b.id, parentId: library.id, beforeId: a.id})).status, 200);
  assert.deepEqual((await list()).filter(n => n.parentId === library.id).sort((x,y) => x.order-y.order).map(n => n.id), [b.id, a.id]);
  const snapshot = await list();
  for (const mutation of [
    {action: 'move', id: a.id, parentId: child.id},
    {action: 'move', id: a.id, parentId: a.id},
    {action: 'move', id: library.id, parentId: a.id},
    {action: 'move', id: a.id, parentId: null},
    {action: 'move', id: b.id, parentId: library.id, beforeId: child.id},
    {action: 'create', kind: 'folder', name: '根目录', parentId: null},
    {action: 'create', kind: 'library', name: '嵌套库', parentId: library.id},
    {action: 'create', kind: 'document', name: '不允许空文档', parentId: library.id},
    {action: 'rename', id: a.id, name: ' '},
    {action: 'delete', id: '../../outside'},
  ]) assert.equal((await post(mutation)).status, 400, JSON.stringify(mutation));
  assert.deepEqual(await list(), snapshot);
});

test('same named libraries and documents have independent stable identities', async () => {
  const a = await create('library', '重复名称');
  const b = await create('library', '重复名称');
  assert.notEqual(a.id, b.id);
  const one = await (await upload(a.id, [['index.md', '# One']])).json();
  const two = await (await upload(b.id, [['index.md', '# Two']])).json();
  assert.notEqual(one.documentIds[0], two.documentIds[0]);
  assert.equal((await (await getDocument(one.documentIds[0])).json()).content, '# One');
  assert.equal((await (await getDocument(two.documentIds[0])).json()).content, '# Two');
  const again = await (await upload(a.id, [['index.md', '# Third']])).json();
  assert.notEqual(again.documentIds[0], one.documentIds[0]);
});

test('invalid paths, collisions, unsafe images, oversized files and invalid parents fail atomically', async () => {
  const library = await create('library', '安全校验');
  const snapshot = await list();
  const invalidEntries = [
    [['../escape.md', '# bad']], [['/absolute.md', '# bad']], [['C:/absolute.md', '# bad']],
    [['folder/./bad.md', '# bad']], [['folder\\bad.md', '# bad']], [['bad\u0000.md', '# bad']],
    [['same.md', '# one'], ['SAME.md', '# two']],
    [['Folder/one.md', '# one'], ['folder/two.md', '# two']],
    [['file.md', '# one'], ['file.md/child.md', '# two']],
    [['good.md', '# good'], ['bad.svg', '<svg onload="alert(1)"/>']],
    [['good.md', '# good'], ['fake.png', '<script>alert(1)</script>']],
    [['huge.md', Buffer.alloc(16 * 1024 * 1024 + 1)]],
    [['only.png', png]],
    [['bad.md', Buffer.from([0xff, 0xfe, 0x80])]],
  ];
  for (const entries of invalidEntries) {
    const response = await upload(library.id, entries);
    assert.equal(response.status, 400, entries[0][0]);
    assert.deepEqual(await list(), snapshot);
  }
  assert.equal((await upload('missing', [['good.md', '# good']])).status, 400);
  assert.equal((await upload('', [['good.md', '# good']])).status, 400);
  assert.deepEqual(await list(), snapshot);
});

test('an import whose destination disappears rolls back every staged blob', async () => {
  const library = await create('library', '导入中被删除');
  const importsPath = path.join(directory, 'study-library/imports');
  const batchesBefore = (await fs.readdir(importsPath)).sort();
  const file = new File(['# must not be published'], 'chapter.md');
  const readBytes = file.arrayBuffer.bind(file);
  file.arrayBuffer = async () => {
    assert.equal((await post({action: 'delete', id: library.id})).status, 200);
    return readBytes();
  };
  await assert.rejects(store.importStudyFiles(library.id, [{path: 'chapter.md', file}]), /不存在|删除/);
  assert.deepEqual((await fs.readdir(importsPath)).sort(), batchesBefore);
  assert.ok(!(await list()).some(node => node.parentId === library.id));
});

test('file-count, aggregate-size and multipart bounds are enforced on the server', async () => {
  const library = await create('library', '上传限制');
  const file = new File(['# good'], 'good.md');
  await assert.rejects(store.importStudyFiles(library.id, Array.from({length: 3001}, (_, i) => ({path: `${i}.md`, file}))), /3000/);
  const large = new File([Buffer.alloc(16 * 1024 * 1024)], 'large.md');
  await assert.rejects(store.importStudyFiles(library.id, Array.from({length: 9}, (_, i) => ({path: `${i}.md`, file: large}))), /128 MiB/);
  const oversized = await importer.POST(new Request('http://localhost/api/study-library/import', {method: 'POST', headers: {'content-length': String(140 * 1024 * 1024)}, body: 'x'}));
  assert.equal(oversized.status, 400);
  const form = new FormData();
  form.set('parentId', library.id);
  form.set('paths', JSON.stringify(['one.md', 'two.md']));
  form.set('files', file);
  assert.equal((await importer.POST(new Request('http://localhost/api/study-library/import', {method: 'POST', body: form}))).status, 400);
  assert.equal((await importer.POST(new Request('http://localhost/api/study-library/import', {method: 'POST', body: 'not multipart'}))).status, 400);
});

test('unsupported auxiliary files produce warnings while a valid Markdown import remains readable', async () => {
  const library = await create('library', '附加文件');
  const response = await upload(library.id, [['book/index.md', '# Text'], ['book/desktop.ini', 'ignored']]);
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.documentIds.length, 1);
  assert.equal(result.warnings.length, 1);
  assert.match(result.warnings[0], /desktop.ini/);
});

test('concurrent mutations and imports publish complete metadata without lost updates', async () => {
  const library = await create('library', '并发');
  const results = await Promise.all(Array.from({length: 5}, (_, i) => upload(library.id, [[`chapter-${i}.md`, `# ${i}`]])));
  for (const response of results) assert.equal(response.status, 200);
  const children = (await list()).filter(node => node.parentId === library.id);
  assert.equal(children.length, 5);
  assert.equal(new Set(children.map(node => node.order)).size, 5);
});

test('missing and traversal-like document and asset IDs never read arbitrary files', async () => {
  for (const id of ['missing', '../../package.json', '']) {
    assert.equal((await getDocument(id)).status, 404);
    assert.equal((await assets.GET(new Request(`http://localhost/api/study-library/asset?id=${encodeURIComponent(id)}`))).status, 404);
  }
});
