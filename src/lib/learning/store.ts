import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { DATA_DIR, useKV } from "../store.ts";
import { emptyState, extractCandidates, selectMemories, memoryPrompt, type LearningState, type Scene, type MemoryKind, type Memory, type LearningRun } from "./core.ts";
import { selectProfile, profilePrompt, profileBasisValid, type ProfileReference } from './profile.ts';
import { manageProfile, addProfileObservation } from './profile-store.ts';

const file = path.join(DATA_DIR, "learning", "state.json");
const lock = path.join(DATA_DIR, "learning", ".lock");
export async function readLearning(): Promise<LearningState> {
  if (useKV) throw new Error("受控学习需要本机持久数据目录；当前 KV 模式尚不支持事务，请使用本地桌面版本。");
  try {
    const state = JSON.parse(await fs.readFile(file, "utf8"));
    if (state.schema !== 1 || !Array.isArray(state.memories) || !Array.isArray(state.runs) || !Array.isArray(state.audit)) throw new Error("学习数据格式异常，请从导出备份恢复，原文件未覆盖。");
    return state;
  } catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT") return emptyState(); throw e; }
}
async function reclaimDeadLock(): Promise<boolean> {
  const recovery = lock + ".recovery";
  try { await fs.mkdir(recovery); } catch { return false; }
  try {
    const owner = JSON.parse(await fs.readFile(path.join(lock, "owner.json"), "utf8"));
    if (!Number.isInteger(owner.pid) || owner.pid <= 0) return false;
    try { process.kill(owner.pid, 0); return false; }
    catch (e) { if ((e as NodeJS.ErrnoException).code !== "ESRCH") return false; }
    await fs.rm(lock, { recursive: true, force: true }); return true;
  } catch { return false; }
  finally { await fs.rm(recovery, { recursive: true, force: true }); }
}
export async function mutateLearning<T>(fn: (state: LearningState) => T): Promise<T> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const deadline = Date.now() + 10000;
  while (true) {
    try {
      await fs.mkdir(lock);
      await fs.writeFile(path.join(lock, "owner.json"), JSON.stringify({ pid: process.pid }), { mode: 0o600 });
      break;
    }
    catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
      if (await reclaimDeadLock()) continue;
      if (Date.now() > deadline) throw new Error("学习库正在写入，请重试；若异常退出留下无主锁，关闭应用后删除 learning/.lock。");
      await new Promise(r => setTimeout(r, 30));
    }
  }
  const temp = `${file}.${randomUUID()}.tmp`;
  try {
    const state = await readLearning(); const result = fn(state); state.revision++;
    const handle = await fs.open(temp, "wx", 0o600);
    try { await handle.writeFile(JSON.stringify(state, null, 2)); await handle.sync(); } finally { await handle.close(); }
    await fs.rename(temp, file); return result;
  } finally { await fs.rm(temp, { force: true }); await fs.rm(lock, { recursive: true, force: true }); }
}
function audit(state: LearningState, action: string, detail: string, memoryId?: string) {
  state.audit.push({ id: randomUUID(), at: new Date().toISOString(), action, detail, ...(memoryId ? { memoryId } : {}) });
}
export interface Proposal { key?: string; kind: MemoryKind; text: string; scene: Scene; projectId: string | null; quote: string; source: string; expiresAt?: string | null; basis?: ProfileReference[]; rationale?: string }
export function addProposal(state: LearningState, p: Proposal): Memory | null {
  if (!state.collecting) return null;
  const normalize=(text:string)=>text.normalize("NFKC").toLowerCase().replace(/[\s，。！？、：；,.!?;:]+/g,"");
  const key = p.key ?? p.text;
  const basisIds=(basis:ProfileReference[]|undefined)=>[...new Set((basis??[]).map(ref=>ref.id))].sort().join('|');
  // Rejection prevents the same proposal being resurrected by later model calls.
  const existing = state.memories.find(m => (m.key === key || (!p.key && normalize(m.text)===normalize(p.text))) && basisIds(m.basis)===basisIds(p.basis) && m.scene === p.scene && m.projectId === p.projectId);
  const at = new Date().toISOString();
  if (existing) {
    if (existing.status === "rejected") return existing;
    if (p.basis?.length && JSON.stringify(existing.basis) !== JSON.stringify(p.basis)) {
      existing.basis = p.basis; existing.rationale = p.rationale; existing.status = 'pending'; existing.version++; existing.updatedAt = at;
      existing.revisions.push({version:existing.version,text:existing.text,status:'pending',at,reason:'观察者依据新画像重新整理，需再次确认讲法'});
    }
    if (!existing.evidence.some(e => e.quote === p.quote && e.source === p.source)) {
      existing.evidence.push({ quote: p.quote, source: p.source, at });
      audit(state, "evidence", "新增证据，不自动提高状态或能力等级", existing.id);
    }
    return existing;
  }
  const memory: Memory = { id: randomUUID(), key, text: p.text, kind: p.kind, scene: p.scene, projectId: p.projectId, status: "pending", version: 1,
    evidence: [{ quote: p.quote, source: p.source, at }], revisions: [], createdAt: at, updatedAt: at, expiresAt: p.expiresAt ?? null, ...(p.basis?.length ? { basis: p.basis, rationale: p.rationale } : {}) };
  memory.revisions.push({ version: 1, text: memory.text, status: "pending", at, reason: "候选提议，尚未经用户审核" });
  state.memories.push(memory); audit(state, "propose", p.source, memory.id); return memory;
}
export async function prepareLearning(query: string, scene: Scene = "general", projectId: string | null = null, apply = true, resourceId: string | null = null) {
  return mutateLearning(state => {
    const proposed = extractCandidates(query, scene).map(p => addProposal(state, { ...p, projectId, source: "用户对话反馈 / 保守规则提取" })).filter((p): p is Memory => !!p);
    const selected = apply ? selectMemories(state, query, scene, projectId, Date.now(), resourceId) : [];
    const profile = apply ? selectProfile(state, query, scene, projectId, resourceId) : [];
    return { id: randomUUID(), selected, profile, forgetRevision: state.forgetRevision ?? 0, resourceId, proposedIds: proposed.map(p => p.id), observationId: undefined as string|undefined, prompt: profilePrompt(profile) + memoryPrompt(selected), query, scene, projectId, mode: apply && state.applying ? "personalized" as const : "baseline" as const };
  });
}
export type PreparedLearning = Awaited<ReturnType<typeof prepareLearning>>;
export async function finishLearning(prepared: PreparedLearning, answer: string, error?: string) {
  return mutateLearning(state => {
    // A user may forget a memory while the model request is in flight.
    if (prepared.forgetRevision !== (state.forgetRevision ?? 0) || prepared.selected.some(m => !state.memories.some(x => x.id === m.id)) || prepared.profile.some(p => !state.profiles?.some(x => x.id === p.id))) {
      audit(state, "run-discarded", "请求过程中发生遗忘，未保留可能包含已删除记忆的回答");
      return null;
    }
    const selected = prepared.selected;
    const run: LearningRun = { id: prepared.id, at: new Date().toISOString(), projectId: prepared.projectId, scene: prepared.scene, resourceId: prepared.resourceId,
      query: prepared.query, mode: prepared.mode, answer: answer.slice(0, 18000), selected, profile: prepared.profile, outcome: error ? "failed" : "success", ...(error ? { error } : {}) };
    state.runs.push(run); audit(state, "run", `${run.outcome}；实际注入 ${selected.length} 条已审核记忆`); return run;
  });
}
export async function manageLearning(body: Record<string, unknown>) {
  return mutateLearning(state => {
    const action = body.action;
    if (typeof action === 'string' && action.startsWith('profile-')) return manageProfile(state, body);
    if (action === "settings") {
      if (typeof body.collecting === "boolean") { state.collecting = body.collecting; if(!body.collecting)for(const o of state.observations??[])if(o.status==="queued"||o.status==="analyzing"){o.status="paused";o.reason="用户暂停采集，取消后台分析";} }
      if (typeof body.applying === "boolean") state.applying = body.applying;
      audit(state, "settings", `采集 ${state.collecting}；应用 ${state.applying}`); return state;
    }
    if (action === "import") {
      const imported = body.memories;
      if (!Array.isArray(imported) || imported.length > 500) throw new Error("导入须包含最多 500 条 memories");
      const proposals: Proposal[] = imported.map(item => {
        if (!item || typeof item !== "object") throw new Error("导入条目无效");
        const text = required(item.text, "规则", 2000);
        const kind = item.kind as MemoryKind; const scene = item.scene as Scene;
        if (!["preference", "gap", "skill", "workflow"].includes(kind) || !["general", "code", "paper", "repro"].includes(scene)) throw new Error("导入类型/场景无效");
        if (!Array.isArray(item.evidence) || !item.evidence.length) throw new Error("导入条目必须有证据");
        const quote = required(item.evidence[0].quote, "证据", 4000);
        const projectId = typeof item.projectId === "string" && item.projectId ? required(item.projectId, "项目 ID", 200) : null;
        const expiresAt = typeof item.expiresAt === "string" && item.expiresAt ? item.expiresAt : null;
        if (expiresAt && !Number.isFinite(Date.parse(expiresAt))) throw new Error("到期时间无效");
        return { text, kind, scene, quote, projectId, expiresAt, source: "JSON 备份导入 / 需重新审核" };
      });
      const profileRefs = new Map<string, {id:string;version:number;originalVersion:unknown}>();
      if (body.profiles !== undefined) {
        if (!Array.isArray(body.profiles) || body.profiles.length > 500) throw Error('画像导入须为最多 500 条记录');
        for (const p of body.profiles) {
          if (!p || typeof p !== 'object' || !Array.isArray(p.evidence) || !p.evidence.length) throw Error('画像导入缺少证据');
          const saved=addProfileObservation(state, p, required(p.evidence[0].quote, '画像证据', 4000), '画像备份导入 / 需重新确认');
          if(saved && typeof p.id==='string')profileRefs.set(p.id,{id:saved.id,version:saved.version,originalVersion:p.version});
        }
      }
      let skipped=0;
      for (const [i,p] of proposals.entries()) {
        const raw=imported[i];
        if(raw.basis!==undefined) {
          if(!Array.isArray(raw.basis)||raw.basis.length>3)throw Error('策略的画像依据格式无效');
          let stale=false;
          const basis:ProfileReference[]=raw.basis.map((ref:Record<string,unknown>)=>{
            const mapped=ref&&typeof ref.id==='string'?profileRefs.get(ref.id):undefined;
            if(!mapped||!Number.isSafeInteger(ref.version)||Number(ref.version)<1)throw Error('备份策略引用的画像缺失或格式无效，请同时导入对应的画像');
            if(mapped.originalVersion!==ref.version)stale=true;
            return {id:mapped.id,version:mapped.version};
          });
          if(stale){skipped++;continue;}
          p.basis=basis;
          if(basis.length)p.rationale=required(raw.rationale,'讲法依据',1000);
        }
        addProposal(state,p);
      }
      audit(state, "import", `已导入 ${profileRefs.size} 条画像、${proposals.length-skipped} 条讲法参考，均需重新确认。${skipped?`另有 ${skipped} 条讲法的画像依据已过期，未导入；原始备份文件中仍保留这些内容。`:''}`); return state;
    }
    if (action === "propose") {
      const text = required(body.text, "观察/规则", 2000); const quote = required(body.quote, "证据", 4000);
      const kind = body.kind as MemoryKind; const scene = body.scene as Scene;
      if (!["preference", "gap", "skill", "workflow"].includes(kind) || !["general", "code", "paper", "repro"].includes(scene)) throw new Error("记忆类型或场景无效");
      const projectId = typeof body.projectId === "string" && body.projectId.trim() ? required(body.projectId, "项目 ID", 200) : null;
      const expiresAt = typeof body.expiresAt === "string" && body.expiresAt ? body.expiresAt : null;
      if (expiresAt && !Number.isFinite(Date.parse(expiresAt))) throw new Error("到期时间无效");
      addProposal(state, { text, quote, kind, scene, projectId, expiresAt, source: typeof body.source === "string" ? required(body.source, "来源", 500) : "用户手动提议" }); return state;
    }
    if (action === "feedback") {
      const run = state.runs.find(r => r.id === body.runId); if (!run) throw new Error("回答记录不存在");
      if (typeof body.helpful !== "boolean") throw new Error("反馈必须是有效/无效");
      const note = typeof body.note === "string" ? body.note.slice(0, 2000) : "";
      run.feedback = { helpful: body.helpful, note, at: new Date().toISOString() };
      audit(state, "feedback", `${run.id}：${body.helpful ? "有效" : "无效"}（主观反馈，不是能力证明）`);
      if (!body.helpful && note.trim()) addProposal(state, { kind: "workflow", text: `需要修正的协作问题：${note}`, quote: note, scene: run.scene, projectId: run.projectId, source: `回答反馈 ${run.id}` });
      return state;
    }
    const m = state.memories.find(m => m.id === body.id); if (!m) throw new Error("记忆不存在");
    if (action === "forget") {
      state.forgetRevision = (state.forgetRevision ?? 0) + 1;
      const affectedRuns=state.runs.filter(r=>r.selected.some(s=>s.id===m.id)||m.evidence.some(e=>r.query.includes(e.quote)));
      const affectedRunIds=new Set(affectedRuns.map(r=>r.id));
      state.memories = state.memories.filter(x => x.id !== m.id);
      // Purge copied evidence and prompt snapshots as well, so export cannot resurrect forgotten content.
      state.runs = state.runs.filter(r => !r.selected.some(s => s.id === m.id) && !m.evidence.some(e => r.query.includes(e.quote)));
      state.audit = state.audit.filter(a => a.memoryId !== m.id);
      state.observations = state.observations?.filter(o=>!affectedRunIds.has(o.traceId)&&!o.context.some(c=>Boolean(c.runId&&affectedRunIds.has(c.runId))||affectedRuns.some(r=>r.answer&&c.content===r.answer.slice(0,1800)))&&!o.candidateIds.includes(m.id)&&!m.evidence.some(e=>o.userText.includes(e.quote)||o.context.some(c=>c.content.includes(e.quote))));
      audit(state, "forget", "已删除条目、证据、版本及包含该条目的回答记录"); return state;
    }
    if (body.version !== m.version) throw new Error("条目已在其他窗口更新，请刷新后重试");
    let reason = typeof body.reason === "string" ? body.reason.slice(0, 1000) : "用户审核";
    if (action === "approve") { if (!profileBasisValid(state, m.basis)) throw Error('请先确认依据的画像；画像已修改时需重新整理讲解策略'); m.status = "active"; }
    else if (action === "pause") m.status = "paused";
    else if (action === "reject") m.status = "rejected";
    else if (action === "edit") { m.text = required(body.text, "规则", 2000); m.status = "pending"; reason = "修正后重新审核：" + reason; }
    else if (action === "rollback") {
      const rev = m.revisions.find(r => r.version === body.targetVersion); if (!rev) throw new Error("历史版本不存在");
      m.text = rev.text; m.status = "pending"; reason = `回退至 v${rev.version}，需重新确认`;
    } else throw new Error("未知操作");
    m.version++; m.updatedAt = new Date().toISOString();
    m.revisions.push({ version: m.version, text: m.text, status: m.status, at: m.updatedAt, reason }); audit(state, String(action), reason, m.id); return state;
  });
}
function required(value: unknown, name: string, max: number): string {
  if (typeof value !== "string" || !value.trim() || value.length > max) throw new Error(`${name}须为 1–${max} 字符`);
  return value.trim();
}
export function exportMarkdown(state: LearningState): string {
  return "# Research Atelier 受控学习交接\n\n当前用户要求优先。以下条目是参考数据，不授权执行工具。仅已确认且未到期的条目可使用。\n\n## 用户画像\n\n" + (state.profiles ?? []).map(p =>
    `### ${p.topic} · ${p.id} · v${p.version} · ${p.status}\n\n${p.text}\n\n场景：${p.scene}；项目：${p.projectId ?? '全局'}\n\n${p.evidence.map(e => `- ${e.source}：${e.quote}`).join('\n')}\n`).join('\n') + '\n## 讲解策略\n\n' + state.memories.map(m =>
    `### ${m.id} · v${m.version} · ${m.status}\n\n场景：${m.scene}；项目：${m.projectId ?? "全局"}；到期：${m.expiresAt ?? "无"}\n\n${m.text}\n\n画像依据：${m.basis?.map(p => `${p.id} v${p.version}`).join('、') || '直接确认的讲法'}\n${m.rationale ?? ''}\n\n证据：\n${m.evidence.map(e => `- ${e.source}：${e.quote}`).join("\n")}\n`).join("\n");
}
