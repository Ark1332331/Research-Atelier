import {ModelConfigError,readPublicModelConfigs,mutateModelConfigs,testModelConfig} from '@/lib/model-config';
export const runtime='nodejs';
const headers={'Cache-Control':'no-store'};
export async function GET(){try{return Response.json(await readPublicModelConfigs(),{headers});}catch{return Response.json({error:'模型配置读取失败，请检查数据目录'},{status:500,headers});}}
export async function POST(request:Request){
 const origin=request.headers.get('origin');if(origin&&origin!==new URL(request.url).origin)return Response.json({error:'不允许跨站修改模型配置'},{status:403,headers});
 try{
  if(Number(request.headers.get('content-length'))>16000)throw new ModelConfigError('配置内容过长');
  const text=await request.text();if(text.length>16000)throw new ModelConfigError('配置内容过长');
  const body=JSON.parse(text);if(!body||typeof body!=='object'||Array.isArray(body))throw new ModelConfigError('请求格式无效');
  return Response.json(body.action==='test'?await testModelConfig(body):await mutateModelConfigs(body),{headers});
 }catch(error){return Response.json({error:error instanceof ModelConfigError?error.message:error instanceof SyntaxError?'请求格式无效':'配置操作失败，请重试'},{status:400,headers});}
}
