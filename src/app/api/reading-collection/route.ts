import { randomUUID } from 'node:crypto';
import { validateAnchor } from '@/lib/reading-memory';
import { mutateTerms } from '@/lib/terms-store';
import { termKey, type Term } from '@/lib/terms';
import { mutateLocalArray, readLocalArray } from '@/lib/local-json';
import type { VocabularyEntry } from '@/lib/vocabulary';
export const runtime='nodejs';
export async function GET() {
  try{return Response.json({entries:await readLocalArray<VocabularyEntry>('vocabulary.json')},{headers:{'Cache-Control':'no-store'}});}
  catch{return Response.json({error:'生词本加载失败'},{status:500});}
}
export async function POST(request:Request) {
  try {
    const body=await request.json();
    if(body.action==='delete-word'&&typeof body.id==='string')return Response.json(await mutateLocalArray<VocabularyEntry,{ok:boolean}>('vocabulary.json',items=>{const i=items.findIndex(e=>e.id===body.id);if(i<0)throw Error('生词不存在');items.splice(i,1);return {ok:true};}));
    const anchor=validateAnchor(body.anchor);const text=anchor.text.trim();
    if(text.length>160)throw Error('请选择词语或简短术语（最多 160 字符）');
    if(typeof body.meaning!=='string'||!body.meaning.trim()||body.meaning.length>4000)throw Error('请先完成翻译，再收藏释义（最多 4000 字符）');
    const meaning=body.meaning.trim();
    if(body.kind==='term')return Response.json(await mutateTerms(items=>{
      let saved=items.find(t=>termKey(t.name)===termKey(text));
      if(!saved){saved={id:randomUUID(),name:text,role:'科研术语',status:'未接触',reuse:'通用',note:'',source:anchor.label,links:'',updatedAt:new Date().toISOString(),collection:'manual'} satisfies Term;items.push(saved);}
      saved.collection='manual';saved.updatedAt=new Date().toISOString();saved.excerpts??=[];saved.meaning ||= meaning;
      const previous=saved.excerpts.find(a=>a.scope===anchor.scope&&a.sourceKey===anchor.sourceKey&&a.start===anchor.start&&a.end===anchor.end);
      if(previous)previous.meaning=meaning;else saved.excerpts.push({...anchor,meaning});
      if(anchor.slug){saved.papers??=[];if(!saved.papers.some(p=>p.slug===anchor.slug))saved.papers.push({slug:anchor.slug,title:anchor.slug});}
      return {saved};
    }));
    if(body.kind!=='word'||!/[a-z]/i.test(text)||text.split(/\s+/).length>12)throw Error('请选择英文单词或短语');
    return Response.json(await mutateLocalArray<VocabularyEntry,{saved:VocabularyEntry}>('vocabulary.json',items=>{
      const old=items.find(e=>e.sourceAnchor?.scope===anchor.scope&&e.sourceAnchor.sourceKey===anchor.sourceKey&&e.sourceAnchor.start===anchor.start&&e.text===text);
      const saved:VocabularyEntry={id:old?.id??randomUUID(),slug:anchor.slug??'',docId:anchor.docId??'',page:anchor.page??0,text,context:anchor.context,meaning,lemma:old?.lemma??text,partOfSpeech:old?.partOfSpeech??'',usage:old?.usage??'',rects:anchor.rects??[],createdAt:old?.createdAt??new Date().toISOString(),sourceAnchor:anchor};
      if(old)items[items.indexOf(old)]=saved;else items.push(saved);return {saved};
    }));
  }catch(e){return Response.json({error:e instanceof Error?e.message:'收藏失败'},{status:400});}
}
