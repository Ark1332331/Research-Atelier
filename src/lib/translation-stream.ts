/** Decode an OpenAI-compatible SSE body without assuming network chunk boundaries. */
export async function* translationDeltas(body: ReadableStream<Uint8Array>, signal: AbortSignal): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let buffer = "";
  let hasText = false;
  const abort = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener("abort", abort, { once: true });
  try {
    while (true) {
      signal.throwIfAborted();
      const { value, done } = await reader.read();
      signal.throwIfAborted();
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
      if (buffer.length > 262144) throw Error("模型响应格式异常，请重试");
      let boundary: RegExpExecArray | null;
      while ((boundary = /\r\n\r\n|\n\n|\r\r/.exec(buffer))) {
        const block = buffer.slice(0, boundary.index);
        buffer = buffer.slice(boundary.index + boundary[0].length);
        const data = block.split(/\r\n|\r|\n/).filter(line => line.startsWith("data:")).map(line => line.slice(5).replace(/^ /, "")).join("\n");
        if (!data.trim()) continue;
        if (data.trim() === "[DONE]") {
          if (!hasText) throw Error("模型未返回译文，请重试");
          return;
        }
        let payload;
        try { payload = JSON.parse(data); } catch { throw Error("模型响应格式异常，请重试"); }
        if (!payload || payload.error || !Array.isArray(payload.choices)) throw Error("翻译服务返回异常，请重试");
        // Usage-only events may have no choices.
        if (!payload.choices.length) continue;
        const choice = payload.choices[0];
        if (!choice || typeof choice !== "object") throw Error("模型响应格式异常，请重试");
        if (choice.finish_reason && choice.finish_reason !== "stop") throw Error("译文未完整生成，请缩短选区后重试");
        const delta = choice.delta?.content;
        if (delta != null && typeof delta !== "string") throw Error("模型响应格式异常，请重试");
        if (delta) { hasText ||= !!delta.trim(); yield delta; }
      }
      if (done) throw Error("翻译连接提前结束，请重试");
    }
  } finally {
    signal.removeEventListener("abort", abort);
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
