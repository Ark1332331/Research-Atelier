import {configuredModelKey,fetchModel} from '../model-config.ts';
import { randomUUID } from "node:crypto";
import { mutateLearning, readLearning, addProposal } from "./store.ts";
import type { MemoryKind, Scene } from "./core.ts";
import type { Observation, ObservationMessage } from "./observation-types.ts";
import { addProfileObservation } from './profile-store.ts';
import { PROFILE_DIMENSIONS, selectProfile, type ProfileReference } from './profile.ts';
import { OBSERVER_PROMPT } from './observer-prompt.ts';
export function redactObservation(text:string):string {
  return text.replace(/(?:sk-[\w-]{8,}|Bearer\s+[\w.\/-]+|(?:api[_-]?key|token|password|密码)\s*[:=]\s*[^\s,;]+)/gi,"[已隐藏凭据]").slice(0,4000);
}
export function observationContext(messages:unknown):ObservationMessage[] {
  if(!Array.isArray(messages))return [];
  return messages.filter(m=>m && (m.role==="user"||m.role==="assistant") && typeof m.content==="string").slice(-6).map(m=>({role:m.role,content:redactObservation(m.content).slice(0,1800),...(typeof m.learning?.runId==="string"?{runId:m.learning.runId}:typeof m.learningRunId==="string"?{runId:m.learningRunId}:{})}));
}
interface Input { traceId?:string; source:string; scene:Scene; projectId?:string|null; resourceId?:string; kind:Observation["kind"]; action:string; userText?:string; context?:ObservationMessage[]; tool?:Observation["tool"]; candidateIds?:string[];reason?:string }
export async function recordObservation(input:Input):Promise<Observation> {
  return mutateLearning(state=>{
    state.observations??=[];const traceId=input.traceId??randomUUID();
    const existing=state.observations.find(o=>o.traceId===traceId&&o.source===input.source&&o.action===input.action);if(existing)return existing;
    const collecting=state.collecting;const semantic=input.kind==="conversation"||input.kind==="feedback"||input.kind==="recall";
    const o:Observation={id:randomUUID(),traceId,at:new Date().toISOString(),source:input.source,scene:input.scene,projectId:input.projectId??null,...(input.resourceId?{resourceId:input.resourceId.slice(0,200)}:{}),kind:input.kind,action:input.action,status:!collecting?"paused":semantic&&input.userText?.trim()?"queued":input.candidateIds?.length?"proposed":"no-change",reason:!collecting?"采集已暂停，未保存内容":input.candidateIds?.length?"检查产生待确认的改法":semantic&&input.userText?.trim()?"已收到，等待后台结合近期对话检查":"已记录工具结果；一次操作不能证明偏好或能力",userText:collecting?redactObservation(input.userText??""):"",context:collecting?(input.context??[]).slice(-6).map(m=>({...m,content:redactObservation(m.content).slice(0,1800)})):[],candidateIds:collecting?(input.candidateIds??[]):[],attempts:0,...(input.tool?{tool:input.tool}:{})};
    o.profileRevision=state.profileRevision??0;o.profileIds=[];
    if(collecting&&input.reason)o.reason=redactObservation(input.reason).slice(0,1000);
    state.observations.push(o);return o;
  });
}
export async function processObservation():Promise<boolean> {
  const snapshot=await readLearning();
  if(!snapshot.observations?.some(o=>o.status==="queued"||(o.status==="analyzing"&&Date.parse(o.leaseUntil??"")<Date.now())))return false;
  const claim=await mutateLearning(state=>{
    const now=Date.now();const o=state.observations?.find(x=>x.status==="queued"||(x.status==="analyzing"&&Date.parse(x.leaseUntil??"")<now));if(!o)return null;
    if(!state.collecting){o.status="paused";o.reason="采集已暂停，取消分析";return null;}
    if(o.profileRevision!==undefined&&o.profileRevision!==(state.profileRevision??0)){o.status="no-change";o.reason="用户已调整画像，旧上下文未写入；后续对话将依据最新画像观察";o.finishedAt=new Date().toISOString();return structuredClone(o);}
    if(o.attempts>=3){o.status="failed";o.reason="连续中断三次，请手动重试";return null;}
    o.status="analyzing";o.attempts++;o.leaseUntil=new Date(now+60000).toISOString();o.reason="后台正在核对原话和近期上下文";return structuredClone(o);
  });
  if(!claim)return false;
  if(claim.status!=='analyzing')return true;
  try {
    const key=await configuredModelKey();if(!key)throw Error("未配置模型，事件已保留，可重试");
    const currentState=await readLearning();
    const profile=selectProfile({...currentState,applying:true},claim.userText,claim.scene,claim.projectId,claim.resourceId??null);
    const recentTools=currentState.observations?.filter(o=>o.kind==="tool"&&o.projectId===claim.projectId&&o.scene===claim.scene&&(!claim.resourceId||o.resourceId===claim.resourceId)&&Date.parse(o.at)<=Date.parse(claim.at)&&Date.parse(o.at)>Date.parse(claim.at)-1800000).slice(-5).map(o=>({source:o.source,action:o.action,tool:o.tool}))??[];
    await mutateLearning(state=>{const o=state.observations?.find(o=>o.id===claim.id);if(o&&o.status==="analyzing"&&o.attempts===claim.attempts)o.toolContext=[...recentTools,...(o.toolContext??[])].slice(-5);});
    const response=await fetchModel({method:"POST",headers:{"Content-Type":"application/json",Authorization:`Bearer ${key}`},signal:AbortSignal.timeout(30000),body:JSON.stringify({model:"deepseek-chat",response_format:{type:"json_object"},messages:[{role:"system",content:OBSERVER_PROMPT},{role:"user",content:JSON.stringify({latestUser:claim.userText,recentConversation:claim.context,source:claim.source,action:claim.action,confirmedProfile:profile,recentTools:[...recentTools,...(claim.toolContext??[])].slice(-5)})}]})});
    if(!response.ok){let detail="";try{const failure=await response.json();detail=typeof failure?.error?.message==="string"?redactObservation(failure.error.message).slice(0,300):"";}catch{/* provider error may not be JSON */}throw Error(`观察模型调用失败 HTTP ${response.status}${detail?`：${detail}`:""}`);}
    const data=await response.json();const payload=JSON.parse(data?.choices?.[0]?.message?.content??"");
    if(!payload||!Array.isArray(payload.candidates)||typeof payload.reason!=="string"||!payload.reason.trim()||(payload.profiles!==undefined&&!Array.isArray(payload.profiles)))throw Error("观察模型格式异常，未写入候选");
    const evidenceValid=(c:Record<string,unknown>)=>c&&typeof c.text==='string'&&Boolean(c.text.trim())&&c.text.length<=1200&&typeof c.quote==='string'&&c.quote.length>=4&&claim.userText.includes(c.quote)&&redactObservation(c.text)===c.text;
    const candidates=payload.candidates.slice(0,3).filter((c:Record<string,unknown>)=>evidenceValid(c)&&["preference","gap","workflow"].includes(String(c.kind)));
    const profiles=(payload.profiles??[]).slice(0,3).filter((p:Record<string,unknown>)=>evidenceValid(p)&&Object.hasOwn(PROFILE_DIMENSIONS,String(p.dimension))&&typeof p.topic==='string'&&Boolean(p.topic.trim())&&p.topic.length<=100&&typeof p.key==='string'&&p.key.length>0&&p.key.length<=100);
    await mutateLearning(state=>{
      const current=state.observations?.find(o=>o.id===claim.id);if(!current||current.status!=="analyzing"||current.attempts!==claim.attempts)return;
      if(!state.collecting){current.status="paused";current.reason="分析过程中采集已暂停，未写入新记忆";return;}
      if((state.profileRevision??0)!==(claim.profileRevision??0)){current.status='no-change';current.reason='分析期间用户已调整画像，本次旧观察未写入';current.finishedAt=new Date().toISOString();delete current.leaseUntil;return;}
      const references=new Map<string,ProfileReference>(profile.map(p=>[p.id,{id:p.id,version:p.version}]));
      current.profileIds??=[];
      for(const p of profiles){if(references.has(p.key))continue;const saved=addProfileObservation(state,{...p,scene:p.scope==='global'?'general':claim.scene,projectId:p.scope==='global'?null:claim.projectId,resourceId:p.scope==='global'||claim.projectId?null:claim.resourceId??`observation:${claim.traceId}`},p.quote,`观察 ${claim.id} / ${claim.source} / 待用户确认`);if(saved&&saved.status!=='rejected'&&saved.status!=='paused'){references.set(p.key,{id:saved.id,version:saved.version});current.profileIds.push(saved.id);}}
      let discarded=payload.candidates.length-candidates.length+(payload.profiles?.length??0)-profiles.length;
      for(const c of candidates){
        const keys=c.basis??[];
        if(payload.profiles!==undefined&&Array.isArray(keys)&&!keys.length&&(c.kind!=='preference'||!/(?:希望|喜欢|请|先|不要|别|讲得|讲的|太抽象|看不懂|没看懂|卡在)/.test(c.quote))){discarded++;continue;}
        if(!Array.isArray(keys)||keys.length>3||keys.some((key:unknown)=>typeof key!=='string'||!references.has(key))||(keys.length&& (typeof c.rationale!=='string'||!c.rationale.trim()||c.rationale.length>1000||redactObservation(c.rationale)!==c.rationale))){discarded++;continue;}
        const basis=keys.map((key:string)=>references.get(key)!);
        const m=addProposal(state,{kind:c.kind as MemoryKind,text:c.text,quote:c.quote,scene:claim.scene,projectId:claim.projectId,basis,rationale:c.rationale,source:`持续观察 ${claim.id} / ${claim.source} / 模型推断需确认`});if(m&&m.status!=="rejected")current.candidateIds.push(m.id);
      }
      current.profileIds=[...new Set(current.profileIds)];current.candidateIds=[...new Set(current.candidateIds)];current.status=current.candidateIds.some(id=>state.memories.find(m=>m.id===id)?.status==="pending")||current.profileIds.some(id=>state.profiles?.find(p=>p.id===id)?.status==='pending')?"proposed":"no-change";current.reason=redactObservation(payload.reason).slice(0,1000)+(discarded?"（无原话依据或格式不合格的候选已丢弃）":"");current.finishedAt=new Date().toISOString();delete current.leaseUntil;
    });
  }catch(e){await mutateLearning(state=>{const o=state.observations?.find(x=>x.id===claim.id);if(!o||o.status!=="analyzing"||o.attempts!==claim.attempts)return;o.status="failed";o.error=redactObservation(e instanceof Error?e.message:String(e));o.reason="观察失败，不代表没有新发现；可重试";o.finishedAt=new Date().toISOString();delete o.leaseUntil;});}
  return true;
}
export async function retryObservation(id:string) {
  return mutateLearning(state=>{const o=state.observations?.find(x=>x.id===id);if(!o||o.status!=="failed")throw Error("仅失败的观察可重试");if(!state.collecting)throw Error("请先恢复采集");o.status="queued";o.attempts=0;o.reason="等待重新检查";delete o.error;return state;});
}
export async function observationHealth(){const state=await readLearning();return {collecting:state.collecting,queued:state.observations?.filter(o=>o.status==="queued"||o.status==="analyzing").length??0};}

export async function attachObservationTool(id:string, result:NonNullable<Observation["toolContext"]>[number]){return mutateLearning(state=>{const o=state.observations?.find(o=>o.id===id);if(!o||!state.collecting)return;o.toolContext=[...(o.toolContext??[]),result].slice(-5);});}
