import test from 'node:test';
import assert from 'node:assert/strict';
const mod = await import('../src/lib/reader-translation-client.ts').catch(() => ({}));
const request = {scope:'paper-a', text:'point cloud', context:'A scene representation'};
const streamResponse = (parts) => new Response(new ReadableStream({start(c) {for (const p of parts) c.enqueue(new TextEncoder().encode(p)); c.close();}}));
function client(fetcher) {assert.equal(typeof mod.ReaderTranslationClient, 'function'); return new mod.ReaderTranslationClient(fetcher);}

test('browser fetch retains the Window receiver instead of the client instance', async () => {
  const c=client(function () {assert.equal(this,globalThis);return Promise.resolve(streamResponse(['{"delta":"译文"}\n{"done":true}\n']));});
  const updates=[];
  await c.translate(request,s=>updates.push(s));
  assert.equal(updates.at(-1).status,'done');
});

test('translation is progressive, assembles split events and caches only a finished result', async () => {
  let calls=0;
  const c=client(async()=>{calls++;return streamResponse(['{"delta":"点', '云"}\n{"delta":"表示"}\n','{"done":true}\n']);});
  const updates=[];
  await c.translate(request,s=>updates.push(s));
  assert.equal(updates.at(-1).status,'done');
  assert.equal(updates.at(-1).text,'点云表示');
  assert.ok(updates.some(s=>s.status==='streaming'&&s.text==='点云'));
  await c.translate(request,()=>{});
  assert.equal(calls,1);
  await c.translate({...request,context:'different context'},()=>{});
  await c.translate({...request,scope:'paper-b'},()=>{});
  assert.equal(calls,3);
});

test('superseding a pending request aborts it and prevents a late result overwriting the new selection', async () => {
  let resolveOld,oldSignal;
  const c=client((_,init)=>{if(JSON.parse(init.body).text==='old') {oldSignal=init.signal;return new Promise(r=>{resolveOld=r;});}return Promise.resolve(streamResponse(['{"delta":"新译文"}\n{"done":true}\n']));});
  const oldUpdates=[],newUpdates=[];
  const pending=c.translate({...request,text:'old'},s=>oldUpdates.push(s));
  await c.translate({...request,text:'new'},s=>newUpdates.push(s));
  resolveOld(streamResponse(['{"delta":"过期译文"}\n{"done":true}\n']));
  await pending;
  assert.equal(oldSignal.aborted,true);
  assert.deepEqual(oldUpdates.map(s=>s.status),['loading']);
  assert.equal(newUpdates.at(-1).text,'新译文');
});

test('truncated and failed streams are retryable and never cached', async () => {
  let calls=0;
  const c=client(async()=>{calls++;return streamResponse([calls===1?'{"delta":"部分"}\n':'{"error":"翻译服务暂不可用"}\n']);});
  const updates=[];
  await c.translate(request,s=>updates.push(s));
  assert.equal(updates.at(-1).status,'error');
  assert.equal(updates.at(-1).text,'部分');
  await c.translate(request,s=>updates.push(s));
  assert.equal(calls,2);
  assert.equal(updates.at(-1).error,'翻译服务暂不可用');
});

test('closing cancels a streaming reader and suppresses later UI updates', async () => {
  let push,cancelled=false;
  const c=client(async()=>new Response(new ReadableStream({start(controller){push=controller;},cancel(){cancelled=true;}})));
  const updates=[];
  const pending=c.translate(request,s=>updates.push(s));
  await new Promise(r=>setImmediate(r));
  push.enqueue(new TextEncoder().encode('{"delta":"部分"}\n'));
  await new Promise(r=>setImmediate(r));
  c.cancel();
  await pending;
  assert.equal(cancelled,true);
  assert.equal(updates.at(-1).status,'streaming');
});
