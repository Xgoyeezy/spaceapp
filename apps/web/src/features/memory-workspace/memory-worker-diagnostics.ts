/** Optional worker instrumentation. Durations are elapsed wall time, not CPU counters. */
export type MemoryWorkerSpan = { name: string; startTime: number; duration: number; iteration: number };
export type MemoryWorkerTrace = {
  role: "layout" | "response"; generation: number; timeOrigin: number; postedAt: number;
  sequence: number; iteration: number; transferBytes: number; jsonBytes: number;
  spans: MemoryWorkerSpan[]; dropped: number; complete: boolean;
};

export class MemoryWorkerDiagnostics {
  private spans: MemoryWorkerSpan[] = [];
  private recorded = 0;
  private dropped = 0;
  private sequence = 0;
  iteration = -1;
  constructor(readonly role: MemoryWorkerTrace["role"], readonly generation: number,
    private readonly limit = 4096) {}

  start() { return performance.now(); }
  end(name: string, startTime: number) {
    const duration = performance.now() - startTime;
    if (this.recorded++ < this.limit) this.spans.push({ name, startTime, duration, iteration: this.iteration });
    else this.dropped++;
  }
  measure<T>(name: string, fn: () => T): T {
    const start = this.start();
    try { return fn(); } finally { this.end(name, start); }
  }
  async pause(fn: () => Promise<void>) {
    const start = this.start();
    try { await fn(); } finally { this.end("yield.wait", start); }
  }
  post(message: object, transfer: ArrayBufferLike[] = [], complete = false) {
    // JSON byte counts describe clone-only fields, not browser wire overhead.
    const jsonBytes = this.measure("diagnostic.size", () => new TextEncoder().encode(JSON.stringify(message,
      (_key, value) => ArrayBuffer.isView(value) ? undefined : value)).byteLength);
    const spans = this.spans; this.spans = [];
    const workerTrace: MemoryWorkerTrace = { role: this.role, generation: this.generation,
      timeOrigin: performance.timeOrigin, postedAt: performance.now(), sequence: this.sequence++, iteration: this.iteration,
      transferBytes: transfer.reduce((sum, buffer) => sum + buffer.byteLength, 0), jsonBytes,
      spans, dropped: this.dropped, complete };
    const start = this.start();
    self.postMessage({ ...message, workerTrace }, { transfer });
    this.end("post.call", start);
  }
  finish() { this.post({}, [], true); }
}
