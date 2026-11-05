export interface TranslationUpdate {
  status: 'loading' | 'streaming' | 'done' | 'error';
  text: string;
  error?: string;
}
interface TranslationInput { scope: string; text: string; context: string }

/** One active selection per reader. Completed translations stay in a bounded session cache. */
export class ReaderTranslationClient {
  private active: AbortController | null = null;
  private cache = new Map<string, string>();
  private fetcher: typeof fetch;

  constructor(fetcher: typeof fetch = fetch) { this.fetcher = fetcher.bind(globalThis); }

  cancel() {
    this.active?.abort();
    this.active = null;
  }

  async translate(input: TranslationInput, update: (state: TranslationUpdate) => void) {
    this.cancel();
    const controller = new AbortController();
    this.active = controller;
    const key = JSON.stringify(input);
    const current = () => this.active === controller && !controller.signal.aborted;
    const cached = this.cache.get(key);
    if (cached !== undefined) { update({ status: 'done', text: cached }); return; }
    let text = '';
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    const abortRead = () => { void reader?.cancel().catch(() => {}); };
    update({ status: 'loading', text });
    try {
      const response = await this.fetcher('/api/reader/translate', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: input.text, context: input.context }), signal: controller.signal,
      });
      if (!current()) { await response.body?.cancel(); return; }
      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw Error(typeof error.error === 'string' ? error.error : '翻译服务暂不可用，请重试。');
      }
      if (!response.body) throw Error('翻译服务没有返回内容，请重试。');
      reader = response.body.getReader();
      controller.signal.addEventListener('abort', abortRead, { once: true });
      const decoder = new TextDecoder();
      let buffer = '', finished = false;
      const consume = (line: string) => {
        if (!line.trim() || finished || !current()) return;
        const event = JSON.parse(line);
        if (typeof event.error === 'string') throw Error(event.error);
        if (typeof event.delta === 'string') {
          text += event.delta;
          update({ status: 'streaming', text });
        }
        if (event.done === true) finished = true;
      };
      while (current() && !finished) {
        const { done, value } = await reader.read();
        if (!current()) return;
        buffer += decoder.decode(value, { stream: !done });
        let newline: number;
        while ((newline = buffer.indexOf('\n')) !== -1) {
          consume(buffer.slice(0, newline));
          buffer = buffer.slice(newline + 1);
        }
        if (buffer.length > 100000) throw Error('翻译响应格式异常，请重试。');
        if (done) { consume(buffer); break; }
      }
      if (!current()) return;
      if (!finished || !text.trim()) throw Error('翻译中断，结果尚不完整，请重试。');
      this.cache.set(key, text);
      if (this.cache.size > 32) this.cache.delete(this.cache.keys().next().value!);
      update({ status: 'done', text });
    } catch (error) {
      if (current()) update({ status: 'error', text, error: error instanceof Error ? error.message : '翻译失败，请重试。' });
    } finally {
      controller.signal.removeEventListener('abort', abortRead);
      await reader?.cancel().catch(() => {});
      reader?.releaseLock();
    }
  }
}
