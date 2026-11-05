'use client';
import { useState } from 'react';
import Link from 'next/link';
import type { Selection } from '@/lib/learning/core';
import type { ProfileSelection } from '@/lib/learning/profile';
import DetailDrawer from './detail-drawer';
export interface ResponseLearning { runId: string; observationId?: string; selected: Selection[]; profile?: ProfileSelection[]; proposedIds: string[]; note?: string }
export default function LearningResponse({ learning }: { learning: ResponseLearning }) {
  const [adjusting, setAdjusting] = useState(false), [basis, setBasis] = useState(false);
  const [note, setNote] = useState(''), [status, setStatus] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  async function feedback(helpful: boolean) {
    setBusy(true); setError(''); setStatus('');
    try {
      const response = await fetch('/api/learning', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'feedback', runId: learning.runId, helpful, note: helpful ? '' : note }) });
      const data = await response.json(); if (!response.ok) throw Error(data.error || '反馈保存失败，请重试');
      setStatus('已记录反馈'); if (!helpful) { setAdjusting(false); setNote(''); }
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  }
  return <div className="response-learning personal-ui">
    <div className="response-learning-actions"><button className="personal-link" disabled={busy} onClick={() => void feedback(true)}>有帮助</button><span aria-hidden="true">·</span><button className="personal-link" aria-expanded={adjusting} disabled={busy} onClick={() => setAdjusting(v => !v)}>调整讲法</button><span aria-hidden="true">·</span><button className="personal-link" onClick={() => setBasis(true)}>查看依据</button></div>
    {adjusting && <form className="personal-form response-adjust" onSubmit={e => { e.preventDefault(); void feedback(false); }}><label>希望怎样调整讲法<textarea rows={3} maxLength={2000} value={note} onChange={e => setNote(e.target.value)} placeholder="哪里卡住了？希望怎样解释？" /></label><button className="personal-button" disabled={busy || !note.trim()}>提交反馈</button></form>}
    {error && <p className="personal-error" role="alert">{error}</p>}{status && <small role="status">{status}</small>}
    {basis && <DetailDrawer title="这次回答的依据" onClose={() => setBasis(false)}><p className="personal-muted">以下为生成这次回答时使用的版本。</p>
      {!!learning.profile?.length && <section className="personal-detail"><h3>用户画像</h3>{learning.profile.map(p => <p key={p.id}>{p.text}<small>当时的 v{p.version} · <Link className="personal-link" onClick={() => setBasis(false)} href={`/?view=personalization&tab=profile&item=${encodeURIComponent(p.id)}`}>查看当前画像</Link></small></p>)}</section>}
      {learning.selected.length > 0 && <section className="personal-detail"><h3>讲解方式</h3>{learning.selected.map(s => <p key={s.id}>{s.text}{s.rationale && <small>依据：{s.rationale}</small>}<small>当时的 v{s.version} · <Link className="personal-link" onClick={() => setBasis(false)} href={`/?view=personalization&tab=teaching&item=${encodeURIComponent(s.id)}`}>查看当前讲法</Link></small></p>)}</section>}
      {!learning.profile?.length && !learning.selected.length && <p className="personal-empty">这次回答没有使用个性化记录。</p>}
      {learning.observationId && <Link className="personal-link" onClick={() => setBasis(false)} href={`/?view=personalization&observation=${encodeURIComponent(learning.observationId)}`}>查看这次观察记录</Link>}
    </DetailDrawer>}
  </div>;
}
