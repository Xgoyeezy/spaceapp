import { afterEach, expect, it, vi } from "vitest";
import type { MemoryLayoutMessage, MemoryLayoutRequest } from "../src/features/memory-workspace/memory-network-layout.worker.js";

afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });

it.each([false, true])("publishes coherent transferable snapshots and truthful completion with diagnostics=%s", async diagnostic => {
  const messages: MemoryLayoutMessage[] = [];
  const scope = { onmessage: null as unknown as (event: { data: MemoryLayoutRequest }) => void,
    postMessage: (value: MemoryLayoutMessage, options?: StructuredSerializeOptions) => messages.push(structuredClone(value, options)) };
  vi.stubGlobal("self", scope);
  await import("../src/features/memory-workspace/memory-network-layout.worker.js");
  const nodes = Array.from({ length: 30 }, (_, i) => ({ id: `node:${i}`, label: i ? `Memory ${i}` : "gemini.md", type: "SOURCE" as const, recordId: null, sourcePath: null }));
  scope.onmessage({ data: { kind: "nodes", nodes, ...(diagnostic ? { diagnosticGeneration: 7 } : {}) } });
  scope.onmessage({ data: { kind: "edges", edges: [] } });
  scope.onmessage({ data: { kind: "run", view3D: true } });
  await vi.waitFor(() => expect(messages.some(message => diagnostic ? message.workerTrace?.complete : message.done)).toBe(true), { timeout: 10_000 });
  const snapshots = messages.filter(message => message.depth);
  expect(snapshots.map(message => message.iteration)).toEqual(Array.from({ length: 16 }, (_, i) => i * 12));
  expect(snapshots.filter(message => message.done)).toHaveLength(1);
  expect(snapshots.at(-1)!.iteration).toBe(180);
  expect(snapshots.filter(message => message.gpu)).toHaveLength(1);
  for (const frame of snapshots) {
    expect(frame.depth!.length).toBe(90);
    expect(frame.picking!.points).toEqual(frame.depth);
    expect(frame.picking!.order.length).toBe(30);
    for (let i = 0; i < 30; i++) expect([...frame.gpuPositions!.slice(i * 4, i * 4 + 3)]).toEqual([...frame.depth!.slice(i * 3, i * 3 + 3)]);
  }
  if (diagnostic) {
    expect(messages.at(-1)!.workerTrace).toMatchObject({ generation: 7, complete: true, dropped: 0 });
    const phases = messages.flatMap(message => message.workerTrace?.spans ?? []);
    expect(phases.filter(span => span.name === "forces.repulsion")).toHaveLength(180);
    expect(phases.filter(span => span.name === "picking.build")).toHaveLength(16);
  } else expect(messages.every(message => !message.workerTrace)).toBe(true);
});
