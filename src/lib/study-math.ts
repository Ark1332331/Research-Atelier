import type { ElementContent } from 'hast';

export type StudyRenderNode = {
  type: string;
  value?: string;
  children?: StudyRenderNode[];
  ordered?: boolean | null;
  position?: { start: { offset?: number }; end?: { offset?: number } };
  data?: { hName?: string; hProperties?: Record<string, unknown>; hChildren?: ElementContent[] };
};

/** Repair Markdown escaping inside TeX, not in prose/code or literal text groups.
 * In particular, never collapse \\\alpha: it can mean a row break then alpha. */
export function normalizeStudyMath(value: string): string {
  const rows = /\\begin\s*\{(?:array|cases|[pbBvV]?matrix|aligned|alignedat|gathered)\}/.test(value);
  const repair = (part: string) => {
    let result = part.replace(/(\\(?:left|right|middle)\s*)\\{2,}([{}])/g, (_all, command, brace) => command + '\\' + brace)
      .replace(/(?<!\\)\\([_^])(?=\s*\{)/g, '$1');
    if (rows) result = result.replace(/(?<!\\)\\{3}(?!\\)(?=\s|[{}0-9])/g, () => '\\\\');
    return result;
  };
  const literals = /\\(?:text(?:normal|rm|sf|tt|bf|it)?|mbox|operatorname)\*?\s*\{/g;
  let result = '', cursor = 0, match: RegExpExecArray | null;
  while ((match = literals.exec(value))) {
    let depth = 1, end = literals.lastIndex;
    for (; end < value.length && depth; end++) {
      if (value[end] === '\\') { end++; continue; }
      if (value[end] === '{') depth++;
      if (value[end] === '}') depth--;
    }
    result += repair(value.slice(cursor, match.index)) + value.slice(match.index, end);
    cursor = end; literals.lastIndex = end;
  }
  return result + repair(value.slice(cursor));
}

function mathNode(value: string, display: boolean, previous?: StudyRenderNode): StudyRenderNode {
  const text: ElementContent = {type: 'text', value};
  const result: StudyRenderNode = {...previous, type: display ? 'math' : 'inlineMath', value, data: display
    ? {hName: 'pre', hChildren: [{type: 'element', tagName: 'code', properties: {className: ['language-math', 'math-display']}, children: [text]}]}
    : {hName: 'code', hProperties: {className: ['language-math', 'math-inline']}, hChildren: [text]}};
  delete result.children;
  return result;
}

export function repairStudyMath(node: StudyRenderNode, source: string): StudyRenderNode {
  if (node.type === 'math' || node.type === 'inlineMath') {
    const value = normalizeStudyMath(node.value ?? '');
    return value === node.value ? node : mathNode(value, node.type === 'math', node);
  }
  if (node.type === 'paragraph' && node.children?.length === 1 && node.children[0].type === 'inlineMath') {
    const formula = node.children[0], start = formula.position?.start.offset, end = formula.position?.end?.offset;
    // remark-math treats $$ x $$ on one line as inline. A paragraph containing
    // only that formula is a display equation; $x$ and formulas within prose stay inline.
    if (start !== undefined && end !== undefined && /^\$\$[\s\S]*\$\$$/.test(source.slice(start, end))) {
      return mathNode(formula.value ?? '', true, node);
    }
  }
  if ((node.type === 'tableCell' || ['td','th'].includes(node.data?.hName ?? '')) && node.children?.length && node.children.every(child => child.type === 'text')) {
    const value = node.children.map(child => child.value ?? '').join('').trim();
    // OCR table cells sometimes omit $ delimiters. Accept only a small, explicit
    // math shape, not English prose, filenames, code or arbitrary backslash text.
    if (/^(?:\\[A-Za-z]+\b|[A-Za-z](?:_|\s*\())/.test(value)
      && /\\(?:alpha|beta|gamma|delta|theta|lambda|mu|sigma|rho|phi|Phi|Sigma|Delta|Omega|omega|pi|in|leq|geq|frac|sqrt)\b/.test(value)
      && /^[\sA-Za-z0-9\\_{}()[\],.+*=<>|!^−-]+$/u.test(value)) {
      return {...node, children: [mathNode(normalizeStudyMath(value), false)]};
    }
  }
  return node;
}
