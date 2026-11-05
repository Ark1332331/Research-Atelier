"use client";

import { memo, useEffect, useRef, useState } from "react";
import type { Term } from "@/lib/terms";
import type { PDFPageProxy } from "pdfjs-dist";
import type { VocabularyEntry } from "@/lib/vocabulary";
import { snapshotReaderRange, type ReaderSelection } from "@/lib/reader-selection";
export type WordSelection = ReaderSelection;
import type { TermBox } from "@/lib/pdf-alignment";
import { wordRangeAtPoint } from "@/lib/pdf-word-lookup";
import { termRanges } from "@/lib/pdf-term-ranges";
import type { ReadingNote } from '@/lib/reading-notes';
import type { ReadingThread } from '@/lib/reading-memory';

/* 全屏阅读器里的单页：自渲染 canvas + 覆盖层（术语高亮）。
   纸张定宽：外框 .pdf-page 宽度 = frameWidth（适应宽度，缩放不变）；
   缩放只放大内容比例：内容条（.pdf-page-scroll）宽度 = vp.width，超宽可横向平移。
   段落圆点已按用户要求移除（对齐成本高）；术语高亮保留。

   坐标契约：canvas 的 CSS 尺寸 == 覆盖层尺寸 == vp.width × vp.height（同一个 CSS-scale
   viewport），所以覆盖层坐标 = CSS px，绝不错位。

   DPR 契约：位图用 page.getViewport({ scale: scale * dpr }) 单独构建（transform 自带 dpr），
   直接渲染到可见 canvas，不再用「覆盖 scale/width 的假 viewport + 离屏 canvas」——
   那条老路在 dpr>1 时 transform 仍是 CSS-scale，文字会被画小再被 downscale。 */

interface Popover { x: number; y: number; term: Term; }

export const FullPdfPage = memo(function FullPdfPage({
  pageNum, width, frameWidth, doc, terms, onTerm, vocabulary = [], onSelect, onWord, onWordLeave, selectedWord, wordLookup = false, memories=[], onMemory,notes=[],onNote,
}: {
  pageNum: number;
  /** 内容 CSS 宽度（适应宽度 × zoom），同时决定渲染 scale */
  width: number;
  /** 纸张外框固定宽度（适应宽度，不随 zoom 变） */
  frameWidth: number;
  doc: { getPage: (n: number) => Promise<unknown>; numPages: number };
  terms: Term[];
  onTerm: (p: Popover) => void;
  vocabulary?: VocabularyEntry[];
  memories?: ReadingThread[];
  onMemory?: (id:string)=>void;
  notes?:ReadingNote[];
  onNote?:(id:string)=>void;
  selectedWord?:WordSelection|null;
  wordLookup?:boolean;
  onSelect?: (s:WordSelection) => void;
  onWord?: (entry:VocabularyEntry,x:number,y:number) => void;
  onWordLeave?:(nextTarget?: EventTarget | null)=>void;
}) {
  const pointerStart = useRef({ x: 0, y: 0 });
  const frameRef = useRef<HTMLDivElement>(null);
  const [visible,setVisible] = useState(false);
  useEffect(() => { const el=frameRef.current; if(!el)return; const io=new IntersectionObserver(entries=>{if(entries.some(e=>e.isIntersecting)){setVisible(true);io.disconnect();}},{rootMargin:"900px"});io.observe(el);return()=>io.disconnect();},[]);
  const textRef = useRef<HTMLDivElement>(null);
  const pageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [data, setData] = useState<{ w: number; h: number; terms: TermBox[] } | null>(null);

  useEffect(() => {
    if(!visible)return;
    let cancelled = false;
    // 上一次的渲染任务：effect 因 width/doc/terms 变化重跑时必须先取消，
    // 否则 pdf.js 会抛 "Cannot use the same canvas during multiple render() operations"。
    let textTask: { cancel: () => void } | null = null;
    let task: { cancel: () => void; promise: Promise<unknown> } | null = null;
    (async () => {
      try {
        const page = (await doc.getPage(pageNum)) as PDFPageProxy;
        if (cancelled) return;
        const base = page.getViewport({ scale: 1 });
        const scale = width / base.width;
        const vp = page.getViewport({ scale });            // CSS 坐标系（覆盖层用它）
        const canvas = canvasRef.current;
        if (!canvas) return;
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const rvp = page.getViewport({ scale: scale * dpr }); // 位图坐标系（transform 自带 dpr）
        canvas.width = Math.ceil(rvp.width);
        canvas.height = Math.ceil(rvp.height);
        canvas.style.width = `${vp.width}px`;
        canvas.style.height = `${vp.height}px`;
        const renderTask = page.render({ canvasContext: canvas.getContext("2d")!, viewport: rvp });
        task = renderTask;
        await renderTask.promise;
        if (cancelled) return;

        const layer = textRef.current;
        if (layer) {
          layer.replaceChildren(); layer.style.setProperty("--scale-factor", String(scale));
          const { TextLayerBuilder } = await import("pdfjs-dist/web/pdf_viewer.mjs");
          if (cancelled) return;
          const tl = new TextLayerBuilder({ pdfPage: page });
          tl.div.classList.add("reader-text-layer");
          layer.append(tl.div);
          textTask = tl; await tl.render(vp);
        }
        if (cancelled) return;
        setData({
          w: vp.width,
          h: vp.height,
          terms: layer && pageRef.current ? termRanges(layer,pageRef.current,terms) : [],
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (!msg.includes("Rendering cancelled") && !msg.includes("Invalid PDF")) console.warn("pdf page:", msg);
      }
    })();
  return () => { cancelled = true; task?.cancel(); textTask?.cancel(); };
  }, [pageNum, width, doc, terms, visible]);

  function wordAt(x: number, y: number) {
    if (!data || !canvasRef.current) return undefined;
    const bounds = canvasRef.current.getBoundingClientRect();
    const px = (x - bounds.left) / data.w, py = (y - bounds.top) / data.h;
    for (const entry of vocabulary) {
      if (entry.page !== pageNum) continue;
      const rect = entry.rects.find(r => px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h);
      if (rect) return { entry, bottom: bounds.top + (rect.y + rect.h) * data.h };
    }
  }


  return (
    <div ref={frameRef} className="pdf-page" style={{ width: frameWidth, minHeight:data ? undefined : frameWidth*1.414 }} data-page={pageNum}>
      <div ref={pageRef} className={`pdf-page-scroll${wordLookup ? " pdf-page-scroll--lookup" : ""}`}
        onPointerDown={e => { pointerStart.current = { x: e.clientX, y: e.clientY }; }}
        onPointerMove={e => {
          if (e.buttons || window.getSelection()?.toString()) return;
          const hit = wordAt(e.clientX, e.clientY);
          if (hit) onWord?.(hit.entry, e.clientX, hit.bottom); else onWordLeave?.();
        }}
        onPointerLeave={e => onWordLeave?.(e.relatedTarget)}
        onClick={e => {
          if (window.getSelection()?.toString() || Math.hypot(e.clientX - pointerStart.current.x, e.clientY - pointerStart.current.y) > 4) return;
          const pageBounds=canvasRef.current?.getBoundingClientRect();
          const remembered=pageBounds&&memories.find(t=>t.anchor.page===pageNum&&t.anchor.rects?.some(r=>e.clientX>=pageBounds.left+r.x*pageBounds.width&&e.clientX<=pageBounds.left+(r.x+r.w)*pageBounds.width&&e.clientY>=pageBounds.top+r.y*pageBounds.height&&e.clientY<=pageBounds.top+(r.y+r.h)*pageBounds.height));
          if(remembered){e.stopPropagation();onMemory?.(remembered.id);return;}
          const noted=pageBounds&&notes.find(n=>n.anchor.page===pageNum&&n.anchor.rects?.some(r=>e.clientX>=pageBounds.left+r.x*pageBounds.width&&e.clientX<=pageBounds.left+(r.x+r.w)*pageBounds.width&&e.clientY>=pageBounds.top+r.y*pageBounds.height&&e.clientY<=pageBounds.top+(r.y+r.h)*pageBounds.height));
          if(noted){e.stopPropagation();onNote?.(noted.id);return;}
          const hit = wordAt(e.clientX, e.clientY);
          if (hit) { e.stopPropagation(); onWord?.(hit.entry, e.clientX, hit.bottom); return; }
          if (wordLookup && textRef.current && pageRef.current) {
            const range = wordRangeAtPoint(textRef.current, e.clientX, e.clientY);
            const selected = range && snapshotReaderRange(pageRef.current, range, false);
            if (selected) { e.stopPropagation(); onSelect?.(selected); return; }
          }
          const bounds=canvasRef.current?.getBoundingClientRect() ?? e.currentTarget.getBoundingClientRect();
          const t=data?.terms.find(t => e.clientX-bounds.left>=t.x && e.clientX-bounds.left<=t.x+t.w && e.clientY-bounds.top>=t.y && e.clientY-bounds.top<=t.y+t.h);
          if(t) {e.stopPropagation();onTerm({ x:Math.max(8,Math.min(e.clientX,window.innerWidth-320)),y:Math.max(8,Math.min(e.clientY,window.innerHeight-260)),term:t.term });}
        }} style={data ? { width: data.w, height: data.h } : { width }}>
        <canvas ref={canvasRef} className="pdf-canvas" />
        <div ref={textRef} className="pdf-text-host" />
        {data&&notes.filter(n=>n.anchor.page===pageNum).flatMap(n=>n.anchor.rects?.map((r,i)=><button key={'note-'+n.id+'-'+i} data-note-id={n.id} className="pdf-note-highlight" style={{left:r.x*data.w,top:r.y*data.h,width:r.w*data.w,height:r.h*data.h}} aria-label={'查看笔记：'+n.comment} onClick={e=>{e.stopPropagation();onNote?.(n.id);}}/>))}
        {data&&memories.filter(t=>t.anchor.page===pageNum).flatMap(t=>t.anchor.rects?.map((r,i)=><button key={`memory-${t.id}-${i}`} className="pdf-memory-highlight" style={{left:r.x*data.w,top:r.y*data.h,width:r.w*data.w,height:r.h*data.h}} aria-label={`展开追问：${t.anchor.text}`} onClick={e=>{e.stopPropagation();onMemory?.(t.id);}}/>))}
        {data && selectedWord?.page===pageNum && !selectedWord.native && selectedWord.rects.map((r,i)=><div key={`selected-${i}`} className="word-selection-preview" aria-hidden="true" style={{left:r.x*data.w,top:r.y*data.h,width:r.w*data.w,height:r.h*data.h}}/>)}
        {data && vocabulary.filter(e => e.page === pageNum).flatMap(entry => entry.rects.map((r,i) => <button key={`${entry.id}-${i}`} className="word-highlight" aria-label={`${entry.text}：${entry.meaning}`} style={{left:r.x*data.w,top:r.y*data.h,width:r.w*data.w,height:r.h*data.h}} onMouseLeave={e => onWordLeave?.(e.relatedTarget)} onBlur={e => onWordLeave?.(e.relatedTarget)} onMouseEnter={e => onWord?.(entry,e.clientX,e.clientY)} onFocus={e => { const b=e.currentTarget.getBoundingClientRect(); onWord?.(entry,b.left,b.bottom); }} onClick={e => { e.stopPropagation(); onWord?.(entry,e.clientX,e.clientY); }} />))}
        {data && (
          <div className="pdf-overlay" style={{ width: data.w, height: data.h }}>
            {data.terms.map((t, i) => (
              <button key={`t${i}`} className="pdf-term"
                style={{ left: t.x, top: t.y, width: t.w, height: t.h }}
                onClick={(e) => {
                  e.stopPropagation();
                  onTerm({ x: Math.min(e.clientX, window.innerWidth - 300), y: Math.min(e.clientY, window.innerHeight - 240), term: t.term });
                }}
                aria-label={`术语 ${t.term.name.split("/")[0].trim()} 详情`}
                title={t.term.name.split("/")[0].trim()}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
});
