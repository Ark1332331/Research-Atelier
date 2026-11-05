'use client';
import { useState } from 'react';
import type { LearningState } from '@/lib/learning/core';
import { PROFILE_DIMENSIONS, profileBasisValid } from '@/lib/learning/profile';
import { isProfile, scopeName, sceneNames, statusNames, recordUnavailable, type PersonalRecord } from '@/lib/learning/presentation';
import type { LearningAction } from './use-learning';

export default function RecordDetail({ record, state, now, busy, act, onEdit, onOpen, onDeleted }: {
  record: PersonalRecord; state: LearningState; now: number; busy: boolean; act: LearningAction;
  onEdit: (record: PersonalRecord) => void; onOpen: (id: string) => void; onDeleted: () => void;
}) {
  const [deleting, setDeleting] = useState<number | null>(null);
  const profile = isProfile(record);
  const expired = !profile && Boolean(record.expiresAt && Date.parse(record.expiresAt) <= now);
  const valid = profile || (!expired && profileBasisValid(state, record.basis));
  async function action(name: string, extra: Record<string, unknown> = {}) {
    const ok = await act({ action: `${profile ? 'profile-' : ''}${name}`, id: record.id, version: record.version, ...extra }, name === 'forget' ? '已删除该条目及关联记录。' : '已更新。');
    if (ok) { setDeleting(null); if (name === 'forget') onDeleted(); }
  }
  return <div className="personal-detail">
    <span className="personal-muted">{profile ? PROFILE_DIMENSIONS[record.dimension] : '讲解方式'} · {recordUnavailable(record, state, now) ?? statusNames[record.status]}</span>
    <p className="personal-detail-text">{record.text}</p>
    <p className="personal-muted">{scopeName(record)} · {sceneNames[record.scene]} · v{record.version} · {new Date(record.updatedAt).toLocaleString('zh-CN')}</p>
    {record.projectId && <a className="personal-link" href={`/?project=${encodeURIComponent(record.projectId)}`}>打开所属论文</a>}
    {profile && record.resourceId && <p className="personal-muted">对话来源：{record.resourceId}</p>}
    {!profile && record.expiresAt && <p className="personal-muted">有效期至 {new Date(record.expiresAt).toLocaleDateString('zh-CN')}</p>}
    {expired && <p className="personal-muted">这条讲法已过期，不再用于回答。如仍有需要，可重新添加。</p>}
    <div className="personal-actions"><button className="personal-button" disabled={busy} onClick={() => onEdit(record)}>编辑</button>
      {record.status !== 'active' && <button className="personal-button" disabled={busy || !valid} onClick={() => void action('approve')}>{record.status === 'pending' ? '确认使用' : '重新启用'}</button>}
      {record.status === 'active' && <button className="personal-button" disabled={busy} onClick={() => void action('pause')}>暂时停用</button>}
      {record.status === 'pending' && <button className="personal-button" disabled={busy} onClick={() => void action('reject')}>{profile ? '不符合我' : '不采纳'}</button>}
    </div>
    {!profile && <section><h3>讲法依据</h3>{record.basis?.length ? <>
      {record.basis.map(ref => { const p = state.profiles?.find(p => p.id === ref.id); const text = p?.version === ref.version ? p.text : p?.revisions.find(r => r.version === ref.version)?.text; return <p key={ref.id}>因为：<button className="personal-link" disabled={!p} onClick={() => onOpen(ref.id)}>{text ?? '依据已删除'}</button><small>当时的 v{ref.version}{p?.version !== ref.version || p?.status !== 'active' ? ' · 需要重新核对' : ''}</small></p>; })}
      <p>所以：{record.rationale || record.text}</p>{!profileBasisValid(state, record.basis) && <p className="personal-muted">依据的画像已变更或尚未确认，这条讲法不会用于回答。</p>}
    </> : <p className="personal-muted">{record.status === 'pending' ? '待确认的直接讲解偏好，未推断你的能力。' : '你直接确认的讲解偏好，未推断你的能力。'}</p>}</section>}
    {profile && <section><h3>关联讲法</h3>{state.memories.some(m => m.basis?.some(p => p.id === record.id)) ? state.memories.filter(m => m.basis?.some(p => p.id === record.id)).map(m => <button key={m.id} className="personal-related" onClick={() => onOpen(m.id)}>{m.text}<small>{statusNames[m.status]}</small></button>) : <p className="personal-muted">暂时没有关联讲法。</p>}</section>}
    <section><h3>原话与来源</h3>{record.evidence.map((e, i) => <blockquote key={i}>{e.quote}<small>{e.source} · {new Date(e.at).toLocaleString('zh-CN')}</small></blockquote>)}{!record.evidence.length && <p className="personal-muted">没有附加原话记录。</p>}</section>
    <details className="personal-disclosure"><summary>修改历史 · {record.revisions.length}</summary>{record.revisions.slice().reverse().map(r => <div className="personal-history" key={r.version}><small>v{r.version} · {statusNames[r.status]} · {new Date(r.at).toLocaleString('zh-CN')}</small><p>{r.text}</p><small>{r.reason}</small>{!profile && r.version !== record.version && <button className="personal-link" disabled={busy} onClick={() => void action('rollback', { targetVersion: r.version })}>恢复此版本，重新确认</button>}</div>)}</details>
    <div className="personal-danger">{deleting === null ? <button className="personal-link" disabled={busy} onClick={() => setDeleting(record.version)}>删除{profile ? '画像' : '讲法'}</button> : <><p>将删除此条目{profile ? '、关联讲法' : ''}以及包含它的观察与回答快照。</p>{deleting !== record.version && <p>条目已更新，请取消后核对新内容。</p>}<div className="personal-actions"><button className="personal-button" disabled={busy || deleting !== record.version} onClick={() => void action('forget', { version: deleting })}>确认删除</button><button className="personal-button" disabled={busy} onClick={() => setDeleting(null)}>取消删除</button></div></>}</div>
  </div>;
}
