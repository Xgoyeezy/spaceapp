import { MemoryWorkerDiagnostics, type MemoryWorkerTrace } from "./memory-worker-diagnostics.js";
import { streamMemoryNetwork3D, memory3DVolumeRatio } from "./memory-3d.js";
import { layoutMemoryNetwork } from "./memory-network-layout.js";
import { createMemoryAtlas, type MemoryAtlasPosition } from "./memory-atlas.js";
import { buildMemoryPickIndex, type MemoryPickIndex } from "./memory-picking.js";
import { isMemoryCoreLabel } from "./memory-graph-visuals.js";
import { prepareMemoryGpuData } from "./memory-webgl-data.js";
import type { MemoryGraphNode, MemoryGraphEdge } from "@space/contracts";
import { yieldMemoryWork as pause } from "./memory-yield.js";

type Atlas = ReturnType<typeof createMemoryAtlas>;
export type MemoryLayoutRequest =
  | { kind: "nodes"; nodes: MemoryGraphNode[]; diagnosticGeneration?: number }
  | { kind: "edges"; edges: MemoryGraphEdge[] }
  | { kind: "run"; view3D: boolean };
export type MemoryLayoutMessage = {
  workerTrace?: MemoryWorkerTrace;
  positions?: Array<[string, MemoryAtlasPosition]>;
  atlas?: Omit<Atlas, "nodes" | "edges" | "positions">;
  nodeIndices?: Uint32Array;
  edgeIndices?: Uint32Array;
  depth?: Float32Array;
  gpuPositions?: Float32Array;
  extent?: number;
  volume?: number;
  picking?: MemoryPickIndex;
  gpu?: Omit<ReturnType<typeof prepareMemoryGpuData>, "index">;
  done?: boolean;
  iteration?: number;
};
const nodes: MemoryGraphNode[] = [], edges: MemoryGraphEdge[] = [];
let running = false;
let diagnostics: MemoryWorkerDiagnostics | undefined;
const measure = <T>(name: string, fn: () => T): T => diagnostics ? diagnostics.measure(name, fn) : fn();
const post = (message: MemoryLayoutMessage, transfer: ArrayBufferLike[] = []) => {
  if (diagnostics) diagnostics.post(message, transfer);
  else self.postMessage(message, { transfer });
};
const yieldWork = () => diagnostics ? diagnostics.pause(pause) : pause();

async function run(view3D: boolean) {
  const atlas = measure("atlas.initialize", () => createMemoryAtlas(nodes, edges, false));
  if (!view3D) {
    const positions = measure("layout.2d", () => layoutMemoryNetwork(atlas.nodes, atlas.edges));
    for (const [id, style] of atlas.positions) Object.assign(style, positions.get(id));
  }
  // Send bounded messages. Cloning the entire 150k-edge graph in either
  // direction creates a main-thread stall even though layout runs off-thread.
  const positions = measure("positions.metadata", () => [...atlas.positions]);
  for (let i = 0; i < positions.length; i += 1000) {
    post({ positions: positions.slice(i, i + 1000) });
    await yieldWork();
  }
  const indicesStart = diagnostics?.start() ?? 0;
  const nodeIndex = new Map(nodes.map((node, i) => [node, i]));
  const edgeIndex = new Map(edges.map((edge, i) => [edge, i]));
  const nodeIndices = Uint32Array.from(atlas.nodes, node => nodeIndex.get(node)!);
  const edgeIndices = Uint32Array.from(atlas.edges, edge => edgeIndex.get(edge)!);
  diagnostics?.end("indices.prepare", indicesStart);
  const { groups, topics, explicitCount, semanticCount } = atlas;
  for (let i = 0; i < nodeIndices.length; i += 1000) {
    const batch = nodeIndices.slice(i, i + 1000);
    post({ nodeIndices: batch }, [batch.buffer]);
    await yieldWork();
  }
  for (let i = 0; i < edgeIndices.length; i += 2000) {
    const batch = edgeIndices.slice(i, i + 2000);
    post({ edgeIndices: batch }, [batch.buffer]);
    await yieldWork();
  }
  post({ atlas: { groups, topics, explicitCount, semanticCount } });
  if (!view3D) {
    post({ done: true, iteration: 180 });
    diagnostics?.finish();
    return;
  }
  let first = true;
  const gpu = measure("gpu.prepare", () => prepareMemoryGpuData(atlas.nodes, atlas.edges, atlas.positions));
  // IDs and the lookup map are assembled from the bounded node batches above.
  // Sending a 50k-entry Map in one message would synchronously clone it on receipt.
  const { index: _index, ...gpuBuffers } = gpu;

  for (const frame of streamMemoryNetwork3D(atlas.nodes, atlas.edges, 12, diagnostics)) {
    const packStart = diagnostics?.start() ?? 0;
    const depth = new Float32Array(atlas.nodes.length * 3);
    const gpuPositions = new Float32Array(256 * Math.max(1, Math.ceil(atlas.nodes.length / 256)) * 4);
    const radii = new Float32Array(atlas.nodes.length);
    let extent = 60;
    atlas.nodes.forEach((node, i) => {
      const p = frame.positions.get(node.id)!;
      const radius = node.type === "SOURCE" ? isMemoryCoreLabel(node.label) ? 10 : 4.6 : 2.1;
      depth.set([p.x, p.y, p.z], i * 3); gpuPositions.set([p.x, p.y, p.z, radius], i * 4); radii[i] = radius;
      extent = Math.max(extent, Math.hypot(p.x, p.y, p.z));
    });
    diagnostics?.end("positions.pack", packStart);
    const volume = measure("volume", () => memory3DVolumeRatio([...frame.positions.values()]));
    const picking = measure("picking.build", () => buildMemoryPickIndex(depth, radii));
    const transfer = measure("transfer.prepare", () => [depth.buffer, gpuPositions.buffer, radii.buffer, picking.order.buffer, picking.bounds.buffer, picking.tree.buffer,
      ...(first ? [gpu.colors.buffer, gpu.radii.buffer, gpu.endpoints.buffer, gpu.edgeKinds.buffer, gpu.offsets.buffer, gpu.neighbors.buffer] : [])]);
    post({ ...(first ? { gpu: gpuBuffers } : {}), depth, gpuPositions, extent, volume, picking, done: frame.done, iteration: frame.iteration }, transfer);
    first = false;
    await yieldWork();
  }
  diagnostics?.finish();
}
self.onmessage = (event: MessageEvent<MemoryLayoutRequest>) => {
  if (running) return;
  if (event.data.kind === "nodes") {
    if (!diagnostics && event.data.diagnosticGeneration !== undefined) diagnostics = new MemoryWorkerDiagnostics("layout", event.data.diagnosticGeneration);
    measure("receive.nodes", () => { if (event.data.kind === "nodes") nodes.push(...event.data.nodes); });
  } else if (event.data.kind === "edges") measure("receive.edges", () => { if (event.data.kind === "edges") edges.push(...event.data.edges); });
  else { running = true; void run(event.data.view3D); }
};
