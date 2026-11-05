export interface HighlightBox {left:number;top:number;width:number;height:number}

/** Merge neighboring glyphs on the same visual line, never across paragraph gaps. */
export function joinHighlightBoxes(boxes:HighlightBox[]):HighlightBox[] {
  const lines:HighlightBox[]=[];
  for(const box of [...boxes].filter(b=>b.width>.1&&b.height>1).sort((a,b)=>a.top-b.top||a.left-b.left)){
    const line=lines.find(b=>{
      const overlap=Math.min(b.top+b.height,box.top+box.height)-Math.max(b.top,box.top);
      const gap=Math.max(box.left-(b.left+b.width),b.left-(box.left+box.width),0);
      return overlap>=Math.min(b.height,box.height)*.6 && gap<=Math.max(12,Math.min(b.height,box.height));
    });
    if(line){const right=Math.max(line.left+line.width,box.left+box.width),bottom=Math.max(line.top+line.height,box.top+box.height);line.left=Math.min(line.left,box.left);line.top=Math.min(line.top,box.top);line.width=right-line.left;line.height=bottom-line.top;}
    else lines.push({...box});
  }
  return lines;
}

/** Keep source text/offsets untouched. Treat KaTeX as a visual atom, not hundreds of spans. */
export function readingHighlightBoxes(root:HTMLElement,selection:Range):HighlightBox[] {
  const boxes:HighlightBox[]=[],math=new Set<Element>();
  const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);
  let node:Node|null;
  function add(rect:DOMRect,element:Element|null){
    let left=rect.left,right=rect.right,top=rect.top,bottom=rect.bottom;
    // Clip against inner scroll areas (e.g. a wide formula), but not the outer reader.
    for(let parent=element;parent&&parent!==root;parent=parent.parentElement){
      const style=getComputedStyle(parent);
      if(/auto|scroll|hidden|clip/.test(style.overflowX)){const r=parent.getBoundingClientRect();left=Math.max(left,r.left);right=Math.min(right,r.right);}
      if(/auto|scroll|hidden|clip/.test(style.overflowY)){const r=parent.getBoundingClientRect();top=Math.max(top,r.top);bottom=Math.min(bottom,r.bottom);}
    }
    if(right>left&&bottom>top)boxes.push({left,top,width:right-left,height:bottom-top});
  }
  while((node=walker.nextNode())){
    if(!node.textContent||!selection.intersectsNode(node))continue;
    const part=document.createRange();part.selectNodeContents(node);
    if(selection.startContainer===node)part.setStart(node,selection.startOffset);
    if(selection.endContainer===node)part.setEnd(node,selection.endOffset);
    if(part.collapsed)continue;
    const formula=node.parentElement?.closest('.katex');
    if(formula){
      if(math.has(formula))continue;math.add(formula);
      const html=formula.querySelector('.katex-html');if(!html)continue;
      // .katex-html may fill the display width. Its bases are the actual formula ink.
      const parts=Array.from(html.children).filter(el=>el.classList.contains('base')||el.classList.contains('tag'));
      // Inline math may wrap between bases; do not fill the empty area between lines.
      const chunks=formula.closest('.katex-display')?[html]:parts.length?parts:[html];
      for(const chunk of chunks){
        const bases=chunk===html?parts:[chunk];
        const rects=bases.map(el=>el.getBoundingClientRect()).filter(r=>r.width&&r.height);
        // Fractions/cases use positioned descendants outside the base's line box.
        const glyphs=document.createTreeWalker(chunk,NodeFilter.SHOW_TEXT);let glyph:Node|null;
        while((glyph=glyphs.nextNode())){if(!glyph.textContent?.trim()||glyph.parentElement?.closest('.vlist-s'))continue;const ink=document.createRange();ink.selectNodeContents(glyph);rects.push(...Array.from(ink.getClientRects()).filter(r=>r.width&&r.height));}
        rects.push(...Array.from(chunk.querySelectorAll('svg')).map(el=>el.getBoundingClientRect()).filter(r=>r.width&&r.height));
        if(rects.length){const l=Math.min(...rects.map(r=>r.left)),t=Math.min(...rects.map(r=>r.top));add(new DOMRect(l,t,Math.max(...rects.map(r=>r.right))-l,Math.max(...rects.map(r=>r.bottom))-t),html);}
      }
    }else if(!node.parentElement?.closest('[hidden],.katex-mathml')){
      for(const rect of part.getClientRects())add(rect,node.parentElement);
    }
  }
  const origin=root.getBoundingClientRect();
  return joinHighlightBoxes(boxes).map(b=>({...b,left:b.left-origin.left,top:b.top-origin.top}));
}

/** Human-readable quote with the original TeX once, instead of MathML + visual glyph duplicates. */
export function readingQuoteMarkdown(root:HTMLElement,selection:Range):string {
  // Backslash-escaped brackets look like TeX delimiters to normalizeMathMarkdown.
  // Entities preserve literal punctuation without creating accidental formulas/links.
  const escape=(text:string)=>text.replace(/[&\\`*_{}\[\]<>#$|]/g,char=>`&#${char.charCodeAt(0)};`);
  function visit(node:Node):string {
    if(!selection.intersectsNode(node))return '';
    if(node.nodeType===Node.TEXT_NODE){
      const start=node===selection.startContainer?selection.startOffset:0;
      const end=node===selection.endContainer?selection.endOffset:node.textContent?.length??0;
      return escape((node.textContent??'').slice(start,end));
    }
    if(!(node instanceof Element))return '';
    if(node.matches('.katex')){
      const latex=node.querySelector('annotation[encoding="application/x-tex"]')?.textContent;
      if(latex)return node.parentElement?.classList.contains('katex-display')?`\n\n$$\n${latex}\n$$\n\n`:`$${latex}$`;
    }
    if(node.matches('[hidden],.katex-mathml'))return '';
    if(node.tagName==='BR')return '\n';
    const result=Array.from(node.childNodes).map(visit).join('');
    return /^(P|DIV|LI|H[1-6]|BLOCKQUOTE|TR)$/.test(node.tagName)?result+'\n\n':result;
  }
  return visit(root).replace(/\n{3,}/g,'\n\n').trim().slice(0,24000);
}
