import type { Scene } from "./core.ts";
export type ObservationStatus = "queued" | "analyzing" | "proposed" | "no-change" | "failed" | "paused";
export interface ObservationMessage { role:"user"|"assistant"; content:string;runId?:string }
export interface Observation {
  id:string; traceId:string; at:string; source:string; scene:Scene; projectId:string|null; resourceId?:string;
  kind:"conversation"|"tool"|"recall"|"feedback"|"system"; action:string;
  status:ObservationStatus; reason:string; userText:string; context:ObservationMessage[];
  candidateIds:string[]; attempts:number; leaseUntil?:string; finishedAt?:string; error?:string;
  toolContext?:{source:string;action:string;tool?:{ok:boolean;status:number;durationMs:number;error?:string}}[];
  tool?:{ok:boolean; status:number; durationMs:number;error?:string};
}
