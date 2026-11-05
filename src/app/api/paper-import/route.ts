import {newImportSession,readImportSession,listImportSessions,sendImportMessage,actOnImportItem,retryPendingImports,ImportBusyError} from '@/lib/paper-import';
export const runtime='nodejs';
export async function GET(request:Request){
  try{const params=new URL(request.url).searchParams;return Response.json(params.get('list')==='1'?{sessions:await listImportSessions()}:{session:await readImportSession(params.get('sessionId')??undefined)},{headers:{'Cache-Control':'no-store'}});}
  catch(e){return Response.json({error:e instanceof Error?e.message:'导入记录读取失败'},{status:500});}
}
export async function POST(request:Request){
  try{
    const b=await request.json();if(!b||typeof b!=='object')throw Error('请求无效');
    if(b.action==='new')return Response.json({session:await newImportSession()});
    if(typeof b.sessionId!=='string')throw Error('请先打开导入对话');
    if(b.action==='retry_pending')return Response.json({session:await retryPendingImports(b.sessionId)});
    if(b.action==='message'){
      if(typeof b.message!=='string'||typeof b.requestId!=='string')throw Error('请输入导入要求');
      return Response.json({session:await sendImportMessage(b.sessionId,b.message,b.requestId)});
    }
    if(b.action==='choose'||b.action==='retry'){
      if(typeof b.itemId!=='string'||b.action==='choose'&&typeof b.candidateId!=='string')throw Error('请选择具体论文');
      return Response.json({session:await actOnImportItem(b.sessionId,b.itemId,b.action==='choose'?b.candidateId:undefined)});
    }
    throw Error('不支持的导入操作');
  }catch(e){return Response.json({error:e instanceof Error?e.message:'导入请求失败'},{status:e instanceof ImportBusyError?409:400});}
}
