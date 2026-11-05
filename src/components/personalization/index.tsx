'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { PROFILE_DIMENSIONS } from '@/lib/learning/profile';
import { isProfile, scopeName, reviewGroups, recordUnavailable, type PersonalRecord } from '@/lib/learning/presentation';
import DetailDrawer from '../detail-drawer';
import { useLearning } from './use-learning';
import PersonalEditor, { draftFor, type EditDraft } from './editor';
import RecordDetail from './record-detail';
import PersonalReview from './review';
import { PersonalSettings, PersonalHistory, type HistoryKind } from './settings';

type Panel = { kind: 'review' | 'settings' } | { kind: 'record'; id: string } | { kind: 'edit'; key: string } | { kind: 'history'; history: HistoryKind; observationId?: string };
const historyTitles: Record<HistoryKind, string> = { inactive: '已停用与拒绝', observations: '观察记录', runs: '回答依据记录', audit: '操作记录' };
export default function Personalization({ initialTab = 'profile' }: { initialTab?: EditDraft['type'] }) {
  const { state, now, error, notice, busy, act, refresh, setError, setNotice } = useLearning();
  const params = useSearchParams(), router = useRouter();
  const tab = params.get('tab') === 'teaching' ? 'teaching' : params.get('tab') === 'profile' ? 'profile' : initialTab;
  const [search, setSearch] = useState(''), [panels, setPanels] = useState<Panel[]>([]), [drafts, setDrafts] = useState<Record<string, EditDraft>>({});
  const item = params.get('item'), observation = params.get('observation'), requestedPanel = params.get('panel');
  useEffect(() => {
    let gone = false;
    const sync = () => {
      const hash = window.location.hash;
      const target = item ?? (hash.startsWith('#profile-') ? hash.slice(9) : hash.startsWith('#memory-') ? hash.slice(8) : null);
      if (!gone) setPanels(target ? [{ kind: 'record', id: target }] : observation ? [{ kind: 'history', history: 'observations', observationId: observation }] : requestedPanel === 'observations' || hash === '#observations' ? [{ kind: 'history', history: 'observations' }] : requestedPanel === 'pending' ? [{ kind: 'review' }] : []);
    };
    queueMicrotask(sync); window.addEventListener('hashchange', sync);
    return () => { gone = true; window.removeEventListener('hashchange', sync); };
  }, [item, observation, requestedPanel]);
  function open(panel: Panel) { setError(''); setNotice(''); setPanels(stack => [...stack, panel]); }
  function edit(record?: PersonalRecord) {
    const type = record ? isProfile(record) ? 'profile' : 'teaching' : tab;
    const key = record?.id ?? `new-${type}`;
    setDrafts(d => ({ ...d, [key]: d[key] ?? draftFor(type, record) })); open({ kind: 'edit', key });
  }
  function close() {
    setPanels([]); setError(''); setNotice('');
    if (item || observation || requestedPanel || window.location.hash) router.replace(`/?view=personalization&tab=${tab}`, { scroll: false });
  }
  const panel = panels.at(-1);
  const records: PersonalRecord[] = [...(state?.profiles ?? []), ...(state?.memories ?? [])];
  const record = panel?.kind === 'record' ? records.find(r => r.id === panel.id) : undefined;
  const draft = panel?.kind === 'edit' ? drafts[panel.key] : undefined;
  const title = panel?.kind === 'record' ? record && isProfile(record) ? '画像详情' : '讲法详情' : panel?.kind === 'edit' ? `${draft?.id ? '编辑' : '添加'}${draft?.type === 'profile' ? '画像' : '讲法'}` : panel?.kind === 'history' ? historyTitles[panel.history] : panel?.kind === 'review' ? '待确认' : '个性化设置';
  const matching = records.filter(r => state && !recordUnavailable(r, state, now) && (tab === 'profile' ? isProfile(r) : !isProfile(r)) && `${r.text} ${isProfile(r) ? r.topic : ''}`.toLowerCase().includes(search.toLowerCase().trim()));
  const groups = tab === 'profile' ? Object.entries(PROFILE_DIMENSIONS).map(([dimension, label]) => ({ label, rows: matching.filter(r => isProfile(r) && r.dimension === dimension) })) : [{ label: '已采纳的讲法', rows: matching }];
  const feedback = <>{error && <div className="personal-error" role="alert">{error}<button className="personal-link" onClick={() => { setError(''); void refresh(); }}>重新读取</button></div>}{notice && <p className="personal-notice" role="status">{notice}</p>}</>;
  return <section className="personalization personal-ui">
    <header className="personal-heading"><h1>个性化</h1><div className="personal-actions"><button className="personal-button" disabled={!state} onClick={() => open({ kind: 'review' })}>待确认{state ? ` · ${reviewGroups(state).length}` : ''}</button><button className="personal-button" disabled={!state} onClick={() => open({ kind: 'settings' })}>设置</button></div></header>
    <nav className="personal-tabs" aria-label="个性化分类"><Link href="/?view=personalization&tab=profile" aria-current={tab === 'profile' ? 'page' : undefined}>用户画像</Link><Link href="/?view=personalization&tab=teaching" aria-current={tab === 'teaching' ? 'page' : undefined}>讲解方式</Link></nav>
    {!panel && feedback}
    <div className="personal-toolbar"><input className="personal-search" type="search" aria-label="搜索当前内容" placeholder={tab === 'profile' ? '搜索画像' : '搜索讲法'} value={search} onChange={e => setSearch(e.target.value)} /><button className="personal-button" disabled={!state} onClick={() => edit()}>＋ 添加</button></div>
    {state && !state.applying && <p className="personal-muted">个性化应用已暂停。<button className="personal-link" onClick={() => open({ kind: 'settings' })}>调整设置</button></p>}
    {!state ? <p className="personal-empty">正在读取…</p> : matching.length ? groups.filter(g => g.rows.length).map(g => <section className="personal-group" key={g.label}><h2>{g.label}</h2>{g.rows.map(r => <article className="personal-row" key={r.id} id={`${isProfile(r) ? 'profile' : 'memory'}-${r.id}`}>
      <div className="personal-row-content"><p>{r.text}</p>{!isProfile(r) && <div className="personal-basis">{r.basis?.length ? <>依据：{r.basis.map((ref, i) => <span key={ref.id}>{i > 0 ? '、' : ''}<button className="personal-link" onClick={() => open({ kind: 'record', id: ref.id })}>{state.profiles?.find(p => p.id === ref.id)?.topic ?? '画像记录'}</button></span>)}</> : <span>直接确认的讲解偏好</span>}</div>}</div>
      <span className="personal-scope">{scopeName(r)}</span><div className="personal-row-actions"><button className="personal-link" onClick={() => edit(r)}>编辑</button><button className="personal-icon" aria-label={`更多：${r.text}`} title="依据、历史与管理" onClick={() => open({ kind: 'record', id: r.id })}>⋯</button></div>
    </article>)}</section>) : <p className="personal-empty">{search ? '没有匹配的内容。' : tab === 'profile' ? '还没有已确认画像。添加你的情况，或在待确认中核对观察。' : '还没有采纳的讲法。添加偏好，或在待确认中核对建议。'}</p>}
    {panel && <DetailDrawer title={title} busy={busy} onClose={close}>
      {panels.length > 1 && <button className="personal-link drawer-back" disabled={busy} onClick={() => { setError(''); setNotice(''); setPanels(s => s.slice(0, -1)); }}>← 返回</button>}
      {feedback}
      {state && panel.kind === 'review' && <PersonalReview state={state} busy={busy} act={act} onOpen={id => open({ kind: 'record', id })} onEdit={edit} />}
      {state && panel.kind === 'record' && (record ? <RecordDetail key={record.id} record={record} state={state} now={now} busy={busy} act={act} onEdit={edit} onOpen={id => open({ kind: 'record', id })} onDeleted={() => setPanels(s => s.slice(0, -1))} /> : <p className="personal-empty">此条目不存在或已删除。</p>)}
      {state && panel.kind === 'edit' && draft && <><PersonalEditor draft={draft} onChange={value => setDrafts(d => ({ ...d, [panel.key]: value }))} record={records.find(r => r.id === draft.id)} onSaved={() => { setDrafts(d => { const next = { ...d }; delete next[panel.key]; return next; }); setPanels(s => s.slice(0, -1)); }} act={act} busy={busy} collecting={state.collecting} />
        <button className="personal-link" disabled={busy} onClick={() => { setDrafts(d => { const next = { ...d }; delete next[panel.key]; return next; }); setError(''); setPanels(s => s.slice(0, -1)); }}>放弃草稿</button></>}
      {state && panel.kind === 'settings' && <PersonalSettings state={state} busy={busy} act={act} onHistory={history => open({ kind: 'history', history })} onError={setError} />}
      {state && panel.kind === 'history' && <PersonalHistory key={`${panel.history}-${panel.observationId ?? ''}`} kind={panel.history} observationId={panel.observationId} state={state} now={now} busy={busy} act={act} onOpen={id => open({ kind: 'record', id })} onReview={() => open({ kind: 'review' })} />}
    </DetailDrawer>}
  </section>;
}
