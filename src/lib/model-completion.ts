import type {AnswerText} from './answer-stream.ts';
type ToolCall={id:string;type:'function';function:{name:string;arguments:string}};
export interface ModelCompletion {choices:{message:{role:'assistant';content:string;tool_calls?:ToolCall[]};finish_reason:string}[]}

/** OpenAI-compatible content and tool deltas, including frames split across UTF-8 chunks. */
export async function modelCompletion(response:Response,onText:AnswerText,signal:AbortSignal):Promise<ModelCompletion>{
  if(!response.ok){await response.body?.cancel();throw Error(`模型服务暂不可用（HTTP ${response.status}），请重试`);}
  if(!response.headers.get('content-type')?.includes('text/event-stream')){
    const data=await response.json();const choice=data?.choices?.[0];
    if(choice?.finish_reason==='length'||(!choice?.message?.content&&!choice?.message?.tool_calls?.length))throw Error('回答未完整生成，请重试');
    if(choice.message.content)onText(choice.message.content);return data;
  }
  if(!response.body)throw Error('模型未返回回答');
  const reader=response.body.getReader(),decoder=new TextDecoder('utf-8',{fatal:true});let buffer='',content='',finish='';const calls=new Map<number,ToolCall>();
  const abort=()=>{void reader.cancel().catch(()=>{});};signal.addEventListener('abort',abort,{once:true});
  try{
    while(true){
      signal.throwIfAborted();const {done,value}=await reader.read();signal.throwIfAborted();buffer+=done?decoder.decode():decoder.decode(value,{stream:true});
      if(buffer.length>1000000)throw Error('模型响应格式异常');
      let boundary:RegExpExecArray|null;
      while((boundary=/\r\n\r\n|\n\n|\r\r/.exec(buffer))){
        const block=buffer.slice(0,boundary.index);buffer=buffer.slice(boundary.index+boundary[0].length);
        const data=block.split(/\r\n|\n|\r/).filter(line=>line.startsWith('data:')).map(line=>line.slice(5).trimStart()).join('\n');if(!data.trim())continue;
        if(data.trim()==='[DONE]'){
          if(!['stop','tool_calls'].includes(finish)||(!content.trim()&&!calls.size))throw Error('回答未完整生成，请重试');
          const toolCalls=[...calls.entries()].sort(([a],[b])=>a-b).map(([,call])=>call);
          if(toolCalls.some(call=>!call.id||!call.function.name))throw Error('工具调用不完整');
          return {choices:[{message:{role:'assistant',content,...(toolCalls.length?{tool_calls:toolCalls}:{})},finish_reason:finish}]};
        }
        const payload=JSON.parse(data);if(payload.error||!Array.isArray(payload.choices))throw Error('模型响应异常');
        const choice=payload.choices[0];if(!choice)continue;
        if(choice.finish_reason){finish=choice.finish_reason;if(!['stop','tool_calls'].includes(finish))throw Error('回答未完整生成，请重试');}
        const delta=choice.delta;
        if(typeof delta?.content==='string'){content+=delta.content;onText(content);}
        for(const part of delta?.tool_calls??[]){
          if(!Number.isSafeInteger(part.index)||part.index<0||part.index>32)throw Error('工具调用格式异常');
          const call=calls.get(part.index)??{id:'',type:'function',function:{name:'',arguments:''}};
          if(part.id)call.id+=part.id;if(part.function?.name)call.function.name+=part.function.name;if(part.function?.arguments)call.function.arguments+=part.function.arguments;
          if(call.function.arguments.length>1000000)throw Error('工具参数过长');calls.set(part.index,call);
        }
      }
      if(done)throw Error('回答连接提前结束，请重试');
    }
  }finally{signal.removeEventListener('abort',abort);await reader.cancel().catch(()=>{});reader.releaseLock();}
}
