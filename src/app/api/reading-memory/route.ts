import {configuredModelKey,fetchModel} from '../../../lib/model-config.ts';
import { randomUUID, createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from '@/lib/store';
import { mutateLocalArray, readLocalArray } from '@/lib/local-json';
import { validateAnchor, buildReadingMessages, type ReadingThread, type ReadingAnchor } from '@/lib/reading-memory';
import { prepareLearning, finishLearning, readLearning, type PreparedLearning } from '@/lib/learning/store';
import { observeConversation } from '@/lib/learning/extract';
import { listProjects } from '@/lib/project';
import {answerResponse,type AnswerText} from '@/lib/answer-stream';
import {modelCompletion} from '@/lib/model-completion';
import {watchAnswerProgress} from '@/lib/answer-deadline';
export const runtime = 'nodejs';
const FILE = 'reading-memory.json';
async function verifyDocument(anchor: ReadingAnchor) {
  if (!anchor.docId) return;
  if (!anchor.slug) throw Error('缺少论文标识');
  const bytes = await fs.readFile(path.join(DATA_DIR,'papers',anchor.slug,'original.pdf'));
  if (createHash('sha256').update(bytes).digest('hex') !== anchor.docId) throw Error('论文文件已变化，请刷新后重新选择');
}
export async function GET() {
  try {
    const threads=await readLocalArray<ReadingThread>(FILE);
    const state=await readLearning().catch(()=>null);
    for(const thread of threads) for(const m of thread.messages) {
      const run=state?.runs.find(r=>r.id===m.learningRunId);
      if(run)m.learning={runId:run.id,observationId:state?.observations?.find(o=>o.traceId===run.id)?.id,selected:run.selected,profile:run.profile,proposedIds:[]};
    }
    return Response.json({threads},{headers:{'Cache-Control':'no-store'}});
  }
  catch { return Response.json({error:'阅读记忆加载失败，请重试'},{status:500}); }
}
export function POST(request:Request){return answerResponse(request,request.headers.get('accept')?.includes('application/x-ndjson')??false,(text,signal)=>handle(request,text,signal));}
async function handle(request: Request,onText?:AnswerText,signal=request.signal) {
  let learning: PreparedLearning | undefined;
  let deadline:ReturnType<typeof watchAnswerProgress>|undefined;
  try {
    const body = await request.json();
    if (body.action === 'create') {
      const anchor = validateAnchor(body.anchor); await verifyDocument(anchor);
      return Response.json(await mutateLocalArray<ReadingThread,{thread:ReadingThread}>(FILE, items => {
        const existing=items.find(t=>t.anchor.scope===anchor.scope&&t.anchor.sourceKey===anchor.sourceKey&&t.anchor.start===anchor.start&&t.anchor.end===anchor.end&&t.anchor.text===anchor.text);
        if(existing)return {thread:existing};
        const thread:ReadingThread={id:randomUUID(),anchor,messages:[],createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()};items.push(thread);return {thread};
      }));
    }
    if (typeof body.id !== 'string') throw Error('追问不存在');
    if (body.action === 'delete') return Response.json(await mutateLocalArray<ReadingThread,{ok:boolean}>(FILE,items=>{const index=items.findIndex(t=>t.id===body.id);if(index<0)throw Error('追问不存在');items.splice(index,1);return {ok:true};}));
    if (body.action !== 'ask' || typeof body.question !== 'string' || !body.question.trim() || body.question.length > 5000) throw Error('请输入问题（最多 5000 字符）');
    const thread=(await readLocalArray<ReadingThread>(FILE)).find(t=>t.id===body.id);
    if(!thread)throw Error('追问不存在');
    if(body.revision!==thread.messages.length)return Response.json({error:'对话已更新，请重新打开后继续'},{status:409});
    await verifyDocument(thread.anchor);
    const key=await configuredModelKey();if(!key)throw Error('尚未配置模型密钥');
    const projectId=thread.anchor.slug?(await listProjects()).find(p=>p.paperSlug===thread.anchor.slug)?.id??null:null;
    learning=await prepareLearning(body.question.trim(),'paper',projectId,true,thread.anchor.slug??thread.id);
    const note=await observeConversation(learning,thread.messages,'划线追问',thread.anchor.slug??thread.id);
    const messages=buildReadingMessages(thread,body.question.trim());messages[0].content+=learning.prompt;
    const timeout=new AbortController();deadline=watchAnswerProgress(timeout);
    const upstream=AbortSignal.any([signal,timeout.signal]);
    const response=await fetchModel({method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${key}`},signal:upstream,body:JSON.stringify({model:'deepseek-chat',stream:!!onText,temperature:0.3,max_tokens:3000,messages})});
    const data=onText?await modelCompletion(response,value=>{deadline!.progress(value);onText(value);},upstream):await response.json();const answer=data?.choices?.[0]?.message?.content;
    deadline.dispose();
    if(!response.ok || typeof answer!=='string' || !answer.trim() || data?.choices?.[0]?.finish_reason === 'length')throw Error('回答未完整生成，请重试；已保存的对话不受影响');
    await verifyDocument(thread.anchor);
    signal.throwIfAborted();
    const result=await mutateLocalArray<ReadingThread,{thread:ReadingThread}>(FILE,items=>{
      const current=items.find(t=>t.id===thread.id);if(!current)throw Error('追问已被删除');
      if(current.messages.length!==body.revision)throw Error('对话已更新，请重新打开后继续');
      current.messages.push({role:'user',content:body.question.trim()},{role:'assistant',content:answer,learningRunId:learning!.id});current.updatedAt=new Date().toISOString();return {thread:current};
    });
    const run=await finishLearning(learning,answer);
    if(run)result.thread.messages.at(-1)!.learning={runId:learning.id,observationId:learning.observationId,selected:learning.selected,profile:learning.profile,proposedIds:learning.proposedIds,note};
    return Response.json(result);
  } catch(e) { if(learning)await finishLearning(learning,'',e instanceof Error?e.message:'追问失败').catch(()=>{});return Response.json({error:e instanceof Error?e.message:'追问失败，请重试'},{status:400}); }
  finally{deadline?.dispose();}
}
