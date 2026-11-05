'use client';
import type { Scene } from '@/lib/learning/core';
import { PROFILE_DIMENSIONS, type ProfileDimension } from '@/lib/learning/profile';
import { isProfile, sceneNames, type PersonalRecord } from '@/lib/learning/presentation';
import type { LearningAction } from './use-learning';

export interface EditDraft { id?: string; version?: number; type: 'profile' | 'teaching'; text: string; topic: string; dimension: ProfileDimension; scene: Scene }
export function draftFor(type: EditDraft['type'], record?: PersonalRecord): EditDraft {
  return { type, text: record?.text ?? '', topic: record && isProfile(record) ? record.topic : '', dimension: record && isProfile(record) ? record.dimension : 'background', scene: record?.scene ?? 'general', ...(record ? { id: record.id, version: record.version } : {}) };
}
export default function PersonalEditor({ draft, onChange, onSaved, record, act, busy, collecting }: {
  draft: EditDraft; onChange: (draft: EditDraft) => void; onSaved: () => void; record?: PersonalRecord;
  act: LearningAction; busy: boolean; collecting: boolean;
}) {
  const profile = draft.type === 'profile';
  async function save() {
    const action = profile ? draft.id ? 'profile-edit' : 'profile-add' : draft.id ? 'edit' : 'propose';
    const body = { ...draft, action, kind: 'preference', quote: draft.text, source: '用户手动填写' };
    if (await act(body, profile ? '画像已保存；相关旧讲法需重新核对。' : '讲法已保存到待确认。')) onSaved();
  }
  return <form className="personal-form" onSubmit={e => { e.preventDefault(); void save(); }}>
    {!draft.id && <>
      {profile && <><label>类型<select value={draft.dimension} onChange={e => onChange({ ...draft, dimension: e.target.value as ProfileDimension })}>{Object.entries(PROFILE_DIMENSIONS).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label><label>主题<input required maxLength={100} value={draft.topic} onChange={e => onChange({ ...draft, topic: e.target.value })} placeholder="例如：概率论基础" /></label></>}
      <label>适用场景<select value={draft.scene} onChange={e => onChange({ ...draft, scene: e.target.value as Scene })}>{Object.entries(sceneNames).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
    </>}
    <label>{profile ? '我的情况' : '希望怎样讲解'}<textarea aria-label={profile ? '我的情况' : '希望怎样讲解'} required rows={6} maxLength={profile ? 1200 : 2000} value={draft.text} onChange={e => onChange({ ...draft, text: e.target.value })} placeholder={profile ? '写下与学习有关的背景、目标或当前卡点。' : '例如：解释公式时，先说明每个符号的含义。'} /></label>
    {record && draft.version !== record.version && <p role="alert">此条目在其他窗口已修改。草稿已保留，请核对最新版本后重新编辑。</p>}
    {draft.id && !record && <p role="alert">此条目已被删除，不能保存旧草稿。</p>}
    {!profile && !draft.id && !collecting && <p>观察已暂停，请在设置中恢复后添加讲法。</p>}
    <p className="personal-muted">{profile ? '你填写的画像保存后生效。' : '讲法保存后需在「待确认」中采纳。'}关闭侧栏会保留本次草稿。</p>
    <button className="personal-button is-primary" disabled={busy || (!!draft.id && !record) || (!profile && !draft.id && !collecting) || !draft.text.trim() || (profile && !draft.id && !draft.topic.trim())}>{busy ? '保存中…' : profile ? '保存画像' : '保存讲法'}</button>
  </form>;
}
