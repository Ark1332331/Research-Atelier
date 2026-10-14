import type { Term } from "./terms";
import type { TermBox } from "./pdf-alignment";
// Use actual PDF.js text glyph positions, rather than estimated character widths.
export function termRanges(layer:HTMLElement, root:HTMLElement, terms:Term[]):TermBox[] {
  const spans=Array.from(layer.querySelectorAll("span")).filter(s=>s.firstChild?.nodeType===Node.TEXT_NODE);
  const chunks:{node:Node;start:number;end:number}[]=[];let text="";
  for(const span of spans){const str=span.textContent??"";chunks.push({node:span.firstChild!,start:text.length,end:text.length+str.length});text+=str+" ";}
  const bounds=root.getBoundingClientRect();const boxes:TermBox[]=[];
  for(const term of terms){const name=term.name.split(/[／/]/)[0].trim();if(name.length<2)continue;
    const escaped=name.replace(/[.*+?^${}()|[\]\\]/g,"\\$&").replace(/\s+/g,"\\s+");const pattern=new RegExp(`(?<![a-z0-9])${escaped}(?![a-z0-9])`,"gi");
    for(const match of text.matchAll(pattern)){const start=match.index;const end=start+match[0].length;const a=chunks.find(c=>start>=c.start&&start<c.end);const b=chunks.find(c=>end>c.start&&end<=c.end);if(!a||!b)continue;
      const range=document.createRange();range.setStart(a.node,start-a.start);range.setEnd(b.node,end-b.start);
      for(const r of Array.from(range.getClientRects()))if(r.width>1&&r.height>1)boxes.push({x:r.left-bounds.left+root.scrollLeft,y:r.top-bounds.top+root.scrollTop,w:r.width,h:r.height,term});
      if(boxes.length>400)return boxes;
    }
  }
  return boxes;
}
