import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
const directory=await fs.mkdtemp(path.join(os.tmpdir(),'ra-paste-integrity-'));
process.env.RA_DATA_DIR=directory;
after(()=>fs.rm(directory,{recursive:true,force:true}));
const {POST}=await import('../src/app/api/study-library/import/route.ts');
const {mutateStudyTree,readStudyDocument,listStudyNodes}=await import('../src/lib/study-library.ts');
const {createdId}=await mutateStudyTree({action:'create',kind:'library',name:'粘贴完整性'});
const full=await fs.readFile(new URL('./fixtures/multivariate-pasted.md',import.meta.url),'utf8');
function request(content,expected=full){
 const form=new FormData();form.set('parentId',createdId);form.set('paths',JSON.stringify(['06.md']));
 form.set('integrity',JSON.stringify([{bytes:Buffer.byteLength(expected),sha256:createHash('sha256').update(expected).digest('hex')}]));
 form.append('files',new File([content],'06.md',{type:'text/markdown'}));
 return new Request('http://localhost/api/study-library/import',{method:'POST',body:form});
}
test('full supplied paste including control character survives multipart, storage and reload byte for byte',async()=>{
 const response=await POST(request(full));assert.equal(response.status,200);
 const result=await response.json(),doc=await readStudyDocument(result.documentIds[0]);
 assert.equal(doc.content,full);assert.ok(doc.content.endsWith('\n14\n'));assert.ok(doc.content.includes('多维随机变量的独立性及条件分布'));
});
test('a truncated or altered paste is rejected before committing a document',async()=>{
 const before=await listStudyNodes();
 for(const content of [full.slice(0,full.indexOf('\u0001')),full.replace('100 件','101 件')]){
  const response=await POST(request(content));assert.equal(response.status,400);assert.match((await response.json()).error,/完整|校验/);
 }
 assert.deepEqual(await listStudyNodes(),before);
});
