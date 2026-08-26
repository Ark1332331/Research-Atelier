"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { FullPdfPage } from "@/components/full-pdf-page";
import ChatPanel from "@/components/chat-panel";
import Markdown from "@/components/markdown";
import { STATUS_COLOR } from "@/components/terms";
import type { Term } from "@/app/api/terms/route";

/* 全屏阅读器 /read/<slug>。
   点击任意论文标题进入：占满整个视口，左栏可切换文章；所有阅读功能都在这里：
   术语高亮(落在词上)、缩放(Ctrl+滚轮/按钮/捏合)、连续滚动、
   AI 讲解抽屉（复用 ChatPanel，附带论文译文，可拖动/缩放/记住位置）、
   左栏底部的能力画像（术语状态分布 + 已读进度）、
   左栏每篇论文的「中」按钮 → 主区切换到上传时生成的整篇中文翻译（/read/<slug>?view=zh）。

   缩放契约：纸张定宽（frameWidth = 适应宽度，不随 zoom 变），缩放只放大内容比例；
   内容条超宽时在页内横向平移（见 full-pdf-page.tsx 的注释）。
   段落圆点已按用户要求移除（对齐成本高）；段落级翻译由上传时的全文翻译替代。 */

interface Popover { x: number; y: number; term: Term; }
interface PaperItem { slug: string; title: string; pages: number; }

/* 与 /api/terms 的 STATUS_OPTIONS 一致（客户端本地副本，避免把服务端 route 模块打进 client bundle） */
const STATUS_ORDER = ["未接触", "有直觉", "能解释", "能对应论文", "能实现"];
const STATUS_DOT: Record<string, string> = {
  "未接触": "#6b7280",
  "有直觉": "#d9a441",
  "能解释": "#c8cdd4",
  "能对应论文": "#7fd08a",
  "能实现": "#3ecf6e",
};

const CHAT_BOX_KEY = "reader-chat-box";
const CHAT_MIN_W = 320, CHAT_MIN_H = 240;

interface ChatBox { x: number; y: number; w: number; h: number; }

function defaultChatBox(): ChatBox {
  const w = Math.min(440, window.innerWidth - 32);
  const h = Math.max(320, Math.min(window.innerHeight - 48, 720));
  return { x: window.innerWidth - w - 16, y: 16, w, h };
}

function readChatBox(): ChatBox | null {
  try {
    const raw = localStorage.getItem(CHAT_BOX_KEY);
    if (!raw) return null;
    const b = JSON.parse(raw) as ChatBox;
    if (typeof b.x !== "number" || typeof b.y !== "number" || typeof b.w !== "number" || typeof b.h !== "number") return null;
    b.w = Math.min(b.w, window.innerWidth - 8);
    b.h = Math.min(b.h, window.innerHeight - 8);
    b.x = Math.min(Math.max(b.x, -b.w + 140), window.innerWidth - 140);
    b.y = Math.min(Math.max(b.y, 0), window.innerHeight - 48);
    return b;
  } catch { return null; }
}

export default function FullReader({ slug }: { slug: string }) {
  const [doc, setDoc] = useState<{ getPage: (n: number) => Promise<unknown>; numPages: number } | null>(null);
  const [papers, setPapers] = useState<PaperItem[]>([]);
  const [terms, setTerms] = useState<Term[]>([]);
  const [zoom, setZoom] = useState(1);
  const [containerW, setContainerW] = useState(0);
  const [pop, setPop] = useState<Popover | null>(null);
  const [chatOpen, setChatOpen] = useState(false);
  const [chatBox, setChatBox] = useState<ChatBox | null>(null);
  const [paperText, setPaperText] = useState("");
  const [translation, setTranslation] = useState("");
  const [view, setView] = useState<"pdf" | "zh">("pdf");
  const [readSet, setReadSet] = useState<Set<number>>(new Set());
  const scrollRef = useRef<HTMLDivElement>(null);
  const pinchRef = useRef<{ dist: number; zoom: number } | null>(null);
  const paperDataLoaded = useRef<string | null>(null);
  const observerRef = useRef<IntersectionObserver | null>(null);
  const dragRef = useRef<{ mode: "move" | "resize"; sx: number; sy: number; box: ChatBox } | null>(null);

  const src = `/api/paper/pdf?slug=${encodeURIComponent(slug)}`;

  // 视图模式：URL ?view=zh 决定（切换论文时跟着 URL 走）
  useEffect(() => {
    setView(window.location.search.includes("view=zh") ? "zh" : "pdf");
  }, [slug]);

  // 论文列表（左栏切换）
  useEffect(() => {
    let cancelled = false;
    fetch("/api/paper")
      .then((r) => r.json())
      .then((d) => { if (!cancelled) setPapers(d.papers ?? []); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  // 术语卡
  useEffect(() => {
    let cancelled = false;
    fetch("/api/terms")
      .then((r) => r.json())
      .then((d) => { if (!cancelled) setTerms(d.terms ?? []); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  // 论文译文（上传时全文翻译生成的 markdown）：
  // - 中文视图直接渲染它；
  // - AI 讲解抽屉把它作为论文上下文（ChatPanel 自动截断长正文）。
  useEffect(() => {
    if (paperDataLoaded.current === slug) return;
    paperDataLoaded.current = slug;
    setTranslation("");
    fetch(`/api/paper?slug=${encodeURIComponent(slug)}`)
      .then((r) => r.json())
      .then((d) => {
        const pages: { n: number; zh: string }[] = d.pages ?? [];
        const t: string = d.translation ?? "";
        setTranslation(t);
        setPaperText(t || pages.map((p) => `【第 ${p.n} 页译文】\n${p.zh}`).join("\n\n"));
      })
      .catch(() => {});
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
      } catch { /* ignore */ }
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

  const handleTerm = useCallback((p: Popover) => setPop(p), []);

  // 视图切换（只换 state + 同步 URL，不触发整页导航，PDF 不重载）
  const setViewMode = useCallback((v: "pdf" | "zh") => {
    setView(v);
    try {
      window.history.replaceState(null, "", v === "zh" ? `/read/${slug}?view=zh` : `/read/${slug}`);
    } catch { /* ignore */ }
  }, [slug]);

  // —— AI 讲解抽屉：拖动 + 缩放 ——
  const toggleChat = useCallback(() => {
    setChatOpen((open) => {
      if (!open) setChatBox(readChatBox() ?? defaultChatBox());
      return !open;
    });
  }, []);
  const onDragStart = useCallback((e: React.PointerEvent<HTMLDivElement>, mode: "move" | "resize") => {
    if (e.button !== 0 || !chatBox) return;
    e.stopPropagation();
    dragRef.current = { mode, sx: e.clientX, sy: e.clientY, box: chatBox };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }, [chatBox]);
  const onDragMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (!d) return;
    const dx = e.clientX - d.sx, dy = e.clientY - d.sy;
    if (d.mode === "move") {
      setChatBox({
        ...d.box,
        x: Math.min(Math.max(d.box.x + dx, -d.box.w + 140), window.innerWidth - 140),
        y: Math.min(Math.max(d.box.y + dy, 0), window.innerHeight - 48),
      });
    } else {
      // 左下角把手：右边缘固定，宽 = box.w - dx；下边缘固定，高 = box.h + dy
      const w = Math.max(CHAT_MIN_W, Math.min(window.innerWidth - 8, d.box.w - dx));
      const h = Math.max(CHAT_MIN_H, Math.min(window.innerHeight - 8, d.box.h + dy));
      setChatBox({ ...d.box, x: d.box.x + d.box.w - w, w, h });
    }
  }, []);
  const onDragEnd = useCallback(() => {
    const d = dragRef.current;
    dragRef.current = null;
    if (!d) return;
    setChatBox((cur) => {
      if (cur) { try { localStorage.setItem(CHAT_BOX_KEY, JSON.stringify(cur)); } catch { /* ignore */ } }
      return cur;
    });
  }, []);

  const title = papers.find((p) => p.slug === slug)?.title ?? slug;

  // 从阅读页删除某篇导入论文（删 data/papers/<slug> + 清理论文库记录），刷新列表；删的是当前篇则跳走
  async function deleteThisPaper(slugToDel: string) {
    const t = papers.find((p) => p.slug === slugToDel)?.title ?? slugToDel;
    if (!confirm(`确定删除《${t}》？会同时删除它的 PDF、原文与中文翻译。`)) return;
    const res = await fetch("/api/paper", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "delete", slug: slugToDel }),
    });
    if (!res.ok) { alert("删除失败"); return; }
    const rest = papers.filter((p) => p.slug !== slugToDel);
    setPapers(rest);
    if (slugToDel === slug) {
      window.location.href = rest.length ? `/read/${rest[0].slug}` : "/";
    }
  }
  const numPages = papers.find((p) => p.slug === slug)?.pages ?? doc?.numPages ?? 0;

  // 能力画像数据：这篇论文（NSR）相关的术语 + 各状态计数
  const paperTerms = useMemo(() => {
    const nsr = terms.filter((t) => /nsr/i.test(t.source ?? ""));
    return nsr.length ? nsr : terms;
  }, [terms]);
  const statusCount = useMemo(() => {
    const m: Record<string, number> = {};
    for (const t of paperTerms) m[t.status] = (m[t.status] ?? 0) + 1;
    return m;
  }, [paperTerms]);
  const mastered = (statusCount["能对应论文"] ?? 0) + (statusCount["能实现"] ?? 0);

  return (
    <div className="full-reader">
      {/* 左栏：论文切换 + 能力画像 */}
      <aside className="full-reader-rail">
        <div className="full-reader-rail-head">
          <span className="mono-label" style={{ color: "var(--panel-dark-muted)" }}>论文库</span>
        </div>
        <div className="full-reader-rail-list">
          {papers.map((p) => (
            <div key={p.slug} className={`full-reader-rail-row${p.slug === slug ? " is-active" : ""}`}>
              <Link href={`/read/${p.slug}`} className="full-reader-rail-item">
                <span className="full-reader-rail-title">{p.title}</span>
                <span className="full-reader-rail-meta">{p.pages} 页</span>
              </Link>
              <button className={`rail-zh-btn${p.slug === slug && view === "zh" ? " is-on" : ""}`}
                onClick={() => { if (p.slug === slug) setViewMode("zh"); else window.location.href = `/read/${p.slug}?view=zh`; }}
                title="看这篇的中文翻译（上传时全文翻译）">
                中
              </button>
              <button className="rail-del-btn" onClick={() => void deleteThisPaper(p.slug)}
                title="删除这篇（含 PDF/原文/译文）">×</button>
            </div>
          ))}
          {papers.length === 0 && <p className="mono-label" style={{ padding: "0.8rem 0.9rem", color: "var(--panel-dark-muted)" }}>还没有导入论文</p>}
        </div>

        <div className="reader-profile">
          <div className="reader-profile-title"><span>论文能力画像</span><span>{title}</span></div>
          <div className="reader-profile-bar" title={STATUS_ORDER.map((s) => `${s} ${statusCount[s] ?? 0}`).join(" · ")}>
            {STATUS_ORDER.map((s) => (
              <i key={s} style={{
                width: `${paperTerms.length ? ((statusCount[s] ?? 0) / paperTerms.length) * 100 : 0}%`,
                background: STATUS_DOT[s],
              }} />
            ))}
          </div>
          <div className="reader-profile-status">
            {STATUS_ORDER.map((s) => (
              <span key={s}><i style={{ background: STATUS_DOT[s] }} />{s} {statusCount[s] ?? 0}</span>
            ))}
          </div>
          <div className="reader-profile-meta">
            已读 {readSet.size}/{numPages} 页 · 术语 {paperTerms.length} 个 · 已掌握 {mastered} 个
          </div>
        </div>
      </aside>

      {/* 主区 */}
      <div className="full-reader-main">
        <div className="full-reader-toolbar">
          <Link href="/" className="full-reader-back" title="返回">←</Link>
          <span className="full-reader-title">{title}</span>
          {view === "pdf" ? (
            <>
              <span className="mono-label" style={{ marginLeft: "0.6rem" }}>点术语→小卡 · Ctrl+滚轮缩放 · 左栏「中」看译文</span>
              <span style={{ flex: 1 }} />
              <span className="pdf-zoom-label">{Math.round(zoom * 100)}%</span>
              <button className="btn btn--ghost btn--quiet" onClick={() => applyZoom(zoom - 0.15)}>缩小</button>
              <button className="btn btn--ghost btn--quiet" onClick={() => applyZoom(zoom + 0.15)}>放大</button>
              <button className="btn btn--ghost btn--quiet" onClick={() => applyZoom(1)} style={{ marginLeft: "0.3rem" }}>适应宽度</button>
            </>
          ) : (
            <>
              <span className="mono-label" style={{ marginLeft: "0.6rem" }}>中文翻译 · 上传时由 DeepSeek 按段落全文翻译</span>
              <span style={{ flex: 1 }} />
              <button className="btn btn--accent" onClick={() => setViewMode("pdf")}>查看原文 PDF</button>
            </>
          )}
          <button className={`btn ${chatOpen ? "btn--accent" : "btn--ghost btn--quiet"}`} style={{ marginLeft: "0.3rem" }}
            onClick={toggleChat}>
            AI 讲解
          </button>
        </div>

        {view === "zh" ? (
          <div className="reader-zh">
            <div className="reader-zh-scroll">
              {translation ? (
                <Markdown>{translation}</Markdown>
              ) : (
                <p className="mono-label" style={{ padding: "2rem 0", textAlign: "center" }}>
                  {paperDataLoaded.current === slug ? "这篇论文还没有生成中文翻译（重新导入时会生成）" : "正在加载中文翻译…"}
                </p>
              )}
            </div>
          </div>
        ) : (
          <div className="full-reader-scroll" ref={scrollRef}
            onClick={() => { setPop(null); }}
            onWheel={onWheel}
            onTouchStart={onTouchStart}
            onTouchMove={onTouchMove}>
            {!doc && <p className="mono-label" style={{ padding: "2rem 0" }}>加载 PDF…</p>}
            {doc && pageWidth > 0 && Array.from({ length: Math.min(doc.numPages, 25) }, (_, i) => (
              <FullPdfPage key={i + 1} pageNum={i + 1} width={pageWidth} frameWidth={frameWidth} doc={doc} terms={terms} onTerm={handleTerm} />
            ))}
          </div>
        )}
      </div>

      {/* AI 讲解抽屉（可拖动头部、可缩放左下角把手，位置尺寸本地记忆） */}
      {chatOpen && chatBox && (
        <aside className="reader-chat" role="dialog" aria-label="AI 讲解对话"
          style={{ left: chatBox.x, top: chatBox.y, width: chatBox.w, height: chatBox.h }}>
          <div className="reader-chat-head"
            onPointerDown={(e) => onDragStart(e, "move")}
            onPointerMove={onDragMove}
            onPointerUp={onDragEnd}
            onPointerCancel={onDragEnd}>
            <span className="mono-label" style={{ color: "var(--foreground)", fontSize: "0.66rem" }}>研究伴侣 · 导读讲解</span>
            <span className="mono-label" style={{ color: "var(--muted-foreground)" }}>
              {paperText ? "已附带论文译文" : "正在加载论文译文…"}
            </span>
            <button className="pdf-pop-close" style={{ position: "static", marginLeft: "auto" }}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() => setChatOpen(false)} aria-label="关闭">×</button>
          </div>
          <div className="reader-chat-body">
            <ChatPanel
              toolKey="p3"
              hint="我是你的导读讲解。可以问：这一段在解决什么问题？这个术语怎么理解？方法部分怎么串起来？也可以直接说「讲一下第 3 页」。"
              systemExtra={paperText}
              historyKey={`read-${slug}`}
            />
          </div>
          <div className="reader-chat-resize" aria-hidden="true"
            onPointerDown={(e) => onDragStart(e, "resize")}
            onPointerMove={onDragMove}
            onPointerUp={onDragEnd}
            onPointerCancel={onDragEnd} />
        </aside>
      )}

      {/* 术语小卡 */}
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
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
