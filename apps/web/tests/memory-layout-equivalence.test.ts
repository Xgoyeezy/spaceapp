import { deepStrictEqual } from "node:assert";
import { expect, it } from "vitest";
import { streamMemoryNetwork3D } from "../src/features/memory-workspace/memory-3d.js";
import { streamMemoryNetwork3D as reference } from "./fixtures/memory-layout-reference.js";
import { createSyntheticMemoryGraph } from "../src/demo/synthetic-memory-graph.js";

it.each([0, 1, 2000, 2001, 3500])("preserves every streamed coordinate at %i nodes, across the aggregate boundary", async count => {
  const graph = await createSyntheticMemoryGraph(Math.max(2, count));
  const nodes = graph.nodes.slice(0, count);
  const expected = reference(nodes, graph.edges);
  let snapshots = 0;
  for (const frame of streamMemoryNetwork3D(nodes, graph.edges)) {
    deepStrictEqual(frame, expected.next().value);
    snapshots++;
  }
  expect(snapshots).toBe(16);
  expect(expected.next().done).toBe(true);
}, 60_000);

it("preserves aggregate output under reversed IDs/edges and duplicate, missing and self links", async () => {
  const graph = await createSyntheticMemoryGraph(2100);
  const edges = [...graph.edges, graph.edges[0]!, { id: "missing", source: "absent", target: graph.nodes[0]!.id, type: "CONTAINS" as const },
    { id: "self", source: graph.nodes[0]!.id, target: graph.nodes[0]!.id, type: "CONTAINS" as const }];
  const expected = reference(graph.nodes, edges);
  for (const frame of streamMemoryNetwork3D([...graph.nodes].reverse(), [...edges].reverse())) deepStrictEqual(frame, expected.next().value);
  expect(expected.next().done).toBe(true);
}, 60_000);
