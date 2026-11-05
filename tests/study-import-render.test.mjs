import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import Markdown from 'react-markdown';
import gfm from 'remark-gfm';
import math from 'remark-math';
import katex from 'rehype-katex';
import {remarkStudyImports} from '../src/lib/study-import-markdown.ts';
import {fromHtml} from 'hast-util-from-html';

function render(content) {
  return renderToStaticMarkup(React.createElement(Markdown, {
    remarkPlugins: [gfm, math, remarkStudyImports], rehypePlugins: [[katex, {strict:false}]], skipHtml:true,
  }, content));
}

test('actual hw07 import retains all sixteen exercises, six tables and five display equations', () => {
  const html=render(readFileSync(new URL('./fixtures/hw07-import.md',import.meta.url),'utf8'));
  for(const id of ['94-1','97-7','98-8','100-11','108-12','101-5.1','101-5.2','102-5.3','106-5.9','109-5.14','94-2','99-10','101-12','98-9','102-3','135-6.45']) assert.ok(html.includes('['+id+']'), 'missing exercise '+id);
  assert.equal((html.match(/<table>/g)||[]).length,6);
  assert.equal((html.match(/class="katex-display"/g)||[]).length,5);
  assert.ok(!html.includes('katex-error'));
  assert.match(html,/<p>\(2\) 试求/);
  assert.match(html,/<p>2\. \[99-10\]/);
  assert.match(html,/<p>\(3\) 求 p/);
  assert.match(html,/<td><span class="katex"/,'OCR eq tags in table cells render as math');
});

test('HTML tables preserve merged cells and inline formatting but cannot inject executable HTML', () => {
  const html=render('<table onclick="bad()"><tr><th colspan="2" style="display:none">条件</th></tr><tr><td rowspan="2"><eq>X_i</eq></td><td><strong>重点</strong><br><sup>2</sup><script>bad()</script><img src="x" onerror="bad()"><a href="javascript:bad()">链接文字</a></td></tr><tr><td>$x^2$</td></tr></table>\n2. [a-2] 后续题目');
  assert.match(html,/colSpan="2"/);assert.match(html,/rowSpan="2"/);
  assert.match(html,/<strong>重点<\/strong>/);assert.match(html,/<sup>2<\/sup>/);
  assert.ok(html.includes('[a-2]'));
  assert.ok(!/onclick|onerror|javascript:|<script|<img|style="display:none"|bad\(\)/i.test(html));
  assert.equal((html.match(/class="katex"/g)||[]).length,2);
});

test('ordinary Markdown tables and code samples are not rewritten', () => {
  const html=render('| X | p |\n| - | - |\n| 1 | 0.5 |\n\n```html\n<table><tr><td>example</td></tr></table>\n2. [a-2] code\n```\n\n`<table>`');
  assert.equal((html.match(/<table>/g)||[]).length,1);
  assert.ok(html.includes('&lt;table&gt;&lt;tr&gt;'));
  assert.ok(html.includes('2. [a-2] code\n'));
});

test('table text spacing and literal code survive conversion', () => {
  const html=render('<table><tr><td><strong>A</strong> <em>B</em><code>$x^2$</code></td></tr></table>');
  assert.match(html,/<strong>A<\/strong> <em>B<\/em>/);
  assert.match(html,/<code>\$x\^2\$<\/code>/);
});

test('Practice1 retains original main and subquestion numbers instead of numbering 1 through 14', () => {
  const html=render(readFileSync(new URL('./fixtures/practice01-import.md',import.meta.url),'utf8'));
  const numbers=[...html.matchAll(/<li value="(\d+)"/g)].map(match=>Number(match[1]));
  assert.deepEqual(numbers,[1,2,3,4,1,2,3,4,5,6,7,8,9,10,1,2,3,4,5]);
  assert.match(html,/\n\(1\) 事件 A/,'retain original line breaks for subquestions');
  assert.match(html,/\n\(2\) 事件 B/);
});

test('source numbering survives skipped numbers, nested lists, restarts and HTML table recovery', () => {
  const html=render('3. 第三题\n8. 第八题\n\n   2. 子题二\n   5. 子题五\n0. 从零开始\n\n<table><tr><td>X</td></tr></table>\n7. 表格后第七题\n12. 表格后第十二题');
  assert.deepEqual([...html.matchAll(/<li value="(\d+)"/g)].map(match=>Number(match[1])),[3,8,2,5,0,7,12]);
});

test('complete multivariate paste repairs escaped math and renders all fourteen block formulas and table symbols', () => {
  const source=readFileSync(new URL('./fixtures/multivariate-pasted.md',import.meta.url),'utf8');
  const html=render(source);
  assert.ok(!html.includes('katex-error'),'copied delimiters must not cause KaTeX errors');
  assert.equal((html.match(/class="katex-display"/g)||[]).length,14);
  const annotations=[];
  const text=node=>node.value??node.children?.map(text).join('')??'';
  function visit(node){if(node.tagName==='annotation')annotations.push(text(node));node.children?.forEach(visit);}
  visit(fromHtml(html,{fragment:true}));
  assert.ok(annotations.some(x=>x.startsWith('X _ {i}')));
  assert.ok(annotations.some(x=>x.includes('\\mu_ {x}')&&x.includes('\\sigma_ {x}')));
  assert.ok(annotations.includes('alpha'.replace(/^/,'\\')));
  assert.ok(annotations.includes('beta'.replace(/^/,'\\')));
  assert.ok(annotations.includes(String.raw`X_{i} (i \in \{1,2\})`));
  assert.ok(annotations.every(x=>!x.includes(String.raw`\_`)));
  assert.ok(html.includes('[92-4]'));assert.equal((html.match(/<table>/g)||[]).length,4);
});

test('literal underscores, text commands, code and valid matrix line breaks are preserved', () => {
  const formula=String.raw`\text{file\_ {name}} + a\_b + \begin{aligned}x&=1\\\alpha&=2\end{aligned}`;
  const html=render('$'+formula+'$\n\n```tex\n'+String.raw`\left\\{ X \_ {i}`+'\n```\n\n`'+String.raw`\mu\_ {x}`+'`');
  assert.ok(!html.includes('katex-error'));
  assert.ok(html.includes(String.raw`\text{file\_ {name}}`));
  assert.ok(html.includes(String.raw`\\\alpha`));
  assert.match(html,/<pre><code class="language-tex">\\left\\\\\{ X \\_ \{i\}/);
  assert.ok(html.includes('<code>'+String.raw`\mu\_ {x}`+'</code>'));
});
