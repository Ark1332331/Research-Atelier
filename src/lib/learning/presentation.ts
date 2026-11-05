import type { LearningState, Memory, Scene } from './core.ts';
import type { UserProfile } from './profile.ts';
import { profileBasisValid } from './profile.ts';

export const sceneNames: Record<Scene, string> = { general: '所有对话', paper: '论文阅读', code: '代码理解', repro: '实验讨论' };
export const statusNames = { active: '已生效', pending: '待确认', paused: '已停用', rejected: '已拒绝' };
export type PersonalRecord = UserProfile | Memory;
export const isProfile = (record: PersonalRecord): record is UserProfile => 'dimension' in record;
export function recordUnavailable(record: PersonalRecord, state: LearningState, now: number): string | null {
  if (record.status !== 'active') return statusNames[record.status];
  if (!isProfile(record)) {
    if (record.expiresAt && Date.parse(record.expiresAt) <= now) return '已过期';
    if (!profileBasisValid(state, record.basis)) return '依据待核对';
  }
  return null;
}
export function scopeName(record: PersonalRecord) {
  return record.projectId ? '指定论文' : isProfile(record) && record.resourceId ? '指定对话' : record.scene === 'general' ? '全局' : sceneNames[record.scene];
}
export interface ReviewGroup { id: string; profiles: UserProfile[]; memories: Memory[]; observationIds: string[] }
/** Connected observations and profile dependencies form one review, including legacy proposals without events. */
export function reviewGroups(state: LearningState): ReviewGroup[] {
  const records: PersonalRecord[] = [...(state.profiles ?? []), ...state.memories];
  const parent = new Map(records.map(r => [r.id, r.id]));
  function root(id: string): string { const p = parent.get(id)!; return p === id ? id : root(p); }
  function connect(ids: string[]) {
    const known = ids.filter(id => parent.has(id));
    for (const id of known.slice(1)) parent.set(root(id), root(known[0]));
  }
  for (const m of state.memories) connect([m.id, ...(m.basis ?? []).map(p => p.id)]);
  for (const o of state.observations ?? []) connect([...(o.profileIds ?? []), ...o.candidateIds]);
  const groups = new Map<string, ReviewGroup>();
  for (const record of records) {
    const id = root(record.id);
    if (!groups.has(id)) groups.set(id, { id, profiles: [], memories: [], observationIds: [] });
    const group = groups.get(id)!;
    if (isProfile(record)) group.profiles.push(record); else group.memories.push(record);
  }
  for (const o of state.observations ?? []) {
    const id = [...(o.profileIds ?? []), ...o.candidateIds].find(id => parent.has(id));
    if (id) groups.get(root(id))!.observationIds.push(o.id);
  }
  return [...groups.values()].filter(g => [...g.profiles, ...g.memories].some(r => r.status === 'pending'));
}
