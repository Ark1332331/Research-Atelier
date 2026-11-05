'use client';
import { useState } from 'react';
import type { LearningState } from '@/lib/learning/core';
import type { ObservationStatus } from '@/lib/learning/observation-types';
import { isProfile, statusNames, recordUnavailable } from '@/lib/learning/presentation';
import type { LearningAction } from './use-learning';

export type HistoryKind = 'inactive' | 'observations' | 'runs' | 'audit';
const observationNames: Record<ObservationStatus, string> = { queued: '等待观察', analyzing: '正在观察', proposed: '已提出建议', 'no-change': '没有新发现', failed: '观察失败', paused: '观察已暂停' };
export function PersonalSettings({ state, busy, act, onHistory, onError }: {
  state: LearningState; busy: boolean; act: LearningAction; onHistory: (kind: HistoryKind) => void; onError: (message: string) => void;
}) {
  return <div className="personal-settings">
    <label className="personal-switch"><span>持续观察<small>独立观察者从对话中整理画像和讲法，新增建议需你确认。</small></span><input type="checkbox" checked={state.collecting} disabled={busy} onChange={e => void act({ action: 'settings', collecting: e.target.checked }, '已更新观察设置。')} /></label>
    <label className="personal-switch"><span>应用个性化<small>回答时参考已确认的画像与讲解方式。</small></span><input type="checkbox" checked={state.applying} disabled={busy} onChange={e => void act({ action: 'settings', applying: e.target.checked }, '已更新应用设置。')} /></label>
    <section><h3>历史与管理</h3>{Object.entries({ inactive: '已停用与拒绝', observations: '观察记录', runs: '回答依据记录', audit: '操作记录' }).map(([kind, label]) => <button key={kind} className="personal-setting-link" onClick={() => onHistory(kind as HistoryKind)}>{label}<span aria-hidden="true">›</span></button>)}</section>
    <section><h3>备份</h3><div className="personal-actions"><a className="personal-button" href="/api/learning?export=json" download>导出 JSON</a><a className="personal-button" href="/api/learning?export=markdown" download>导出可读记录</a></div>
      <label className="personal-import">导入备份<input type="file" accept=".json,application/json" disabled={busy || !state.collecting} onChange={async e => {
        const file = e.currentTarget.files?.[0]; e.currentTarget.value = ''; if (!file) return;
        try { if (file.size > 10 * 1024 * 1024) throw Error('备份超过 10 MB，请精简后导入。'); const data = JSON.parse(await file.text()); if (!data || !Array.isArray(data.memories)) throw Error('请选择含有 memories 的 JSON 备份。'); await act({ action: 'import', memories: data.memories, profiles: data.profiles }, '已导入，请在待确认中核对。'); }
        catch (error) { onError(error instanceof Error ? error.message : String(error)); }
      }} /></label><p className="personal-muted">导入内容需重新确认。{!state.collecting && '恢复持续观察后可导入。'}</p>
    </section>
  </div>;
}

export function PersonalHistory({ kind, observationId, state, now, busy, act, onOpen, onReview }: {
  kind: HistoryKind; observationId?: string; state: LearningState; now: number; busy: boolean; act: LearningAction; onOpen: (id: string) => void; onReview: () => void;
}) {
  const [limit, setLimit] = useState(20), [filter, setFilter] = useState('all');
  const inactive = [...(state.profiles ?? []), ...state.memories].filter(r => r.status !== 'pending' && recordUnavailable(r, state, now));
  const observations = (state.observations ?? []).slice().reverse().filter(o => observationId ? o.id === observationId : filter === 'failed' ? o.status === 'failed' : true);
  const total = kind === 'inactive' ? inactive.length : kind === 'observations' ? observations.length : kind === 'runs' ? state.runs.length : state.audit.length;
  return <div className="personal-history-list">
    {kind === 'inactive' && inactive.slice(0, limit).map(r => <button className="personal-related" key={r.id} onClick={() => onOpen(r.id)}>{r.text}<small>{isProfile(r) ? '用户画像' : '讲解方式'} · {recordUnavailable(r, state, now)}</small></button>)}
    {kind === 'observations' && <>
      {!observationId && <select className="personal-filter" aria-label="观察记录范围" value={filter} onChange={e => { setFilter(e.target.value); setLimit(20); }}><option value="all">全部记录</option><option value="failed">仅失败记录</option></select>}
      {observations.slice(0, limit).map(o => <article key={o.id} className="personal-history"><h3>{o.source} · {observationNames[o.status]}</h3><small>{new Date(o.at).toLocaleString('zh-CN')}</small><p>{o.reason}</p>{o.error && <p className="personal-error">{o.error}</p>}
        <details className="personal-disclosure" open={Boolean(observationId)}><summary>原话与上下文</summary>{o.userText && <blockquote>{o.userText}</blockquote>}{o.context.map((m, i) => <blockquote key={i}><small>{m.role === 'user' ? '你' : '助手（上下文）'}</small>{m.content}</blockquote>)}{o.toolContext?.map((t, i) => <p key={i}>{t.source} · {t.action} · {t.tool?.ok ? '成功' : '失败'} {t.tool?.error}</p>)}{[...(o.profileIds ?? []), ...o.candidateIds].map(id => { const record = [...(state.profiles ?? []), ...state.memories].find(r => r.id === id); return record ? <button key={id} className="personal-related" onClick={() => onOpen(id)}>{record.text}<small>{statusNames[record.status]}</small></button> : null; })}</details>
        {o.status === 'failed' && <button className="personal-button" disabled={busy || !state.collecting} onClick={() => void act({ action: 'retry', id: o.id }, '已重新排队观察。', '/api/learning/observations')}>重试观察</button>}
        {[...(o.profileIds ?? []), ...o.candidateIds].some(id => [...(state.profiles ?? []), ...state.memories].some(r => r.id === id && r.status === 'pending')) && <button className="personal-link" onClick={onReview}>前往待确认</button>}
      </article>)}
    </>}
    {kind === 'runs' && state.runs.slice().reverse().slice(0, limit).map(r => <article className="personal-history" key={r.id}><h3>{r.query}</h3><small>{new Date(r.at).toLocaleString('zh-CN')} · {r.outcome === 'success' ? '回答完成' : '调用失败'}</small><details className="personal-disclosure"><summary>当时使用的依据</summary>{(r.profile ?? []).map(p => <p key={p.id}>画像：{p.text}<small>当时的 v{p.version}</small></p>)}{r.selected.map(m => <p key={m.id}>讲法：{m.text}<small>当时的 v{m.version}{m.rationale && ` · ${m.rationale}`}</small></p>)}{!r.profile?.length && !r.selected.length && <p>这次回答没有使用个性化记录。</p>}</details></article>)}
    {kind === 'audit' && state.audit.slice().reverse().slice(0, limit).map(a => <article className="personal-history" key={a.id}><p>{a.detail}</p><small>{new Date(a.at).toLocaleString('zh-CN')} · {a.action}</small></article>)}
    {!total && <p className="personal-empty">{observationId ? '这条观察记录不存在或已删除。' : '暂无记录。'}</p>}
    {total > limit && <button className="personal-button" onClick={() => setLimit(n => n + 20)}>加载更多</button>}
  </div>;
}
