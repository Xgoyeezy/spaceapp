import type { MemoryGraphNode } from "@space/contracts";
import type { MemoryCoordinates } from "./memory-coordinates.js";
import type { MemoryPickIndex } from "./memory-picking.js";
import type { prepareMemoryGpuData } from "./memory-webgl-data.js";
import type { MemoryWebGLRenderer } from "./memory-webgl-renderer.js";

export type MemoryRenderSnapshot = {
  nodes: MemoryGraphNode[]; data: ReturnType<typeof prepareMemoryGpuData>;
  coordinates: MemoryCoordinates; positions?: Float32Array; extent?: number;
  picking: MemoryPickIndex | null; ids: string[]; index?: Map<string, number>;
};
type Target = Pick<MemoryWebGLRenderer, "setGraph" | "setPositions" | "setPicking">;

/** One owner for each immutable worker snapshot, including restored GPU contexts. */
export class MemoryRendererSync {
  private accepted: { target: Target; generation: number; snapshot: MemoryRenderSnapshot } | null = null;

  synchronize(target: Target, generation: number, next: MemoryRenderSnapshot) {
    const accepted = this.accepted;
    const previous = accepted?.target === target && accepted.generation === generation ? accepted.snapshot : null;
    const graphChanged = !previous || previous.nodes !== next.nodes || previous.data !== next.data;
    const positionsChanged = graphChanged || previous!.coordinates !== next.coordinates || previous!.positions !== next.positions || previous!.extent !== next.extent;
    if (graphChanged) target.setGraph(next.nodes, next.data);
    if (positionsChanged) target.setPositions(next.coordinates, next.positions, next.extent);
    // Publish the index in the same synchronous operation as its position version.
    if (positionsChanged || previous!.picking !== next.picking || previous!.ids !== next.ids || previous!.index !== next.index) {
      target.setPicking(next.picking, next.ids, next.index);
    }
    this.accepted = { target, generation, snapshot: next };
  }
}
