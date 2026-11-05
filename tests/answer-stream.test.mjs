import test from 'node:test';
import assert from 'node:assert/strict';
import {modelCompletion} from '../src/lib/model-completion.ts';
import {answerResponse,readAnswer} from '../src/lib/answer-stream.ts';
const encoder=new TextEncoder();
const frame=choice=>'data: '+JSON.stringify({choices:[choice]})+'\r\n\r\n';
function source(text,split=3){return new Response(new ReadableStream({start(c){const bytes=encoder.encode(text);for(let i=0;i<bytes.length;i+=split)c.enqueue(bytes.slice(i,i+split));c.close();}}),{headers:{'Content-Type':'text/event-stream'}});}
test('SSE incrementally decodes split UTF-8, formulas and fragmented tool arguments',async()=>{
 const seen=[];const text=frame({delta:{content:'先解释中文 $X$。'}})+frame({delta:{content:'\n再推导。'}})+frame({delta:{},finish_reason:'stop'})+'data: [DONE]\r\n\r\n';
 const result=await modelCompletion(source(text),s=>seen.push(s),new AbortController().signal);
 assert.deepEqual(seen,['先解释中文 $X$。','先解释中文 $X$。\n再推导。']);assert.equal(result.choices[0].message.content,seen.at(-1));
 const tools=frame({delta:{tool_calls:[{index:0,id:'call-1',function:{name:'search_papers',arguments:'{"query":'}}]}})+frame({delta:{tool_calls:[{index:0,function:{arguments:'"VLA"}'}}]},finish_reason:'tool_calls'})+'data: [DONE]\n\n';
 assert.deepEqual((await modelCompletion(source(tools),()=>{},new AbortController().signal)).choices[0].message.tool_calls,[{id:'call-1',type:'function',function:{name:'search_papers',arguments:'{"query":"VLA"}'}}]);
});
test('partial, malformed and length-limited upstream answers never count as successful',async()=>{
 for(const ending of ['',frame({delta:{},finish_reason:'length'}),'data: {broken}\n\n','data: [DONE]\n\n']){
  const seen=[];await assert.rejects(modelCompletion(source(frame({delta:{content:'部分内容'}})+ending),s=>seen.push(s),new AbortController().signal));assert.deepEqual(seen,['部分内容']);
 }
});
test('client receives text before completion and waits for terminal metadata; reset replaces tool-round text',async()=>{
 let release;const gate=new Promise(r=>release=r),seen=[];
 const response=answerResponse(new Request('http://test'),true,async emit=>{emit('检索前');await gate;emit('最终回答');return Response.json({answer:'最终回答',learning:{runId:'run-1'}});});
 let finished=false;const consuming=readAnswer(response,text=>seen.push(text)).then(result=>{finished=true;return result;});
 await new Promise(r=>setTimeout(r,10));assert.deepEqual(seen,['检索前']);assert.equal(finished,false);release();assert.deepEqual(await consuming,{answer:'最终回答',learning:{runId:'run-1'}});assert.deepEqual(seen,['检索前','最终回答']);
});
test('truncated client stream and error events retain provisional text but cannot complete',async()=>{
 for(const suffix of ['',JSON.stringify({error:'中断'})+'\n']){
  const seen=[];await assert.rejects(readAnswer(new Response(JSON.stringify({delta:'部分回答'})+'\n'+suffix,{headers:{'Content-Type':'application/x-ndjson'}}),text=>seen.push(text)));assert.deepEqual(seen,['部分回答']);
 }
});
test('cancelling downstream aborts the upstream request signal',async()=>{
 let signal,aborted;const gate=new Promise(r=>aborted=r);
 const response=answerResponse(new Request('http://test'),true,async(emit,s)=>{signal=s;emit('已开始');await new Promise(r=>s.addEventListener('abort',r,{once:true}));aborted();throw Error('aborted');});
 const reader=response.body.getReader();await reader.read();await reader.cancel();await gate;assert.equal(signal.aborted,true);
});

test('bursty token updates are batched for rendering without delaying the first text or losing the final content',async()=>{
 const events=Array.from({length:100},()=>JSON.stringify({delta:'字'})+'\n').join('')+JSON.stringify({done:true,result:{answer:'字'.repeat(100)}})+'\n';
 const seen=[];const result=await readAnswer(new Response(events,{headers:{'Content-Type':'application/x-ndjson'}}),text=>seen.push(text));
 assert.equal(seen[0],'字');assert.equal(seen.at(-1),result.answer);assert.ok(seen.length<=3,`100 buffered tokens should not trigger ${seen.length} renders`);
});
