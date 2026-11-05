import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeMathMarkdown } from '../src/lib/math-markdown.ts';
import { validateAnchor, buildReadingMessages, readingPath } from '../src/lib/reading-memory.ts';
import { belongsToPaper } from '../src/lib/vocabulary.ts';

test('legacy collection locations share the workspace while reading views retain their paper', () => {
  for (const scope of ['/terms/entropy?paper=sample', '/terms', '/vocabulary', '/?view=terms&term=entropy']) assert.equal(readingPath(scope), '/');
  assert.equal(readingPath('/read/sample?view=zh#paragraph'), '/read/sample');
  assert.equal(readingPath('/read/other'), '/read/other');
});

test('paper vocabulary includes text conversations but excludes replaced PDF anchors', () => {
  const entry = {slug:'sample', docId:'current', rects:[]};
  assert.equal(belongsToPaper(entry,'sample','current'),true);
  assert.equal(belongsToPaper({...entry,docId:'old'},'sample','current'),false);
  assert.equal(belongsToPaper({...entry,docId:'',sourceAnchor:{scope:'/read/sample?view=zh'}},'sample','current'),true);
  assert.equal(belongsToPaper({...entry,docId:'',sourceAnchor:{}},'other','current'),false);
  assert.equal(belongsToPaper({...entry,docId:''},'sample','current'),false);
});

test('normalizes model math delimiters without changing code', () => {
  assert.equal(normalizeMathMarkdown(String.raw`数值 \(x_t\) 和 \[\frac{a}{b}\]`), '数值 $x_t$ 和 \n$$\n\\frac{a}{b}\n$$\n');
  assert.equal(normalizeMathMarkdown('`foo_bar` 和 `x = 2`'), '`foo_bar` 和 `x = 2`');
  assert.equal(normalizeMathMarkdown('`x_train` `y_pred` `x_test.shape` `x_t`'), '`x_train` `y_pred` `x_test.shape` `x_t`');
  assert.equal(normalizeMathMarkdown('```python\nx = "\\(x\\)"\n```'), '```python\nx = "\\(x\\)"\n```');
  assert.equal(normalizeMathMarkdown('`(M_t - M_0)/(M_F - M_0)`'), '$\\frac{M_t - M_0}{M_F - M_0}$');
  assert.equal(normalizeMathMarkdown('`v_t = (d_t - d_{t+1})/d_t`'), '$v_t = \\frac{d_t - d_{t+1}}{d_t}$');
});

const anchor = { scope: '/read/paper', sourceKey: 'reply-1', label: 'AI 回答', text: '收益', context: '这里讨论收益的基线', start: 4, end: 6 };
test('validates anchors and refuses unbounded or invalid offsets', () => {
  assert.deepEqual(validateAnchor(anchor), anchor);
  for (const value of [null, {...anchor, start: -1}, {...anchor, end: 3}, {...anchor, text: 'x'.repeat(12001)}, {...anchor, rects: [{x:-1,y:0,w:1,h:1}]}]) {
    assert.throws(() => validateAnchor(value));
  }
});
test('follow-ups carry the quote, context, and previous turns as distinct messages', () => {
  const messages = buildReadingMessages({anchor, messages:[{role:'user',content:'相对哪个基线？'},{role:'assistant',content:'全数据训练。'}]}, '为何这样归一化？');
  assert.match(messages[0].content, /\\\(/);
  assert.match(messages[1].content, /这里讨论收益的基线/);
  assert.deepEqual(messages.slice(-3), [{role:'user',content:'相对哪个基线？'},{role:'assistant',content:'全数据训练。'},{role:'user',content:'为何这样归一化？'}]);
});
