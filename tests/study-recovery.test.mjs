import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {recoverStudyData} from '../scripts/recover-study-data.mjs';

test('recovery backs up both stores, preserves current records and IDs, and can safely repeat', async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'ra-recovery-'));const source=path.join(dir,'old'),target=path.join(dir,'current'),backups=path.join(dir,'backups');
 const write=async(root,rel,data)=>{const file=path.join(root,rel);await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,typeof data==='string'?data:JSON.stringify(data));};
 const id='11111111-1111-4111-8111-111111111111',importId='22222222-2222-4222-8222-222222222222',content='# 原文';
 try{
  await write(source,`study-library/imports/${importId}/${id}`,content);
  await write(source,'study-library/index.json',[{version:1,nodes:[{id,kind:'document',name:'旧文档.md',parentId:null}],sources:[{id,importId,mime:'text/markdown',sha256:createHash('sha256').update(content).digest('hex')}]}]);
  await write(source,'reading-memory.json',[{id:'same',messages:['old']},{id:'old',anchor:{scope:'/study/'+id}}]);
  await write(target,'reading-memory.json',[{id:'same',messages:['current']},{id:'new',messages:['keep']}]);
  await write(source,'reading-notes.json',[{id:'note',comment:'保留批注',anchor:{scope:'/study/missing'}}]);
  const before=await fs.readFile(path.join(target,'reading-memory.json'),'utf8');
  const result=await recoverStudyData({source,target,backups});
  assert.equal(result.documents,1);assert.equal(result.conflicts.length,1);assert.equal(result.missingOrigins.length,1);
  assert.equal(await fs.readFile(path.join(result.backup,'target/reading-memory.json'),'utf8'),before);
  assert.equal(await fs.readFile(path.join(result.backup,'source/study-library/imports',importId,id),'utf8'),content);
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(target,'reading-memory.json'),'utf8')),[{id:'same',messages:['current']},{id:'new',messages:['keep']},{id:'old',anchor:{scope:'/study/'+id}}]);
  const repeated=await recoverStudyData({source,target,backups});assert.equal(repeated.addedThreads,0);assert.equal(repeated.addedNotes,0);
  await write(source,`study-library/imports/${importId}/${id}`,'corrupt');
  const current=await fs.readFile(path.join(target,'reading-memory.json'),'utf8');
  await assert.rejects(recoverStudyData({source,target,backups}),/hash/i);
  assert.equal(await fs.readFile(path.join(target,'reading-memory.json'),'utf8'),current);
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});
