import type { MemoryPickIndex } from "./baseline.js";

export async function loadWasmPicker(bytes: BufferSource, index: MemoryPickIndex, precomputed = false) {
  const instantiateStart = performance.now();
  const { instance } = await WebAssembly.instantiate(bytes, { math: { sin: Math.sin, cos: Math.cos } });
  const instantiateMs = performance.now() - instantiateStart;
  const setupStart = performance.now();
  const memory = instance.exports.memory as WebAssembly.Memory;
  const kernel = instance.exports.pick_node as (...args: number[]) => number;
  const precalculatedKernel = instance.exports.pick_node_precomputed as (...args: number[]) => number;
  const base = Number((instance.exports.__heap_base as WebAssembly.Global).value);
  const arrays = [index.points, index.radii, index.order, index.bounds, index.tree];
  const scratchBytes = index.tree.length;
  const copiedBytes = arrays.reduce((sum, array) => sum + array.byteLength, 0);
  const end = base + copiedBytes + scratchBytes;
  if (end > memory.buffer.byteLength) memory.grow(Math.ceil((end - memory.buffer.byteLength) / 65536));
  const pointers: number[] = [];
  let next = base;
  for (const array of arrays) {
    pointers.push(next);
    new Uint8Array(memory.buffer, next, array.byteLength).set(new Uint8Array(array.buffer, array.byteOffset, array.byteLength));
    next += array.byteLength;
  }
  const [points, radii, order, bounds, tree] = pointers;
  const scratch = next, treeLength = index.tree.length;
  return {
    setup: { instantiateMs, copyAndMemoryMs: performance.now() - setupStart, copiedBytes, memoryBytes: memory.buffer.byteLength },
    pick: precomputed ? function(camera: { yaw: number; pitch: number; zoom: number }, scale: number, width: number, height: number, x: number, y: number, focus = -1) {
      return precalculatedKernel(points!, radii!, order!, bounds!, tree!, scratch, treeLength, Math.cos(camera.yaw), Math.sin(camera.yaw), Math.cos(camera.pitch), Math.sin(camera.pitch), camera.zoom, scale, width, height, x, y, focus);
    } : function(camera: { yaw: number; pitch: number; zoom: number }, scale: number, width: number, height: number, x: number, y: number, focus = -1) {
      return kernel(points!, radii!, order!, bounds!, tree!, scratch, treeLength, camera.yaw, camera.pitch, camera.zoom, scale, width, height, x, y, focus);
    }
  };
}
