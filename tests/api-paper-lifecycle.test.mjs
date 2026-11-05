import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {promises as fs} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
const dir=await fs.mkdtemp(path.join(os.tmpdir(),'ra-paper-api-'));process.env.RA_DATA_DIR=dir;
process.env.DEEPSEEK_API_KEY='';
const realFetch=globalThis.fetch;
const fixture=await fs.readFile('public/papers/nsr.pdf');
globalThis.fetch=async()=>new Response(fixture,{headers:{'Content-Type':'application/pdf'}});
const {POST:paperPost,GET:paperGet}=await import('../src/app/api/paper/route.ts');
const {POST:projectPost}=await import('../src/app/api/projects/route.ts');
const {POST:libraryPost}=await import('../src/app/api/library/route.ts');
const {createProject,getProject}=await import('../src/lib/project.ts');
const {downloadPaper}=await import('../src/lib/paper-tools.ts');
const request=(body)=>new Request('http://localhost/api/paper',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
after(async()=>{globalThis.fetch=realFetch;await fs.rm(dir,{recursive:true,force:true});});
test('actual upload repairs a missing PDF, repeated upload/download reuses it, and API rename/delete stay consistent',async()=>{
  const missing='lost-original';await fs.mkdir(path.join(dir,'papers',missing),{recursive:true});
  await fs.writeFile(path.join(dir,'papers',missing,'meta.json'),JSON.stringify({slug:missing,title:'旧论文',sha256:createHash('sha256').update(fixture).digest('hex')}));
  const legacy=await createProject({title:'旧笔记',paperSlug:missing,notes:[{id:'note',projectId:'legacy',title:'保留笔记',content:'research',tags:[]}]});
  const upload=async(projectId)=>{const form=new FormData();form.append('file',new File([fixture],'paper.pdf',{type:'application/pdf'}));if(projectId)form.append('projectId',projectId);return paperPost(new Request('http://localhost/api/paper',{method:'POST',body:form}));};
  const response=await upload(legacy.id);assert.equal(response.status,200);const imported=await response.json();
  assert.equal(imported.project.id,legacy.id);assert.equal(imported.project.notes[0].content,'research');assert.ok(await fs.stat(path.join(dir,'papers',imported.meta.slug,'original.pdf')));
  // Await background no-key translation result before fixture cleanup.
  for(let i=0;i<100;i++){if(await fs.stat(path.join(dir,'papers',imported.meta.slug,'translation.error.txt')).then(()=>true).catch(()=>false))break;await new Promise(r=>setTimeout(r,10));}
  assert.equal((await projectPost(request({action:'rename',id:legacy.id,title:'统一名称'}))).status,200);
  const duplicate=await (await upload()).json();assert.equal(duplicate.duplicate,true);assert.equal(duplicate.project.id,legacy.id);assert.equal(duplicate.title,'统一名称');
  const downloaded=await downloadPaper({pdfUrl:'https://fixture.invalid/paper.pdf',title:'another filename'});assert.equal(downloaded.imported,false);assert.equal(downloaded.slug,imported.meta.slug);assert.equal(downloaded.title,'统一名称');
  const listed=await (await paperGet(new Request('http://localhost/api/paper'))).json();assert.equal(listed.papers.length,1);assert.equal(listed.papers[0].projectId,legacy.id);
  const library=JSON.parse(await fs.readFile(path.join(dir,'library.json'),'utf8'));assert.equal(library.papers.length,1);assert.equal(library.papers[0].title,'统一名称');
  assert.equal((await libraryPost(request({action:'deletePaper',id:library.papers[0].id}))).status,200);
  assert.equal(await getProject(legacy.id),null);await assert.rejects(fs.stat(path.join(dir,'papers',imported.meta.slug)));
  assert.equal((await (await paperGet(new Request('http://localhost/api/paper'))).json()).papers.length,0);
});
