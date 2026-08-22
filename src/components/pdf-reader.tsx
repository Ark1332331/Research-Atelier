"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import type { Term } from "@/app/api/terms/route";
import { STATUS_COLOR } from "@/components/terms";

/* 位置提取用 pdf.js 的 getTextContent→transform（经真实字号/上缘/宽换算成 CSS px 框）。
   这套我验证过：术语框精确落在"point cloud / locomotion / voxel grid"等词的字形上。
   ReaderPage 自渲染 canvas + 覆盖层，全部用同一个 viewport，保证同尺度、绝不错位。 */

const ReaderPage = dynamic(() => import("./pdf-reader-page").then((m) => m.ReaderPage), {
  ssr: false,
  loading: () => <p className="mono-label" style={{ padding: "2rem 0" }}>加载 PDF 页面…</p>,
});

/* ---------------- 类型 ---------------- */

interface Popover { x: number; y: number; term: Term; }
interface Seg { text: string; zh?: string; loading?: boolean; err?: string; }

const TRANSLATE_SYSTEM =
  "你是中文学术语论文的翻译引擎。把用户发来的英文段落翻译成准确、通顺、保留学术术语原文的中文。" +
  "只输出译文本身，不要任何解释、前缀或批注。";

function engName(t: Term) { return t.name.split("/")[0].trim(); }
function hash(s: string) { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return Math.abs(h).toString(36); }

/* ---------------- 阅读器：连续页 + 段落/划词翻译/提问 ---------------- */

export default function PdfReader({
  src, terms, onGoTerms, onExtractText, onAsk,
}: {
  src: string | ArrayBuffer;
  terms: Term[];
  onGoTerms?: () => void;
  onExtractText?: (t: string) => void;
  onAsk?: (segText: string) => void;
}) {
  const [zoom, setZoom] = useState(1);
  const [containerW, setContainerW] = useState(0);
  const [doc, setDoc] = useState<{ getPage: (n: number) => Promise<unknown>; numPages: number } | null>(null);
  const [pop, setPop] = useState<Popover | null>(null);
  const [seg, setSeg] = useState<Seg | null>(null);
  const [selMenu, setSelMenu] = useState<{ x: number; y: number; text: string } | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const pinchRef = useRef<{ dist: number; zoom: number } | null>(null);

  // 容器宽度（稳定后测量一次；窗口 resize 跟随）
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const measure = () => setContainerW(Math.max(200, el.clientWidth - 24));
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);

  // 加载一次文档 + 提取全文（供对话上下文）
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const pdfjs = await import("pdfjs-dist");
        pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
        const d = await pdfjs.getDocument({
          url: typeof src === "string" ? src : undefined,
          data: typeof src === "string" ? undefined : src,
          cMapUrl: "/pdfjs/cmaps/",
          cMapPacked: true,
          standardFontDataUrl: "/pdfjs/standard_fonts/",
        }).promise;
        if (cancelled) return;
        setDoc(d);
        let all = "";
        for (let i = 1; i <= Math.min(d.numPages, 80); i++) {
          const pg = await d.getPage(i);
          const tc = await pg.getTextContent();
          all += tc.items.map((it) => ("str" in it ? it.str : "")).join(" ") + "\n";
        }
        if (!cancelled && all.trim()) onExtractText?.(all);
      } catch { /* ignore */ }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src, onExtractText]);

  // 用一个比例尺：自然页宽 → 容器宽（用真实页宽 612pt，避免"半屏空白"）
  const fitBase = useMemo(() => (containerW > 0 ? containerW / 612 : 1), [containerW]);
  const pageWidth = useMemo(() => Math.round(fitBase * zoom * 612), [fitBase, zoom]);

  const applyZoom = useCallback((next: number) => setZoom(Math.min(3, Math.max(0.7, next))), []);
  const onWheel = useCallback((e: React.WheelEvent) => {
    if (!(e.ctrlKey || e.metaKey)) return;
    e.preventDefault();
    applyZoom(zoom * (e.deltaY < 0 ? 1.1 : 0.9));
  }, [zoom, applyZoom]);
  const onTouchStart = useCallback((e: React.TouchEvent) => {
    if (e.touches.length === 2) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      pinchRef.current = { dist: Math.hypot(dx, dy), zoom };
    }
  }, [zoom]);
  const onTouchMove = useCallback((e: React.TouchEvent) => {
    if (e.touches.length === 2 && pinchRef.current) {
      e.preventDefault();
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      applyZoom(pinchRef.current.zoom * (Math.hypot(dx, dy) / pinchRef.current.dist));
    }
  }, [applyZoom]);

  const handleSeg = useCallback((t: string) => setSeg({ text: t }), []);
  const handleTerm = useCallback((p: Popover) => setPop(p), []);

  async function translate(segText: string) {
    const key = `trans-${hash(segText)}`;
    try {
      const cached = localStorage.getItem(key);
      if (cached) { setSeg((s) => (s ? { ...s, zh: cached } : s)); return; }
    } catch { /* ignore */ }
    setSeg((s) => (s ? { ...s, loading: true, err: "" } : s));
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: [
          { role: "system", content: TRANSLATE_SYSTEM },
          { role: "user", content: segText },
        ] }),
      });
      const data = await res.json();
      const zh = data?.choices?.[0]?.message?.content ?? (data?.error ? `翻译失败：${data.error}` : "无响应");
      try { localStorage.setItem(key, zh); } catch { /* ignore */ }
      setSeg((s) => (s ? { ...s, zh, loading: false } : s));
    } catch (e) {
      setSeg((s) => (s ? { ...s, err: `请求失败：${e instanceof Error ? e.message : String(e)}`, loading: false } : s));
    }
  }

  return (
    <div className="pdf-reader">
      <div className="pdf-toolbar">
        <span className="pdf-count">{!pageWidth ? "…" : "连续页"}</span>
        <span className="pdf-meta">点段落圆点 → 翻译/提问 · 点术语 → 小卡 · Ctrl+滚轮缩放</span>
        <span style={{ flex: 1 }} />
        <span className="pdf-zoom-label">{Math.round(zoom * 100)}%</span>
        <button className="btn btn--ghost btn--quiet" onClick={() => applyZoom(zoom - 0.15)}>缩小</button>
        <button className="btn btn--ghost btn--quiet" onClick={() => applyZoom(zoom + 0.15)}>放大</button>
        <button className="btn btn--ghost btn--quiet" onClick={() => applyZoom(1)} style={{ marginLeft: "0.3rem" }}>适应宽度</button>
      </div>

      {terms.length > 0 && (
        <div className="pdf-terms-legend">
          <span className="mono-label">已建档术语 · 点开小卡：</span>
          {terms.slice(0, 12).map((t) => (
            <button key={t.id} className="pdf-term-chip"
              onClick={(e) => { e.stopPropagation(); setPop({ x: Math.min(e.clientX, window.innerWidth - 300), y: Math.min(e.clientY, window.innerHeight - 240), term: t }); }}>
              {engName(t)}
            </button>
          ))}
        </div>
      )}

      <div className="pdf-scroll" ref={wrapRef}
        onClick={() => { setPop(null); setSelMenu(null); }}
        onWheel={onWheel}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}>
        {doc && pageWidth > 0 && Array.from({ length: Math.min(doc.numPages, 25) }, (_, i) => (
          <ReaderPage
            key={i + 1}
            pageNum={i + 1}
            width={pageWidth}
            doc={doc}
            terms={terms}
            onSeg={handleSeg}
            onTerm={handleTerm}
          />
        ))}
      </div>

      {pop && (
        <div className="pdf-pop-wrap" onClick={(e) => e.stopPropagation()}>
          <div className="pdf-pop" style={{ left: pop.x, top: pop.y }}>
            <div className="pdf-pop-head">
              <strong>{pop.term.name}</strong>
              <span style={{ marginLeft: "auto", color: STATUS_COLOR[pop.term.status] ?? "var(--muted-foreground)" }}>● {pop.term.status}</span>
            </div>
            <span className="pdf-pop-role">{pop.term.role} · {pop.term.reuse}</span>
            <p className="pdf-pop-note">{pop.term.note || "还没有写理解笔记。"}</p>
            <button className="pdf-pop-close" onClick={() => setPop(null)}>×</button>
            <div className="pdf-pop-foot">
              <span className="mono-label">来自词汇表 · 首次出现即建档</span>
              {onGoTerms && (
                <button className="tlink" style={{ fontSize: "0.75rem" }} onClick={() => { onGoTerms(); setPop(null); }}>去词汇表 →</button>
              )}
            </div>
          </div>
        </div>
      )}

      {selMenu && (
        <span className="pdf-selection-menu" style={{ left: selMenu.x, top: selMenu.y }}>
          <button className="btn btn--accent" onClick={() => { setSelMenu(null); setSeg({ text: selMenu.text }); }}>翻译</button>
          <button className="btn" onClick={() => { setSelMenu(null); onAsk?.(selMenu.text); }}>提问</button>
        </span>
      )}

      {seg && <div className="seg-mask" onClick={() => setSeg(null)} aria-hidden="true" />}
      {seg && (
        <aside className="seg-panel" role="dialog" aria-label="翻译与提问">
          <div className="seg-head">
            <span className="mono-label">翻译或提问</span>
            <button className="pdf-pop-close" style={{ position: "static" }} onClick={() => setSeg(null)}>×</button>
          </div>
          <p className="seg-orig">{seg.text}</p>
          {seg.zh && <p className="seg-zh">{seg.zh}</p>}
          {seg.loading && <p className="mono-label">翻译中…</p>}
          {seg.err && <p className="mono-label" style={{ color: "var(--amber)" }}>{seg.err}</p>}
          <div className="seg-actions">
            <button className="btn btn--accent" onClick={() => void translate(seg.text)} disabled={seg.loading || Boolean(seg.zh)}>
              {seg.zh ? "已翻译" : "翻译"}
            </button>
            <button className="btn" onClick={() => { onAsk?.(seg.text); setSeg(null); }}>
              就这段提问 →
            </button>
          </div>
        </aside>
      )}
    </div>
  );
}
