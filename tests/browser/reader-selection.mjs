/**
 * Real Chromium + real PDF text layer; all application APIs are intercepted so this
 * never calls a model or changes the user's library. Run against a local dev server:
 * READER_TEST_URL=http://localhost:3111 PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs node tests/browser/reader-selection.mjs
 * PLAYWRIGHT_MODULE is optional when `playwright` is installed locally.
 */
import { readFileSync, mkdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import ts from 'typescript';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
const browser = await chromium.launch({ channel: process.env.READER_TEST_BROWSER || 'msedge', headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, permissions: ['clipboard-read', 'clipboard-write'] });
const page = await context.newPage();
page.setDefaultTimeout(15000);
const errors = [], requests = [], vocabulary = [], terms = [];
let mode = 'success', pendingRoute;
page.on('pageerror', e => errors.push(e.message));
const json = (route, body) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
const result = (route, text) => route.fulfill({ status: 200, contentType: 'application/x-ndjson', body: JSON.stringify({ delta: text }) + '\n{"done":true}\n' });
await page.route('**/api/**', async route => {
  const url = new URL(route.request().url());
  if (url.pathname === '/api/paper/pdf') return route.fulfill({ status: 200, contentType: 'application/pdf', body: readFileSync('public/papers/nsr.pdf') });
  if (url.pathname === '/api/paper') return json(route, url.search ? { pages: [], translation: '' } : { papers: [{ slug: 'selection-test', title: 'PDF selection translation test', pages: 8 }] });
  if (url.pathname === '/api/terms') {if(route.request().method()==='POST'){const body=route.request().postDataJSON();assert.equal(body.action,'capture');terms.push({...body,id:'term-'+terms.length,name:body.text,collection:'manual',papers:[{slug:'selection-test'}]});}return json(route, { terms });}
  if (url.pathname === '/api/vocabulary') {
    if (route.request().method() === 'GET') return json(route, { docId: 'fixture-pdf', entries: vocabulary });
    const body = route.request().postDataJSON();
    assert.equal(body.action, 'save', 'translation must not write vocabulary automatically');
    const saved = { ...body, id: 'word-' + vocabulary.length, lemma: body.text, partOfSpeech: '', usage: '', createdAt: new Date().toISOString() };
    vocabulary.push(saved);
    return json(route, { entries: vocabulary, saved });
  }
  if (url.pathname === '/api/reader/translate') {
    const body = route.request().postDataJSON(); requests.push(body);
    if (mode === 'pending') { pendingRoute = route; return; }
    if (mode === 'error') return route.fulfill({ status: 200, contentType: 'application/x-ndjson', body: '{"delta":"未完成的片段"}\n{"error":"测试网络中断"}\n' });
    return result(route, body.text.length > 80 ? '这是一段用于验证阅读交互的中文译文。\n\n原文中的公式、变量与引用编号应保留。' : `语境释义：${body.text}。这是当前句子中的用法。`);
  }
  return json(route, {});
});
mkdirSync('.build-cache/reader-verification', { recursive: true });
const screenshot = name => page.screenshot({ path: `.build-cache/reader-verification/${name}.png` });

async function drag(start, end) {
  const points = await page.evaluate(({ start, end }) => {
    const spans = [...document.querySelector('.reader-text-layer').querySelectorAll('span')];
    function point(search, offset, atEnd) {
      const span = spans.find(s => s.firstChild?.nodeType === 3 && s.textContent.includes(search));
      if (!span) throw Error('Missing PDF text: ' + search);
      const r = document.createRange(), n = offset === null ? span.textContent.length : offset;
      r.setStart(span.firstChild, Math.max(0, n - (atEnd ? 1 : 0)));
      r.setEnd(span.firstChild, Math.min(span.textContent.length, n + (atEnd ? 0 : 1)));
      const b = r.getBoundingClientRect();
      return { x: atEnd ? b.right - 1 : b.left + 1, y: (b.top + b.bottom) / 2 };
    }
    return { a: point(start.text, start.offset, false), b: point(end.text, end.offset, true) };
  }, { start, end });
  await page.mouse.move(points.a.x, points.a.y); await page.mouse.down();
  await page.mouse.move(points.b.x, points.b.y, { steps: 14 }); await page.mouse.up();
  await page.getByRole('toolbar', { name: '选中文字操作' }).waitFor();
}
const wordDrag = (text, start, end) => drag({ text, offset: start }, { text, offset: end });
const translate = () => page.getByRole('toolbar').getByRole('button', { name: '翻译', exact: true }).click();
const completed = () => page.getByText('翻译完成', { exact: true }).waitFor();
const close = () => page.keyboard.press('Escape');

try {
  await page.goto(`${process.env.READER_TEST_URL || 'http://localhost:3111'}/read/selection-test`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForSelector('.reader-text-layer span', { timeout: 30000 });
  const code = ts.transpileModule(readFileSync('src/lib/reader-selection.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  await page.evaluate(async source => { window.readerSelection = await import(URL.createObjectURL(new Blob([source], { type: 'text/javascript' }))); }, code);

  await drag({ text: '—We propose', offset: 1 }, { text: 'data coming from', offset: null });
  assert.ok((await page.evaluate(() => getSelection().toString())).length > 160);
  assert.equal(await page.locator('.reader-text-layer span').first().evaluate(el => getComputedStyle(el, '::selection').color), 'rgba(0, 0, 0, 0)');
  await translate(); await completed();
  assert.ok(requests[0].text.length > 160);
  assert.equal(await page.getByRole('dialog', { name: '选段翻译', exact: true }).count(), 1);
  assert.equal(vocabulary.length, 0);
  assert.equal(await page.locator('.word-highlight').count(), 0);
  await page.evaluate(() => document.dispatchEvent(new Event('selectionchange')));
  await page.locator('.full-reader-scroll').evaluate(el => el.scrollTop += 60);
  await page.waitForTimeout(250);
  assert.equal(await page.getByRole('dialog', { name: '选段翻译', exact: true }).count(), 1);
  await page.getByRole('button', { name: '复制译文', exact: true }).click();
  assert.ok((await page.evaluate(() => navigator.clipboard.readText())).includes('中文译文'));
  await screenshot('passage');
  console.log('PASS native long drag, transparent text selection, no annotations, copy, scroll/debounce stability');

  await close(); await page.locator('.full-reader-scroll').evaluate(el => el.scrollTop = 0);
  await wordDrag('—We propose', 14, 22); await translate(); await completed();
  assert.equal(requests.at(-1).text, 'learning');
  assert.equal(await page.getByRole('dialog', { name: '词语翻译', exact: true }).count(), 1);
  assert.equal(vocabulary.length, 0);
  const translatedMeaning=await page.locator('.reader-translation-result .md-body').innerText();
  await page.getByRole('button',{name:'加入术语卡片',exact:true}).click();await page.getByRole('button',{name:'已加入术语卡片',exact:true}).waitFor();assert.equal(terms[0].meaning,translatedMeaning);assert.equal(terms[0].text,'learning');
  await page.getByRole('button', { name: '加入生词本', exact: true }).click();
  await page.getByRole('button', { name: '已加入生词本', exact: true }).waitFor();
  assert.equal(vocabulary.length, 1);
  assert.ok(await page.locator('.word-highlight').count());
  await page.getByRole('button', { name: '复制译文', exact: true }).click();
  assert.equal(await page.getByRole('button', { name: '已加入生词本', exact: true }).isDisabled(), true);
  await screenshot('word');
  await close();
  const calls = requests.length;
  await wordDrag('—We propose', 14, 22); await translate(); await completed();
  assert.equal(requests.length, calls, 'identical completed translation should be cached');
  console.log('PASS short-word popover, explicit save, drag through saved highlight, completed cache');

  await close();
  const contexts = await page.evaluate(() => {
    const root = document.querySelector('.full-reader-scroll');
    const spans = [...root.querySelector('.reader-text-layer').querySelectorAll('span')];
    const snapshot = text => {
      const span = spans.find(s => s.textContent.includes(text)), offset = span.textContent.indexOf('learning');
      const range = document.createRange(); range.setStart(span.firstChild, offset); range.setEnd(span.firstChild, offset + 8);
      return window.readerSelection.snapshotReaderRange(root, range).context;
    };
    return [snapshot('—We propose'), snapshot('advances in deep learning')];
  });
  assert.notEqual(contexts[0], contexts[1]); assert.ok(contexts[1].includes('advances in deep learning'));

  await page.getByRole('button', { name: '放大', exact: true }).click();
  await page.getByRole('button', { name: '放大', exact: true }).click();
  await page.waitForTimeout(700);
  const geometry = await page.evaluate(() => {
    const root = document.querySelector('.full-reader-scroll'), p = root.querySelector('.pdf-page-scroll'); p.scrollLeft = 80;
    const span = [...p.querySelectorAll('.reader-text-layer span')].find(s => s.textContent === 'Abstract');
    const range = document.createRange(); range.selectNodeContents(span);
    const selection = window.readerSelection.snapshotReaderRange(root, range), b = range.getBoundingClientRect(), canvas = p.querySelector('canvas').getBoundingClientRect();
    return { actual: selection.rects[0], expected: { x: (b.left - canvas.left) / canvas.width, w: b.width / canvas.width } };
  });
  assert.ok(Math.abs(geometry.actual.x - geometry.expected.x) < .002);
  assert.ok(Math.abs(geometry.actual.w - geometry.expected.w) < .002);
  const highlight = await page.locator('.word-highlight').first().boundingBox();
  await page.mouse.move(highlight.x + highlight.width / 2, highlight.y + highlight.height / 2);
  await page.getByRole('tooltip').waitFor();
  assert.ok((await page.getByRole('tooltip').innerText()).includes('learning'));
  await page.mouse.move(highlight.x - 30, highlight.y - 20);
  await page.waitForTimeout(50);
  assert.equal(await page.getByRole('tooltip').count(), 0, 'leaving a highlight must dismiss immediately, without a 250ms timer');
  await page.mouse.move(highlight.x + highlight.width / 2, highlight.y + highlight.height / 2);
  await page.getByRole('tooltip').waitFor();
  const tooltip = await page.getByRole('tooltip').boundingBox();
  await page.mouse.move(tooltip.x + 4, tooltip.y + 20, { steps: 10 });
  await page.waitForTimeout(300);
  assert.equal(await page.getByRole('tooltip').count(), 1, 'crossing into the interactive tooltip must keep it open');
  await page.getByRole('tooltip').getByRole('button', { name: '移除这处高亮' }).hover();
  await page.mouse.move(highlight.x - 30, highlight.y - 20);
  await page.waitForTimeout(50);
  assert.equal(await page.getByRole('tooltip').count(), 0, 'leaving the tooltip must also dismiss immediately');
  await page.mouse.move(highlight.x + highlight.width / 2, highlight.y + highlight.height / 2);
  await page.getByRole('tooltip').waitFor();
  await page.locator('.pdf-page-scroll').first().evaluate(el => el.scrollLeft += 10);
  await page.waitForTimeout(250); assert.equal(await page.getByRole('tooltip').count(), 0);
  console.log('PASS occurrence-specific context, zoom/pan geometry, saved-word hover after panning');

  await page.getByRole('button', { name: '适应宽度', exact: true }).click(); await page.waitForTimeout(500);
  await page.locator('.pdf-page-scroll').first().evaluate(el => el.scrollLeft = 0);
  await page.getByRole('button', { name: '点词查译', exact: true }).click();
  await page.locator('.reader-text-layer span').filter({ hasText: /^Abstract$/ }).first().click();
  await page.getByRole('toolbar').waitFor();
  assert.equal(await page.evaluate(() => getSelection().toString()), '');
  await close();
  await drag({ text: '—We propose', offset: 1 }, { text: 'urban environments.', offset: null });
  assert.ok((await page.evaluate(() => getSelection().toString())).length > 80);
  await close();
  await page.getByRole('button', { name: '关闭点词', exact: true }).click();
  console.log('PASS point lookup still supports native passage dragging');

  mode = 'error';
  await wordDrag('Structured Terrain', 0, 10); await translate();
  await page.getByRole('alert').filter({ hasText: '测试网络中断' }).waitFor();
  assert.equal(await page.getByRole('button', { name: '加入生词本', exact: true }).isDisabled(), true);
  mode = 'success'; await page.getByRole('button', { name: '重试', exact: true }).click(); await completed();
  assert.ok((await page.locator('.reader-translation-result').innerText()).includes('Structured'));
  await close();
  console.log('PASS partial failure cannot be saved; retry replaces incomplete output');

  mode = 'pending';
  await wordDrag('Neural Scene Representation', 0, 6); await translate();
  await page.waitForFunction(() => document.querySelector('.reader-translation-result')?.textContent.includes('正在理解'));
  while (!pendingRoute) await new Promise(resolve => setTimeout(resolve, 10));
  mode = 'success';
  await wordDrag('Structured Terrain', 11, 18); await translate(); await completed();
  await result(pendingRoute, '过期译文不应显示').catch(() => {});
  await page.waitForTimeout(200);
  assert.ok((await page.locator('.reader-translation-result').innerText()).includes('Terrain'));
  assert.ok(!(await page.locator('body').innerText()).includes('过期译文不应显示'));
  console.log('PASS superseded request cannot overwrite new translation');
  await close();

  // Cross-page Range uses the same document-level selectionchange path as keyboard selection.
  await page.locator('.pdf-page[data-page="2"]').scrollIntoViewIfNeeded();
  await page.locator('.pdf-page[data-page="2"] .reader-text-layer span').first().waitFor();
  await page.evaluate(() => {
    const pages = [...document.querySelectorAll('.reader-text-layer')];
    const a = [...pages[0].querySelectorAll('span')].filter(s => s.firstChild?.nodeType === 3 && /[a-z]/i.test(s.textContent)).at(-1);
    const b = [...pages[1].querySelectorAll('span')].find(s => s.firstChild?.nodeType === 3 && s.textContent.length > 30);
    const range = document.createRange(); range.setStart(a.firstChild, 0); range.setEnd(b.firstChild, b.textContent.length);
    getSelection().removeAllRanges(); getSelection().addRange(range);
  });
  await page.getByRole('toolbar').waitFor(); await translate(); await completed();
  assert.equal(await page.getByRole('dialog', { name: '选段翻译', exact: true }).count(), 1);
  assert.equal(vocabulary.length, 1);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(300);
  const panel = await page.locator('.reader-translation-panel').boundingBox();
  assert.ok(panel.x >= 0 && panel.x + panel.width <= 390 && panel.y + panel.height <= 844);
  await screenshot('mobile');
  console.log('PASS cross-page selection, no passage annotations, mobile panel remains within viewport');
  assert.deepEqual(errors, []);
  console.log('PASS browser verification complete (all model responses mocked)');
} finally {
  await screenshot('last-state');
  await browser.close();
}
