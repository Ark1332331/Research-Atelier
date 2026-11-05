import test from 'node:test';
import assert from 'node:assert/strict';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import { remarkStudyHeadings, resolveStudyLink } from '../src/lib/study-markdown.ts';

test('headings follow Markdown parsing, ignore fences, and get collision-free anchors', () => {
  const parser = unified().use(remarkParse).use(remarkStudyHeadings);
  const tree = parser.runSync(parser.parse('# 第一章 **集合**\n\n```md\n# 假标题\n```\n\n## 第一章 集合\n\n## 第一章 集合-1\n\n## 第一章 集合\n\n集合基础\n----'));
  const headings = tree.children.filter(node => node.type === 'heading');
  assert.deepEqual(headings.map(node => node.data.hProperties.id), ['第一章-集合', '第一章-集合-1', '第一章-集合-1-1', '第一章-集合-2', '集合基础']);
  assert.equal(headings[0].data.hProperties['data-study-title'], '第一章 集合');
  assert.equal(headings[4].data.hProperties['data-study-depth'], 2);
});

test('imported document and image references use stable IDs and retain fragments', () => {
  const links = { 'chapter 2.md': '/study/next', 'images/图.png': '/api/study-library/asset?id=img' };
  assert.deepEqual(resolveStudyLink('./chapter%202.md#证明', links), { href: '/study/next#证明', external: false });
  assert.deepEqual(resolveStudyLink('images/%E5%9B%BE.png', links, true), { href: '/api/study-library/asset?id=img', external: false });
  assert.deepEqual(resolveStudyLink('#集合', links), { href: '#集合', external: false });
  assert.equal(resolveStudyLink('missing.png', links, true), null);
});

test('links reject executable schemes, local files, untrusted mappings and image mailto', () => {
  for (const href of ['javascript:alert(1)', 'data:text/html,x', 'file:///C:/secret', '//example.com', '/etc/passwd', 'toString']) {
    assert.equal(resolveStudyLink(href, {}), null);
  }
  assert.equal(resolveStudyLink('x.md', {'x.md': 'javascript:alert(1)'}), null);
  assert.equal(resolveStudyLink('mailto:test@example.com', {}, true), null);
  assert.deepEqual(resolveStudyLink('https://example.com/a', {}), { href: 'https://example.com/a', external: true });
  assert.deepEqual(resolveStudyLink('mailto:test@example.com', {}), { href: 'mailto:test@example.com', external: true });
});
