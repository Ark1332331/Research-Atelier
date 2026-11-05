export type AnswerText = (text:string)=>void;

/** Keep the existing terminal JSON contract; emit provisional text until it is committed. */
export function answerResponse(request:Request,stream:boolean,run:(text:AnswerText|undefined,signal:AbortSignal)=>Promise<Response>):Promise<Response>|Response {
  if(!stream)return run(undefined,request.signal);
  const abort=new AbortController();let cancelled=false;
  const cancel=()=>abort.abort();request.signal.addEventListener('abort',cancel,{once:true});if(request.signal.aborted)cancel();
  const encoder=new TextEncoder();
  return new Response(new ReadableStream<Uint8Array>({
    async start(controller){
      let previous='';
      const emit=(event:object)=>{if(!cancelled)controller.enqueue(encoder.encode(JSON.stringify(event)+'\n'));};
      try{
        const response=await run(text=>{if(text.startsWith(previous))emit({delta:text.slice(previous.length)});else emit({text});previous=text;},abort.signal);
        const result=await response.json();
        if(!response.ok||result.error)emit({error:result.error||'回答失败，请重试'});else emit({done:true,result});
      }catch{emit({error:abort.signal.aborted?'回答已中断，请重试':'回答未能完整完成，请重试'});}
      finally{request.signal.removeEventListener('abort',cancel);if(!cancelled)controller.close();}
    },
    cancel(){cancelled=true;abort.abort();request.signal.removeEventListener('abort',cancel);},
  }),{headers:{'Content-Type':'application/x-ndjson; charset=utf-8','Cache-Control':'no-store','X-Accel-Buffering':'no'}});
}

/** Only a terminal event counts as success. Never save a truncated stream as a completed turn. */
export async function readAnswer<T>(response:Response,onText:AnswerText):Promise<T>{
  if(!response.headers.get('content-type')?.includes('application/x-ndjson')){
    const result=await response.json();if(!response.ok||result.error)throw Error(result.error||'回答失败，请重试');return result as T;
  }
  if(!response.body)throw Error('回答没有返回内容');
  const reader=response.body.getReader(),decoder=new TextDecoder('utf-8',{fatal:true});let buffer='',text='';
  // First text is immediate; bursts repaint at most every 50 ms. Network parsing
  // continues at full speed, and completion/errors flush all pending text.
  let delivered:string|undefined,timer:ReturnType<typeof setTimeout>|undefined;
  const flush=()=>{clearTimeout(timer);timer=undefined;if(delivered!==text){delivered=text;onText(text);}};
  const publish=()=>{if(delivered===undefined)flush();else if(timer===undefined)timer=setTimeout(flush,50);};
  try{
    while(true){
      const {done,value}=await reader.read();buffer+=done?decoder.decode():decoder.decode(value,{stream:true});
      if(buffer.length>2000000)throw Error('回答格式异常');
      let newline:number;
      while((newline=buffer.indexOf('\n'))>=0){
        const line=buffer.slice(0,newline);buffer=buffer.slice(newline+1);if(!line.trim())continue;
        const event=JSON.parse(line);if(event.error)throw Error(String(event.error));
        if(typeof event.text==='string'){text=event.text;publish();}else if(typeof event.delta==='string'){text+=event.delta;publish();}
        if(event.done===true&&event.result&&response.ok)return event.result as T;
      }
      if(done)throw Error('回答连接中断，当前内容尚未完整保存，请重试');
    }
  }finally{if(delivered!==undefined)flush();else clearTimeout(timer);await reader.cancel().catch(()=>{});reader.releaseLock();}
}
