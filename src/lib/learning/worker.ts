import { mutateLearning } from "./store.ts";
import { processObservation } from "./observations.ts";
const key=Symbol.for("research-atelier.observation-worker");
type RuntimeGlobal=typeof globalThis & {[key]?:ReturnType<typeof setInterval>};
export function startObservationWorker(){
  const runtime=globalThis as RuntimeGlobal;if(runtime[key])return;
  let busy=false,lastHeartbeat=0;
  const tick=async()=>{if(busy)return;busy=true;try{if(Date.now()-lastHeartbeat>10000){await mutateLearning(s=>{s.observerHeartbeatAt=new Date().toISOString();});lastHeartbeat=Date.now();}await processObservation();}catch{console.error("持续观察队列不可用，请在学习页面检查本地学习数据。");}finally{busy=false;}};
  runtime[key]=setInterval(()=>void tick(),2000);runtime[key].unref?.();void tick();
}
