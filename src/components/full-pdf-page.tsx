"use client";

import { memo, useEffect, useRef, useState } from "react";
import type { Term } from "@/lib/terms";
import type { PDFPageProxy } from "pdfjs-dist";
import type { VocabularyEntry, HighlightRect } from "@/lib/vocabulary";
export interface WordSelection { x:number; y:number; text:string; context:string; page:number; rects:HighlightRect[] }
import type { TermBox } from "@/lib/pdf-alignment";
import { wordRangeAtPoint } from "@/lib/pdf-word-lookup";
import { termRanges } from "@/lib/pdf-term-ranges";

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
  pageNum, width, frameWidth, doc, terms, onTerm, vocabulary = [], onSelect, onWord, onWordLeave, selectedWord, wordLookup = false,
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
  selectedWord?:WordSelection|null;
  wordLookup?:boolean;
  onSelect?: (s:WordSelection) => void;
  onWord?: (entry:VocabularyEntry,x:number,y:number) => void;
  onWordLeave?:()=>void;
}) {
  const skipClickRef=useRef(0);
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
          const { TextLayer } = await import("pdfjs-dist");
          if (cancelled) return;
          const tc = await page.getTextContent();
          if (cancelled) return;
          const tl = new TextLayer({ textContentSource:tc, container:layer, viewport:vp });
          textTask = tl; await tl.render();
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

    function snapshot(range:Range) {
    const root=pageRef.current,layer=textRef.current;
    if(!root||!layer||!data||!onSelect||!layer.contains(range.startContainer)||!layer.contains(range.endContainer))return false;
    const text = range.toString().trim(); if (!text || text.length > 160 || !/[a-z]/i.test(text)) return false;
    const bounds = root.getBoundingClientRect(); const raw = Array.from(range.getClientRects()).filter(r => r.width > 1 && r.height > 1);
    const rects = raw.map(r => {
      const x=Math.max(0,r.left-bounds.left+root.scrollLeft), y=Math.max(0,r.top-bounds.top);
      return {x:x/data.w,y:y/data.h,w:Math.min(r.width,data.w-x)/data.w,h:Math.min(r.height,data.h-y)/data.h};
    }).filter(r => r.w>0 && r.h>0);
    if (!rects.length) return false;
    const spans = Array.from(layer.querySelectorAll("span"));
    const anchor = range.startContainer.parentElement; const idx = spans.findIndex(s => s === anchor || s.contains(anchor));
    const context = spans.slice(Math.max(0,idx-2),idx+4).map(s => s.textContent).join(" ");
    onSelect?.({ x:Math.max(8,Math.min(raw[0].left,window.innerWidth-340)), y:Math.max(8,Math.min(raw[0].bottom+8,window.innerHeight-210)), text,context,page:pageNum,rects });
    return true;
  }
  function selection(e:{type:string;stopPropagation:()=>void}){
    const selected=window.getSelection();if(!selected||selected.isCollapsed||!selected.rangeCount)return;
    if(snapshot(selected.getRangeAt(0))){e.stopPropagation();skipClickRef.current=e.type==="mouseup"?Date.now()+100:0;selected.removeAllRanges();}
  }


  return (
    <div ref={frameRef} className="pdf-page" style={{ width: frameWidth, minHeight:data ? undefined : frameWidth*1.414 }} data-page={pageNum}>
      <div ref={pageRef} className="pdf-page-scroll" onMouseUp={selection} onKeyUp={selection} onClick={e => { if(Date.now()<skipClickRef.current){skipClickRef.current=0;e.stopPropagation();return;} skipClickRef.current=0;if(wordLookup&&textRef.current){const range=wordRangeAtPoint(textRef.current,e.clientX,e.clientY);if(range&&snapshot(range)){e.stopPropagation();window.getSelection()?.removeAllRanges();return;}} if(window.getSelection()?.toString()) return; const bounds=e.currentTarget.getBoundingClientRect(); const t=data?.terms.find(t => e.clientX-bounds.left>=t.x && e.clientX-bounds.left<=t.x+t.w && e.clientY-bounds.top>=t.y && e.clientY-bounds.top<=t.y+t.h); if(t) {e.stopPropagation();onTerm({ x:Math.max(8,Math.min(e.clientX,window.innerWidth-320)),y:Math.max(8,Math.min(e.clientY,window.innerHeight-260)),term:t.term });} }} style={data ? { width: data.w, height: data.h } : { width }}>
        <canvas ref={canvasRef} className="pdf-canvas" />
        <div ref={textRef} className={`textLayer reader-text-layer${wordLookup?" reader-text-layer--lookup":""}`} />
        {data && selectedWord?.page===pageNum && selectedWord.rects.map((r,i)=><div key={`selected-${i}`} className="word-selection-preview" aria-hidden="true" style={{left:r.x*data.w,top:r.y*data.h,width:r.w*data.w,height:r.h*data.h}}/>)}
        {data && vocabulary.filter(e => e.page === pageNum).flatMap(entry => entry.rects.map((r,i) => <button key={`${entry.id}-${i}`} className="word-highlight" aria-label={`${entry.text}：${entry.meaning}`} style={{left:r.x*data.w,top:r.y*data.h,width:r.w*data.w,height:r.h*data.h}} onMouseLeave={onWordLeave} onBlur={onWordLeave} onMouseEnter={e => onWord?.(entry,e.clientX,e.clientY)} onFocus={e => { const b=e.currentTarget.getBoundingClientRect(); onWord?.(entry,b.left,b.bottom); }} onClick={e => { e.stopPropagation(); onWord?.(entry,e.clientX,e.clientY); }} />))}
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
