import {randomUUID} from 'node:crypto';
import {readLocalArray,mutateLocalArray} from './local-json.ts';

type Profile={id:string;name:string;baseUrl:string;model:string;apiKey:string};
type State={version:1;activeId:string|null;profiles:Profile[]};
export type PublicModelProfile=Omit<Profile,'apiKey'>&{hasKey:boolean};
export type PublicModelConfigs={activeId:string|null;profiles:PublicModelProfile[];environment:PublicModelProfile};
const FILE='model-configs.json';
export class ModelConfigError extends Error {}
function state(items:State[]):State{
 if(!items.length)return {version:1,activeId:null,profiles:[]};
 if(items.length!==1||items[0].version!==1||!Array.isArray(items[0].profiles))throw new ModelConfigError('模型配置文件异常，请检查备份');
 return items[0];
}
function field(value:unknown,label:string,max:number){if(typeof value!=='string'||!value.trim()||value.trim().length>max||/[\u0000-\u001f\u007f]/.test(value))throw new ModelConfigError(`请填写有效的${label}`);return value.trim();}
export function normalizeModelBaseUrl(value:unknown):string{
 const raw=field(value,'Base URL',1000);let url:URL;try{url=new URL(raw);}catch{throw new ModelConfigError('Base URL 必须是完整的 HTTP 或 HTTPS 地址');}
 if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.search||url.hash)throw new ModelConfigError('Base URL 不能包含用户名、密码、查询参数或片段');
 return url.toString().replace(/\/+$/,'').replace(/\/chat\/completions$/,'');
}
function environment():Profile{return {id:'environment',name:'环境默认',baseUrl:normalizeModelBaseUrl(process.env.DEEPSEEK_BASE_URL||'https://api.deepseek.com'),model:process.env.DEEPSEEK_MODEL||'deepseek-chat',apiKey:process.env.DEEPSEEK_API_KEY||''};}
function publicProfile({apiKey,...profile}:Profile):PublicModelProfile{return {...profile,hasKey:!!apiKey};}
function publicState(value:State):PublicModelConfigs{return {activeId:value.activeId,profiles:value.profiles.map(publicProfile),environment:publicProfile(environment())};}
export async function readPublicModelConfigs(){return publicState(state(await readLocalArray<State>(FILE)));}
export async function getActiveModelConfig():Promise<Profile>{const value=state(await readLocalArray<State>(FILE));if(value.activeId){const profile=value.profiles.find(p=>p.id===value.activeId);if(!profile)throw new ModelConfigError('当前模型配置不存在，请重新选择');return profile;}return environment();}
export async function configuredModelKey(){return (await getActiveModelConfig()).apiKey;}
function draft(body:Record<string,unknown>,previous?:Profile):Profile{
 const apiKey=body.apiKey===undefined||body.apiKey===''?previous?.apiKey:field(body.apiKey,'API Key',4000);
 if(!apiKey)throw new ModelConfigError('请填写 API Key');
 return {id:previous?.id??randomUUID(),name:field(body.name,'配置名称',80),baseUrl:normalizeModelBaseUrl(body.baseUrl),model:field(body.model,'模型名称',200),apiKey};
}
export async function mutateModelConfigs(body:Record<string,unknown>):Promise<PublicModelConfigs>{
 return mutateLocalArray<State,PublicModelConfigs>(FILE,items=>{
  const value=state(items);
  if(body.action==='save'){
   const previous=value.profiles.find(p=>p.id===body.id);if(body.id&&!previous)throw new ModelConfigError('配置已被删除，请刷新');
   if(!previous&&value.profiles.length>=30)throw new ModelConfigError('最多保存 30 套配置');
   const profile=draft(body,previous);value.profiles=value.profiles.filter(p=>p.id!==profile.id).concat(profile);if(body.activate===true)value.activeId=profile.id;
  }else if(body.action==='activate'){
   if(body.id!==null&&!value.profiles.some(p=>p.id===body.id))throw new ModelConfigError('模型配置不存在');value.activeId=body.id as string|null;
  }else if(body.action==='delete'){
   if(value.activeId===body.id)throw new ModelConfigError('请先切换到其他配置，再删除当前配置');
   if(!value.profiles.some(p=>p.id===body.id))throw new ModelConfigError('模型配置不存在');value.profiles=value.profiles.filter(p=>p.id!==body.id);
  }else throw new ModelConfigError('未知的配置操作');
  items.splice(0,items.length,value);return publicState(value);
 });
}

async function requestModel(init:RequestInit,config:Profile):Promise<Response>{
 if(!config.apiKey)throw new ModelConfigError('尚未配置模型，请打开“模型配置”填写 Base URL、API Key 和模型名称');
 const body=JSON.parse(typeof init.body==='string'?init.body:'{}');
 const headers=new Headers(init.headers);headers.set('Content-Type','application/json');headers.set('Authorization',`Bearer ${config.apiKey}`);
 let response:Response;
 try{response=await fetch(config.baseUrl+'/chat/completions',{...init,method:'POST',headers,body:JSON.stringify({...body,model:config.model}),redirect:'error'});}
 catch{if(init.signal?.aborted)throw init.signal.reason;throw new ModelConfigError('无法连接模型服务，请检查 Base URL 和网络');}
 return response;
}
/** Each HTTP request takes one configuration snapshot. Switching never aborts or
 * reroutes an in-flight stream. Ordinary requests never expose provider error bodies. */
export async function fetchModel(init:RequestInit,profile?:Profile):Promise<Response>{
 const response=await requestModel(init,profile??await getActiveModelConfig());
 if(!response.ok){await response.body?.cancel();return Response.json({error:{message:`模型服务返回 HTTP ${response.status}，请检查模型配置或稍后重试`}}, {status:response.status});}
 return response;
}

function redactDiagnostic(text:string,key:string):string{
 for(const secret of new Set([key,encodeURIComponent(key),Buffer.from(key).toString('base64')]))if(secret)text=text.split(secret).join('[已隐藏]');
 return text.replace(/Bearer\s+[^\s,;"']+/gi,'Bearer [已隐藏]')
  .replace(/\b(?:api[-_ ]?key|token|secret|authorization)\s*[:=]\s*["']?[^\s,;"']+/gi,'凭据=[已隐藏]')
  .replace(/\bsk-[\w-]+/g,'[已隐藏]').replace(/[\u0000-\u001f\u007f]/g,' ').trim();
}
// Only a short JSON error message/code from the synthetic connection test may be
// displayed. Never forward HTML, headers, raw request echoes or arbitrary objects.
async function testDiagnostic(response:Response,key:string):Promise<string>{
 const reader=response.body?.getReader();if(!reader)return '';
 try{
  const chunks:Uint8Array[]=[];let length=0;
  while(true){const {done,value}=await reader.read();if(done)break;length+=value.byteLength;if(length>16384)return '';chunks.push(value);}
  const bytes=new Uint8Array(length);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
  const data=JSON.parse(new TextDecoder().decode(bytes));
  const error=data?.error;
  const message=typeof error?.message==='string'?error.message:typeof data?.message==='string'?data.message:typeof error==='string'?error:'';
  const code=typeof error?.code==='string'?error.code:typeof data?.code==='string'?data.code:'';
  return redactDiagnostic([code,message].filter(Boolean).join(' · '),key).slice(0,600);
 }catch{return '';}
 finally{try{await reader.cancel();}catch{/* already aborted */}reader.releaseLock();}
}
export async function testModelConfig(body:Record<string,unknown>){
 const value=state(await readLocalArray<State>(FILE));const previous=value.profiles.find(p=>p.id===body.id);
 if(body.id&&!previous)throw new ModelConfigError('配置已被删除，请刷新');
 const config=draft(body,previous),start=Date.now();
 const response=await requestModel({signal:AbortSignal.timeout(20000),body:JSON.stringify({messages:[{role:'user',content:'Reply OK.'}],max_tokens:32,stream:false})},config);
 if(!response.ok){
  const detail=await testDiagnostic(response,config.apiKey);
  const hint=response.status===404?'请核对该模型在此服务的名称及支持的接口类型；当前使用 Chat Completions。':response.status===401||response.status===403?'请检查密钥及该模型的访问权限。':'请根据服务商返回原因检查配置或稍后重试。';
  throw new ModelConfigError(redactDiagnostic(`连接测试失败（HTTP ${response.status}）。请求接口：${config.baseUrl}/chat/completions。${detail?'服务商返回：'+detail+'。':'服务商未提供可显示的 JSON 错误原因。'}${hint}`,config.apiKey));
 }
 const data=await response.json();if(!data?.choices?.[0]?.message)throw new ModelConfigError('返回格式不是兼容的 Chat Completions 响应');
 return {ok:true,elapsedMs:Date.now()-start};
}
