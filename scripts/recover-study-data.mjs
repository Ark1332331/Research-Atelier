import fs from 'node:fs/promises';
import {constants} from 'node:fs';
import path from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';

const records=['reading-memory.json','reading-notes.json'];
const index='study-library/index.json';
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
async function optional(file){try{return await fs.readFile(file);}catch(e){if(e.code==='ENOENT')return null;throw e;}}
async function array(root,rel){const bytes=await optional(path.join(root,rel));const value=bytes?JSON.parse(bytes):[];if(!Array.isArray(value))throw Error('Invalid array: '+rel);return value;}
function state(items){if(!items.length)return {version:1,nodes:[],sources:[]};if(items.length!==1||items[0].version!==1||!Array.isArray(items[0].nodes)||!Array.isArray(items[0].sources))throw Error('Invalid study index');return items[0];}
function unique(items){const ids=new Set();for(const item of items){if(!item.id||ids.has(item.id))throw Error('Missing/duplicate ID');ids.add(item.id);}return ids;}
function merge(current,incoming,label,conflicts){unique(current);unique(incoming);const values=new Map(current.map(item=>[item.id,item]));for(const item of incoming){const prior=values.get(item.id);if(!prior)values.set(item.id,item);else if(JSON.stringify(prior)!==JSON.stringify(item))conflicts.push({file:label,id:item.id,action:'kept-current; incoming retained in backup'});}return [...values.values()];}
function blob(source){if(!uuid.test(source.id)||!uuid.test(source.importId))throw Error('Invalid blob ID');return `study-library/imports/${source.importId}/${source.id}`;}
async function atomic(file,value){const temp=file+'.'+randomUUID()+'.tmp';const handle=await fs.open(temp,'wx');try{await handle.writeFile(JSON.stringify(value,null,2));await handle.sync();}finally{await handle.close();}await fs.rename(temp,file);}
async function snapshot(source,target){try{await fs.cp(source,target,{recursive:true,errorOnExist:true,force:false,filter:file=>!file.endsWith('.lock')});}catch(e){if(e.code!=='ENOENT')throw e;}}
function contains(parent,child){const rel=path.relative(parent,child);return rel===''||(!rel.startsWith('..')&&!path.isAbsolute(rel));}

/** Copy, never move. Existing IDs win; differing blob identities abort before data changes.
 * Uses the same locks as the app, and writes the index only after validated blobs exist. */
export async function recoverStudyData({source,target,backups}){
 source=await fs.realpath(source);target=path.resolve(target);backups=path.resolve(backups);
 if(contains(source,target)||contains(target,source)||contains(source,backups)||contains(target,backups))throw Error('Source, target and backup directories must be separate');
 const locks=[];
 try{
  for(const root of [source,target].sort())for(const rel of [index,...records]){
   const lock=path.join(root,rel+'.lock');await fs.mkdir(path.dirname(lock),{recursive:true});
   await fs.mkdir(lock);locks.push(lock);await fs.writeFile(path.join(lock,'owner.json'),JSON.stringify({pid:process.pid}));
  }
  const old=state(await array(source,index)),current=state(await array(target,index)),conflicts=[];
  const nodes=merge(current.nodes,old.nodes,index,conflicts),sources=merge(current.sources,old.sources,index,conflicts);
  for(const item of old.sources){const existing=current.sources.find(x=>x.id===item.id);if(existing&&(existing.importId!==item.importId||existing.sha256!==item.sha256))throw Error('Conflicting blob identity: '+item.id);}
  const files=[];
  for(const item of old.sources){const rel=blob(item),bytes=await fs.readFile(path.join(source,rel));if(hash(bytes)!==item.sha256)throw Error('Source hash mismatch: '+rel);const existing=await optional(path.join(target,rel));if(existing&&hash(existing)!==item.sha256)throw Error('Target hash mismatch: '+rel);files.push({rel,sha256:item.sha256,exists:!!existing});}
  const merged=[],counts=[];
  for(const rel of records){const before=await array(target,rel),incoming=await array(source,rel),after=merge(before,incoming,rel,conflicts);merged.push({rel,after});counts.push(after.length-before.length);}
  const documentIds=new Set(nodes.filter(n=>n.kind==='document').map(n=>n.id));
  const missingOrigins=merged.flatMap(({rel,after})=>after.filter(item=>item.anchor?.scope?.startsWith('/study/')&&!documentIds.has(item.anchor.scope.slice(7).split(/[?#]/)[0])).map(item=>({file:rel,id:item.id,scope:item.anchor.scope})));
  const backup=path.join(backups,new Date().toISOString().replace(/[:.]/g,'-')+'-'+randomUUID().slice(0,8));await fs.mkdir(backup,{recursive:true});
  for(const [root,label] of [[source,'source'],[target,'target']])for(const rel of ['study-library',...records])await snapshot(path.join(root,rel),path.join(backup,label,rel));
  const report={source,target,backup,status:'backed-up',documents:old.nodes.filter(n=>n.kind==='document').length,addedThreads:counts[0],addedNotes:counts[1],conflicts,missingOrigins,files};
  await atomic(path.join(backup,'report.json'),report);
  for(const file of files){if(file.exists)continue;const dest=path.join(target,file.rel);await fs.mkdir(path.dirname(dest),{recursive:true});await fs.copyFile(path.join(source,file.rel),dest,constants.COPYFILE_EXCL);if(hash(await fs.readFile(dest))!==file.sha256)throw Error('Copied hash mismatch: '+file.rel);}
  // Idempotent: repeat runs do not replace or duplicate any existing records.
  for(const {rel,after} of merged)await atomic(path.join(target,rel),after);
  await atomic(path.join(target,index),[{...current,nodes,sources}]);
  report.status='complete';await atomic(path.join(backup,'report.json'),report);return report;
 }finally{for(const lock of locks.reverse()){await fs.unlink(path.join(lock,'owner.json')).catch(e=>{if(e.code!=='ENOENT')throw e;});await fs.rmdir(lock);}}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
 const [source,target,backups]=process.argv.slice(2);if(!source||!target||!backups)throw Error('Usage: node scripts/recover-study-data.mjs SOURCE TARGET BACKUPS');
 console.log(JSON.stringify(await recoverStudyData({source,target,backups}),null,2));
}
