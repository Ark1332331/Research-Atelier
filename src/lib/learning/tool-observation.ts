import { recordObservation, observationContext, redactObservation } from "./observations.ts";
import type { Scene } from "./core.ts";
interface Spec {source:string;scene:Scene; conversation?:boolean}
/** Explicit route instrumentation. No recording of headers, raw files, request bodies or response bodies. */
export function withToolObservation(spec:Spec, handler:(request:Request)=>Promise<Response>){
  return async(request:Request):Promise<Response>=>{
    if(!spec.conversation||request.method==="GET")return handler(request);
    let body:Record<string,unknown>={};
    if(request.headers.get("content-type")?.includes("application/json")&&Number(request.headers.get("content-length")??0)<65536)try{body=await request.clone().json();}catch{/* invalid requests still get a result event */}
    const url=new URL(request.url);
    if(request.method==="GET"){const file=url.searchParams.get("file"),slug=url.searchParams.get("slug");if(!file&&!slug)return handler(request);body={action:file?"打开代码文件":"打开论文",slug:slug??undefined,resourceId:file??undefined};}
    const start=Date.now();let response:Response;
    try{response=await handler(request);}catch{response=Response.json({error:"工具执行失败"},{status:500});}
    let toolError:string|undefined;if(!response.ok&&response.headers.get("content-type")?.includes("application/json"))try{const result=await response.clone().json();const text=typeof result.error==="string"?result.error:typeof result.hint==="string"?result.hint:"工具请求失败";toolError=redactObservation(text).slice(0,300);}catch{/* error payload is optional */}
    const messages=observationContext(body.messages);const last=messages.filter(m=>m.role==="user").at(-1)?.content;
    const userText=spec.conversation?(last??(typeof body.question==="string"?body.question:"")):"";
    try {
      const o=await recordObservation({source:spec.source,scene:spec.scene,projectId:typeof body.projectId==="string"?body.projectId:null,resourceId:typeof body.slug==="string"?body.slug:typeof body.sessionId==="string"?body.sessionId:typeof body.resourceId==="string"?body.resourceId:undefined,kind:spec.conversation&&userText?"conversation":"tool",action:redactObservation(typeof body.action==="string"?body.action:request.method).slice(0,100),userText,context:messages,tool:{ok:response.ok,status:response.status,durationMs:Date.now()-start,...(toolError?{error:toolError}:{})}});
      response.headers.set("X-RA-Observation",o.id);
    }catch{response.headers.set("X-RA-Observation-Error","storage-unavailable");}
    return response;
  };
}
