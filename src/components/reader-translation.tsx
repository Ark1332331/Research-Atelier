"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { classifySelection, MAX_SELECTION_LENGTH, type ReaderSelection } from "@/lib/reader-selection";
import { ReaderTranslationClient, type TranslationUpdate } from "@/lib/reader-translation-client";
import FloatingPanel from './floating-panel';
import Markdown from './markdown';
import { sourceFingerprint } from '@/lib/reading-memory';

function useAnchor(selection: ReaderSelection | null) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !selection) return;
    const place = () => {
      const rect = el.getBoundingClientRect();
      el.style.left = `${Math.max(8, Math.min(selection.x, window.innerWidth - rect.width - 8))}px`;
      el.style.top = `${Math.max(8, Math.min(selection.y, window.innerHeight - rect.height - 8))}px`;
    };
    place();
    const observer = new ResizeObserver(place);
    observer.observe(el);
    window.addEventListener('resize', place);
    return () => { observer.disconnect(); window.removeEventListener('resize', place); el.style.removeProperty('left'); el.style.removeProperty('top'); };
  }, [selection]);
  return ref;
}

export function ReaderSelectionToolbar({ selection, error, onTranslate, onClose, onAsk, onNote }: {
  selection: ReaderSelection; error: string;
  onTranslate: () => void; onClose: () => void;
  onAsk?: () => void; onNote?: () => void;
}) {
  const ref = useAnchor(selection);
  const [copyState, setCopyState] = useState('');
  const tooLong = selection.text.length > MAX_SELECTION_LENGTH;
  return <div ref={ref} className="reader-selection-toolbar" role="toolbar" aria-label="选中文字操作"
    onMouseDown={e => e.preventDefault()} onClick={e => e.stopPropagation()}>
    <div className="inline-actions">
      <button className="btn btn--primary" disabled={tooLong} onClick={onTranslate}>翻译</button>
      {onNote&&<button className="btn" disabled={tooLong} onClick={onNote}>随心笔记</button>}
      {onAsk&&<button className="btn" disabled={tooLong} onClick={onAsk}>划线追问</button>}
      <button className="text-button" onClick={async () => { try { await navigator.clipboard.writeText(selection.text); setCopyState('已复制'); } catch { setCopyState('复制失败，请重试'); } }}>复制</button>
      <button className="text-button" aria-label="关闭选区工具条" onClick={onClose}>×</button>
    </div>
    {tooLong && <p role="alert">一次最多翻译 {MAX_SELECTION_LENGTH.toLocaleString()} 字符，请缩小选区。</p>}
    {error && <p role="alert">{error}</p>}
    {copyState && <small role="status">{copyState}</small>}
  </div>;
}

export default function ReaderTranslation({ selection, scope, canSave, sourceLabel, sourceSlug, sourceUrl, onClose, onSave }: {
  selection: ReaderSelection | null; scope: string; canSave: boolean; onClose: () => void;
  sourceLabel?: string; sourceSlug?: string; sourceUrl?: string;
  onSave: (selection: ReaderSelection, meaning: string, kind: 'term' | 'word') => Promise<void>;
}) {
  const [client] = useState(() => new ReaderTranslationClient());
  const [result, setResult] = useState<{ selection: ReaderSelection; update: TranslationUpdate } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [feedback, setFeedback] = useState<{ selection: ReaderSelection; message: string; saved?: ('term' | 'word')[]; saving?: 'term' | 'word' } | null>(null);
  const saving = useRef(false);
  const ref = useAnchor(selection && classifySelection(selection.text) === 'word' ? selection : null);
  const generation = useRef(0);
  useEffect(() => {
    const token = ++generation.current;
    if (selection) void client.translate({ scope, text: selection.text, context: selection.context }, update => setResult({ selection, update }));
    return () => { generation.current = token + 1; client.cancel(); };
  }, [client, scope, selection, attempt]);
  if (!selection) return null;
  const state: TranslationUpdate = result?.selection === selection ? result.update : { status: 'loading', text: '' };
  const info = feedback?.selection === selection ? feedback : null;
  const passage = classifySelection(selection.text) === 'passage';
  const floating = passage || Boolean(sourceLabel);
  const location = sourceLabel ?? `第 ${selection.page} 页`;
  const loading = state.status === 'loading' || state.status === 'streaming';
  const copy = async (text: string) => {
    const current = generation.current;
    const message = (value: string) => {
      if (current === generation.current) setFeedback(previous => ({ ...(previous?.selection === selection ? previous : {}), selection, message: value }));
    };
    try { await navigator.clipboard.writeText(text); message('已复制'); }
    catch { message('复制失败，请重试。'); }
  };
  const save = async (kind: 'term' | 'word') => {
    if(saving.current || state.status !== 'done')return;
    saving.current=true;
    const current = generation.current;
    const saved=info?.saved??[];
    setFeedback({ selection, message: '保存中…', saving: kind, saved });
    try {
      await onSave(selection, state.text, kind);
      if (current === generation.current) setFeedback({ selection, message: kind==='term'?'已加入术语卡片':'已加入生词本', saved: [...saved,kind] });
    } catch (e) {
      if (current === generation.current) setFeedback({ selection, saved, message: e instanceof Error ? e.message : '保存失败，请重试。' });
    } finally {saving.current=false;}
  };
  const content=<>
    {!floating&&<div className="reader-translation-heading"><div><small>{location} · AI 语境翻译</small><h2>词语释义</h2></div><button className="text-button" onClick={onClose} aria-label="关闭翻译">×</button></div>}
    <div className="reader-translation-body">
      <div className="reader-translation-label"><span>原文</span><button className="text-button" onClick={() => void copy(selection.text)}>复制原文</button></div>
      <blockquote className="reader-translation-source">{selection.text}</blockquote>
      <div className="reader-translation-label"><span>中文译文</span><span role="status">{loading ? '翻译中…' : state.status === 'done' ? '翻译完成' : '翻译未完成'}</span></div>
      <div className="reader-translation-result" aria-busy={loading}>{state.text ? <Markdown origin={{kind:"translation",content:state.text}} sourceUrl={sourceUrl} label={`选段译文 · ${location}`} sourceKey={`translation:${scope}:${selection.page}:${(selection.memoryRects??selection.rects)[0]?.x}:${(selection.memoryRects??selection.rects)[0]?.y}:${sourceFingerprint(selection.text+'\n'+selection.context)}`} slug={sourceSlug} context={selection.context+'\n原文：'+selection.text} interactive={!loading}>{state.text}</Markdown> : (loading ? '正在理解所选内容…' : '暂无译文')}{state.status === 'streaming' && <span className="reader-translation-cursor" aria-hidden="true">▍</span>}</div>
      {state.status === 'error' && <p className="v1-error" role="alert">{state.error}</p>}
    </div>
    <div className="reader-translation-footer">
      <div className="inline-actions">
        <button className="btn btn--quiet" disabled={!state.text} onClick={() => void copy(state.text)}>复制译文</button>
        {state.status === 'error' && <button className="btn btn--primary" onClick={() => setAttempt(n => n + 1)}>重试</button>}
        {selection.text.trim().length<=160 && <button className="btn btn--quiet" disabled={state.status !== 'done' || !canSave || Boolean(info?.saving) || info?.saved?.includes('term')} onClick={() => void save('term')}>{info?.saved?.includes('term') ? '已加入术语卡片' : info?.saving==='term' ? '保存中…' : '加入术语卡片'}</button>}
        {!passage && /[a-z]/i.test(selection.text) && <button className="btn btn--quiet" disabled={state.status !== 'done' || !canSave || Boolean(info?.saving) || info?.saved?.includes('word')} onClick={() => void save('word')}>{info?.saved?.includes('word') ? '已加入生词本' : info?.saving==='word' ? '保存中…' : '加入生词本'}</button>}
      </div>
      {info && <small role="status">{info.message}</small>}
    </div>
  </>;
  return floating?<FloatingPanel open onClose={onClose} title={passage?'选段翻译':'词语释义'} subtitle={`${location} · 可划线追问`} storageKey="reader-translation-box" className="reader-translation-panel" width={460} closeLabel="关闭翻译">{content}</FloatingPanel>:<div ref={ref} className="word-popover reader-translation-popover" role="dialog" aria-label="词语翻译" onClick={e=>e.stopPropagation()}>{content}</div>;
}
