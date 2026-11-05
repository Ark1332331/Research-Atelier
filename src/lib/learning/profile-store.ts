import { randomUUID } from 'node:crypto';
import type { LearningState, Scene } from './core.ts';
import { PROFILE_DIMENSIONS, type ProfileDimension, type UserProfile } from './profile.ts';

const normalize = (value: string) => value.normalize('NFKC').toLowerCase().replace(/[\s，。！？、：；,.!?;:]+/g, '');
function field(value: unknown, name: string, max: number): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw Error(`${name}须为 1–${max} 字符`);
  return value.trim();
}
function validate(body: Record<string, unknown>) {
  const dimension = body.dimension as ProfileDimension, scene = (body.scene ?? 'general') as Scene;
  if (!Object.hasOwn(PROFILE_DIMENSIONS, dimension) || !['general', 'paper', 'code', 'repro'].includes(scene)) throw Error('画像类型或场景无效');
  return { dimension, scene, topic: field(body.topic, '主题', 100), text: field(body.text, '画像描述', 1200),
    projectId: body.projectId == null || body.projectId === '' ? null : field(body.projectId, '论文 ID', 200),
    resourceId: body.resourceId == null || body.resourceId === '' ? null : field(body.resourceId, '对话来源', 200) };
}
function record(state: LearningState, p: UserProfile, reason: string) {
  p.updatedAt = new Date().toISOString();
  p.revisions.push({ version: p.version, text: p.text, status: p.status, at: p.updatedAt, reason });
  state.audit.push({ id: randomUUID(), at: p.updatedAt, action: 'profile-update', memoryId: p.id, detail: reason });
}
function invalidateStrategies(state: LearningState, id: string) {
  for (const m of state.memories) if (m.basis?.some(ref => ref.id === id) && (m.status === 'active' || m.status === 'pending')) {
    m.status = 'paused'; m.version++; m.updatedAt = new Date().toISOString();
    m.revisions.push({ version: m.version, text: m.text, status: m.status, at: m.updatedAt, reason: '依据的画像已变更，需重新核对讲解策略' });
  }
}
function sameTopic(a: UserProfile, b: Pick<UserProfile, 'dimension' | 'topic' | 'scene' | 'projectId' | 'resourceId'>) {
  return a.dimension === b.dimension && normalize(a.topic) === normalize(b.topic) && a.scene === b.scene && a.projectId === b.projectId && (a.resourceId ?? null) === (b.resourceId ?? null);
}
function supersede(state: LearningState, p: UserProfile) {
  for (const old of state.profiles ?? []) if (old.id !== p.id && old.status === 'active' && sameTopic(old, p)) {
    old.status = 'paused'; old.version++; record(state, old, '同一主题已采用新的画像'); invalidateStrategies(state, old.id);
  }
}
export function addProfileObservation(state: LearningState, body: Record<string, unknown>, quote: string, source: string): UserProfile | null {
  if (!state.collecting) return null;
  const values = validate(body); state.profiles ??= [];
  const duplicate = state.profiles.find(p => sameTopic(p, values) && normalize(p.text) === normalize(values.text));
  if (duplicate) return duplicate; // Never reactivate rejected/paused facts or overwrite user corrections.
  const at = new Date().toISOString();
  const p: UserProfile = { ...values, id: randomUUID(), origin: 'observer', status: 'pending', version: 1,
    evidence: [{ quote, source, at }], revisions: [], createdAt: at, updatedAt: at };
  state.profiles.push(p); record(state, p, '观察者提议，等待用户确认'); return p;
}
export function manageProfile(state: LearningState, body: Record<string, unknown>): LearningState {
  state.profiles ??= [];
  if (body.action === 'profile-add') {
    const values = validate(body), at = new Date().toISOString();
    const p: UserProfile = { ...values, id: randomUUID(), status: 'active', origin: 'user', version: 1,
      evidence: [{ quote: values.text, source: '用户亲自填写', at }], revisions: [], createdAt: at, updatedAt: at };
    supersede(state, p); state.profiles.push(p); record(state, p, '用户亲自填写，立即生效');
  } else {
    const p = state.profiles.find(p => p.id === body.id); if (!p) throw Error('画像条目不存在');
    if (body.version !== p.version) throw Error('条目已在其他窗口更新，请刷新后重试');
    if (body.action === 'profile-forget') {
      state.forgetRevision = (state.forgetRevision ?? 0) + 1;
      const linked = new Set(state.memories.filter(m => m.basis?.some(ref => ref.id === p.id)).map(m => m.id));
      const quotes = [...p.evidence.map(e => e.quote), p.text].filter(Boolean);
      const runs = new Set(state.runs.filter(r => r.profile?.some(ref => ref.id === p.id) || r.selected.some(m => linked.has(m.id)) || quotes.some(q => r.query.includes(q))).map(r => r.id));
      state.profiles = state.profiles.filter(x => x.id !== p.id);
      state.memories = state.memories.filter(m => !linked.has(m.id));
      state.observations = state.observations?.filter(o => !o.profileIds?.includes(p.id) && !o.candidateIds.some(id => linked.has(id)) && !runs.has(o.traceId) && !o.context.some(c => (c.runId && runs.has(c.runId)) || quotes.some(q => c.content.includes(q))) && !quotes.some(q => o.userText.includes(q)));
      state.runs = state.runs.filter(r => !runs.has(r.id));
      state.audit = state.audit.filter(a => a.memoryId !== p.id && !linked.has(a.memoryId ?? ''));
    } else {
      const previousVersion = p.version;
      if (body.action === 'profile-edit') {
        p.text = field(body.text, '画像描述', 1200); p.origin = 'user'; p.status = 'active';
        p.evidence.push({ quote: p.text, source: '用户亲自修正', at: new Date().toISOString() });
        invalidateStrategies(state, p.id);
      } else if (body.action === 'profile-approve') p.status = 'active';
      else if (body.action === 'profile-pause') { p.status = 'paused'; invalidateStrategies(state, p.id); }
      else if (body.action === 'profile-reject') { p.status = 'rejected'; invalidateStrategies(state, p.id); }
      else throw Error('画像操作无效');
      p.version++; record(state, p, body.action === 'profile-edit' ? '用户修正，立即生效；旧讲解依据停止使用' : '用户审核画像');
      if (p.status === 'active') supersede(state, p);
      if (body.action === 'profile-approve') for (const m of state.memories) {
        let changed=false;
        for (const ref of m.basis ?? []) if (ref.id === p.id && (ref.version === previousVersion || p.revisions.some(r=>r.version===ref.version&&r.text===p.text))) {ref.version = p.version;changed=true;}
        if(changed){
          if(m.status==='paused'&&m.revisions.at(-1)?.reason==='依据的画像已变更，需重新核对讲解策略')m.status='pending';
          m.version++;m.updatedAt=new Date().toISOString();m.revisions.push({version:m.version,text:m.text,status:m.status,at:m.updatedAt,reason:'画像内容已确认，更新关联版本；讲法仍由用户决定'});
        }
      }
    }
  }
  state.profileRevision = (state.profileRevision ?? 0) + 1;
  return state;
}
