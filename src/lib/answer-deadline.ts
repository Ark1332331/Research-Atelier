/** Bound a stalled answer, not the total duration of a healthy stream.
 * Only new answer text resets the clock; empty/repeated frames cannot keep it alive.
 * Each request owns its watchdog, so concurrent answers do not share deadlines. */
export function watchAnswerProgress(controller:AbortController,{firstTextMs=180000,idleMs=90000}:{firstTextMs?:number;idleMs?:number}={}){
  let previous='',disposed=false,timer:ReturnType<typeof setTimeout>;
  const dispose=()=>{disposed=true;clearTimeout(timer);controller.signal.removeEventListener('abort',dispose);};
  const arm=(ms:number)=>{
    clearTimeout(timer);
    timer=setTimeout(()=>controller.abort(new DOMException(previous
      ?`模型输出中断：已连续 ${Math.round(ms/1000)} 秒没有新内容。当前窗口保留已收到的部分，尚未作为完整回答保存；可以重试。`
      :`等待超时：模型在 ${Math.round(ms/1000)} 秒内未返回正文。问题已保留，可以重试。`,'TimeoutError')),ms);
  };
  controller.signal.addEventListener('abort',dispose,{once:true});
  if(controller.signal.aborted)dispose();else arm(firstTextMs);
  return {dispose,progress(text:string){if(disposed||!text.trim()||text===previous)return;previous=text;arm(idleMs);}};
}
