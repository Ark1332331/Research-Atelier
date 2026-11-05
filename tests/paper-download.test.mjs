import test from 'node:test';
import assert from 'node:assert/strict';
import {downloadPdfBytes} from '../src/lib/paper-download.ts';

const bytes=Buffer.alloc(1500000,32);bytes.write('%PDF-1.7\n');
test('range downloads assemble complete bytes and retry only a failed segment',async()=>{
  const calls=[];let failed=false;
  const result=await downloadPdfBytes('https://example.org/paper.pdf',async(url,options)=>{
    const range=new Headers(options.headers).get('range'),[,a,b]=range.match(/bytes=(\d+)-(\d+)/),start=Number(a),end=Math.min(Number(b),bytes.length-1);calls.push(start);
    if(start>0&&!failed){failed=true;throw Error('interrupted');}
    return new Response(bytes.subarray(start,end+1),{status:206,headers:{'Content-Range':`bytes ${start}-${end}/${bytes.length}`,ETag:'"v1"'}});
  });
  assert.deepEqual(result,bytes);assert.equal(calls.filter(n=>n===0).length,1);assert.equal(calls.length,4);
});
test('servers ignoring Range still return a validated complete PDF',async()=>{
  let calls=0;const result=await downloadPdfBytes('https://example.org/paper.pdf',async()=>{calls++;return new Response(bytes);});
  assert.deepEqual(result,bytes);assert.equal(calls,1);
});
test('changed, truncated and oversized ranges are rejected without returning partial PDFs',async()=>{
  for(const failure of ['changed','truncated','oversized']){
    await assert.rejects(downloadPdfBytes('https://example.org/paper.pdf',async(url,options)=>{
      const [,a,b]=new Headers(options.headers).get('range').match(/bytes=(\d+)-(\d+)/),start=Number(a),end=Math.min(Number(b),bytes.length-1);
      const total=failure==='oversized'?200000000:bytes.length;
      return new Response(bytes.subarray(start,end+(failure==='truncated'?0:1)),{status:206,headers:{'Content-Range':`bytes ${start}-${end}/${total}`,ETag:start&&failure==='changed'?'"v2"':'"v1"'}});
    }),/变化|不完整|过大/);
  }
});
test('HTML login responses cannot become PDFs',async()=>{
  await assert.rejects(downloadPdfBytes('https://example.org/paper.pdf',async()=>new Response('<html>login</html>')),/有效 PDF/);
});

test('CDNs with per-range ETags use the consistent Last-Modified validator',async()=>{
  const modified='Thu, 13 Aug 2026 00:35:42 GMT';
  const result=await downloadPdfBytes('https://example.org/paper.pdf',async(url,options)=>{
    const headers=new Headers(options.headers),[,a,b]=headers.get('range').match(/bytes=(\d+)-(\d+)/),start=Number(a),end=Math.min(Number(b),bytes.length-1);
    if(start)assert.equal(headers.get('if-range'),modified);
    return new Response(bytes.subarray(start,end+1),{status:206,headers:{'Content-Range':`bytes ${start}-${end}/${bytes.length}`,ETag:`"chunk-${start}"`,'Last-Modified':modified}});
  });
  assert.deepEqual(result,bytes);
});
