import { withToolObservation } from "@/lib/learning/tool-observation";
import { promises as fs } from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { DATA_DIR } from "@/lib/store";
import { mutateLocalArray, readLocalArray } from "@/lib/local-json";
import { studyJson, modelText } from "@/lib/study-model";
import { validateRects, type VocabularyEntry } from "@/lib/vocabulary";
export const runtime="nodejs";
async function paperIdentity(slug:unknown) {
  if(typeof slug!=="string"||!/^[\p{L}\p{N}_.-]{1,180}$/u.test(slug)||slug==="."||slug==="..") throw Error("论文标识无效");
  const bytes=await fs.readFile(path.join(DATA_DIR,"papers",slug,"original.pdf")); return {slug,docId:createHash("sha256").update(bytes).digest("hex")};
}
export async function GET(request:Request) {
  try {const {slug,docId}=await paperIdentity(new URL(request.url).searchParams.get("slug"));const entries=(await readLocalArray<VocabularyEntry>("vocabulary.json")).filter(e=>e.slug===slug&&e.docId===docId);return Response.json({entries,docId},{headers:{"Cache-Control":"no-store"}});}
  catch(e){return Response.json({error:e instanceof Error?e.message:String(e)},{status:400});}
}
async function observedPOST(request:Request) {
  try {
    const body=await request.json();const {slug,docId}=await paperIdentity(body.slug);
    if(body.docId!==docId)return Response.json({error:"论文文件已变化，请刷新后重新选词"},{status:409});
    if(body.action==="delete")return Response.json(await mutateLocalArray<VocabularyEntry,{entries:VocabularyEntry[]}>("vocabulary.json",items=>{const i=items.findIndex(e=>e.id===body.id&&e.slug===slug&&e.docId===docId);if(i<0)throw Error("标注不存在");items.splice(i,1);return {entries:items.filter(e=>e.slug===slug&&e.docId===docId)};}));
    if(body.action!=="translate")throw Error("操作无效");
    if(typeof body.text!=="string"||!body.text.trim()||body.text.length>160||!/[a-z]/i.test(body.text)||!Number.isInteger(body.page)||body.page<1||body.page>10000)throw Error("请选择英文单词或短语（最多 160 字符）");
    const rects=validateRects(body.rects);const text=body.text.trim();const context=typeof body.context==="string"?body.context.slice(0,1600):"";
    const d=await studyJson('作为论文阅读英语助手，解释所选词在提供句子中的意思。不要把词汇翻译当作学科概念卡。返回 {"meaning":"当前语境最贴切的简短中文释义","lemma":"词典原形","partOfSpeech":"词性中文或缩写","usage":"一句中文说明该词在原句里的用法"}。只给有关的释义，不堆全部义项；语境不足须明确说明。', {selected:text,context});
    const translated={meaning:modelText(d,"meaning",800),lemma:modelText(d,"lemma",200),partOfSpeech:modelText(d,"partOfSpeech",100),usage:modelText(d,"usage",1000)};
    // File replacement during a model call must not attach annotations to a new PDF.
    if((await paperIdentity(slug)).docId!==docId)return Response.json({error:"翻译期间论文已变化，请刷新后重试"},{status:409});
    return Response.json(await mutateLocalArray<VocabularyEntry,{entries:VocabularyEntry[];saved:VocabularyEntry}>("vocabulary.json",items=>{
      const existing=items.find(e=>e.slug===slug&&e.docId===docId&&e.page===body.page&&e.text===text&&Math.abs(e.rects[0].x-rects[0].x)<.002&&Math.abs(e.rects[0].y-rects[0].y)<.002);
      const saved:VocabularyEntry={id:existing?.id??randomUUID(),slug,docId,page:body.page,text,context,...translated,rects,createdAt:existing?.createdAt??new Date().toISOString()};
      if(existing)items[items.indexOf(existing)]=saved;else items.push(saved);return {entries:items.filter(e=>e.slug===slug&&e.docId===docId),saved};
    }));
  }catch(e){return Response.json({error:e instanceof Error?e.message:String(e)},{status:400});}
}

export const POST=withToolObservation({source:"论文选词翻译",scene:"paper",conversation:false},observedPOST);
