'use client';
import type { LearningState } from '@/lib/learning/core';
import { profileBasisValid } from '@/lib/learning/profile';
import { isProfile, reviewGroups, statusNames, type PersonalRecord } from '@/lib/learning/presentation';
import type { LearningAction } from './use-learning';

export default function PersonalReview({ state, busy, act, onOpen, onEdit }: {
  state: LearningState; busy: boolean; act: LearningAction; onOpen: (id: string) => void; onEdit: (record: PersonalRecord) => void;
}) {
  const groups = reviewGroups(state);
  const row = (record: PersonalRecord) => {
    const profile = isProfile(record), valid = profile || profileBasisValid(state, record.basis);
    return <div className="review-record" key={record.id} data-record={record.id}>
      <small>{profile ? '用户画像' : '讲解方式'} · {statusNames[record.status]}</small><p>{record.text}</p>
      {!profile && record.rationale && <p className="personal-muted">依据：{record.rationale}</p>}
      <div className="personal-actions">{record.status === 'pending' && <>
        <button className="personal-button is-primary" disabled={busy || !valid} onClick={() => void act({ action: profile ? 'profile-approve' : 'approve', id: record.id, version: record.version }, profile ? '画像已确认，请继续核对关联讲法。' : '讲法已采纳。')}>{profile ? '符合我' : '采纳讲法'}</button>
        <button className="personal-button" disabled={busy} onClick={() => void act({ action: profile ? 'profile-reject' : 'reject', id: record.id, version: record.version }, '已拒绝。')}>{profile ? '不符合' : '不采纳'}</button>
        <button className="personal-link" disabled={busy} onClick={() => onEdit(record)}>修改</button>
      </>}<button className="personal-link" onClick={() => onOpen(record.id)}>查看依据</button></div>
      {!valid && record.status === 'pending' && <p className="personal-muted">先确认关联画像，再采纳讲法；已变更的画像需重新核对。</p>}
    </div>;
  };
  return <div>{groups.length ? <><p className="personal-muted">画像与讲法分别确认。有关联的内容放在一起核对。</p>{groups.map((g, i) => {
    const observation = state.observations?.find(o => g.observationIds.includes(o.id));
    return <section className="review-group" key={g.id} aria-label={`待确认组 ${i + 1}`}><h3>{observation?.source ?? '待核对的内容'}</h3>{observation && <small>{new Date(observation.at).toLocaleString('zh-CN')}</small>}{g.profiles.map(row)}{g.memories.map(row)}</section>;
  })}</> : <p className="personal-empty">没有待确认的内容。</p>}</div>;
}
