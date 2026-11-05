import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {promises as fs} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const dir=await fs.mkdtemp(path.join(os.tmpdir(),'ra-paper-management-'));process.env.RA_DATA_DIR=dir;
const {removePaper,removePaperProject,renamePaper,registerPaper,findPaperByHash,reconcilePaperProjects}=await import('../src/lib/paper-management.ts');
const {createProject,getProject,updateProject}=await import('../src/lib/project.ts');
const {POST:libraryPost}=await import('../src/app/api/library/route.ts');
const paper=async slug=>{await fs.mkdir(path.join(dir,'papers',slug),{recursive:true});await fs.writeFile(path.join(dir,'papers',slug,'original.pdf'),'fixture');await fs.writeFile(path.join(dir,'papers',slug,'meta.json'),JSON.stringify({slug,title:slug,sha256:'same-hash'}));await fs.writeFile(path.join(dir,'library.json'),JSON.stringify({groups:[],papers:[{id:'legacy',slug,title:slug}]}));};
after(()=>fs.rm(dir,{recursive:true,force:true}));
test('deleting a paper removes PDF and all linked projects while keeping independent collections',async()=>{
  await paper('shared');const a=await createProject({title:'A',paperSlug:'shared'}),b=await createProject({title:'B',paperSlug:'shared'});
  await updateProject(a.id,p=>{p.notes.push({id:'note',projectId:a.id,title:'保留',content:'我的研究',tags:[]});});
  await fs.writeFile(path.join(dir,'glossary.json'),'[{"name":"retain"}]');
  await removePaper('shared');assert.equal(await getProject(a.id),null);assert.equal(await getProject(b.id),null);
  assert.equal(JSON.parse(await fs.readFile(path.join(dir,'library.json'),'utf8')).papers.length,0);assert.equal(await fs.readFile(path.join(dir,'glossary.json'),'utf8'),'[{"name":"retain"}]');
  await assert.rejects(fs.stat(path.join(dir,'papers','shared')));
  await removePaper('shared');
});
test('deleting from projects removes the same paper entity and legacy duplicate links',async()=>{
  await paper('two');const a=await createProject({title:'one',paperSlug:'two'}),b=await createProject({title:'two',paperSlug:'two'});
  await removePaperProject(a.id);assert.equal(await getProject(a.id),null);assert.equal(await getProject(b.id),null);await assert.rejects(fs.stat(path.join(dir,'papers','two')));
  assert.equal(await removePaperProject(b.id),false);
});
test('rename synchronizes all titles without changing identity, PDF, notes or highlighters',async()=>{
  await paper('rename');const a=await createProject({title:'old',paperSlug:'rename'});
  await fs.writeFile(path.join(dir,'papers','rename','reading-memory.json'),'preserve');
  await renamePaper('rename','  新的论文名  ');
  assert.equal((await getProject(a.id)).title,'新的论文名');assert.equal((await getProject(a.id)).paperSlug,'rename');
  const meta=JSON.parse(await fs.readFile(path.join(dir,'papers','rename','meta.json'),'utf8'));assert.equal(meta.title,'新的论文名');assert.equal(meta.sha256,'same-hash');
  assert.equal(JSON.parse(await fs.readFile(path.join(dir,'library.json'),'utf8')).papers[0].title,'新的论文名');
  assert.equal(await fs.readFile(path.join(dir,'papers','rename','reading-memory.json'),'utf8'),'preserve');
  for(const title of ['',null,'x'.repeat(201)])await assert.rejects(renamePaper('rename',title));
});
test('invalid slugs and corrupt metadata never trigger recursive deletion',async()=>{
  for(const slug of ['..','../outside','a/b','C:\\Users','.',null])await assert.rejects(removePaper(slug));
  await paper('safe');await fs.writeFile(path.join(dir,'library.json'),'broken');await assert.rejects(removePaper('safe'));assert.ok(await fs.stat(path.join(dir,'papers','safe','original.pdf')));
});
test('library rename normalizes all duplicate titles and preserves metadata edits',async()=>{
  await paper('library-rename');const p=await createProject({title:'old',paperSlug:'library-rename'});
  await fs.writeFile(path.join(dir,'library.json'),JSON.stringify({groups:[],papers:[{id:'a',slug:'library-rename',title:'old'},{id:'b',slug:'library-rename',title:'old'}]}));
  const res=await libraryPost(new Request('http://localhost/api/library',{method:'POST',body:JSON.stringify({action:'updatePaper',id:'a',patch:{title:'  New title  ',status:'在读'}})}));
  assert.equal(res.status,200);const data=await res.json();assert.deepEqual(data.papers.map(p=>p.title),['New title','New title']);assert.equal(data.papers[0].status,'在读');assert.equal((await getProject(p.id)).title,'New title');
});
test('a PDF missing from disk is not a duplicate; legacy project can be repaired without losing notes',async()=>{
  await paper('missing');await fs.writeFile(path.join(dir,'papers','missing','meta.json'),JSON.stringify({slug:'missing',title:'missing',sha256:'repair-hash'}));await fs.rm(path.join(dir,'papers','missing','original.pdf'));
  const p=await createProject({title:'legacy',paperSlug:'missing'});await updateProject(p.id,item=>{item.notes.push({id:'note',projectId:p.id,title:'note',content:'retained',tags:[]});});
  assert.equal(await findPaperByHash('repair-hash'),null);
  await paper('repaired');const meta=JSON.parse(await fs.readFile(path.join(dir,'papers','repaired','meta.json'),'utf8'));
  await fs.writeFile(path.join(dir,'papers','repaired','meta.json'),JSON.stringify({...meta,sha256:'repair-hash'}));
  const updated=await registerPaper({...meta,sha256:'repair-hash',importedAt:'2026-10-23'},p.id);
  assert.equal(updated.paperSlug,'repaired');assert.equal(updated.notes[0].content,'retained');
  assert.equal((await findPaperByHash('repair-hash')).slug,'repaired');
});
test('older standalone PDFs acquire exactly one project and duplicate imports reuse it',async()=>{
  await paper('orphan');await reconcilePaperProjects();
  const meta={slug:'orphan',title:'orphan',pages:1,importedAt:'2026-10-23'};
  const first=await registerPaper(meta),second=await registerPaper(meta);assert.equal(first.id,second.id);
  const legacy=await createProject({title:'other notes'});await assert.rejects(registerPaper(meta,legacy.id));assert.equal((await getProject(legacy.id)).paperSlug,undefined);
});
