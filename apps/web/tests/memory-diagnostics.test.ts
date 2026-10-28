import { describe, expect, it } from "vitest";
import { MemoryDiagnostics, memoryReplayInput } from "../src/features/memory-workspace/memory-diagnostics.js";

describe("bounded memory diagnostics", () => {
  it("retains ordered timestamps and generations without conflating their maxima", () => {
    const recorder = new MemoryDiagnostics(false);
    const graph = {}, replacement = {};
    expect(recorder.identity(graph)).toBe(recorder.identity(graph));
    expect(recorder.identity(replacement)).not.toBe(recorder.identity(graph));
    const tags = { graph: recorder.identity(graph), layout: 1, renderer: 2 };
    recorder.record("upload", 10, 12, tags, { bytes: 100 });
    tags.layout = 2;
    recorder.record("labels", 50, 53, tags);
    const { spans } = recorder.snapshot();
    expect(spans).toMatchObject([
      { name: "upload", startTime: 10, duration: 2, tags: { layout: 1 }, details: { bytes: 100 } },
      { name: "labels", startTime: 50, duration: 3, tags: { layout: 2 } }
    ]);
  });

  it("bounds retained records, reports losses and keeps complete counters", () => {
    const recorder = new MemoryDiagnostics(false, { spans: 2, frames: 2, entries: 2 });
    for (let i = 0; i < 5; i++) {
      recorder.record("upload", i, i + 1, {}, { bytes: 100 });
      recorder.frame(i, i + .5, {});
      recorder.entry({ toJSON: () => ({ startTime: i, duration: 100 }) } as PerformanceEntry);
      recorder.count("upload.bytes", 100);
    }
    expect(recorder.snapshot()).toMatchObject({ dropped: { spans: 3, frames: 3, entries: 3 }, counters: { "upload.bytes": 500 } });
    expect(recorder.snapshot().frames).toHaveLength(2);
  });

  it("records a failed operation without swallowing its error", () => {
    const recorder = new MemoryDiagnostics(false);
    expect(() => recorder.run("upload", { graph: 1 }, () => { throw new Error("context lost"); })).toThrow("context lost");
    expect(recorder.snapshot().spans[0]).toMatchObject({ name: "upload", tags: { graph: 1 } });
  });

  it("replays the same camera and pointer independently of wall time or prior yaw", () => {
    const first = Array.from({ length: 601 }, (_, i) => memoryReplayInput(i, 900, 460));
    const second = Array.from({ length: 601 }, (_, i) => memoryReplayInput(i, 900, 460));
    expect(second).toEqual(first);
    expect(first[0]!.camera.yaw).toBeCloseTo(.312);
    expect(first[600]!.camera.yaw).toBeCloseTo(.3 + 601 * .012);
    expect(first.every(frame => frame.pointer.x >= 270 && frame.pointer.x <= 630 && frame.pointer.y === 230)).toBe(true);
  });
});
