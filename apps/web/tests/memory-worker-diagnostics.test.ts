import { afterEach, expect, it, vi } from "vitest";
import { MemoryWorkerDiagnostics, type MemoryWorkerTrace } from "../src/features/memory-workspace/memory-worker-diagnostics.js";
import { MemoryDiagnostics } from "../src/features/memory-workspace/memory-diagnostics.js";
import { streamMemoryNetwork3D } from "../src/features/memory-workspace/memory-3d.js";

afterEach(() => vi.unstubAllGlobals());

it("normalizes worker timestamps and retains separate delivery and synchronous spans", () => {
  const diagnostics = new MemoryDiagnostics(false);
  const trace: MemoryWorkerTrace = { role: "layout", generation: 4, timeOrigin: performance.timeOrigin + 100,
    postedAt: 50, sequence: 0, iteration: 12, transferBytes: 4096, jsonBytes: 20, dropped: 0, complete: false,
    spans: [{ name: "forces.repulsion", startTime: 10, duration: 30, iteration: 12 }] };
  diagnostics.worker(trace, 155);
  expect(diagnostics.snapshot().spans).toMatchObject([
    { name: "layout.message.delivery", startTime: 150, duration: 5 },
    { name: "layout.worker.forces.repulsion", startTime: 110, duration: 30, tags: { sourceGraph: 4, iteration: 12 } }
  ]);
  expect(diagnostics.snapshot().workers[0]!.trace).toEqual(trace);
});

it("bounds worker spans across flushes and counts exact transferred buffer bytes", () => {
  const messages: Array<{ workerTrace: MemoryWorkerTrace }> = [];
  vi.stubGlobal("self", { postMessage: (value: { workerTrace: MemoryWorkerTrace }) => messages.push(value) });
  const recorder = new MemoryWorkerDiagnostics("layout", 9, 2);
  recorder.measure("first", () => 1);
  recorder.post({ depth: new Float32Array(4) }, [new ArrayBuffer(16)]);
  recorder.measure("over-bound", () => 2);
  recorder.finish();
  expect(messages[0]!.workerTrace.transferBytes).toBe(16);
  expect(messages.flatMap(message => message.workerTrace.spans)).toHaveLength(2);
  expect(messages.at(-1)!.workerTrace).toMatchObject({ complete: true, generation: 9 });
  expect(messages.at(-1)!.workerTrace.dropped).toBeGreaterThan(0);
});

it("does not change snapshots, iteration count or deterministic order when profiling", () => {
  const nodes = Array.from({ length: 40 }, (_, i) => ({ id: `n${i}`, label: i ? `n${i}` : "gemini.md", type: "SOURCE" as const, recordId: null, sourcePath: null }));
  const recorder = new MemoryWorkerDiagnostics("layout", 1);
  const normal = [...streamMemoryNetwork3D(nodes, [])];
  const profiled = [...streamMemoryNetwork3D(nodes, [], 12, recorder)];
  expect(profiled).toEqual(normal);
  expect(profiled.map(frame => frame.iteration)).toEqual(Array.from({ length: 16 }, (_, i) => i * 12));
  expect(profiled.at(-1)!.done).toBe(true);
});
