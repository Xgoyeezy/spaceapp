import type { MemoryWorkerTrace } from "./memory-worker-diagnostics.js";
/** Bounded, opt-in diagnostics. These records do not alter benchmark scoring. */
export type MemoryDiagnosticTags = { graph?: number; sourceGraph?: number; layout?: number; picking?: number; renderer?: number; contextGeneration?: number; iteration?: number; frame?: number };
type Details = Record<string, number | string | boolean | null>;
type Span = { name: string; startTime: number; duration: number; tags: MemoryDiagnosticTags; details?: Details };
const LIMITS = { spans: 24000, frames: 8000, entries: 1000 };

export class MemoryDiagnostics {
  private readonly identities = new WeakMap<object, number>();
  private nextIdentity = 1;
  private readonly spans: Span[] = [];
  private readonly frames: Array<{ rafTime: number; callbackEntry: number; tags: MemoryDiagnosticTags }> = [];
  private readonly entries: unknown[] = [];
  private readonly counters: Record<string, number> = {};
  private readonly workers: Array<{ trace: MemoryWorkerTrace; receivedAt: number; mainTimeOrigin: number }> = [];
  private readonly dropped = { spans: 0, frames: 0, entries: 0 };

  constructor(private readonly timing = true, private readonly limits = LIMITS) {}

  identity(value: object | null | undefined): number {
    if (!value) return 0;
    let id = this.identities.get(value);
    if (!id) { id = this.nextIdentity++; this.identities.set(value, id); }
    return id;
  }

  count(name: string, amount = 1) { this.counters[name] = (this.counters[name] ?? 0) + amount; }

  record(name: string, startTime: number, endTime: number, tags: MemoryDiagnosticTags = {}, details?: Details) {
    if (this.spans.length >= this.limits.spans) { this.dropped.spans++; return; }
    const span = { name, startTime, duration: endTime - startTime, tags: { ...tags }, details };
    this.spans.push(span);
    if (this.timing && typeof performance.measure === "function") {
      performance.measure(`memory:${name}`, { start: startTime, end: endTime, detail: { ...tags, ...details } });
    }
  }

  event(name: string, tags: MemoryDiagnosticTags = {}, details?: Details) {
    const now = performance.now(); this.record(name, now, now, tags, details);
  }

  run<T>(name: string, tags: MemoryDiagnosticTags, run: () => T, details?: Details): T {
    const start = performance.now();
    try { return run(); } finally { this.record(name, start, performance.now(), tags, details); }
  }

  frame(rafTime: number, callbackEntry: number, tags: MemoryDiagnosticTags) {
    if (this.frames.length < this.limits.frames) this.frames.push({ rafTime, callbackEntry, tags: { ...tags } });
    else this.dropped.frames++;
  }

  entry(entry: PerformanceEntry) {
    if (this.entries.length < this.limits.entries) this.entries.push(entry.toJSON());
    else this.dropped.entries++;
  }

  worker(trace: MemoryWorkerTrace, receivedAt: number) {
    if (this.workers.length >= 512) { this.count("worker.messages.dropped"); return; }
    this.workers.push({ trace, receivedAt, mainTimeOrigin: performance.timeOrigin });
    const offset = trace.timeOrigin - performance.timeOrigin;
    const tags = { sourceGraph: trace.generation, iteration: trace.iteration };
    this.record(`${trace.role}.message.delivery`, offset + trace.postedAt, receivedAt, tags,
      { sequence: trace.sequence, transferBytes: trace.transferBytes, jsonBytes: trace.jsonBytes });
    this.count(`${trace.role}.messages`); this.count(`${trace.role}.transferBytes`, trace.transferBytes);
    for (const span of trace.spans) this.record(`${trace.role}.worker.${span.name}`,
      offset + span.startTime, offset + span.startTime + span.duration, { ...tags, iteration: span.iteration });
  }

  snapshot() {
    return { schema: 1, timeOrigin: performance.timeOrigin, capturedAt: performance.now(), limits: this.limits,
      dropped: { ...this.dropped }, counters: { ...this.counters }, spans: [...this.spans], frames: [...this.frames], entries: [...this.entries], workers: [...this.workers] };
  }
}

let active: MemoryDiagnostics | null = null;
export function getMemoryDiagnostics(): MemoryDiagnostics | null {
  const enabled = typeof window !== "undefined" && window.location.pathname.replace(/\/$/, "").endsWith("/demo-workspace") && new URLSearchParams(window.location.search).get("memoryDiagnostics") === "1";
  if (!enabled) { active = null; return null; }
  return active ??= new MemoryDiagnostics();
}
export function activeMemoryDiagnostics() { return active; }

/** Separate diagnostic replay: deterministic inputs, never the acceptance run. */
export function memoryReplayInput(frame: number, width: number, height: number) {
  const elapsed = (frame + 1) * 1000 / 60;
  return { camera: { yaw: 0.3 + (frame + 1) * 0.012, pitch: Math.sin(elapsed / 3000) * 0.5, zoom: 1 + Math.sin(elapsed / 1800) * 0.3 },
    pointer: { x: width * (0.5 + 0.2 * Math.sin(elapsed / 1700)), y: height * 0.5 } };
}

export function downloadMemoryDiagnostics(result: string) {
  if (!active) return;
  const blob = new Blob([JSON.stringify({ ...active.snapshot(), benchmark: result.startsWith("{") ? JSON.parse(result) : result }, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob), anchor = document.createElement("a");
  anchor.href = url; anchor.download = `memory-diagnostics-${Date.now()}.json`; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function downloadMemoryBenchmark(result: string) {
  const parsed = JSON.parse(result);
  const url = URL.createObjectURL(new Blob([result], { type: "application/json" }));
  const anchor = document.createElement("a");
  anchor.href = url; anchor.download = `memory-benchmark-${parsed.nodes ?? "invalid"}-${Date.now()}.json`; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
