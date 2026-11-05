export interface HighlightRect { x:number; y:number; w:number; h:number }
export interface VocabularyEntry { id:string; slug:string; docId:string; page:number; text:string; context:string; meaning:string; lemma:string; partOfSpeech:string; usage:string; rects:HighlightRect[]; createdAt:string; sourceAnchor?:import('./reading-memory').ReadingAnchor }
export function belongsToPaper(entry:VocabularyEntry,slug:string,docId:string):boolean {
  return entry.slug===slug&&(entry.docId===docId||(!entry.docId&&Boolean(entry.sourceAnchor)&&!entry.rects.length));
}
export function validateRects(input:unknown, maximum=30): HighlightRect[] {
  if(!Array.isArray(input)||!input.length||input.length>maximum) throw Error("请缩小选区后重试");
  return input.map(r=>{ if(!r||[r.x,r.y,r.w,r.h].some(n=>typeof n!=="number"||!Number.isFinite(n))||r.x<0||r.y<0||r.w<=0||r.h<=0||r.x+r.w>1.01||r.y+r.h>1.01) throw Error("高亮位置无效");return {x:r.x,y:r.y,w:r.w,h:r.h}; });
}
