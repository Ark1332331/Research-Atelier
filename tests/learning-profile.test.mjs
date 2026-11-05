import {test, after, beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
const dir=await mkdtemp(path.join(os.tmpdir(),'ra-profile-'));
process.env.RA_DATA_DIR=dir;process.env.DEEPSEEK_API_KEY='test-only';
delete process.env.VERCEL_KV_REST_API_URL;delete process.env.VERCEL_KV_REST_API_TOKEN;
const {manageLearning,readLearning,prepareLearning,finishLearning,mutateLearning,exportMarkdown}=await import('../src/lib/learning/store.ts');
const {emptyState}=await import('../src/lib/learning/core.ts');
const {recordObservation,processObservation}=await import('../src/lib/learning/observations.ts');
const oldFetch=globalThis.fetch;
after(async()=>{globalThis.fetch=oldFetch;await rm(dir,{recursive:true,force:true});});
beforeEach(async()=>{globalThis.fetch=oldFetch;await mutateLearning(s=>{for(const key of Object.keys(s))delete s[key];Object.assign(s,emptyState());});});
const add=(text,extra={})=>manageLearning({action:'profile-add',dimension:'background',topic:'编程经历',text,scene:'general',...extra});
const change=(p,action,extra={})=>manageLearning({action:`profile-${action}`,id:p.id,version:p.version,...extra});
const model=payload=>async()=>Response.json({choices:[{message:{content:JSON.stringify(payload)}}]});
const observe=text=>recordObservation({source:'划线追问',scene:'paper',kind:'conversation',action:'发送消息',userText:text});
test('manual profile is separate, editable, scoped and actually included in response snapshots',async()=>{
  let s=await add('我有 C 语言基础');const p=s.profiles[0];
  assert.equal(s.memories.length,0);assert.equal(p.status,'active');assert.equal(p.origin,'user');
  let prepared=await prepareLearning('解释训练过程','paper');assert.equal(prepared.profile[0].text,p.text);assert.match(prepared.prompt,/用户画像/);
  await finishLearning(prepared,'解释');assert.equal((await readLearning()).runs[0].profile[0].version,p.version);
  s=await change(p,'edit',{text:'我熟悉 Python，正在学 C'});assert.equal(s.profiles[0].status,'active');
  await assert.rejects(()=>change(p,'edit',{text:'过时窗口'}),/其他窗口/);
  prepared=await prepareLearning('解释训练过程','paper');assert.ok(!prepared.prompt.includes('我有 C 语言基础'));assert.match(prepared.prompt,/熟悉 Python/);
  await manageLearning({action:'settings',applying:false});assert.equal((await prepareLearning('解释','paper')).profile.length,0);
  await manageLearning({action:'settings',applying:true});assert.equal((await prepareLearning('解释','paper',null,false)).profile.length,0);
  await add('仅此论文的阅读难点',{scene:'paper',projectId:'paper-a',dimension:'difficulty',topic:'训练过程'});
  assert.ok(!(await prepareLearning('训练过程','paper','paper-b')).prompt.includes('仅此论文'));
});
test('observer separates profile from strategy, validates evidence, and guards strategy with reviewed profile versions',async()=>{
  const o=await observe('我学过线性代数，但没学过概率论，希望从基础讲。');
  globalThis.fetch=model({reason:'依据用户自述',profiles:[{key:'probability',dimension:'knowledge',topic:'概率论',text:'用户自述尚未学过概率论',quote:'没学过概率论',scope:'global'},{key:'fake',dimension:'knowledge',topic:'张量',text:'掌握张量',quote:'助手认为已掌握张量'}],candidates:[{kind:'workflow',text:'解释概率分布时先说明随机变量，再给抛硬币例子。',quote:'没学过概率论',basis:['probability'],rationale:'概率论尚未系统学习，需要先建立基本概念。'}]});
  await processObservation();let s=await readLearning();assert.equal(s.profiles.length,1);assert.equal(s.profiles[0].status,'pending');
  assert.equal(s.observations.find(x=>x.id===o.id).profileIds[0],s.profiles[0].id);
  let m=s.memories[0];assert.equal(m.basis[0].id,s.profiles[0].id);
  await assert.rejects(()=>manageLearning({action:'approve',id:m.id,version:m.version}),/画像/);
  s=await change(s.profiles[0],'approve');m=s.memories[0];
  await manageLearning({action:'approve',id:m.id,version:m.version});
  let prepared=await prepareLearning('概率分布','paper');assert.equal(prepared.selected[0].basis[0].id,s.profiles[0].id);
  s=await change(s.profiles[0],'edit',{text:'我已修完概率论课程'});
  assert.equal(s.memories[0].status,'paused');prepared=await prepareLearning('概率分布','paper');assert.equal(prepared.selected.length,0);
  assert.match(prepared.prompt,/已修完概率论/);assert.ok(!prepared.prompt.includes('没学过'));
});
test('editing or deleting profile during observer inference cannot resurrect old conclusions',async()=>{
  const s=await add('我正在学习概率论');const p=s.profiles[0];await observe('我还在学习概率论');
  let ready,release;const started=new Promise(r=>ready=r),gate=new Promise(r=>release=r);
  globalThis.fetch=async()=>{ready();await gate;return model({reason:'旧上下文',profiles:[{key:'old',dimension:'knowledge',topic:'概率论',text:'还没学过概率论',quote:'还在学习概率论'}],candidates:[]})();};
  const work=processObservation();await started;await change(p,'edit',{text:'概率论课程已完成'});release();await work;
  assert.equal((await readLearning()).profiles.length,1);assert.equal((await readLearning()).profiles[0].text,'概率论课程已完成');
  const prepared=await prepareLearning('概率论','paper');await finishLearning(prepared,'回复');
  const current=(await readLearning()).profiles[0];await change(current,'forget');await finishLearning(prepared,'延迟回复');
  const final=await readLearning();assert.equal(final.profiles.length,0);assert.equal(final.runs.length,0);assert.ok(!exportMarkdown(final).includes('概率论课程已完成'));
});
test('paused collection permits manual corrections but blocks automatic profile proposals',async()=>{
  await manageLearning({action:'settings',collecting:false});const s=await add('有信号处理经验');assert.equal(s.profiles.length,1);
  const o=await observe('我没学过概率论');assert.equal(o.status,'paused');assert.equal(o.userText,'');
  globalThis.fetch=()=>{throw Error('observer must not run');};assert.equal(await processObservation(),false);
});
test('local observations without a project are isolated by their conversation resource',async()=>{
  await recordObservation({source:'划线追问',scene:'paper',resourceId:'thread-a',kind:'conversation',action:'发送消息',userText:'我只是不理解这篇论文里的评估指标'});
  globalThis.fetch=model({reason:'当前论文卡点',profiles:[{key:'metric',dimension:'difficulty',topic:'评估指标',text:'当前论文的评估指标尚未理解',quote:'不理解这篇论文里的评估指标',scope:'current'}],candidates:[]});
  await processObservation();const s=await readLearning();await change(s.profiles[0],'approve');
  assert.equal((await prepareLearning('评估指标','paper',null,true,'thread-a')).profile.length,1);
  assert.equal((await prepareLearning('评估指标','paper',null,true,'thread-b')).profile.length,0);
  assert.equal((await prepareLearning('评估指标','paper')).profile.length,0);
});
test('forget cancels in-flight snapshots even with personalization off',async()=>{
  let s=await add('用户特定经历原文');const p=s.profiles[0];await manageLearning({action:'settings',applying:false});
  const prepared=await prepareLearning('用户特定经历原文，请解释一下','paper');await change(p,'forget');await finishLearning(prepared,'延迟回复');
  s=await readLearning();assert.equal(s.runs.length,0);
});
test('backup restore keeps remapped strategy basis pending, and incomplete backup does not detach it',async()=>{
  const {addProposal}=await import('../src/lib/learning/store.ts');let s=await add('有统计学背景');const p=s.profiles[0];
  await mutateLearning(s=>addProposal(s,{kind:'workflow',text:'使用统计估计类比',quote:'有统计学背景',scene:'general',projectId:null,source:'test',basis:[{id:p.id,version:p.version}],rationale:'有统计学背景，使用熟悉的类比'}));
  const backup=await readLearning();await mutateLearning(s=>{for(const k of Object.keys(s))delete s[k];Object.assign(s,emptyState());});
  await assert.rejects(()=>manageLearning({action:'import',memories:backup.memories}),/画像/);
  s=await manageLearning({action:'import',memories:backup.memories,profiles:backup.profiles});assert.equal(s.profiles[0].status,'pending');assert.notEqual(s.profiles[0].id,p.id);assert.equal(s.memories[0].basis[0].id,s.profiles[0].id);
  await assert.rejects(()=>manageLearning({action:'approve',id:s.memories[0].id,version:s.memories[0].version}),/画像/);
});
test('unchanged re-enabled profile permits review again; new evidence can revise an outdated strategy without auto-activation',async()=>{
  const {addProposal}=await import('../src/lib/learning/store.ts');let s=await add('有统计学背景');let p=s.profiles[0];
  const proposal={kind:'workflow',text:'使用统计估计类比',quote:p.text,scene:'general',projectId:null,source:'test',basis:[{id:p.id,version:p.version}],rationale:'统计背景'};
  let m=await mutateLearning(s=>addProposal(s,proposal));await manageLearning({action:'approve',id:m.id,version:m.version});
  s=await change(p,'pause');s=await change(s.profiles[0],'approve');m=s.memories[0];assert.equal(m.basis[0].version,s.profiles[0].version);assert.equal(m.status,'pending');
  s=await change(s.profiles[0],'edit',{text:'目前学习统计估计'});p=s.profiles[0];assert.equal(s.memories[0].status,'paused');
  m=await mutateLearning(s=>addProposal(s,{...proposal,basis:[{id:p.id,version:p.version}],rationale:'当前学习统计估计，可用它作类比'}));assert.equal(m.status,'pending');assert.equal(m.basis[0].version,p.version);assert.equal((await readLearning()).memories.length,1);
});
test('backup with stale strategies still restores profiles and explicitly reports skipped old strategies',async()=>{
  const {addProposal}=await import('../src/lib/learning/store.ts');let s=await add('学习概率论之前');const p=s.profiles[0];
  await mutateLearning(s=>addProposal(s,{kind:'workflow',text:'从概率论零基础开始讲',quote:p.text,scene:'paper',projectId:null,source:'test',basis:[{id:p.id,version:p.version}],rationale:'尚未学习概率论'}));
  await change(p,'edit',{text:'概率论已学完'});const backup=await readLearning();
  await mutateLearning(s=>{for(const key of Object.keys(s))delete s[key];Object.assign(s,emptyState());});
  s=await manageLearning({action:'import',memories:backup.memories,profiles:backup.profiles});
  assert.equal(s.profiles[0].text,'概率论已学完');assert.equal(s.profiles[0].status,'pending');assert.equal(s.memories.length,0);assert.match(s.audit.at(-1).detail,/1 条讲法的画像依据已过期，未导入/);
});
test('same wording with different profile identities never overwrites another papers strategy',async()=>{
  const {addProposal}=await import('../src/lib/learning/store.ts');let s=await add('论文 A 指标尚不熟悉',{resourceId:'a'});const a=s.profiles[0];
  s=await add('论文 B 指标尚不熟悉',{resourceId:'b'});const b=s.profiles[1];
  const proposal={kind:'workflow',text:'用一个具体样本说明指标',quote:'指标尚不熟悉',scene:'paper',projectId:null,source:'test',rationale:'当前指标未理解'};
  const ma=await mutateLearning(s=>addProposal(s,{...proposal,basis:[{id:a.id,version:a.version}]}));await manageLearning({action:'approve',id:ma.id,version:ma.version});
  await mutateLearning(s=>addProposal(s,{...proposal,basis:[{id:b.id,version:b.version}]}));s=await readLearning();assert.equal(s.memories.length,2);assert.equal(s.memories[0].status,'active');
  assert.equal((await prepareLearning('指标','paper',null,true,'a')).selected.length,1);
});
test('new observer contract rejects inferred strategies without a profile basis and assistant-only evidence',async()=>{
  await observe('我没有学过贝叶斯推断');globalThis.fetch=model({reason:'核对依据',profiles:[{key:'fake',dimension:'knowledge',topic:'贝叶斯',text:'用户熟练掌握贝叶斯',quote:'助手说用户已经掌握'}],candidates:[{kind:'workflow',text:'从零开始解释',quote:'没有学过贝叶斯推断',basis:[],rationale:'推断缺基础'},{kind:'preference',text:'假造引用',quote:'没有学过贝叶斯推断',basis:['missing'],rationale:'missing'}]});
  await processObservation();const s=await readLearning();assert.equal(s.profiles?.length??0,0);assert.equal(s.memories.length,0);assert.match(s.observations[0].reason,/丢弃/);
});
