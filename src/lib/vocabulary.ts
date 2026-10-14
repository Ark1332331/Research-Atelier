export interface HighlightRect { x:number; y:number; w:number; h:number }
export interface VocabularyEntry { id:string; slug:string; docId:string; page:number; text:string; context:string; meaning:string; lemma:string; partOfSpeech:string; usage:string; rects:HighlightRect[]; createdAt:string }
export function validateRects(input:unknown): HighlightRect[] {
  if(!Array.isArray(input)||!input.length||input.length>30) throw Error("请在一页内选中一个单词或短语");
  return input.map(r=>{ if(!r||[r.x,r.y,r.w,r.h].some(n=>typeof n!=="number"||!Number.isFinite(n))||r.x<0||r.y<0||r.w<=0||r.h<=0||r.x+r.w>1.01||r.y+r.h>1.01) throw Error("高亮位置无效");return {x:r.x,y:r.y,w:r.w,h:r.h}; });
}
