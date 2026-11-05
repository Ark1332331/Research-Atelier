import {promises as fs} from 'node:fs';
import path from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {DATA_DIR,readStore,writeStore} from '@/lib/store';
import {attachPaperToProject,ensureProjectForPaper,deleteProject,getProject,listProjects,removeProjectsForPaper,renameProjectsForPaper} from '@/lib/project';
import {withProjectLock} from '@/lib/project-lock';

export function paperDirectory(slug:unknown):string {
  if(typeof slug!=='string'||!/^[\p{L}\p{N}_.-]{1,180}$/u.test(slug)||slug==='.'||slug==='..')throw Error('论文标识无效');
  const root=path.resolve(DATA_DIR,'papers'),target=path.resolve(root,slug);
  if(path.dirname(target)!==root)throw Error('论文目录无效');return target;
}
export interface ManagedPaper { slug:string;title:string;pages:number;importedAt:string;sha256?:string }

/** Never consider metadata without a PDF a successful prior import. */
export async function findPaperByHash(hash:string):Promise<ManagedPaper|null> {
  const root=path.join(DATA_DIR,'papers');
  const dirs=await fs.readdir(root).catch((e:NodeJS.ErrnoException)=>{if(e.code==='ENOENT')return [];throw e;});
  for(const slug of dirs){
    try {
      const dir=paperDirectory(slug),meta:ManagedPaper=JSON.parse(await fs.readFile(path.join(dir,'meta.json'),'utf8'));
      if(!(await fs.stat(path.join(dir,'original.pdf'))).isFile())continue;
      const existingHash=meta.sha256||createHash('sha256').update(await fs.readFile(path.join(dir,'original.pdf'))).digest('hex');
      if(existingHash===hash)return {...meta,slug};
    }catch{/* incomplete imports cannot be selected */}
  }
  return null;
}

/** Used by uploads and downloads inside the same reentrant lifecycle lock. */
export async function registerPaper(meta:ManagedPaper,projectId?:string) {
  return withProjectLock(async()=>{
    const raw=await readStore('library.json');const lib=raw?JSON.parse(raw):{groups:[],papers:[]};
    if(!Array.isArray(lib.papers)||!Array.isArray(lib.groups))throw Error('论文库记录格式异常，未覆盖原文件');
    const projects=await listProjects();
    const target=projectId?projects.find(p=>p.id===projectId):undefined;
    if(projectId&&!target)throw Error('目标项目不存在');
    if(target?.paperSlug&&target.paperSlug!==meta.slug){
      const existing=await fs.stat(path.join(paperDirectory(target.paperSlug),'original.pdf')).catch(()=>null);
      if(existing)throw Error('这个项目已有 PDF');
      lib.papers=lib.papers.filter((p:{slug?:string})=>p.slug!==target.paperSlug);
    }
    if(target&&projects.some(p=>p.id!==target.id&&p.paperSlug===meta.slug))throw Error('这份 PDF 已有论文项目，请从论文库打开已有项目；当前笔记仍保留在这里。');
    if(!lib.papers.some((p:{slug?:string})=>p.slug===meta.slug))lib.papers.push({id:`p-${randomUUID()}`,slug:meta.slug,title:meta.title,source:'imported',status:'未读',group:null,current:false,firstEncounter:meta.importedAt.slice(0,10),lastEngaged:''});
    try{
      await writeStore('library.json',JSON.stringify(lib,null,2));
      const project=projectId?await attachPaperToProject(projectId,meta):await ensureProjectForPaper(meta);
      if(!project)throw Error('目标项目不存在');return project;
    }catch(error){await writeStore('library.json',raw??JSON.stringify({groups:[],papers:[]}));throw error;}
  });
}

/** Older imports may have a PDF and library record but no project yet. */
export async function reconcilePaperProjects() {
  return withProjectLock(async()=>{
    const projects=await listProjects();const known=new Set(projects.map(p=>p.paperSlug));
    const root=path.join(DATA_DIR,'papers');
    const dirs=await fs.readdir(root).catch((e:NodeJS.ErrnoException)=>{if(e.code==='ENOENT')return [];throw e;});
    for(const slug of dirs){
      if(known.has(slug))continue;
      let meta:ManagedPaper;
      try{const dir=paperDirectory(slug);if(!(await fs.stat(path.join(dir,'original.pdf'))).isFile())continue;meta=JSON.parse(await fs.readFile(path.join(dir,'meta.json'),'utf8'));if(typeof meta.title!=='string')continue;}
      catch{continue;}
      await registerPaper({...meta,slug,importedAt:meta.importedAt||new Date().toISOString()});known.add(slug);
    }
  });
}
/** A paper and its project disappear together. Independently saved vocabulary/terms remain. */
export async function removePaper(slug:string):Promise<{ok:true;removedProjectIds:string[]}>{
  return withProjectLock(async()=>{
    const dir=paperDirectory(slug);
    const raw=await readStore('library.json');const library=raw?JSON.parse(raw):null;
    if(library&&(!Array.isArray(library.papers)||!Array.isArray(library.groups)))throw Error('论文库记录格式异常，未删除文件');
    // Validate all metadata before touching files, including malformed project records.
    await listProjects();
    const stat=await fs.lstat(dir).catch((e:NodeJS.ErrnoException)=>{if(e.code==='ENOENT')return null;throw e;});
    if(stat?.isSymbolicLink()||stat&&!stat.isDirectory())throw Error('论文目录类型异常，未删除文件');
    const trash=path.resolve(DATA_DIR,'.paper-trash',randomUUID());let moved=false;
    if(stat){const realRoot=await fs.realpath(path.dirname(dir));if(path.dirname(await fs.realpath(dir))!==realRoot)throw Error('论文目录超出资料库');await fs.mkdir(path.dirname(trash),{recursive:true});await fs.rename(dir,trash);moved=true;}
    try{
      if(library){library.papers=library.papers.filter((p:{slug?:string})=>p.slug!==slug);await writeStore('library.json',JSON.stringify(library,null,2));}
      const removedProjectIds=await removeProjectsForPaper(slug);
      // Files in trash cannot appear in the reader; cleanup failure does not resurrect metadata.
      if(moved)await fs.rm(trash,{recursive:true,force:true}).catch(()=>{});
      return {ok:true,removedProjectIds};
    }catch(e){if(raw)await writeStore('library.json',raw);if(moved)await fs.rename(trash,dir);throw e;}
  });
}
export async function removePaperProject(id:string):Promise<boolean>{
  return withProjectLock(async()=>{
    const project=await getProject(id);if(!project)return false;
    if(project.paperSlug){await removePaper(project.paperSlug);return true;}
    return deleteProject(id); // Explicit removal of a legacy project with no PDF.
  });
}
export async function renamePaper(slug:string,value:unknown):Promise<{title:string}>{
  if(typeof value!=='string'||!value.trim()||value.trim().length>200)throw Error('论文名称须为 1–200 个字符');
  const title=value.trim();
  return withProjectLock(async()=>{
    const dir=paperDirectory(slug),metaFile=path.join(dir,'meta.json');const oldMeta=await fs.readFile(metaFile,'utf8');const meta=JSON.parse(oldMeta);
    const oldLibrary=await readStore('library.json');const library=oldLibrary?JSON.parse(oldLibrary):null;
    if(library&&!Array.isArray(library.papers))throw Error('论文库记录格式异常');await listProjects();
    const temp=path.join(dir,`meta.${randomUUID()}.tmp`);
    try{await fs.writeFile(temp,JSON.stringify({...meta,title},null,2));await fs.rename(temp,metaFile);
      if(library){for(const paper of library.papers)if(paper.slug===slug)paper.title=title;await writeStore('library.json',JSON.stringify(library,null,2));}
      await renameProjectsForPaper(slug,title);return {title};
    }catch(e){await fs.writeFile(metaFile,oldMeta);if(oldLibrary)await writeStore('library.json',oldLibrary);throw e;}
    finally{await fs.rm(temp,{force:true});}
  });
}
