type MarkdownNode = {
  type: string;
  value?: string;
  alt?: string;
  depth?: number;
  children?: MarkdownNode[];
  data?: { hProperties?: Record<string, unknown>; [key: string]: unknown };
};

function headingText(node: MarkdownNode): string {
  return node.value ?? node.alt ?? node.children?.map(headingText).join('') ?? '';
}

/** Assign IDs from the parsed tree, so code fences and setext headings follow CommonMark. */
export function remarkStudyHeadings() {
  return (tree: MarkdownNode) => {
    const used = new Set<string>();
    function visit(node: MarkdownNode) {
      if (node.type === 'heading') {
        const title = headingText(node).trim();
        const base = title.toLowerCase().replace(/[^\p{L}\p{N}\p{M}\s_-]/gu, '').replace(/\s+/g, '-') || 'section';
        let id = base;
        for (let suffix = 1; used.has(id); suffix++) id = `${base}-${suffix}`;
        used.add(id);
        node.data = { ...node.data, hProperties: { ...node.data?.hProperties, id, 'data-study-title': title, 'data-study-depth': node.depth ?? 1 } };
      }
      node.children?.forEach(visit);
    }
    visit(tree);
  };
}

type ResolvedLink = { href: string; external: boolean };
function safeDestination(href: string, image: boolean): ResolvedLink | null {
  if (/[\u0000-\u0020\u007f\\]/.test(href)) return null;
  if (/^https?:\/\//i.test(href) || (!image && /^mailto:/i.test(href))) return { href, external: true };
  if ((!image && /^#[^\s]*$/.test(href)) || /^\/study\/[A-Za-z0-9_-]+(?:[?#].*)?$/.test(href) || /^\/api\/study-library\/asset\?id=[^\s]+$/.test(href)) return { href, external: false };
  return null;
}

/** Relative references resolve only through the import manifest, never a server file path. */
export function resolveStudyLink(raw: string, links: Record<string, string>, image = false): ResolvedLink | null {
  const direct = safeDestination(raw, image);
  if (direct) return direct;
  const hash = raw.indexOf('#');
  const path = hash < 0 ? raw : raw.slice(0, hash);
  const fragment = hash < 0 ? '' : raw.slice(hash);
  let decoded = path;
  try { decoded = decodeURIComponent(path); } catch { /* Keep malformed escapes as an unmatched reference. */ }
  const candidates = [raw, path, decoded, path.replace(/^\.\//, ''), decoded.replace(/^\.\//, '')];
  for (const candidate of candidates) {
    if (!Object.prototype.hasOwnProperty.call(links, candidate)) continue;
    const destination = links[candidate];
    const href = destination + (fragment && !destination.includes('#') ? fragment : '');
    return safeDestination(href, image);
  }
  return null;
}
