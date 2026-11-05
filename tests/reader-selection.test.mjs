import test from 'node:test';
import assert from 'node:assert/strict';
const selection = await import('../src/lib/reader-selection.ts').catch(() => ({}));

test('PDF extraction cleans wrapped prose while preserving paragraphs and real hyphens', () => {
  assert.equal(typeof selection.normalizeSelectionText, 'function');
  assert.equal(selection.normalizeSelectionText('reconstruc-\ntion of\nmodels\n\nA state-of-the-art method.'), 'reconstruction of models\n\nA state-of-the-art method.');
  assert.equal(selection.normalizeSelectionText('ﬁnite\u00ad element\u0000 analysis'), 'finite element analysis');
});

test('sentences use the passage panel even below the old 160-character limit', () => {
  assert.equal(typeof selection.classifySelection, 'function');
  assert.equal(selection.classifySelection('point cloud'), 'word');
  assert.equal(selection.classifySelection('self-supervised learning'), 'word');
  assert.equal(selection.classifySelection('This is a complete sentence.'), 'passage');
  assert.equal(selection.classifySelection('a long selection containing more than eight words for translation'), 'passage');
  assert.equal(selection.classifySelection('first paragraph\n\nsecond paragraph'), 'passage');
  assert.ok(selection.MAX_SELECTION_LENGTH >= 12000);
});
