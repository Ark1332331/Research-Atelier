import type { HighlightRect } from './vocabulary';

export const MAX_SELECTION_LENGTH = 12000;
export interface ReaderSelection {
  x: number;
  y: number;
  text: string;
  context: string;
  page: number;
  rects: HighlightRect[];
  memoryRects?: HighlightRect[];
  native: boolean;
}

export function normalizeSelectionText(text: string): string {
  return text.normalize('NFKC').replace(/[\u0000\u00ad]/g, '')
    .replace(/\r\n?/g, '\n')
    .replace(/([a-z])-[ \t]*\n[ \t]*([a-z])/g, '$1$2')
    .replace(/[ \t]+/g, ' ').replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n').replace(/([^\n])\n(?!\n)/g, '$1 ').trim();
}

export function classifySelection(text: string): 'word' | 'passage' {
  const clean = normalizeSelectionText(text);
  return clean.length <= 80 && clean.split(/\s+/).length <= 8 && !/[.!?。！？;；\n]/.test(clean)
    ? 'word' : 'passage';
}

function textLayer(node: Node): HTMLElement | null {
  return (node.nodeType === 1 ? node as Element : node.parentElement)?.closest<HTMLElement>('.reader-text-layer') ?? null;
}

function separator(previous: DOMRect | null, next: DOMRect, newPage = false): string {
  if (!previous) return '';
  if (newPage || Math.abs(next.top - previous.top) > Math.max(next.height, previous.height) * .55) {
    return !newPage && next.top - previous.bottom > previous.height * .8 ? '\n\n' : '\n';
  }
  return next.left - previous.right > Math.max(1, next.height * .12) ? ' ' : '';
}

function contextAround(layer: HTMLElement, selection: Range): string {
  const walker = layer.ownerDocument.createTreeWalker(layer, NodeFilter.SHOW_TEXT);
  let node: Node | null, text = '', anchor: number | null = null, previous: DOMRect | null = null;
  while ((node = walker.nextNode())) {
    if (!node.textContent) continue;
    const range = layer.ownerDocument.createRange();
    range.selectNodeContents(node);
    const rect = range.getBoundingClientRect();
    text += separator(previous, rect);
    if (anchor === null && selection.intersectsNode(node)) {
      anchor = text.length + (selection.startContainer === node ? selection.startOffset : 0);
    }
    text += node.textContent;
    previous = rect;
  }
  const start = Math.max(0, (anchor ?? 0) - 500);
  return normalizeSelectionText(text.slice(start, Math.max(start + 1600, (anchor ?? 0) + 200))).slice(0, 1600);
}

/** Read only PDF text nodes: UI labels and annotation buttons never become source text. */
export function snapshotReaderRange(root: HTMLElement, range: Range, native = true, backwards = false): ReaderSelection | null {
  const firstLayer = textLayer(range.startContainer), lastLayer = textLayer(range.endContainer);
  if (!firstLayer || !lastLayer || !root.contains(firstLayer) || !root.contains(lastLayer) || range.collapsed) return null;
  const page = Number(firstLayer.closest<HTMLElement>('[data-page]')?.dataset.page);
  const pageRoot = firstLayer.closest<HTMLElement>('.pdf-page-scroll');
  if (!pageRoot || !page) return null;
  let text = '', previous: DOMRect | null = null, previousLayer: Element | null = null;
  const rectangles: DOMRect[] = [];
  for (const layer of root.querySelectorAll<HTMLElement>('.reader-text-layer')) {
    if (!range.intersectsNode(layer)) continue;
    const walker = root.ownerDocument.createTreeWalker(layer, NodeFilter.SHOW_TEXT);
    let node: Node | null;
    while ((node = walker.nextNode())) {
      if (!node.textContent || !range.intersectsNode(node)) continue;
      const part = range.cloneRange();
      if (range.comparePoint(node, 0) >= 0) part.setStart(node, 0);
      if (range.comparePoint(node, node.textContent.length) <= 0) part.setEnd(node, node.textContent.length);
      const value = part.toString();
      if (!value) continue;
      const rect = part.getBoundingClientRect();
      text += separator(previous, rect, layer !== previousLayer);
      text += value;
      rectangles.push(...Array.from(part.getClientRects()).filter(r => r.width > 0 && r.height > 0));
      previous = rect; previousLayer = layer;
    }
  }
  text = normalizeSelectionText(text);
  if (!text || !rectangles.length) return null;
  // The canvas is the full PDF surface; the scroll container can be narrower at zoom > 1.
  // Its client rect already includes horizontal/vertical scrolling offsets.
  const bounds = pageRoot.querySelector('canvas')?.getBoundingClientRect();
  if (!bounds?.width || !bounds.height) return null;
  const rects = firstLayer === lastLayer && classifySelection(text) === 'word' ? rectangles.map(r => ({
    x: Math.max(0, r.left - bounds.left) / bounds.width,
    y: Math.max(0, r.top - bounds.top) / bounds.height,
    w: Math.max(0, Math.min(r.right, bounds.right) - Math.max(r.left, bounds.left)) / bounds.width,
    h: Math.max(0, Math.min(r.bottom, bounds.bottom) - Math.max(r.top, bounds.top)) / bounds.height,
  })).filter(r => r.w > 0 && r.h > 0) : [];
  const anchor = backwards ? rectangles[0] : rectangles[rectangles.length - 1];
  // Long/cross-page questions anchor their memory to the selected lines on the first page.
  const memoryRects=rectangles.filter(r=>r.top>=bounds.top-1&&r.bottom<=bounds.bottom+1&&r.right>bounds.left&&r.left<bounds.right).slice(0,300).map(r=>({x:Math.max(0,r.left-bounds.left)/bounds.width,y:Math.max(0,r.top-bounds.top)/bounds.height,w:Math.max(0,Math.min(r.right,bounds.right)-Math.max(r.left,bounds.left))/bounds.width,h:Math.max(0,Math.min(r.bottom,bounds.bottom)-Math.max(r.top,bounds.top))/bounds.height})).filter(r=>r.w>0&&r.h>0);
  return {
    x: anchor.left, y: anchor.bottom + 8, text,
    context: contextAround(firstLayer, range), page,
    rects: rects.length <= 30 ? rects : [], memoryRects, native,
  };
}

export function captureReaderSelection(root: HTMLElement): ReaderSelection | null {
  const selection = root.ownerDocument.getSelection();
  if (!selection || selection.isCollapsed || !selection.rangeCount) return null;
  const range = selection.getRangeAt(0);
  return snapshotReaderRange(root, range, true, selection.focusNode === range.startContainer && selection.focusOffset === range.startOffset);
}
