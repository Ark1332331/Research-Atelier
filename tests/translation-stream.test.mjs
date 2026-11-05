import test from "node:test";
import assert from "node:assert/strict";
import { translationDeltas } from "../src/lib/translation-stream.ts";

const bytes = text => new TextEncoder().encode(text);
function body(text) {
  return new ReadableStream({ start(controller) { for (const byte of bytes(text)) controller.enqueue(Uint8Array.of(byte)); controller.close(); } });
}
async function collect(stream, signal = new AbortController().signal) {
  const values = [];
  for await (const value of translationDeltas(stream, signal)) values.push(value);
  return values;
}

test("SSE comments, multiline data and mixed newline delimiters preserve text", async () => {
  const source = ': keep-alive\r\rdata: {"choices":\rdata: [{"delta":{"content":"中文"}}]}\r\r'
    + 'data: {"choices":[],"usage":{"completion_tokens":2}}\n\n'
    + 'data: [DONE]\r\n\r\n';
  assert.deepEqual(await collect(body(source)), ["中文"]);
});

test("empty or incomplete streams cannot produce a successful translation", async () => {
  for (const source of ["", "data: [DONE]\n\n", 'data: {"choices":[{"delta":{"content":" "}}]}\n\ndata: [DONE]\n\n', 'data: {"choices":[{"delta":{"content":"译文"},"finish_reason":"stop"}]}\n\n']) {
    await assert.rejects(collect(body(source)));
  }
});

test("aborted signal cancels the unread upstream body", async () => {
  let cancelled = false;
  const stream = new ReadableStream({ cancel() { cancelled = true; } });
  const abort = new AbortController(); abort.abort();
  await assert.rejects(collect(stream, abort.signal));
  assert.equal(cancelled, true);
});

test("invalid UTF-8 and malformed content are rejected", async () => {
  const stream = new ReadableStream({ start(controller) { controller.enqueue(Uint8Array.of(0xff)); controller.close(); } });
  await assert.rejects(collect(stream));
  await assert.rejects(collect(body('data: {"choices":[{"delta":{"content":42}}]}\n\n')));
});
