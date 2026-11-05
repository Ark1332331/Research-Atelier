'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { LearningState } from '@/lib/learning/core';

export function useLearning() {
  const [state, setState] = useState<LearningState | null>(null);
  const [now, setNow] = useState(0);
  const [error, setError] = useState(''), [notice, setNotice] = useState(''), [busy, setBusy] = useState(false);
  const sequence = useRef(0), writing = useRef(false);
  const refresh = useCallback(async () => {
    if (writing.current) return;
    const seq = ++sequence.current;
    try {
      const response = await fetch('/api/learning', { cache: 'no-store' });
      const data = await response.json(); if (!response.ok) throw Error(data.error || '读取失败');
      if (seq === sequence.current) { setState(data); setNow(Date.now()); }
    } catch (e) { if (seq === sequence.current) setError(e instanceof Error ? e.message : String(e)); }
  }, []);
  useEffect(() => {
    let gone = false; const serial = sequence;
    queueMicrotask(() => { if (!gone) void refresh(); });
    const timer = setInterval(() => { if (document.visibilityState !== 'hidden') void refresh(); }, 4000);
    return () => { gone = true; clearInterval(timer); serial.current++; };
  }, [refresh]);
  const act = async (body: Record<string, unknown>, message = '已保存', endpoint = '/api/learning') => {
    if (writing.current) return false;
    writing.current = true; const seq = ++sequence.current; setBusy(true); setError(''); setNotice('');
    try {
      const response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const data = await response.json(); if (!response.ok) throw Error(data.error || '保存失败，请重试');
      if (seq !== sequence.current) return false;
      setState(data.state ?? data);
      setNow(Date.now());
      setNotice(body.action === 'import' ? (data.state ?? data).audit?.at(-1)?.detail ?? message : message);
      return true;
    } catch (e) { if (seq === sequence.current) setError(e instanceof Error ? e.message : String(e)); return false; }
    finally { writing.current = false; setBusy(false); }
  };
  return { state, now, error, notice, busy, act, refresh, setError, setNotice };
}
export type LearningAction = ReturnType<typeof useLearning>['act'];
