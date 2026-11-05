const CHUNK=512*1024,MAX_BYTES=100*1024*1024;
type Fetcher=(url:string,options:RequestInit)=>Promise<Response>;

async function bodyBytes(response:Response,limit:number){
  if(Number(response.headers.get('content-length'))>limit){await response.body?.cancel();throw Error('PDF 文件过大');}
  const reader=response.body?.getReader();if(!reader)throw Error('PDF 下载内容为空');
  const chunks:Uint8Array[]=[];let length=0;
  try{for(;;){const {done,value}=await reader.read();if(done)break;length+=value.length;if(length>limit)throw Error('PDF 文件过大');chunks.push(value);}}
  finally{await reader.cancel().catch(()=>{});}
  return Buffer.concat(chunks,length);
}

/** Bounded parallel ranges keep slow full-file transfers from losing all progress. */
export async function downloadPdfBytes(url:string,fetcher:Fetcher=fetch):Promise<Buffer>{
  const controller=new AbortController(),deadline=setTimeout(()=>controller.abort(),240000);
  const request=async(start:number,end:number,validator?:string)=>{
    const response=await fetcher(url,{method:'GET',cache:'no-store',redirect:'follow',signal:AbortSignal.any([controller.signal,AbortSignal.timeout(start===0?120000:60000)]),headers:{'User-Agent':'Mozilla/5.0 (ResearchAtelier; PDF import)',Range:`bytes=${start}-${end}`,...(validator?{'If-Range':validator}:{})}});
    if(!response.ok){await response.body?.cancel();throw Error(`PDF 下载失败（HTTP ${response.status}）`);}
    return response;
  };
  try{
    const first=await request(0,CHUNK-1);
    if(first.status!==206){const full=await bodyBytes(first,MAX_BYTES);if(full.subarray(0,4).toString()!=='%PDF')throw Error('下载内容不是有效 PDF（可能需登录/未开放）');return full;}
    const range=first.headers.get('content-range')?.match(/^bytes (\d+)-(\d+)\/(\d+)$/);
    if(!range||Number(range[1])!==0){await first.body?.cancel();throw Error('PDF 分段响应不完整');}
    const total=Number(range[3]),firstEnd=Number(range[2]);
    if(total>MAX_BYTES){await first.body?.cancel();throw Error('PDF 文件过大（最多 100 MB）');}
    if(firstEnd!==Math.min(CHUNK,total)-1){await first.body?.cancel();throw Error('PDF 分段响应不完整');}
    const initial=await bodyBytes(first,CHUNK);
    if(initial.length!==firstEnd+1)throw Error('PDF 分段下载不完整');
    if(initial.subarray(0,4).toString()!=='%PDF')throw Error('下载内容不是有效 PDF（可能需登录/未开放）');
    const etag=first.headers.get('etag'),modified=first.headers.get('last-modified');
    // Some scholarly CDNs hash each range into a distinct ETag. Their stable
    // Last-Modified value is a representation validator across all segments.
    const validator=modified??(etag&&!etag.startsWith('W/')?etag:undefined);
    const output=Buffer.alloc(total);initial.copy(output);let next=initial.length;
    const worker=async()=>{
      while(next<total){
        const start=next,end=Math.min(start+CHUNK,total)-1;next=end+1;
        for(let attempt=0;attempt<2;attempt++){
          try{
            const response=await request(start,end,validator);
            if(response.status!==206||response.headers.get('content-range')!==`bytes ${start}-${end}/${total}`||modified&&response.headers.get('last-modified')!==modified||!modified&&etag&&response.headers.get('etag')!==etag){await response.body?.cancel();throw Error(`PDF 在下载期间发生变化或分段响应不完整（HTTP ${response.status}；${response.headers.get('content-range')??'未返回分段范围'}），请重试`);}
            const chunk=await bodyBytes(response,end-start+1);if(chunk.length!==end-start+1)throw Error('PDF 分段下载不完整');chunk.copy(output,start);break;
          }catch(error){if(attempt||controller.signal.aborted)throw error;}
        }
      }
    };
    await Promise.all(Array.from({length:4},worker));return output;
  }finally{clearTimeout(deadline);controller.abort();}
}
