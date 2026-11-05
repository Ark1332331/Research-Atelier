import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const app=createRequire(import.meta.url),renderer=createRequire(app.resolve('rehype-katex'));
test('KaTeX stylesheet and Markdown renderer come from the same installation',()=>{
 assert.equal(app.resolve('katex'),renderer.resolve('katex'),'layout imports katex/dist CSS, which must match rehype-katex HTML and fonts');
});
