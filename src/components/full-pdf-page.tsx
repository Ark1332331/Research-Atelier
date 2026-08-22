"use client";

import { memo, useEffect, useRef, useState } from "react";
import type { Term } from "@/app/api/terms/route";
import { getPageItems, matchTerms, type TermBox } from "@/lib/pdf-alignment";

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
  pageNum, width, frameWidth, doc, terms, onTerm,
}: {
  pageNum: number;
  /** 内容 CSS 宽度（适应宽度 × zoom），同时决定渲染 scale */
  width: number;
  /** 纸张外框固定宽度（适应宽度，不随 zoom 变） */
  frameWidth: number;
  doc: { getPage: (n: number) => Promise<unknown>; numPages: number };
  terms: Term[];
  onTerm: (p: Popover) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [data, setData] = useState<{ w: number; h: number; terms: TermBox[] } | null>(null);

  useEffect(() => {
    let cancelled = false;
    // 上一次的渲染任务：effect 因 width/doc/terms 变化重跑时必须先取消，
    // 否则 pdf.js 会抛 "Cannot use the same canvas during multiple render() operations"。
    let task: { cancel: () => void; promise: Promise<unknown> } | null = null;
    (async () => {
      try {
        const page = (await doc.getPage(pageNum)) as any;
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

        const items = await getPageItems(page, vp);
        if (cancelled) return;
        setData({
          w: vp.width,
          h: vp.height,
          terms: matchTerms(items, terms),
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (!msg.includes("Rendering cancelled") && !msg.includes("Invalid PDF")) console.warn("pdf page:", msg);
      }
    })();
    return () => { cancelled = true; task?.cancel(); };
  }, [pageNum, width, doc, terms]);

  return (
    <div className="pdf-page" style={{ width: frameWidth }} data-page={pageNum}>
      <div className="pdf-page-scroll" style={data ? { width: data.w, height: data.h } : { width }}>
        <canvas ref={canvasRef} className="pdf-canvas" />
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
