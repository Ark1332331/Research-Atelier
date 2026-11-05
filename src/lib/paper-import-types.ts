import type {PaperHit} from './paper-tools';
export interface ImportCandidate extends PaperHit {candidateId:string;automatic:boolean}
export type ImportStatus='queued'|'searching'|'choice'|'ready'|'importing'|'imported'|'existing'|'not_found'|'unavailable'|'failed';
export interface ImportItem {id:string;query:string;context?:string;original?:string;sourceUrl?:string;targetGroup?:string;groupError?:string;status:ImportStatus;candidates:ImportCandidate[];selectedId?:string;error?:string;result?:{slug:string;title:string;pages:number;imported:boolean;group?:string};updatedAt:string}
export interface ImportMessage {id:string;role:'user'|'assistant';content:string;createdAt:string}
export interface ImportSession {id:string;messages:ImportMessage[];items:ImportItem[];targetGroup?:string;groups?:string[];updatedAt:string;busy:boolean;operationId?:string;leaseUntil?:number;error?:string}
export interface ImportSessionSummary {id:string;updatedAt:string;busy:boolean;title:string;itemCount:number}
