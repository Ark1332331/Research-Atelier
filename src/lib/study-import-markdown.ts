import { fromHtml } from 'hast-util-from-html';
import type { RootContent as HtmlNode } from 'hast';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import { repairStudyMath, type StudyRenderNode } from './study-math.ts';

type Node = StudyRenderNode;
const parser = unified().use(remarkParse).use(remarkGfm).use(remarkMath);
const tableTags = new Set(['table', 'thead', 'tbody', 'tfoot', 'tr', 'td', 'th', 'caption', 'strong', 'b', 'em', 'i', 'sub', 'sup', 'br', 'code']);
const discardTags = new Set(['script', 'style', 'iframe', 'object', 'embed', 'svg', 'math', 'template', 'img', 'input']);

function inline(source: string): Node[] {
  return parser.parse(source).children.flatMap(node => node.type === 'paragraph' ? node.children : [{ type: 'text' as const, value: source }]);
}

function plainText(node: HtmlNode): string {
  return node.type === 'text' ? node.value : node.type === 'element' && !discardTags.has(node.tagName) ? node.children.map(plainText).join('') : '';
}

/** Rebuild table content from a small allowlist; never pass imported HTML attributes through. */
function tableContent(node: HtmlNode): Node[] {
  if (node.type === 'text') return node.value.trim() ? inline(node.value) : [{ type: 'text', value: node.value }];
  if (node.type !== 'element' || discardTags.has(node.tagName)) return [];
  if (node.tagName === 'eq') {
    return inline(`$${plainText(node)}$`);
  }
  if (node.tagName === 'code') return [{ type: 'inlineCode', value: plainText(node) }];
  const structural = ['table', 'thead', 'tbody', 'tfoot', 'tr'].includes(node.tagName);
  const children = node.children.filter(child => !(structural && child.type === 'text' && !child.value.trim())).flatMap(tableContent);
  if (!tableTags.has(node.tagName)) return children;
  const properties: Record<string, unknown> = {};
  if (node.tagName === 'td' || node.tagName === 'th') {
    for (const key of ['colSpan', 'rowSpan']) {
      const value = Number(node.properties[key]);
      if (Number.isInteger(value) && value > 0 && value <= 1000) properties[key] = value;
    }
  }
  return [{ type: 'studyTableElement', data: { hName: node.tagName, hProperties: properties }, children }];
}

/** Find the matching table end, including nested tables. */
function tableEnd(source: string): number {
  let depth = 0;
  for (const match of source.matchAll(/<\/?table\b[^>]*>/gi)) {
    depth += match[0].startsWith('</') ? -1 : 1;
    if (depth === 0) return match.index! + match[0].length;
  }
  return -1;
}

function splitExercises(node: Node): Node[] {
  if (node.type !== 'paragraph') return [node];
  const paragraphs: Node[] = [];
  let children: Node[] = [];
  for (const child of node.children ?? []) {
    if (child.type !== 'text') { children.push(child); continue; }
    const parts = (child.value ?? '').split(/\n(?=(?:\d+[.)]\s*\[[^\]\n]+\]|\(\d+\)))/);
    parts.forEach((value, index) => {
      if (index && children.length) { paragraphs.push({ type: 'paragraph', children }); children = []; }
      if (value) children.push({ ...child, value });
    });
  }
  if (children.length) paragraphs.push({ ...node, children });
  return paragraphs;
}

/** OCR exporters omit blank lines after HTML tables, so CommonMark consumes the
 * following exercises as one raw HTML block. Recover and parse that Markdown too.
 * Code stays untouched; formula repairs apply only to parsed math and table cells. */
export function remarkStudyImports() {
  function restore(node: Node, sourceText: string): Node[] {
    if (node.type === 'html' && /^\s*<table\b/i.test(node.value ?? '')) {
      const source = node.value!, end = tableEnd(source);
      if (end > 0) {
        const table = fromHtml(source.slice(0, end), { fragment: true }).children.flatMap(tableContent);
        const tailSource = source.slice(end);
        const tail = parser.parse(tailSource);
        return [...table.flatMap(child => restore(child, '')), ...tail.children.flatMap(child => restore(child, tailSource))];
      }
    }
    if (node.children) node.children = node.children.flatMap(child => restore(child, sourceText));
    if (node.type === 'list') {
      for (const item of node.children ?? []) {
        // CommonMark retains only the first number of a list. OCR documents can
        // restart subquestions at 1 without indentation; keep each original value.
        const offset = item.position?.start.offset;
        const marker = node.ordered && offset !== undefined ? sourceText.slice(offset).match(/^(\d{1,9})[.)](?:\s|$)/) : null;
        if (marker) item.data = { ...item.data, hProperties: { ...item.data?.hProperties, value: Number(marker[1]) } };
      }
    }
    return splitExercises(repairStudyMath(node, sourceText));
  }
  return (tree: Node, file: { toString(): string }) => {
    const source = file.toString();
    if (tree.children) tree.children = tree.children.flatMap(child => restore(child, source));
  };
}
