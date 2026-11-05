import {readFileSync, mkdirSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';

const playwright = process.env.PLAYWRIGHT_MODULE ?? 'C:/Users/pc/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/playwright/index.mjs';
const {chromium} = await import(pathToFileURL(playwright).href);
const browser = await chromium.launch({channel: 'msedge', headless: true});
const page = await browser.newPage({viewport: {width: 1600, height: 1000}});
page.setDefaultTimeout(15000);
const base = process.env.READER_TEST_URL ?? 'http://localhost:3000';
const output = '.build-cache/notes-and-windows-verification';
mkdirSync(output, {recursive: true});

const errors = [], threads = [], notes = [], sessions = [], requests = [];
let nextThread = 0, nextNote = 0, nextSession = 0, failNoteSave = false;
let heldAsk = null, heldNoteUpdate = null, heldSessionRestore = null;
const translation = '# 阅读笔记验证\n\n这里讨论相对全数据训练的收益，需要先明确比较基线。Entropy measures uncertainty in this example.\n\n独立保存自己的理解，之后可以返回这一处原文。';
const answer = '基线是全数据训练。分母表示参考增益，比较前后结果时需要保持同一尺度。Entropy 表示不确定性。';
const timestamp = () => new Date().toISOString();
const sameAnchor = (a, b) => ['scope', 'sourceKey', 'start', 'end', 'text'].every(key => a[key] === b[key]);
const json = (route, data, status = 200) => route.fulfill({status, contentType: 'application/json', body: JSON.stringify(data)});
function responseGate(id) {
  let notifyCommitted, release;
  const committed = new Promise(resolve => { notifyCommitted = resolve; });
  const released = new Promise(resolve => { release = resolve; });
  return {id, committed, release, async hold(route, data) {
    const snapshot = structuredClone(data);
    notifyCommitted();
    await released;
    return json(route, snapshot);
  }};
}
page.on('pageerror', error => errors.push(error.message));

// Every API request is fulfilled here. Browser tests never read or write the user's data.
await page.route('**/api/**', async route => {
  const url = new URL(route.request().url());
  const body = route.request().method() === 'POST' ? route.request().postDataJSON() : null;
  requests.push({path: url.pathname, body});
  if (url.pathname === '/api/model-configs') return json(route, {activeId:null,profiles:[],environment:{model:'test-model',hasKey:true}});
  if (url.pathname === '/api/paper/pdf') return route.fulfill({contentType: 'application/pdf', body: readFileSync('public/papers/nsr.pdf')});
  if (url.pathname === '/api/paper') return json(route, url.search ? {translation, pages: [{text: 'Original text'}]} : {papers: [{slug: 'notes-test', title: 'Notes browser verification', pages: 8}]});
  if (url.pathname === '/api/vocabulary') return json(route, {docId: 'a'.repeat(64), entries: []});
  if (url.pathname === '/api/terms') return json(route, {terms: []});
  if (url.pathname === '/api/reading-collection') return json(route, {entries: []});
  if (url.pathname === '/api/reading-memory') {
    if (!body) return json(route, {threads});
    if (body.action === 'create') {
      let thread = threads.find(item => sameAnchor(item.anchor, body.anchor));
      if (!thread) {
        thread = {id: `thread-${++nextThread}`, anchor: body.anchor, messages: [], createdAt: timestamp(), updatedAt: timestamp()};
        threads.push(thread);
      }
      return json(route, {thread});
    }
    const index = threads.findIndex(item => item.id === body.id);
    if (index < 0) return json(route, {error: '追问不存在'}, 400);
    const thread = threads[index];
    if (body.action === 'ask') {
      if (body.revision !== thread.messages.length) return json(route, {error: '对话版本不匹配'}, 409);
      thread.messages.push({role: 'user', content: body.question}, {role: 'assistant', content: answer});
      thread.updatedAt = timestamp();
      if (heldAsk?.id === body.id) return heldAsk.hold(route, {thread});
      return json(route, {thread});
    }
    if (body.action === 'delete') { threads.splice(index, 1); return json(route, {ok: true}); }
  }
  if (url.pathname === '/api/reading-notes') {
    if (!body) return json(route, {notes});
    if (failNoteSave && body.action !== 'delete') return json(route, {error: '模拟笔记保存失败，请重试'}, 400);
    if (body.action === 'save') {
      let note = notes.find(item => sameAnchor(item.anchor, body.anchor));
      if (!note) {
        note = {id: `note-${++nextNote}`, anchor: body.anchor, comment: body.comment.trim(), createdAt: timestamp(), updatedAt: timestamp()};
        notes.push(note);
      }
      return json(route, {note});
    }
    const index = notes.findIndex(item => item.id === body.id);
    if (index < 0) return json(route, {error: '笔记不存在'}, 400);
    if (body.action === 'update') {
      notes[index].comment = body.comment.trim(); notes[index].updatedAt = timestamp();
      if (heldNoteUpdate?.id === body.id) return heldNoteUpdate.hold(route, {note: notes[index]});
      return json(route, {note: notes[index]});
    }
    if (body.action === 'delete') { notes.splice(index, 1); return json(route, {ok: true}); }
  }
  if (url.pathname === '/api/chat') return json(route, {choices: [{message: {content: '主对话说明：比较实验必须固定评价指标，保留这一处回答。'}}]});
  if (url.pathname === '/api/session-history') {
    if (body?.action === 'delete') {
      const index = sessions.findIndex(item => item.id === body.id && item.tool === body.tool);
      if (index < 0) return json(route, {error: '会话不存在'}, 404);
      sessions.splice(index, 1);
      return json(route, {ok: true, sessions: []});
    }
    if (body?.action === 'upsert') {
      const session = {id: body.id ?? `session-${++nextSession}`, tool: body.tool, msgs: body.msgs};
      const index = sessions.findIndex(item => item.id === session.id);
      if (index < 0) sessions.push(session); else sessions[index] = session;
      return json(route, {id: session.id, sessions: sessions.map(item => ({id: item.id, title: '测试对话', createdAt: timestamp(), updatedAt: timestamp(), count: item.msgs.length}))});
    }
    const id = url.searchParams.get('id'), messageId = url.searchParams.get('messageId');
    if (id && heldSessionRestore?.id === id) return heldSessionRestore.hold(route, {session: sessions.find(item => item.id === id)});
    if (id || messageId) return json(route, {session: sessions.find(item => id ? item.id === id : item.msgs.some(message => message.id === messageId))});
    return json(route, {sessions: []});
  }
  if (url.pathname === '/api/reader/translate') return route.fulfill({contentType: 'application/x-ndjson', body: JSON.stringify({delta: '这是选区翻译，独立译文中的重要理解。'}) + '\n{"done":true}\n'});
  return json(route, {projects: [], profiles: [], memories: [], runs: [], audit: [], observations: []});
});

const panel = id => page.locator('.reading-memory-panel').filter({has: page.locator(`[data-thread-id="${id}"]`)});
const editor = () => page.getByRole('dialog', {name: '随心笔记', exact: true});
async function select(selector, text) {
  await page.locator(selector).first().waitFor();
  await page.evaluate(({selector, text}) => {
    const root = document.querySelector(selector);
    const index = root.textContent.indexOf(text);
    if (index < 0) throw Error('Selection text missing: ' + text);
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT), range = document.createRange();
    let offset = 0, node, started = false;
    while ((node = walker.nextNode())) {
      const size = node.textContent.length;
      if (!started && index < offset + size) { range.setStart(node, index - offset); started = true; }
      if (started && index + text.length <= offset + size) { range.setEnd(node, index + text.length - offset); break; }
      offset += size;
    }
    const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range);
    root.dispatchEvent(new MouseEvent('mouseup', {bubbles: true}));
  }, {selector, text});
  await page.getByRole('toolbar', {name: '回答选区操作'}).waitFor();
}
async function send(target, question) {
  const before = await target.locator('.reading-message--assistant').count();
  await target.getByRole('textbox', {name: '追问内容'}).fill(question);
  await target.getByRole('button', {name: '发送追问', exact: true}).click();
  await target.locator('.reading-message--assistant').nth(before).waitFor();
}
async function movePanel(target, x, y) {
  const before = await target.boundingBox(), handle = await target.locator('.floating-panel-drag').boundingBox();
  const point = {x: handle.x + 25, y: handle.y + 15};
  await page.mouse.move(point.x, point.y); await page.mouse.down();
  await page.mouse.move(point.x + x - before.x, point.y + y - before.y, {steps: 12});
  await page.mouse.up();
  const after = await target.boundingBox();
  assert.ok(Math.abs(after.x - x) < 2 && Math.abs(after.y - y) < 2, 'title drag places a window without forced clicks');
}
async function saveNote(selector, quote, comment) {
  await select(selector, quote);
  await page.getByRole('toolbar', {name: '回答选区操作'}).getByRole('button', {name: '随心笔记', exact: true}).click();
  await editor().getByRole('textbox', {name: '我的批注'}).fill(comment);
  await editor().getByRole('button', {name: '保存笔记', exact: true}).click();
  await editor().waitFor({state: 'hidden'});
  const note = notes.find(item => item.comment === comment);
  assert.ok(note, 'note was persisted through the API');
  return structuredClone(note);
}
async function library() {
  await page.goto(base + '/?view=notes');
  await page.getByRole('heading', {name: '随心笔记', exact: true}).waitFor();
  await page.locator('.reading-notes-library[aria-busy="false"]').waitFor();
}
async function locateNote(note) {
  await page.getByRole('button', {name: `定位笔记：${note.comment}`, exact: true}).click();
  await page.waitForURL(url => url.searchParams.get('note') === note.id);
  await page.locator(`[data-note-located="${note.id}"]`).waitFor();
}
async function assertExactSurface(note) {
  const found = await page.locator(`[data-note-located="${note.id}"]`).evaluate(element => ({source: element.dataset.readingSource, quote: [...CSS.highlights.get('reading-focus')][0].toString()}));
  assert.equal(found.source, note.anchor.sourceKey);
  assert.equal(found.quote, note.anchor.text);
}

try {
  await page.goto(base + '/read/notes-test?view=zh');
  await page.locator('.reader-zh .md-body').waitFor();
  await select('.reader-zh .md-body', '相对全数据训练的收益');
  await page.getByRole('button', {name: '划线追问', exact: true}).click();
  await movePanel(page.locator('.reading-memory-panel:visible'), 50, 130);
  await send(page.locator('.reading-memory-panel:visible'), '相对哪个基线？');
  const parentId = threads[0].id, parent = panel(parentId);
  await movePanel(parent, 24, 100);
  await send(parent, '补充确认窗口保存后的位置');
  const savedGeometry = await parent.boundingBox();
  const storedGeometry = await page.evaluate(id => JSON.parse(localStorage.getItem('reading-memory-box:' + id)), parentId);
  assert.deepEqual(storedGeometry, {x: 24, y: 100, w: savedGeometry.width, h: savedGeometry.height}, 'saved-thread ID owns the geometry after the first send');
  await page.reload();
  await page.locator('.reader-zh .reading-memory-links button').click();
  await parent.waitFor();
  assert.deepEqual(await parent.boundingBox(), savedGeometry, 'full reload and reopening restores the saved thread position');
  await parent.getByRole('textbox', {name: '追问内容'}).fill('父窗口未发送的草稿');
  await select(`[data-thread-id="${parentId}"] .reading-message--assistant .md-body`, '分母表示参考增益');
  await page.getByRole('button', {name: '划线追问', exact: true}).click();
  const childDraft = page.locator('.reading-memory-panel:visible').filter({hasNot: page.locator(`[data-thread-id="${parentId}"]`)});
  assert.equal(await page.locator('.reading-memory-panel:visible').count(), 2, 'parent and child remain open together');
  await send(childDraft, '子窗口自己的问题');
  const childId = threads[1].id, child = panel(childId);
  await child.getByRole('textbox', {name: '追问内容'}).fill('子窗口未发送的草稿');
  assert.equal(await parent.getByRole('textbox', {name: '追问内容'}).inputValue(), '父窗口未发送的草稿');
  assert.equal(threads[0].messages.length, 4);
  assert.equal(threads[1].messages[0].content, '子窗口自己的问题');
  assert.equal(threads[1].anchor.origin.threadId, parentId);
  heldAsk = responseGate(parentId);
  await parent.getByRole('button', {name: '发送追问', exact: true}).click();
  await heldAsk.committed;
  assert.equal(await parent.getByRole('textbox', {name: '追问内容'}).isDisabled(), true);
  await send(child, '父窗口等待时子窗口继续发送');
  assert.equal(threads[1].messages.at(-2).content, '父窗口等待时子窗口继续发送');
  assert.equal(await child.locator('.reading-message--assistant').count(), 2);
  assert.equal(await parent.locator('.reading-message--assistant').count(), 2, 'parent is still waiting for its independent response');
  heldAsk.release();
  await parent.locator('.reading-message--assistant').nth(2).waitFor();
  heldAsk = null;
  assert.equal(threads[0].messages.length, 6);
  assert.equal(threads[1].messages.length, 4);
  await parent.getByRole('textbox', {name: '追问内容'}).fill('父窗口未发送的草稿');
  await child.getByRole('textbox', {name: '追问内容'}).fill('子窗口未发送的草稿');
  await page.screenshot({path: output + '/independent-windows.png'});

  await parent.getByRole('button', {name: '关闭追问'}).click();
  assert.equal(await child.isVisible(), true);
  assert.equal(threads.length, 2);
  await page.locator('.reader-zh .reading-highlight--memory').first().waitFor();
  await page.locator('.reader-zh .reading-memory-links button').click();
  await parent.waitFor();
  assert.equal(await parent.getByRole('textbox', {name: '追问内容'}).inputValue(), '父窗口未发送的草稿');
  assert.equal(await child.getByRole('textbox', {name: '追问内容'}).inputValue(), '子窗口未发送的草稿');
  await child.getByRole('button', {name: '关闭追问'}).click();
  await parent.locator('.reading-memory-links button').click();
  await child.waitFor();
  assert.equal(await child.getByRole('textbox', {name: '追问内容'}).inputValue(), '子窗口未发送的草稿');
  page.once('dialog', dialog => dialog.accept());
  await child.getByRole('button', {name: '删除对话及高光'}).click();
  await child.waitFor({state: 'detached'});
  assert.deepEqual(threads.map(thread => thread.id), [parentId], 'deleting child leaves parent conversation intact');
  assert.equal(await parent.isVisible(), true);
  assert.equal(await parent.locator('.reading-memory-links button').count(), 0, 'deleted child highlight link disappears');
  const memoryNote = await saveNote(`[data-thread-id="${parentId}"] .reading-message--assistant .md-body`, '比较前后结果时需要保持同一尺度', '追问回答里的可比性提醒');
  assert.deepEqual(memoryNote.anchor.origin, {kind: 'memory', threadId: parentId});
  await parent.getByRole('button', {name: '关闭追问'}).click();

  await select('.reader-zh .md-body', '需要先明确比较基线');
  await page.getByRole('button', {name: '随心笔记', exact: true}).click();
  await editor().getByRole('textbox', {name: '我的批注'}).fill('先弄清楚比较对象再看收益');
  failNoteSave = true;
  await editor().getByRole('button', {name: '保存笔记', exact: true}).click();
  await editor().getByRole('alert').filter({hasText: '模拟笔记保存失败'}).waitFor();
  assert.equal(await editor().getByRole('textbox', {name: '我的批注'}).inputValue(), '先弄清楚比较对象再看收益');
  assert.equal(notes.length, 1, 'failed save creates no note');
  failNoteSave = false;
  await editor().getByRole('button', {name: '保存笔记', exact: true}).click();
  await editor().waitFor({state: 'hidden'});
  const translationNote = structuredClone(notes.find(note => note.comment === '先弄清楚比较对象再看收益'));
  assert.ok(translationNote);
  await page.locator('.reader-zh .reading-highlight--note').first().waitFor();

  await library();
  assert.equal(await page.locator('.reading-note-item').count(), 2);
  await page.getByRole('textbox', {name: '搜索随心笔记'}).fill('需要先明确');
  assert.equal(await page.locator('.reading-note-item').count(), 1, 'search matches captured source text');
  await page.getByRole('button', {name: '编辑笔记', exact: true}).click();
  await editor().getByRole('textbox', {name: '我的批注'}).fill('更新理解：收益需要同一比较基线');
  await editor().getByRole('button', {name: '保存笔记', exact: true}).click();
  await editor().waitFor({state: 'hidden'});
  translationNote.comment = '更新理解：收益需要同一比较基线';
  assert.deepEqual(notes.find(note => note.id === translationNote.id).anchor, translationNote.anchor, 'editing annotation preserves the source snapshot');
  await page.getByRole('textbox', {name: '搜索随心笔记'}).fill('更新理解');
  assert.equal(await page.locator('.reading-note-item').count(), 1, 'search matches own annotation');
  await page.reload();
  await page.getByRole('button', {name: `定位笔记：${translationNote.comment}`, exact: true}).waitFor();
  await locateNote(translationNote);
  await assertExactSurface(translationNote);
  assert.equal(new URL(page.url()).pathname, '/read/notes-test');
  assert.equal(new URL(page.url()).searchParams.get('view'), 'zh');

  await library();
  await locateNote(memoryNote);
  assert.equal(await panel(parentId).isVisible(), true, 'locating a follow-up note reopens its closed source conversation');
  await assertExactSurface(memoryNote);
  assert.equal(await page.locator(`[data-note-located="${memoryNote.id}"]`).evaluate(element => element.closest('[data-thread-id]')?.dataset.threadId), parentId);
  await panel(parentId).getByRole('button', {name: '关闭追问'}).click();
  await page.screenshot({path: output + '/located-notes.png'});

  // PDF notes use the original document fingerprint and normalized page rectangles.
  await page.getByRole('button', {name: '查看原文 PDF'}).click();
  await page.locator('.reader-text-layer span').first().waitFor();
  await page.evaluate(() => {
    const spans = [...document.querySelector('.reader-text-layer').querySelectorAll('span')].filter(span => span.firstChild?.nodeType === 3);
    const range = document.createRange(); range.setStart(spans[0].firstChild, 0); range.setEnd(spans[5].firstChild, spans[5].textContent.length);
    const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range);
    document.dispatchEvent(new Event('selectionchange'));
  });
  await page.getByRole('toolbar', {name: '选中文字操作'}).getByRole('button', {name: '随心笔记', exact: true}).click();
  await editor().getByRole('textbox', {name: '我的批注'}).fill('原文 PDF 的关键段落');
  await editor().getByRole('button', {name: '保存笔记', exact: true}).click();
  await editor().waitFor({state: 'hidden'});
  const pdfNote = structuredClone(notes.find(note => note.comment === '原文 PDF 的关键段落'));
  assert.ok(pdfNote.anchor.rects.length > 0); assert.equal(pdfNote.anchor.docId, 'a'.repeat(64));
  await page.locator('.pdf-note-highlight').first().waitFor();
  await library(); await locateNote(pdfNote);
  assert.equal(await page.locator(`[data-note-located="${pdfNote.id}"]`).getAttribute('data-page'), String(pdfNote.anchor.page));
  const pdfHighlight = page.locator(`.pdf-note-highlight[data-note-id="${pdfNote.id}"]`).first();
  await pdfHighlight.waitFor();
  assert.equal(await pdfHighlight.evaluate(element => getComputedStyle(element).pointerEvents), 'none', 'note overlays preserve native PDF text dragging');

  // A main-chat note restores its saved session and exact assistant message after navigation.
  await page.getByRole('button', {name: 'AI 讲解', exact: true}).click();
  await page.locator('.reader-chat textarea').last().fill('说明实验比较');
  await page.locator('.reader-chat').getByRole('button', {name: '发送', exact: true}).click();
  await page.locator('.reader-chat .md-body').waitFor();
  await page.waitForFunction(() => document.querySelector('.reader-chat textarea')?.disabled === false);
  await page.locator('.reader-chat .md-body').scrollIntoViewIfNeeded();
  // Wait for the chat's smooth arrival scroll and the selection toolbar's 120 ms debounce.
  await page.waitForTimeout(500);
  const chatNote = await saveNote('.reader-chat .md-body', '比较实验必须固定评价指标', '主对话里的实验提醒');
  assert.equal(chatNote.anchor.origin.kind, 'chat');
  assert.ok(chatNote.anchor.origin.messageId);
  await library(); await locateNote(chatNote); await assertExactSurface(chatNote);
  assert.equal(await page.locator('.reader-chat').isVisible(), true);
  page.once('dialog', dialog => dialog.accept());
  await page.locator('.reader-chat').getByRole('button', {name: '删除当前对话', exact: true}).click();
  await page.locator('.reader-chat .md-body').waitFor({state: 'detached'});
  assert.equal(sessions.length, 0, 'delete current conversation removes its persisted session');
  assert.deepEqual(notes.find(note => note.id === chatNote.id), chatNote, 'deleting the original chat retains the independent note snapshot');

  // Keep current-session deletion coverage above; use a fresh session for the stale history restore race.
  await page.locator('.reader-chat textarea').last().fill('验证删除时尚未完成的历史读取');
  await page.locator('.reader-chat').getByRole('button', {name: '发送', exact: true}).click();
  await page.locator('.reader-chat .md-body').waitFor();
  await page.waitForFunction(() => document.querySelector('.reader-chat textarea')?.disabled === false);
  assert.equal(sessions.length, 1);
  const restoredSessionId = sessions[0].id;
  assert.notEqual(restoredSessionId, chatNote.anchor.origin.sessionId);
  await page.locator('.reader-chat').getByRole('button', {name: /^历史记录/}).click();
  heldSessionRestore = responseGate(restoredSessionId);
  await page.locator('.reader-chat .history-item-main').click();
  await heldSessionRestore.committed;
  page.once('dialog', dialog => dialog.accept());
  await page.locator('.reader-chat').getByRole('button', {name: '删除这个会话', exact: true}).click();
  await page.locator('.reader-chat .md-body').waitFor({state: 'detached'});
  assert.equal(sessions.length, 0);
  const delayedRestore = page.waitForResponse(response => {
    const url = new URL(response.url());
    return url.pathname === '/api/session-history' && url.searchParams.get('id') === restoredSessionId;
  });
  heldSessionRestore.release();
  await (await delayedRestore).finished();
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  heldSessionRestore = null;
  assert.equal(await page.locator('.reader-chat .md-body').count(), 0, 'a delayed history GET must not restore messages from a deleted session');
  assert.equal(await page.locator('.reader-chat').getByRole('button', {name: '删除当前对话', exact: true}).count(), 0, 'a delayed history GET must not restore the deleted current-session identity');
  assert.deepEqual(notes.find(note => note.id === chatNote.id), chatNote);
  await library();
  await page.getByRole('button', {name: `定位笔记：${chatNote.comment}`, exact: true}).click();
  await page.waitForURL(url => url.searchParams.get('note') === chatNote.id);
  const unavailable = page.getByRole('dialog', {name: '笔记来源', exact: true});
  await unavailable.waitFor({timeout: 15000});
  await unavailable.getByRole('status').filter({hasText: '暂时无法定位原位置'}).waitFor();
  assert.equal(await unavailable.locator('blockquote').textContent(), chatNote.anchor.text);
  await unavailable.getByText(chatNote.comment, {exact: true}).waitFor();
  assert.equal(await page.locator('.reader-chat .md-body').count(), 0, 'source fallback must not recreate a deleted conversation');

  // A short translation is ephemeral; its note retains the full translated result for later return.
  await page.goto(base + '/read/notes-test?view=zh');
  await select('.reader-zh .md-body', 'Entropy');
  await page.getByRole('toolbar', {name: '回答选区操作'}).getByRole('button', {name: '翻译 / 释义', exact: true}).click();
  await page.getByText('翻译完成', {exact: true}).waitFor();
  const snapshotNote = await saveNote('.reader-translation-result .md-body', '独立译文中的重要理解', '选段译文里的即时理解');
  assert.deepEqual(snapshotNote.anchor.origin, {kind: 'translation', content: '这是选区翻译，独立译文中的重要理解。'});
  await page.getByRole('button', {name: '关闭翻译', exact: true}).click();
  const translationCalls = requests.filter(request => request.path === '/api/reader/translate').length;
  await library(); await locateNote(snapshotNote); await assertExactSurface(snapshotNote);
  const snapshot = page.getByRole('dialog', {name: '当时的译文', exact: true});
  await snapshot.waitFor();
  assert.equal(await snapshot.locator(`[data-note-located="${snapshotNote.id}"]`).count(), 1);
  assert.match(await snapshot.innerText(), /这是选区翻译，独立译文中的重要理解/);
  assert.equal(requests.filter(request => request.path === '/api/reader/translate').length, translationCalls, 'returning to a translation note must reuse its snapshot rather than invoke translation again');

  await library();
  await page.getByRole('textbox', {name: '搜索随心笔记'}).fill('更新理解');
  await page.getByRole('button', {name: '编辑笔记', exact: true}).click();
  await editor().getByRole('textbox', {name: '我的批注'}).fill('更新理解：这个迟到的保存不能复活已删除笔记');
  heldNoteUpdate = responseGate(translationNote.id);
  await editor().getByRole('button', {name: '保存笔记', exact: true}).click();
  await heldNoteUpdate.committed;
  assert.match(notes.find(note => note.id === translationNote.id).comment, /迟到/);
  await editor().getByRole('button', {name: '关闭笔记', exact: true}).click();
  await page.getByRole('button', {name: '删除笔记', exact: true}).click();
  await page.getByText('没有匹配的笔记，试试其他关键词。', {exact: true}).waitFor();
  assert.ok(!notes.some(note => note.id === translationNote.id));
  const delayedResponse = page.waitForResponse(response => response.url().includes('/api/reading-notes') && response.request().postDataJSON()?.action === 'update');
  heldNoteUpdate.release();
  await (await delayedResponse).finished();
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  heldNoteUpdate = null;
  assert.equal(await page.locator('.reading-note-item').count(), 0, 'late update response must not resurrect the deleted note in client state');
  assert.ok(notes.some(note => note.id === memoryNote.id));
  assert.equal(threads.length, 1, 'deleting a note does not delete a conversation');
  await page.reload();
  await page.locator('.reading-notes-library[aria-busy="false"]').waitFor();
  assert.equal(await page.locator('.reading-note-item').count(), 4);
  assert.equal(await page.getByRole('button', {name: `定位笔记：${translationNote.comment}`, exact: true}).count(), 0);
  await page.setViewportSize({width: 390, height: 844});
  await page.screenshot({path: output + '/mobile-notes-library.png', fullPage: true});
  await page.locator('.reading-note-item').first().getByRole('button', {name: '编辑笔记', exact: true}).click();
  const mobileEditor = await editor().boundingBox();
  assert.ok(mobileEditor.x >= 0 && mobileEditor.y >= 0 && mobileEditor.x + mobileEditor.width <= 390 && mobileEditor.y + mobileEditor.height <= 844);
  await page.screenshot({path: output + '/mobile-note-editor.png'});
  assert.deepEqual(errors, []);
  assert.equal(requests.filter(request => request.path === '/api/learning/observations').length, 0);
  console.log('PASS independent parent/child windows, drafts and concurrent sends; saved geometry after reload; close/reopen; delete isolation and delayed-save/history-restore resurrection regressions; notes failure/retry, search, edit, delete, reload, mobile; exact translated text, follow-up, PDF and main-chat source restoration; deleted-chat fallback and captured-translation return (all APIs mocked)');
} catch (error) {
  console.error('PAGE', (await page.locator('body').innerText()).slice(0, 6500), 'ERRORS', errors);
  await page.screenshot({path: output + '/failure.png'});
  throw error;
} finally {
  await browser.close();
}
