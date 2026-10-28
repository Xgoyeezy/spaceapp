import { afterEach, expect, it, vi } from "vitest";
import type { MemoryResponseRequest } from "../src/features/memory-workspace/memory-response.worker.js";

afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });

async function decode(raw: string, diagnostic = false) {
  const messages: Array<Record<string, any>> = [];
  const scope = { onmessage: null as unknown as (event: MessageEvent<MemoryResponseRequest>) => Promise<void>, postMessage: (value: Record<string, any>) => messages.push(value) };
  vi.stubGlobal("self", scope);
  await import("../src/features/memory-workspace/memory-response.worker.js");
  const bytes = new TextEncoder().encode(raw).buffer;
  await scope.onmessage({ data: diagnostic ? { bytes, diagnosticGeneration: 3 } : bytes } as MessageEvent<MemoryResponseRequest>);
  return messages;
}

it("decodes large graph bodies off-thread in bounded, lossless batches", async () => {
  const nodes = Array.from({ length: 2501 }, (_, i) => ({ id: `node:${i}`, label: `Memory ${i}` }));
  const edges = Array.from({ length: 6001 }, (_, i) => ({ id: `edge:${i}`, source: "node:0", target: `node:${i % nodes.length}` }));
  const messages = await decode(JSON.stringify({ requestId: "synthetic", data: { nodes, edges, truncated: false, summary: { nodeCount: nodes.length } } }));
  expect(messages.flatMap(message => message.nodes ?? [])).toEqual(nodes);
  expect(messages.flatMap(message => message.edges ?? [])).toEqual(edges);
  expect(messages.every(message => (message.nodes?.length ?? 0) <= 1000 && (message.edges?.length ?? 0) <= 2000)).toBe(true);
  expect(messages.at(-1)).toEqual({ graph: true, value: { requestId: "synthetic", data: { truncated: false, summary: { nodeCount: nodes.length } } } });
});

it("preserves JSON error bodies for the existing request error handling", async () => {
  const value = { error: { code: "NOT_AUTHORIZED", message: "Synthetic denied response" } };
  expect(await decode(JSON.stringify(value))).toEqual([{ value }]);
});

it("preserves non-JSON bodies instead of returning a partial graph", async () => {
  expect(await decode("<html>Proxy unavailable</html>")).toEqual([{ value: "<html>Proxy unavailable</html>" }]);
});

it("records parsing separately from yielded delivery only when explicitly requested", async () => {
  const messages = await decode(JSON.stringify({ data: { nodes: [{ id: "n" }], edges: [] } }), true);
  const phases = messages.flatMap(message => message.workerTrace?.spans ?? []);
  expect(phases.map(phase => phase.name)).toEqual(expect.arrayContaining(["text.decode", "json.parse", "nodes.batch", "yield.wait", "post.call"]));
  expect(messages.at(-1)!.workerTrace).toMatchObject({ role: "response", generation: 3, complete: true, dropped: 0 });
  expect(messages.flatMap(message => message.nodes ?? [])).toEqual([{ id: "n" }]);
});
