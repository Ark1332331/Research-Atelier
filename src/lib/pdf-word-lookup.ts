/** A DOM Range measures a word without putting it into the browser's native Selection. */
export function englishWordAt(text:string,offset:number):{start:number;end:number;text:string}|null {
  if(!Number.isInteger(offset)||offset<0||offset>text.length)return null;
  const match=Array.from(text.matchAll(/[A-Za-z]+(?:['’\-][A-Za-z]+)*/g)).find(m=>offset>=m.index&&offset<m.index+m[0].length)
    ?? Array.from(text.matchAll(/[A-Za-z]+(?:['’\-][A-Za-z]+)*/g)).find(m=>offset===m.index+m[0].length);
  return match?{start:match.index,end:match.index+match[0].length,text:match[0]}:null;
}
export function wordRangeAtPoint(layer:HTMLElement,x:number,y:number):Range|null {
  const doc=layer.ownerDocument;
  const api=doc as Document & {caretPositionFromPoint?:(x:number,y:number)=>{offsetNode:Node;offset:number}|null;caretRangeFromPoint?:(x:number,y:number)=>Range|null};
  const position=api.caretPositionFromPoint?.(x,y);const caret=position?null:api.caretRangeFromPoint?.(x,y);
  const node=position?.offsetNode??caret?.startContainer;const offset=position?.offset??caret?.startOffset;
  if(!node||node.nodeType!==Node.TEXT_NODE||offset===undefined||!layer.contains(node))return null;
  const word=englishWordAt(node.textContent??"",offset);if(!word)return null;
  const range=doc.createRange();range.setStart(node,word.start);range.setEnd(node,word.end);
  // Caret APIs return a nearest text position even if the pointer is in empty page space.
  if(!Array.from(range.getClientRects()).some(r=>x>=r.left-2&&x<=r.right+2&&y>=r.top-2&&y<=r.bottom+2))return null;
  return range;
}
