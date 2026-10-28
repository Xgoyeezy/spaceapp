import { describe, expect, it, vi } from "vitest";
import type { MemoryGraphNode } from "@space/contracts";
import { MemoryWebGLRenderer } from "../src/features/memory-workspace/memory-webgl-renderer.js";
import { IndexedMemoryCoordinates } from "../src/features/memory-workspace/memory-coordinates.js";
import { MemoryLabelCache } from "../src/features/memory-workspace/memory-label-cache.js";
import { prepareMemoryGpuData } from "../src/features/memory-workspace/memory-webgl-data.js";
import { referenceLabels } from "./fixtures/memory-label-reference.js";
import { fakeGl, labelContext } from "./fixtures/memory-renderer-harness.js";

const nodes: MemoryGraphNode[] = Array.from({ length: 500 }, (_, i) => ({ id: `n${i}`, type: i < 100 ? "SOURCE" : "MEMORY", label: i === 499 ? "space.md" : i === 498 ? "a".repeat(49) : `Node ${i}`, recordId: null, sourcePath: null }));

describe("label loop equivalence", () => {
  it("remeasures after context or font-metric invalidation while retaining stable metrics", () => {
    const graph=nodes.slice(0,1),data=prepareMemoryGpuData(graph,[],new Map()),renderer=new MemoryWebGLRenderer(fakeGl().gl);
    renderer.setGraph(graph,data);renderer.setPositions(new Map([[graph[0]!.id,{x:0,y:0,z:0}]]));renderer.resize(900,460,2);
    const first=labelContext(),second=labelContext(),camera={yaw:0,pitch:0,zoom:1};
    renderer.labels(first.context,camera,true);renderer.labels(first.context,camera,true);expect(first.measure).toHaveBeenCalledTimes(1);
    second.measure.mockReturnValue({width:100});renderer.labels(second.context,camera,true);expect(second.measure).toHaveBeenCalledTimes(1);
    expect(second.commands.find(command=>command[0]==="rect")?.[4]).toBe(106);
    renderer.invalidateLabelMeasurements();renderer.labels(second.context,camera,true);expect(second.measure).toHaveBeenCalledTimes(2);
  });
  it("matches the original commands across camera, zoom, DPR, focus and graph changes", () => {
    const renderer = new MemoryWebGLRenderer(fakeGl().gl);
    for (const version of [0, 1]) {
      const graph = nodes.map(node => ({ ...node, id: `${node.id}:${version}`, label: `${node.label}${version ? " new" : ""}` }));
      const data = prepareMemoryGpuData(graph, [], new Map());
      const points = new Float32Array(graph.flatMap((_, i) => [(i % 23 - 11) * 14, (i % 19 - 9) * 12, (i % 7 - 3) * 20]));
      const indexed = new IndexedMemoryCoordinates(data.index, points);
      const map = new Map(graph.map(node => [node.id, indexed.get(node.id)!]));
      for (const coordinates of [map, indexed]) {
        renderer.setGraph(graph, data); renderer.setPositions(coordinates, new Float32Array(2048), 220);
        const cache = new MemoryLabelCache(graph, data.labels);
        for (const dpr of [1, 2]) for (const zoom of [.35, 1, 1.599999, 1.6, 2, 5]) for (const focus of [-1, 0, 498, 499, 390, -1]) {
          renderer.resize(900, 460, dpr); renderer.setFocus(graph[focus]?.id ?? null);
          const camera = { yaw: zoom * .7, pitch: zoom * -.2, zoom };
          const old = labelContext(), next = labelContext();
          referenceLabels.call({ width: 900, height: 460, extent: 220, nodes: graph, data, coordinates, labelCache: cache, focus }, old.context, camera, true);
          renderer.labels(next.context, camera, true);
          expect(next.commands).toEqual(old.commands);
        }
      }
    }
    renderer.dispose();
  });

  it("preserves strict collision and viewport boundaries, missing points and hidden titles", () => {
    const graph = nodes.slice(0, 12).map(node => ({ ...node, label: "x" }));
    // At scale=zoom=1 and no rotation, place labels exactly at and just inside each edge.
    const screen = [[100,100], [110,100], [109.999999,100], [100,116], [100,115.999999], [0,14], [-.000001,14], [875,455], [875.000001,455], [300,13.999999], [400,455.000001]];
    const coordinates = new Map(screen.map(([x,y],i) => [graph[i]!.id, { x: x! - 459, y: 230 - y!, z: 0 }]));
    const data = prepareMemoryGpuData(graph, [], new Map());
    const renderer = new MemoryWebGLRenderer(fakeGl().gl);
    renderer.setGraph(graph, data); renderer.setPositions(coordinates, new Float32Array(1024), 184); renderer.resize(900,460,2);
    for (const visible of [true, false, true]) {
      const old = labelContext(), next = labelContext(), camera = { yaw:0,pitch:0,zoom:1 };
      referenceLabels.call({ width:900,height:460,extent:184,nodes:graph,data,coordinates,labelCache:new MemoryLabelCache(graph,data.labels),focus:-1 },old.context,camera,visible);
      renderer.labels(next.context,camera,visible); expect(next.commands).toEqual(old.commands);
    }
  });

  it("uses four trig evaluations per pass and no allocating indexed getter", () => {
    const data = prepareMemoryGpuData(nodes, [], new Map()), points = new Float32Array(nodes.length * 3);
    const coordinates = new IndexedMemoryCoordinates(data.index, points), renderer = new MemoryWebGLRenderer(fakeGl().gl);
    renderer.setGraph(nodes,data); renderer.setPositions(coordinates,new Float32Array(2048),60); renderer.resize(900,460,2);
    const get = vi.spyOn(coordinates,"get"), sin = vi.spyOn(Math,"sin"), cos = vi.spyOn(Math,"cos");
    renderer.labels(labelContext().context,{yaw:.3,pitch:-.15,zoom:2},true);
    expect(get).not.toHaveBeenCalled(); expect(sin).toHaveBeenCalledTimes(2); expect(cos).toHaveBeenCalledTimes(2);
    vi.restoreAllMocks();
    const first=coordinates.get(nodes[0]!.id)!, second=coordinates.get(nodes[0]!.id)!;
    expect(first).not.toBe(second); first.x=123; expect(second.x).toBe(0);
  });
});
