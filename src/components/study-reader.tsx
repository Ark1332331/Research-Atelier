"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import Link from 'next/link';
import { ReadingSurface, useReadingMemory } from '@/components/reading-memory';
import StudyMarkdown from '@/components/study-markdown';
import {ModelControl} from '@/components/model-settings';
import type { StudyDocument, StudyNode } from '@/lib/study-library-types';

type Heading = { id: string; title: string; depth: number };

function sorted(nodes: StudyNode[]) {
  return [...nodes].sort((a, b) => a.order - b.order || a.name.localeCompare(b.name, 'zh-CN', { numeric: true }) || a.id.localeCompare(b.id));
}

function Directory({ nodes, parentId, currentId, ancestors, onNavigate, visited = new Set<string>() }: { nodes: StudyNode[]; parentId: string | null; currentId: string; ancestors: Set<string>; onNavigate: () => void; visited?: Set<string> }) {
  return <ul className="study-reader-tree">{sorted(nodes.filter(node => node.parentId === parentId && !visited.has(node.id))).map(node => node.kind === 'document'
    ? <li key={node.id}><Link href={`/study/${node.id}`} aria-current={node.id === currentId ? 'page' : undefined} onClick={onNavigate}><span aria-hidden="true">▤</span><span>{node.name}</span></Link></li>
    : <li key={node.id}><details open={ancestors.has(node.id) || undefined}><summary><span>{node.name}</span></summary><Directory nodes={nodes} parentId={node.id} currentId={currentId} ancestors={ancestors} onNavigate={onNavigate} visited={new Set([...visited, node.id])} /></details></li>)}</ul>;
}

export default function StudyReader({ documentId }: { documentId: string }) {
  return <StudyReaderSession key={documentId} documentId={documentId} />;
}

function StudyReaderSession({ documentId }: { documentId: string }) {
  const [result, setResult] = useState<{ document: StudyDocument; nodes: StudyNode[] } | null>(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        const [libraryResponse, documentResponse] = await Promise.all([
          fetch('/api/study-library', { signal: controller.signal, cache: 'no-store' }),
          fetch(`/api/study-library/document?id=${encodeURIComponent(documentId)}`, { signal: controller.signal, cache: 'no-store' }),
        ]);
        const [library, document] = await Promise.all([libraryResponse.json(), documentResponse.json()]);
        if (!documentResponse.ok) throw new Error(document.error || '教材不存在或已被删除。');
        if (!libraryResponse.ok) throw new Error(library.error || '学习目录暂时无法加载。');
        if (!document.node || typeof document.content !== 'string') throw new Error('教材内容格式不正确。');
        if (!controller.signal.aborted) setResult({ document: { ...document, links: document.links ?? {} }, nodes: library.nodes ?? [] });
      } catch (reason) {
        if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : '教材加载失败，请重试。');
      }
    }
    void load();
    return () => controller.abort();
  }, [documentId, attempt]);
  if (!result) return <main className="study-reader-status"><Link href="/?view=study">← 返回学习书库</Link><div><small>RESEARCH ATELIER · 学习</small><h1>{error ? '暂时无法打开这份教材' : '正在打开教材…'}</h1>{error ? <><p role="alert">{error}</p><button className="btn btn--primary" onClick={() => { setError(''); setAttempt(value => value + 1); }}>重新加载</button></> : <p role="status">加载文档与学习目录</p>}</div></main>;
  return <LoadedStudyReader document={result.document} nodes={result.nodes} />;
}

function LoadedStudyReader({ document, nodes }: { document: StudyDocument; nodes: StudyNode[] }) {
  const viewport = useRef<HTMLDivElement>(null);
  const shell = useRef<HTMLElement>(null);
  const memory = useReadingMemory();
  const hasConversations = (memory?.openConversationCount ?? 0) > 0;
  const [answerOpen, setAnswerOpen] = useState(true);
  const [treeOpen, setTreeOpen] = useState(() => {
    if (typeof window === 'undefined' || window.innerWidth <= 1000) return false;
    try { return localStorage.getItem('study-directory-open') === 'true'; } catch { return false; }
  });
  const [chatWidth, setChatWidth] = useState(() => {
    try { const saved = Number(localStorage.getItem('study-answer-width')); return saved >= 30 && saved <= 60 ? saved : 44; } catch { return 44; }
  });
  const [tocOpen, setTocOpen] = useState(false);
  const [headings, setHeadings] = useState<Heading[]>([]);
  const [activeHeading, setActiveHeading] = useState('');
  const [fontSize, setFontSize] = useState(() => {
    try { const saved = Number(localStorage.getItem('study-reader-font')); return saved >= 14 && saved <= 24 ? saved : 17; } catch { return 17; }
  });
  const { node, content, links } = document;
  const path = useMemo(() => {
    const list: StudyNode[] = [node], seen = new Set([node.id]);
    let parent = nodes.find(item => item.id === node.parentId);
    while (parent && !seen.has(parent.id)) { list.unshift(parent); seen.add(parent.id); parent = nodes.find(item => item.id === parent!.parentId); }
    return list;
  }, [node, nodes]);
  const ancestorIds = useMemo(() => new Set(path.map(item => item.id)), [path]);
  const documentOrder = useMemo(() => {
    const ordered: StudyNode[] = [], seen = new Set<string>();
    function walk(parentId: string | null) {
      for (const item of sorted(nodes.filter(item => item.parentId === parentId))) {
        if (seen.has(item.id)) continue;
        seen.add(item.id);
        if (item.kind === 'document') ordered.push(item); else walk(item.id);
      }
    }
    walk(path[0]?.kind === 'library' ? path[0].id : null);
    return ordered;
  }, [nodes, path]);
  const index = documentOrder.findIndex(item => item.id === node.id);
  const previous = index > 0 ? documentOrder[index - 1] : null;
  const next = index >= 0 ? documentOrder[index + 1] : null;
  useEffect(() => { if (hasConversations) queueMicrotask(() => { setTocOpen(false); setAnswerOpen(true); }); }, [hasConversations, memory?.conversationFocus]);
  function toggleTree() {
    const next = !treeOpen; setTreeOpen(next);
    try { localStorage.setItem('study-directory-open', String(next)); } catch { /* Optional preference. */ }
  }
  function resizeSplit(value: number) {
    const next = Math.min(60, Math.max(30, value)); setChatWidth(next);
    try { localStorage.setItem('study-answer-width', String(next)); } catch { /* Optional preference. */ }
  }

  useEffect(() => {
    const element = viewport.current;
    if (!element) return;
    const titles = Array.from(element.querySelectorAll<HTMLElement>('[data-study-title]'));
    let gone = false;
    queueMicrotask(() => { if (!gone) setHeadings(titles.map(title => ({ id: title.id, title: title.dataset.studyTitle ?? '', depth: Number(title.dataset.studyDepth) || 1 }))); });
    const storageKey = `study-reader-scroll:${node.id}`;
    let restored = false;
    let scrollFrame = 0;
    const updateHeading = () => {
      cancelAnimationFrame(scrollFrame);
      scrollFrame = requestAnimationFrame(() => {
        const top = element.getBoundingClientRect().top + 100;
        const current = [...titles].reverse().find(title => title.getBoundingClientRect().top <= top) ?? titles[0];
        setActiveHeading(current?.id ?? '');
      });
    };
    const restoreFrame = requestAnimationFrame(() => {
      const url = new URL(window.location.href);
      // The shared note locator owns navigation when a note is requested.
      if (!url.searchParams.has('note')) {
        if (url.hash) {
          let hash = url.hash.slice(1);
          try { hash = decodeURIComponent(hash); } catch { /* Use literal fragment. */ }
          const target = titles.find(title => title.id === hash);
          target?.scrollIntoView({ block: 'start' });
        } else {
          try { const saved = Number(localStorage.getItem(storageKey)); if (Number.isFinite(saved) && saved > 0) element.scrollTop = saved; } catch { /* Reading works without browser storage. */ }
        }
      }
      restored = true;
      updateHeading();
    });
    const remember = () => { if (!restored) return; try { localStorage.setItem(storageKey, String(element.scrollTop)); } catch { /* Optional persistence. */ } };
    let saveTimer: ReturnType<typeof setTimeout> | undefined;
    const onScroll = () => { updateHeading(); clearTimeout(saveTimer); saveTimer = setTimeout(remember, 250); };
    element.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('pagehide', remember);
    return () => { gone = true; cancelAnimationFrame(restoreFrame); cancelAnimationFrame(scrollFrame); clearTimeout(saveTimer); remember(); element.removeEventListener('scroll', onScroll); window.removeEventListener('pagehide', remember); };
  }, [node.id, content]);

  function changeFont(delta: number) {
    const size = Math.min(24, Math.max(14, fontSize + delta));
    setFontSize(size);
    try { localStorage.setItem('study-reader-font', String(size)); } catch { /* Optional persistence. */ }
  }

  return <main ref={shell} className={`study-reader-shell${treeOpen ? ' is-tree-open' : ' is-tree-closed'}${tocOpen ? '' : ' is-toc-closed'}${answerOpen ? ' is-answer-open' : ''}`} style={{'--study-chat-width':`${chatWidth}%`} as CSSProperties}>
    <header className="study-reader-toolbar">
      <Link className="study-reader-back" href="/?view=study" aria-label="返回学习书库">← <span>学习书库</span></Link>
      <nav className="study-reader-breadcrumb" aria-label="当前位置">{path.map((part, i) => <span key={part.id}>{i > 0 && <span aria-hidden="true"> / </span>}{part.name}</span>)}</nav>
      <ModelControl />
      {!!memory?.memoryCount&&<button className="study-memory-button" aria-label="追问记忆" onClick={memory.showLibrary}>追问 · {memory.memoryCount}</button>}
      <button className="study-shortcuts-settings" onClick={memory?.configureShortcuts}>自定义快捷</button>
      <div className="study-reader-controls"><button className="study-directory-toggle" aria-label={treeOpen?'收起书目':'展开书目'} title={treeOpen?'收起左侧目录':'展开左侧目录'} aria-expanded={treeOpen} aria-controls="study-reader-directory" onClick={toggleTree}>书目</button><button aria-label="缩小字号" disabled={fontSize <= 14} onClick={() => changeFont(-1)}>A−</button><span className="study-font-size" aria-live="polite">{fontSize}</span><button aria-label="增大字号" disabled={fontSize >= 24} onClick={() => changeFont(1)}>A+</button><button aria-expanded={tocOpen} aria-controls="study-reader-toc" onClick={() => setTocOpen(value => !value)}>目录</button><button aria-label={answerOpen?'收起问答区':'展开问答区'} aria-expanded={answerOpen} aria-controls="study-conversations" onClick={()=>setAnswerOpen(value=>!value)}>问答</button></div>
    </header>
    <aside id="study-reader-directory" className="study-reader-directory" aria-label="学习书目"><div className="study-reader-directory-heading"><h2>学习书目</h2><button aria-label="关闭左侧书目" onClick={toggleTree}>×</button></div><Directory nodes={nodes} parentId={null} currentId={node.id} ancestors={ancestorIds} onNavigate={() => setTreeOpen(false)} /><Link className="study-reader-manage" href="/?view=study">管理书库 ↗</Link></aside>
    {treeOpen && <button className="study-reader-backdrop" aria-label="关闭书目" onClick={() => setTreeOpen(false)} />}
    <div className="study-reader-viewport" ref={viewport} tabIndex={0} aria-label={`${node.name} 正文`}>
      <article className="study-reader-article" style={{ fontSize }}>
        <header className="study-reader-document-heading"><span>原文</span><small title={node.name}>{node.name}</small></header>
        {content.trim() ? <ReadingSurface content={content} sourceKey={`study:${node.id}`} sourceUrl={`/study/${node.id}`} label={node.name}><StudyMarkdown content={content} links={links} /></ReadingSurface> : <div className="study-reader-empty"><h2>这份教材还没有正文</h2><p>请在书库中导入包含文字内容的 Markdown 文件。</p><Link href="/?view=study">返回学习书库 →</Link></div>}
        <nav className="study-reader-pagination" aria-label="相邻教材">{previous ? <Link href={`/study/${previous.id}`}><small>← 上一篇</small><strong>{previous.name}</strong></Link> : <span />}{next ? <Link href={`/study/${next.id}`}><small>下一篇 →</small><strong>{next.name}</strong></Link> : <span />}</nav>
      </article>
    </div>
    <div className="study-answer-divider" hidden={!answerOpen} role="separator" tabIndex={0} aria-label="调整题目与回答比例" aria-orientation="vertical" aria-valuemin={40} aria-valuemax={70} aria-valuenow={Math.round(100-chatWidth)} title="左右拖动调整题目与回答比例；双击恢复"
      onPointerDown={e=>{e.preventDefault();e.currentTarget.setPointerCapture(e.pointerId);}}
      onPointerMove={e=>{if(!e.currentTarget.hasPointerCapture(e.pointerId))return;const bounds=shell.current?.getBoundingClientRect();if(bounds)resizeSplit((bounds.right-e.clientX)/bounds.width*100);}}
      onPointerUp={e=>{if(e.currentTarget.hasPointerCapture(e.pointerId))e.currentTarget.releasePointerCapture(e.pointerId);}}
      onDoubleClick={()=>resizeSplit(44)}
      onKeyDown={e=>{if(e.key==='ArrowLeft'||e.key==='ArrowRight'){e.preventDefault();resizeSplit(chatWidth+(e.key==='ArrowLeft'?2:-2));}else if(e.key==='Home'){e.preventDefault();resizeSplit(44);}}}/>
    <div id="study-conversations" className="study-conversations" aria-label="学习问答区" hidden={!answerOpen}>
      <div className="study-canvas-toolbar"><span>已打开 {memory?.openConversationCount??0} 个对话</span><button type="button" disabled={!hasConversations} onClick={memory?.closeCurrent} title="关闭当前画布上的所有问答框，保留记录、高光和草稿；生成中的回答继续完成">清空画布</button></div>
      {!hasConversations&&<section className="study-conversations-empty"><header><h2>学习问答</h2><span>与原文并排阅读</span></header><div className="study-conversations-guide"><svg viewBox="0 0 48 48" width="44" height="44" aria-hidden="true"><path d="M8 10h32v23H23l-9 7v-7H8zM16 18h16M16 25h11" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round"/></svg><h3>从一道题、一段话开始</h3><p>划选左侧原文，用快捷指令直接提问，<br/>或点击「划线追问」输入自己的问题。</p><div className="study-shortcut-examples" aria-label="当前快捷提问">{memory?.shortcuts.map(item=><span key={item.id} title={item.prompt}>{item.title}</span>)}</div><button onClick={memory?.configureShortcuts}>编辑快捷指令</button>{!!memory?.memoryCount&&<button onClick={memory.showLibrary}>打开已有追问 · {memory.memoryCount}</button>}</div><footer>翻译、追问、随心笔记，都可以从选中文字开始。</footer></section>}
      <div ref={memory?.setConversationDock} className="study-conversation-windows"/>
    </div>
    <aside id="study-reader-toc" className="study-reader-toc" aria-label="本篇目录" hidden={!tocOpen}><div className="study-reader-toc-heading"><small>ON THIS PAGE</small><h2>本篇目录 <span>{headings.length}</span></h2></div>{headings.length ? <nav><ol>{headings.map(heading => <li key={heading.id} style={{ paddingLeft: Math.min(heading.depth - 1, 4) * 12 }}><a href={`#${encodeURIComponent(heading.id)}`} aria-current={activeHeading === heading.id ? 'location' : undefined}>{heading.title || '未命名章节'}</a></li>)}</ol></nav> : <p className="study-reader-toc-empty">正文暂无章节标题</p>}<p className="study-reader-toc-tip">一点好奇，一条笔记。<br />把读过的变成自己的。</p></aside>
  </main>;
}
