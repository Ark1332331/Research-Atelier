import test, { after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { createHash } from "node:crypto";

const directory = await fs.mkdtemp(path.join(os.tmpdir(), "ra-reader-translate-"));
process.env.RA_DATA_DIR = directory;
process.env.DEEPSEEK_API_KEY = "test-only-key";
const originalFetch = globalThis.fetch;
after(async () => { globalThis.fetch = originalFetch; await fs.rm(directory, { recursive: true, force: true }); });
beforeEach(() => { globalThis.fetch = async () => { throw Error("Unexpected external request"); }; });
const { POST } = await import("../src/app/api/reader/translate/route.ts");
const { POST: save } = await import("../src/app/api/vocabulary/route.ts");
const event = (content, finish_reason = null) => `data: ${JSON.stringify({ choices: [{ delta: { content }, finish_reason }] })}\r\n\r\n`;
const complete = event("语境中的释义") + event("", "stop") + "data: [DONE]\r\n\r\n";
function upstream(value, bytewise = false) {
  const bytes = new TextEncoder().encode(value);
  return new Response(new ReadableStream({ start(controller) {
    if (bytewise) for (const byte of bytes) controller.enqueue(Uint8Array.of(byte));
    else controller.enqueue(bytes);
    controller.close();
  } }));
}
const request = (body, signal) => new Request("http://localhost/api/reader/translate", { method: "POST", body: JSON.stringify(body), signal });
const records = async response => (await response.text()).trim().split("\n").map(line => JSON.parse(line));

test("long selection streams split UTF-8 correctly without PDF identity, rectangles, or persistence", async () => {
  let sent;
  globalThis.fetch = async (_url, init) => { sent = JSON.parse(init.body); return upstream(complete, true); };
  const before = await fs.readdir(directory);
  const response = await POST(request({ text: "This is a long passage with evidence [3] and equation x = y. ".repeat(10), context: "x".repeat(2000) }));
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type"), /application\/x-ndjson/);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await records(response), [{ delta: "语境中的释义" }, { done: true }]);
  assert.equal(sent.stream, true);
  assert.equal(sent.model, "deepseek-chat");
  assert.equal(JSON.parse(sent.messages[1].content).context.length, 1600);
  assert.match(sent.messages[0].content, /翻译/);
  assert.deepEqual(await fs.readdir(directory), before);
});

test("invalid input rejects before any upstream call", async () => {
  for (const body of [null, {}, { text: " \n " }, { text: "x".repeat(12001) }, { text: 5 }]) {
    const response = await POST(request(body));
    assert.equal(response.status, 400);
    assert.ok((await records(response))[0].error);
  }
});

test("missing key is a controlled failure with no upstream request", async () => {
  delete process.env.DEEPSEEK_API_KEY;
  try { const response = await POST(request({ text: "model" })); assert.equal(response.status, 503); assert.ok((await records(response))[0].error); }
  finally { process.env.DEEPSEEK_API_KEY = "test-only-key"; }
});

test("partial output followed by malformed, truncated, or rejected SSE ends with error only", async () => {
  for (const suffix of ["data: broken\n\n", event("", "length") + "data: [DONE]\n\n", "", 'data: {"error":{"message":"private upstream detail"}}\n\n']) {
    globalThis.fetch = async () => upstream(event("部分译文") + suffix);
    const result = await records(await POST(request({ text: "model" })));
    assert.equal(result[0].delta, "部分译文");
    assert.ok(result.at(-1).error);
    assert.equal(result.some(item => item.done), false);
    assert.equal(JSON.stringify(result).includes("private upstream detail"), false);
  }
});

test("HTTP upstream errors are sanitized and never reported as success", async () => {
  globalThis.fetch = async () => new Response("private upstream detail", { status: 429 });
  const result = await records(await POST(request({ text: "model" })));
  assert.equal(result.length, 1);
  assert.ok(result[0].error);
  assert.equal(JSON.stringify(result).includes("private upstream detail"), false);
});

test("request abort cancels upstream stream after partial output", async () => {
  let upstreamSignal, cancelled = false;
  globalThis.fetch = async (_url, init) => {
    upstreamSignal = init.signal;
    return new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode(event("部分"))); }, cancel() { cancelled = true; } }));
  };
  const abort = new AbortController();
  const response = await POST(request({ text: "model" }, abort.signal));
  const reader = response.body.getReader();
  await reader.read();
  abort.abort();
  const rest = [];
  for (;;) { const chunk = await reader.read(); if (chunk.done) break; rest.push(new TextDecoder().decode(chunk.value)); }
  assert.equal(upstreamSignal.aborted, true);
  assert.equal(cancelled, true);
  assert.match(rest.join(""), /error/);
  assert.doesNotMatch(rest.join(""), /"done":true/);
});

test("downstream cancel aborts fetch and cancels its pending reader", async () => {
  let upstreamSignal, cancelled = false;
  globalThis.fetch = async (_url, init) => {
    upstreamSignal = init.signal;
    return new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode(event("部分"))); }, cancel() { cancelled = true; } }));
  };
  const reader = (await POST(request({ text: "model" }))).body.getReader();
  await reader.read();
  await reader.cancel();
  assert.equal(upstreamSignal.aborted, true);
  assert.equal(cancelled, true);
});

test("timeout aborts a stalled upstream and terminates with an error", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let upstreamSignal, cancelled = false;
  globalThis.fetch = async (_url, init) => {
    upstreamSignal = init.signal;
    return new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode(event("部分"))); }, cancel() { cancelled = true; } }));
  };
  const reader = (await POST(request({ text: "model" }))).body.getReader();
  await reader.read();
  t.mock.timers.tick(60001);
  const tail = new TextDecoder().decode((await reader.read()).value);
  assert.match(tail, /超时/);
  assert.equal(upstreamSignal.aborted, true);
  assert.equal(cancelled, true);
  assert.equal((await reader.read()).done, true);
});

test("explicit save stores supplied meaning, deduplicates and rejects changed PDF identity", async () => {
  const slug = "paper";
  const pdf = Buffer.from("test PDF identity");
  await fs.mkdir(path.join(directory, "papers", slug), { recursive: true });
  await fs.writeFile(path.join(directory, "papers", slug, "original.pdf"), pdf);
  const body = { action: "save", slug, docId: createHash("sha256").update(pdf).digest("hex"), text: "model", context: "a model", meaning: "模型\n用法：名词", page: 1, rects: [{ x: .1, y: .2, w: .1, h: .02 }] };
  const response = await save(request(body));
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.saved.meaning, body.meaning);
  assert.equal(result.saved.lemma, body.text);
  assert.equal(result.saved.partOfSpeech, "");
  assert.equal(result.saved.usage, "");
  const duplicate = await (await save(request(body))).json();
  assert.equal(duplicate.entries.length, 1);
  assert.equal(duplicate.saved.id, result.saved.id);
  for (const patch of [{ meaning: " " }, { meaning: "x".repeat(4001) }, { rects: [] }, { text: "This is a complete sentence describing a model and its behavior." }]) {
    assert.equal((await save(request({ ...body, ...patch }))).status, 400);
  }
  await fs.writeFile(path.join(directory, "papers", slug, "original.pdf"), "replaced PDF");
  assert.equal((await save(request(body))).status, 409);
  assert.equal(JSON.parse(await fs.readFile(path.join(directory, "vocabulary.json"), "utf8")).length, 1);
});

test("legacy translate remains available and validates PDF identity again after model response", async () => {
  const slug = "legacy-paper", pdf = Buffer.from("legacy PDF");
  const pdfPath = path.join(directory, "papers", slug, "original.pdf");
  await fs.mkdir(path.dirname(pdfPath), { recursive: true });
  await fs.writeFile(pdfPath, pdf);
  const body = { action: "translate", slug, docId: createHash("sha256").update(pdf).digest("hex"), text: "model", page: 1, rects: [{ x: .1, y: .2, w: .1, h: .02 }] };
  const result = () => Response.json({ choices: [{ message: { content: JSON.stringify({ meaning: "模型", lemma: "model", partOfSpeech: "名词", usage: "文中表示模型" }) } }] });
  globalThis.fetch = async () => result();
  assert.equal((await save(request(body))).status, 200);
  globalThis.fetch = async () => { await fs.writeFile(pdfPath, "changed during translation"); return result(); };
  assert.equal((await save(request(body))).status, 409);
});
