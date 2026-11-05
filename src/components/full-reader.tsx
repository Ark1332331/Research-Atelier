"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {ModelControl} from '@/components/model-settings';
import { useRouter, useSearchParams } from "next/navigation";
import { FullPdfPage, type WordSelection } from "@/components/full-pdf-page";
import {useReadingNotes} from "./reading-notes";
import type {ReadingAnchor} from "@/lib/reading-memory";
import FloatingPanel from './floating-panel';
import PaperActions from './paper-actions';
import {watchPaperChanges} from '@/lib/paper-events';
import ChatPanel from "@/components/chat-panel";
import Markdown from "@/components/markdown";
import { useReadingMemory } from "@/components/reading-memory";
import { termsForPaper, type Term } from "@/lib/terms";
import type { VocabularyEntry } from "@/lib/vocabulary";
import { captureReaderSelection, classifySelection, MAX_SELECTION_LENGTH } from "@/lib/reader-selection";
import ReaderTranslation, { ReaderSelectionToolbar } from "@/components/reader-translation";

/* 全屏阅读器 /read/<slug>。
   点击任意论文标题进入：占满整个视口，左栏可切换文章；所有阅读功能都在这里：
   手动收藏术语高亮(落在词上)、缩放(Ctrl+滚轮/按钮/捏合)、连续滚动、
   AI 讲解抽屉（复用 ChatPanel，附带论文译文，可拖动/缩放/记住位置）、
   左栏底部的阅读收藏与进度、
   左栏每篇论文的「中」按钮 → 主区切换到上传时生成的整篇中文翻译（/read/<slug>?view=zh）。

   缩放契约：纸张定宽（frameWidth = 适应宽度，不随 zoom 变），缩放只放大内容比例；
   内容条超宽时在页内横向平移（见 full-pdf-page.tsx 的注释）。
   段落圆点已按用户要求移除（对齐成本高）；段落级翻译由上传时的全文翻译替代。 */

interface Popover { x: number; y: number; term: Term; }
interface PaperItem { slug: string; title: string; pages: number; projectId?:string; }

export default function FullReader({ slug }: { slug: string }) {
  const router=useRouter(),searchParams=useSearchParams();
  const requestedProject=searchParams.get('project');
  const memory=useReadingMemory();
  const notes=useReadingNotes();
  const [railOpen,setRailOpen] = useState(false);
  const [words,setWords] = useState<VocabularyEntry[]>([]);
  const [wordLookup,setWordLookup]=useState(false);
  useEffect(()=>{let gone=false;queueMicrotask(()=>{try{if(!gone)setWordLookup(localStorage.getItem("ra-reader-word-lookup")==="true");}catch{/* reading preference is optional */}});return()=>{gone=true;};},[]);
  const [docId,setDocId] = useState(""); const [wordSelection,setWordSelection] = useState<WordSelection | null>(null);
  const [translationSelection, setTranslationSelection] = useState<WordSelection | null>(null);
  const latestSelectionRef = useRef<WordSelection | null>(null);
  const documentScopeRef = useRef('');
  const [wordPop,setWordPop] = useState<{entry:VocabularyEntry;x:number;y:number} | null>(null);
  function closeWord(nextTarget?: EventTarget | null) {
    if (nextTarget instanceof Element && nextTarget.closest('.word-popover-hover')) return;
    setWordPop(null);
  }
  const [wordError,setWordError] = useState(""); const [showWords,setShowWords] = useState(false);
  const [pdfError,setPdfError] = useState("");
  useEffect(() => { let cancelled=false; documentScopeRef.current = slug; queueMicrotask(()=>{if(!cancelled){setWords([]);setDocId("");setWordSelection(null);setTranslationSelection(null);latestSelectionRef.current=null;setWordPop(null);setWordError("");}});
    let version=0;const refresh=()=>{const token=++version;fetch(`/api/vocabulary?slug=${encodeURIComponent(slug)}`).then(async r => {const d=await r.json();if(!r.ok)throw Error(d.error);if(!cancelled&&token===version){setWords(d.entries);setDocId(d.docId);}}).catch(e=>{if(!cancelled)setWordError(e.message);});};refresh();window.addEventListener('reading-words-changed',refresh);return()=>{cancelled=true;window.removeEventListener('reading-words-changed',refresh);}; },[slug]);
  function translateSelection() {
    if (!wordSelection || wordSelection.text.length > MAX_SELECTION_LENGTH) return;
    setTranslationSelection(wordSelection); setWordSelection(null); setWordPop(null);
  }
  async function saveCollection(selection: WordSelection, meaning: string, kind: 'term' | 'word') {
    if (!docId) throw Error('论文尚未加载完成，请稍后保存。');
    const r = await fetch(kind==='term'?'/api/terms':'/api/vocabulary', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: kind==='term'?'capture':'save', slug, docId, ...selection, meaning }) });
    const d = await r.json();
    if (!r.ok) throw Error(d.error || '保存失败，请重试。');
    if (documentScopeRef.current === slug) {if(kind==='term')setTerms(d.terms);else setWords(d.entries);}
    window.dispatchEvent(new Event(kind==='term'?'reading-terms-changed':'reading-words-changed'));
  }
  async function removeWord(entry:VocabularyEntry) {
    try {const r=await fetch("/api/vocabulary",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"delete",slug,docId,id:entry.id})});const d=await r.json();if(!r.ok)throw Error(d.error);setWords(d.entries);setWordPop(null);window.dispatchEvent(new Event("reading-words-changed"));}catch(e){setWordError(e instanceof Error?e.message:String(e));}
  }
  const [doc, setDoc] = useState<{ getPage: (n: number) => Promise<unknown>; numPages: number } | null>(null);
  const [papers, setPapers] = useState<PaperItem[]>([]);
  const [terms, setTerms] = useState<Term[]>([]);
  const [zoom, setZoom] = useState(1);
  const [containerW, setContainerW] = useState(0);
  const [pop, setPop] = useState<Popover | null>(null);
  const [chatOpen, setChatOpen] = useState(false);
  const [chatVisited,setChatVisited]=useState(false);
  const [paperText, setPaperText] = useState("");
  const [translation, setTranslation] = useState("");
  const [translationError, setTranslationError] = useState("");
  const [zhGenerating, setZhGenerating] = useState(false);
  const [view, setView] = useState<"pdf" | "zh">("pdf");
  useEffect(()=>{const locate=(event:Event)=>{const anchor=(event as CustomEvent<ReadingAnchor>).detail;if(anchor.slug!==slug)return;if(anchor.origin?.kind==='chat'){setChatVisited(true);setChatOpen(true);}else if(anchor.rects&&anchor.docId===docId){setView('pdf');}};window.addEventListener('reading-open-source',locate);return()=>window.removeEventListener('reading-open-source',locate);},[slug,docId]);
  const [readSet, setReadSet] = useState<Set<number>>(new Set());
  const scrollRef = useRef<HTMLDivElement>(null);
  const pinchRef = useRef<{ dist: number; zoom: number } | null>(null);
  const [paperDataLoaded,setPaperDataLoaded]=useState(false);
  const zhTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const observerRef = useRef<IntersectionObserver | null>(null);
  const translationGeneration=useRef(0);
  const cancelTranslation=useCallback(()=>{translationGeneration.current++;if(zhTimerRef.current){clearInterval(zhTimerRef.current);zhTimerRef.current=null;}},[]);

  const src = `/api/paper/pdf?slug=${encodeURIComponent(slug)}`;

  const receiveSelection = useCallback((selection: WordSelection) => {
    const old = latestSelectionRef.current;
    if (old && old.text === selection.text && old.page === selection.page && old.x === selection.x && old.y === selection.y) return;
    latestSelectionRef.current = selection;
    setWordSelection(selection); setTranslationSelection(null); setWordPop(null); setPop(null); setWordError('');
  }, []);

  useEffect(() => {
    if (view !== 'pdf') return;
    let dragging = false, frame = 0, timer: ReturnType<typeof setTimeout> | undefined, settledRange: Range | null = null;
    const capture = () => {
      if (!scrollRef.current) return;
      const native = window.getSelection();
      if (!native?.rangeCount || native.isCollapsed) return;
      const range = native.getRangeAt(0);
      if (settledRange && range.startContainer === settledRange.startContainer && range.startOffset === settledRange.startOffset && range.endContainer === settledRange.endContainer && range.endOffset === settledRange.endOffset) return;
      const selected = captureReaderSelection(scrollRef.current);
      if (selected) { settledRange = range.cloneRange(); receiveSelection(selected); }
    };
    const pointerDown = (event: PointerEvent) => {
      if (!(event.target instanceof Element) || !scrollRef.current?.contains(event.target) || !event.target.closest('.reader-text-layer') || event.button !== 0) return;
      dragging = true; latestSelectionRef.current = null; settledRange = null;
      cancelAnimationFrame(frame); clearTimeout(timer);
      setWordSelection(null); setTranslationSelection(null); setWordPop(null);
    };
    const pointerUp = () => {
      if (!dragging) return;
      dragging = false; cancelAnimationFrame(frame); frame = requestAnimationFrame(capture);
    };
    const selectionChange = () => {
      if (dragging) return;
      clearTimeout(timer); timer = setTimeout(capture, 120);
    };
    const keyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      clearTimeout(timer); cancelAnimationFrame(frame);
      setWordSelection(null); setTranslationSelection(null); setWordPop(null);
      latestSelectionRef.current = null;
      const native = window.getSelection();
      if (native?.anchorNode && scrollRef.current?.contains(native.anchorNode)) native.removeAllRanges();
    };
    const cancelDrag = () => { dragging = false; clearTimeout(timer); cancelAnimationFrame(frame); };
    const resize = () => {
      clearTimeout(timer); cancelAnimationFrame(frame);
      setWordSelection(null); setWordPop(null);
      setTranslationSelection(s => s && classifySelection(s.text) === 'word' ? null : s);
    };
    const scroller = scrollRef.current;
    scroller?.addEventListener('scroll', resize, true);
    document.addEventListener('pointerdown', pointerDown);
    document.addEventListener('pointerup', pointerUp);
    document.addEventListener('pointercancel', cancelDrag);
    document.addEventListener('selectionchange', selectionChange);
    document.addEventListener('keydown', keyDown);
    window.addEventListener('blur', cancelDrag);
    window.addEventListener('resize', resize);
    return () => {
      cancelDrag();
      scroller?.removeEventListener('scroll', resize, true);
      document.removeEventListener('pointerdown', pointerDown);
      document.removeEventListener('pointerup', pointerUp);
      document.removeEventListener('pointercancel', cancelDrag);
      document.removeEventListener('selectionchange', selectionChange);
      document.removeEventListener('keydown', keyDown);
      window.removeEventListener('blur', cancelDrag);
      window.removeEventListener('resize', resize);
    };
  }, [receiveSelection, view]);

  // 视图模式：URL ?view=zh 决定（切换论文时跟着 URL 走）
  useEffect(() => {
    let cancelled=false;queueMicrotask(()=>{if(!cancelled)setView(window.location.search.includes("view=zh") ? "zh" : "pdf");});
    return()=>{cancelled=true;};
  }, [slug]);

  // Local edits and changes in another window refresh the same library.
  useEffect(() => {
    let gone=false,version=0,listed=false;
    const refresh=()=>{const token=++version;fetch('/api/paper').then(async r=>{const d=await r.json();if(!r.ok)throw Error(d.error||'论文库加载失败');if(!gone&&token===version){const items:PaperItem[]=d.papers??[];if(listed&&!items.some(p=>p.slug===slug)){router.replace("/");return;}listed=items.some(p=>p.slug===slug);setPapers(items);}}).catch(e=>{if(!gone)setWordError(e.message);});};
    refresh();const stop=watchPaperChanges(refresh);return()=>{gone=true;stop();};
  }, [router,slug]);

  // 主动收藏后同步本篇术语，不重新加载论文。
  useEffect(() => {
    let cancelled = false;
    const refresh=()=>{fetch("/api/terms").then(r=>r.json()).then(d=>{if(!cancelled)setTerms(d.terms??[]);}).catch(()=>{});};
    refresh();window.addEventListener('reading-terms-changed',refresh);
    return()=>{cancelled=true;window.removeEventListener('reading-terms-changed',refresh);};
  }, []);

  // 论文译文（导入时全文翻译生成的 markdown，失败会带 translationError）：
  // - 中文视图直接渲染它；
  // - AI 讲解抽屉把它作为论文上下文（ChatPanel 自动截断长正文）。
  useEffect(() => {
    let gone=false;
    fetch(`/api/paper?slug=${encodeURIComponent(slug)}`)
      .then(async r=>{const d=await r.json();if(!r.ok)throw Error(d.error||'论文加载失败');return d;})
      .then(d=>{if(gone)return;setPaperDataLoaded(true);setTranslation(d.translation??'');setTranslationError(d.translationError??'');setPaperText(d.translation||(d.pages??[]).map((p:{n:number;original?:string;zh?:string})=>`【第 ${p.n} 页】\n${p.original||p.zh||''}`).join('\n\n'));})
      .catch(e=>{if(!gone){setPaperDataLoaded(true);setTranslationError(e.message);}});
    return()=>{gone=true;cancelTranslation();};
  },[slug,cancelTranslation]);

  // 手动触发/重试整篇中文翻译（后台分钟级；完成后自动刷新视图）
  const generateTranslation = useCallback(() => {
    const generation=++translationGeneration.current;
    const cancelled=()=>generation!==translationGeneration.current;
    if(zhTimerRef.current)clearInterval(zhTimerRef.current);
    setZhGenerating(true);
    setTranslationError("");
    (async () => {
      try {
        const res = await fetch("/api/paper", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "translate", slug }),
        });
        if (!res.ok) {
          const d = await res.json().catch(() => ({}));
          if (!cancelled()) { setTranslationError(d?.error ?? "触发翻译失败"); setZhGenerating(false); }
          return;
        }
      } catch {
        if (!cancelled()) { setTranslationError("触发翻译失败：网络错误"); setZhGenerating(false); }
        return;
      }
      // 轮询结果：translation.md 或 translation.error.txt 出现即结束（上限 12 分钟）
      if(cancelled())return;
      const started = Date.now();
      zhTimerRef.current = setInterval(async () => {
        if (cancelled()) { if (zhTimerRef.current) { clearInterval(zhTimerRef.current); zhTimerRef.current = null; } return; }
        if (Date.now() - started > 12 * 60 * 1000) {
          if (zhTimerRef.current) { clearInterval(zhTimerRef.current); zhTimerRef.current = null; }
          setZhGenerating(false);
          setTranslationError("翻译超时未完成，请稍后重试");
          return;
        }
        try {
          const d = await (await fetch(`/api/paper?slug=${encodeURIComponent(slug)}`)).json();
          if(cancelled())return;
          if (d.translation || d.translationError || d.error) {
            if (zhTimerRef.current) { clearInterval(zhTimerRef.current); zhTimerRef.current = null; }
            const pages: { n: number; zh: string }[] = d.pages ?? [];
            const t: string = d.translation ?? "";
            setTranslation(t);
            setTranslationError(d.translationError ?? d.error ?? "");
            setPaperText(t || pages.map((p: { n: number; zh: string }) => `【第 ${p.n} 页译文】\n${p.zh}`).join("\n\n"));
            setZhGenerating(false);
          }
        } catch { /* 网络抖动，继续轮询 */ }
      }, 8000);
    })();
  }, [slug]);

  // 容器宽度
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const measure = () => setContainerW(Math.max(240, el.clientWidth - 24));
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);

  // 加载文档（中文视图下不需要 PDF，跳过，省 7MB）
  useEffect(() => {
    if (view !== "pdf") return;
    let cancelled = false;
    queueMicrotask(()=>{if(!cancelled){setDoc(null);setPdfError("");}});
    (async () => {
      try {
        const pdfjs = await import("pdfjs-dist");
        pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
        const d = await pdfjs.getDocument({
          url: src,
          cMapUrl: "/pdfjs/cmaps/",
          cMapPacked: true,
          standardFontDataUrl: "/pdfjs/standard_fonts/",
        }).promise;
        if (cancelled) return;
        setDoc(d);
      } catch(e) {if(!cancelled)setPdfError(e instanceof Error?e.message:"PDF 加载失败");}
    })();
    return () => { cancelled = true; };
  }, [src, view]);

  // 已读进度：页面进入视口即记为已读，按 slug 存 localStorage。
  // 注意：延迟到页面完成首轮布局后再开始观察——刚挂载时各页高度还是 0，
  // 全部叠在顶部会被误判为"都在视口内"，导致一进阅读器就显示已读 5/8。
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !doc || view !== "pdf") return;
    const key = `reader-progress:${slug}`;
    let saved: number[] = [];
    try { saved = JSON.parse(localStorage.getItem(key) ?? "[]") ?? []; } catch { /* ignore */ }
    setReadSet(new Set(saved));
    const timer = setTimeout(() => {
      const io = new IntersectionObserver(
        (entries) => {
          setReadSet((prev) => {
            let changed = false;
            const next = new Set(prev);
            for (const en of entries) {
              const target = en.target as HTMLElement;
              if (!en.isIntersecting || target.getBoundingClientRect().height < 200) continue;
              const n = Number(target.dataset.page);
              if (!Number.isNaN(n) && !next.has(n)) { next.add(n); changed = true; }
            }
            if (changed) { try { localStorage.setItem(key, JSON.stringify([...next])); } catch { /* ignore */ } }
            return changed ? next : prev;
          });
        },
        { root: el, threshold: 0.35 },
      );
      for (const p of el.querySelectorAll(".pdf-page[data-page]")) io.observe(p);
      observerRef.current = io;
    }, 800);
    return () => { clearTimeout(timer); observerRef.current?.disconnect(); observerRef.current = null; };
  }, [doc, slug, view]);

  // 纸张定宽（不随 zoom 变）+ 内容宽度（随 zoom 变）
  const frameWidth = useMemo(() => (containerW ? Math.max(200, Math.round(containerW)) : 0), [containerW]);
  const pageWidth = useMemo(() => (frameWidth ? Math.max(200, Math.round(frameWidth * zoom)) : 0), [frameWidth, zoom]);

  const applyZoom = useCallback((next: number) => {
    setWordSelection(null); setWordPop(null);
    setTranslationSelection(s => s && classifySelection(s.text) === 'word' ? null : s);
    setZoom(Math.min(3, Math.max(0.7, next)));
  }, []);
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

  const handleTerm = useCallback((p: Popover) => setPop(p), []);

  // 视图切换（只换 state + 同步 URL，不触发整页导航，PDF 不重载）
  const setViewMode = useCallback((v: "pdf" | "zh") => {
    setView(v);
    try {
      const url=new URL(window.location.href);if(v==='zh')url.searchParams.set('view','zh');else url.searchParams.delete('view');window.history.replaceState(null,'',url.pathname+url.search);
    } catch { /* ignore */ }
  }, []);

  const toggleChat=useCallback(()=>{setChatVisited(true);setChatOpen(open=>!open);},[]);
  const returnProject=requestedProject||papers.find(p=>p.slug===slug)?.projectId;
  const title = papers.find((p) => p.slug === slug)?.title ?? slug;
  const numPages = papers.find((p) => p.slug === slug)?.pages ?? doc?.numPages ?? 0;

  const paperTerms = useMemo(() => termsForPaper(terms.filter(t=>t.collection==='manual'||t.source==='手动建卡'), slug, title), [terms, slug, title]);
  const memoryThreads=memory?.threads.filter(t=>t.anchor.slug===slug&&t.anchor.docId===docId&&t.anchor.rects)??[];
  function askSelection(asNote=false) {
    if(!wordSelection||!docId)return;
    (asNote?notes?.capture:memory?.open)?.({scope:`/read/${slug}`,sourceKey:`pdf:${docId}:${wordSelection.page}:${(wordSelection.memoryRects??wordSelection.rects)[0]?.x}:${(wordSelection.memoryRects??wordSelection.rects)[0]?.y}`,label:`${title} · 第 ${wordSelection.page} 页`,text:wordSelection.text,context:wordSelection.context||wordSelection.text,start:0,end:wordSelection.text.length,slug,docId,page:wordSelection.page,rects:wordSelection.memoryRects?.length?wordSelection.memoryRects:wordSelection.rects});
    setWordSelection(null);setTranslationSelection(null);setWordPop(null);
  }

  return (
    <div data-reader-docid={view==="pdf"?docId:undefined} className={"full-reader"+(railOpen?" is-rail-open":"")}>
      {railOpen && <button className="reader-rail-mask" aria-label="关闭论文列表" onClick={()=>setRailOpen(false)} />}
      {/* 左栏：论文切换 + 阅读收藏 */}
      <aside className="full-reader-rail">
        <div className="full-reader-rail-head">
          <span className="mono-label" style={{ color: "var(--panel-dark-muted)" }}>论文库</span>
        </div>
        <div className="full-reader-rail-list">
          {papers.map((p) => (
            <div key={p.slug} className={`full-reader-rail-row${p.slug === slug ? " is-active" : ""}`}>
              <Link href={`/read/${p.slug}${p.projectId?`?project=${encodeURIComponent(p.projectId)}`:""}`} onClick={()=>setRailOpen(false)} className="full-reader-rail-item">
                <span className="full-reader-rail-title">{p.title}</span>
                <span className="full-reader-rail-meta">{p.pages} 页</span>
              </Link>
              <button className={`rail-zh-btn${p.slug === slug && view === "zh" ? " is-on" : ""}`}
                onClick={() => { if (p.slug === slug) setViewMode("zh"); else router.push(`/read/${p.slug}?view=zh`); }}
                title="看这篇的中文翻译（上传时全文翻译）">
                中
              </button>

            </div>
          ))}
          {papers.length === 0 && <p className="mono-label" style={{ padding: "0.8rem 0.9rem", color: "var(--panel-dark-muted)" }}>还没有导入论文</p>}
        </div>

        <div className="reader-profile">
          <div className="reader-profile-title"><span>我的阅读收藏</span></div>
          <p className="reader-profile-meta">浏览过 {readSet.size}/{numPages} 页 · 手动收藏 {paperTerms.length} 个术语</p>
          <Link href={`/?view=terms&paper=${encodeURIComponent(slug)}`} className="text-button">术语卡片 →</Link>
          <Link href="/?view=vocabulary" className="text-button">全部生词 →</Link>
          <Link href={"/?view=notes&paper="+encodeURIComponent(slug)} className="text-button">随心笔记 →</Link>
          <div className="reading-highlight-legend"><span>蓝色 · 翻译选区</span><span>紫色 · 点击继续追问</span><span>黄色 · 生词收藏</span><span>绿色 · 随心笔记</span></div>
        </div>
      </aside>

      {/* 主区 */}
      <div className="full-reader-main">
        <div className="full-reader-toolbar"><ModelControl />
          <button className="btn reader-library-toggle" aria-expanded={railOpen} onClick={()=>setRailOpen(!railOpen)}>论文库</button>
          <Link href={returnProject?`/?project=${encodeURIComponent(returnProject)}`:"/"} className="full-reader-back" title={returnProject?"返回论文项目":"返回论文库"} aria-label={returnProject?"返回论文项目":"返回论文库"}>←</Link>
          <span className="full-reader-title" title={title}>{title}</span><PaperActions compact title={title} slug={slug} onRenamed={next=>setPapers(items=>items.map(p=>p.slug===slug?{...p,title:next}:p))} onDeleted={()=>router.replace('/')}/>
          {view === "pdf" ? (
            <>
              <span className="mono-label" style={{ marginLeft: "0.6rem" }}>{wordLookup?"单击查词 · 拖选翻译句段":"划选 → 翻译后收藏 / 追问"}</span>
              <button className="btn btn--quiet" aria-pressed={wordLookup} onClick={()=>{setWordLookup(!wordLookup);try{localStorage.setItem("ra-reader-word-lookup",String(!wordLookup));}catch{/* lookup mode still works without storage */}setWordSelection(null);setTranslationSelection(null);window.getSelection()?.removeAllRanges();}} title="开启单击查词，仍可拖选句子和段落">{wordLookup?"关闭点词":"点词查译"}</button>
              <span style={{ flex: 1 }} />
              <span className="pdf-zoom-label">{Math.round(zoom * 100)}%</span>
              <button className="btn btn--ghost btn--quiet" onClick={() => applyZoom(zoom - 0.15)}>缩小</button>
              <button className="btn btn--ghost btn--quiet" onClick={() => applyZoom(zoom + 0.15)}>放大</button>
              <button className="btn btn--ghost btn--quiet" onClick={() => applyZoom(1)} style={{ marginLeft: "0.3rem" }}>适应宽度</button>
            </>
          ) : (
            <>
              <span className="mono-label" style={{ marginLeft: "0.6rem" }}>中文翻译 · 划选内容可继续追问</span>
              <span style={{ flex: 1 }} />
              <button className="btn btn--accent" onClick={() => setViewMode("pdf")}>查看原文 PDF</button>
            </>
          )}
          <Link href={`/?view=terms&paper=${encodeURIComponent(slug)}`} className="btn btn--quiet">术语卡片</Link><button className="btn btn--ghost btn--quiet" onClick={() => setShowWords(!showWords)}>生词本 · {words.length}</button>
          <button className={`btn ${chatOpen ? "btn--accent" : "btn--ghost btn--quiet"}`} style={{ marginLeft: "0.3rem" }}
            onClick={toggleChat}>
            AI 讲解
          </button>
        </div>

        {view === "zh" ? (
          <div className="reader-zh">
            <div className="reader-zh-scroll">
              {translation ? (
                <Markdown sourceKey={`paper-translation:${slug}`} label={`${title} · 全文译文`} slug={slug}>{translation}</Markdown>
              ) : zhGenerating ? (
                <p className="mono-label" style={{ padding: "2rem 0", textAlign: "center" }}>
                  正在生成中文翻译（分钟级，可先看原文 PDF，生成完这里会自动刷新）…
                </p>
              ) : translationError ? (
                <div style={{ padding: "2rem 0", textAlign: "center" }}>
                  <p className="mono-label" style={{ color: "var(--muted-foreground)" }}>中文翻译生成失败：{translationError}</p>
                  <button className="btn btn--accent" style={{ marginTop: "0.8rem" }} onClick={generateTranslation}>重试生成翻译</button>
                </div>
              ) : paperDataLoaded ? (
                <div style={{ padding: "2rem 0", textAlign: "center" }}>
                  <p className="mono-label">这篇论文还没有生成中文翻译</p>
                  <button className="btn btn--accent" style={{ marginTop: "0.8rem" }} onClick={generateTranslation}>生成中文翻译</button>
                </div>
              ) : (
                <p className="mono-label" style={{ padding: "2rem 0", textAlign: "center" }}>正在加载中文翻译…</p>
              )}
            </div>
          </div>
        ) : (
          <div className="full-reader-scroll" ref={scrollRef}
            onClick={() => { setPop(null); if(!window.getSelection()?.toString())setWordSelection(null);setWordPop(null); }}
            onWheel={onWheel}
            onTouchStart={onTouchStart}
            onTouchMove={onTouchMove}>
            {!doc && <p className="mono-label" style={{ padding: "2rem 0" }}>{pdfError||"加载 PDF…"}</p>}
            {doc && pageWidth > 0 && Array.from({ length: doc.numPages }, (_, i) => (
              <FullPdfPage key={i + 1} pageNum={i + 1} width={pageWidth} frameWidth={frameWidth} doc={doc} terms={paperTerms} notes={notes?.notes.filter(n=>n.anchor.slug===slug&&n.anchor.docId===docId&&n.anchor.rects)??[]} onNote={id=>notes?.edit(id)} memories={memoryThreads} onMemory={id=>memory?.show(id)} selectedWord={wordSelection ?? translationSelection} wordLookup={wordLookup} onTerm={handleTerm} vocabulary={words} onSelect={receiveSelection} onWordLeave={closeWord} onWord={(entry,x,y) => {if(translationSelection||wordSelection)return;setWordPop({entry,x:Math.max(8,Math.min(x,window.innerWidth-340)),y:Math.max(8,Math.min(y+12,window.innerHeight-230))});}} />
            ))}
          </div>
        )}
      </div>

      {wordError && !wordSelection && <div className="reader-notice" role="alert">{wordError}<button className="text-button" onClick={()=>setWordError("")}>关闭</button></div>}
      {view === 'pdf' && wordSelection && <ReaderSelectionToolbar key={`${wordSelection.page}:${wordSelection.text}`} selection={wordSelection} error={wordError} onTranslate={translateSelection} onAsk={()=>askSelection()} onNote={()=>askSelection(true)} onClose={() => {setWordSelection(null);window.getSelection()?.removeAllRanges();}} />}
      <ReaderTranslation selection={view === 'pdf' ? translationSelection : null} scope={`${slug}:${docId}`} canSave={!!docId} onClose={() => {setTranslationSelection(null);window.getSelection()?.removeAllRanges();}} sourceSlug={slug} onSave={saveCollection} />
      {wordPop && <div className="word-popover-hover" style={{left:wordPop.x,top:wordPop.y-12}} onPointerLeave={e=>closeWord(e.relatedTarget)} onBlur={e=>closeWord(e.relatedTarget)}><div className="word-popover" role="tooltip"><div className="section-top"><strong>{wordPop.entry.text}</strong><button className="text-button" aria-label="关闭释义" onClick={()=>setWordPop(null)}>×</button></div><p className="word-meaning">{wordPop.entry.meaning}</p><small>{wordPop.entry.lemma} · {wordPop.entry.partOfSpeech}</small><p>{wordPop.entry.usage}</p><small>AI 语境释义 · 第 {wordPop.entry.page} 页</small><button className="text-button" onClick={()=>void removeWord(wordPop.entry)}>移除这处高亮</button></div></div>}
      {showWords&&<FloatingPanel open onClose={()=>setShowWords(false)} title="这篇论文的生词本" storageKey="reader-vocabulary-box" className="reader-vocabulary"><div className="reader-vocabulary-content"><p className="soft-copy">原文收藏可按页码定位，译文和对话收藏保留来源。<Link href="/?view=vocabulary">查看全部生词 →</Link></p>{words.length?words.map(w=><article className="vocabulary-item" key={w.id}><strong>{w.text}</strong><p>{w.meaning}</p><small>{w.lemma}{w.partOfSpeech && ` · ${w.partOfSpeech}`}</small><details><summary>原句与用法</summary><blockquote>{w.context}</blockquote><p>{w.usage}</p></details><div className="inline-actions">{w.sourceAnchor?<Link href={w.sourceAnchor.scope.startsWith("/")&&!w.sourceAnchor.scope.startsWith("//")?w.sourceAnchor.scope:`/read/${slug}`} className="text-button" onClick={()=>setShowWords(false)}>回到收藏来源 →</Link>:<button className="text-button" onClick={()=>{setViewMode("pdf");setShowWords(false);setTimeout(()=>document.querySelector(`[data-page="${w.page}"]`)?.scrollIntoView({behavior:"smooth"}),100);}}>第 {w.page} 页 →</button>}<button className="text-button" onClick={()=>void removeWord(w)}>移除</button></div></article>):<p className="empty-study">划选词语并翻译，再点击“加入生词本”。</p>}</div></FloatingPanel>}
      {chatVisited&&<FloatingPanel open={chatOpen} onClose={()=>setChatOpen(false)} title="AI 讲解对话" subtitle={paperText?'已附带论文内容 · 可划线追问':'研究伴侣 · 导读讲解'} storageKey="reader-chat-box" className="reader-chat" width={560} closeLabel="关闭 AI 讲解">
        <div className="reader-chat-body"><ChatPanel toolKey="p3" resourceId={slug} hint="可以问：这一段在解决什么问题？公式怎么推导？也可以选中回答继续追问。" systemExtra={paperText} historyKey={`read-${slug}`}/></div>
      </FloatingPanel>}

      {/* 术语小卡 */}
      {pop && (
        <div className="pdf-pop-wrap" onClick={(e) => e.stopPropagation()}>
          <div className="pdf-pop" style={{ left: pop.x, top: pop.y }}>
            <div className="pdf-pop-head">
              <strong>{pop.term.name}</strong>
              <span style={{ marginLeft: "auto" }}>我的收藏</span>
            </div>
            <span className="pdf-pop-role">{pop.term.role} · {pop.term.reuse}</span>
            <p className="pdf-pop-note">{pop.term.contexts?.find(c=>c.slug===slug)?.meaning || pop.term.meaning || pop.term.note || "还没有释义。"}</p>
            <button className="pdf-pop-close" onClick={() => setPop(null)}>×</button>
            <div className="pdf-pop-foot">
              <Link href={`/?view=terms&term=${encodeURIComponent(pop.term.id)}&paper=${encodeURIComponent(slug)}`} className="text-button">查看术语卡片 →</Link>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
