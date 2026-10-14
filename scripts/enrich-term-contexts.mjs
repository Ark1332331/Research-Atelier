// Reversible local upgrade: no model calls, no inferred comprehension.
import {promises as fs,writeFileSync} from 'node:fs';import path from 'node:path';
import {DATA_DIR} from '../src/lib/store.ts';
import {mutateTerms} from '../src/lib/terms-store.ts';
import {consolidateTerms} from '../src/lib/terms.ts';
const papers=[];
for(const slug of await fs.readdir(path.join(DATA_DIR,'papers'))){try{const dir=path.join(DATA_DIR,'papers',slug);const meta=JSON.parse(await fs.readFile(path.join(dir,'meta.json'),'utf8'));const files=(await fs.readdir(dir)).filter(f=>/^page_\d+\.txt$/.test(f)).sort();const pages=await Promise.all(files.map(f=>fs.readFile(path.join(dir,f),'utf8')));papers.push({slug,title:meta.title??slug,pages});}catch{/* Skip incomplete imports. */}}
const backupDir=path.join(DATA_DIR,'backups');await fs.mkdir(backupDir,{recursive:true});const backup=path.join(backupDir,`glossary-before-study-${Date.now()}.json`);
const result=await mutateTerms(items=>{
 writeFileSync(backup,JSON.stringify(items,null,2),{mode:0o600});const before=items.length;const merged=consolidateTerms(items);let added=0;
 for(const t of merged){for(const paper of papers){
  const associated=t.papers?.some(p=>p.slug===paper.slug)||(t.source??'').split('/')[0].trim().toLowerCase()===paper.title.trim().toLowerCase();if(!associated)continue;
  t.papers??=[];if(!t.papers.some(p=>p.slug===paper.slug))t.papers.push({slug:paper.slug,title:paper.title});
  t.contexts??=[];if(t.contexts.some(c=>c.slug===paper.slug))continue;
  const name=t.name.split('/')[0].trim();const pattern=new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&').replace(/\s+/g,'\\s+'),'i');let found;
  for(let i=0;i<paper.pages.length;i++){const m=pattern.exec(paper.pages[i]);if(m){found={page:i+1,quote:paper.pages[i].slice(Math.max(0,m.index-120),Math.min(paper.pages[i].length,m.index+m[0].length+200))};break;}}
  t.contexts.push({slug:paper.slug,title:paper.title,meaning:'',quote:found?.quote??'',...(found?{page:found.page,nextAction:`回到第 ${found.page} 页，说明这个概念在原句中的作用。`}:{})});added++;
 }}
 items.splice(0,items.length,...merged);return {before,after:items.length,contextsAdded:added,backup};
});console.log(JSON.stringify(result,null,2));
