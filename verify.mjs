// verify.ts
import { readFile, writeFile } from "node:fs/promises";

// baseline.ts
var LEAF_SIZE = 24;
function buildMemoryPickIndex(points, radii) {
  const count = radii.length, order = Uint32Array.from({ length: count }, (_, i) => i);
  const bounds = [], tree = [];
  const build = (start, end) => {
    const id = tree.length / 4;
    let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity, radius = 0;
    for (let i = start; i < end; i++) {
      const point = order[i], at = point * 3, x2 = points[at], y2 = points[at + 1], z2 = points[at + 2];
      minX = Math.min(minX, x2);
      minY = Math.min(minY, y2);
      minZ = Math.min(minZ, z2);
      maxX = Math.max(maxX, x2);
      maxY = Math.max(maxY, y2);
      maxZ = Math.max(maxZ, z2);
      radius = Math.max(radius, radii[point]);
    }
    const x = (minX + maxX) / 2, y = (minY + maxY) / 2, z = (minZ + maxZ) / 2;
    bounds.push(x, y, z, Math.hypot(maxX - x, maxY - y, maxZ - z), radius);
    tree.push(start, end, -1, -1);
    if (end - start > LEAF_SIZE) {
      const sizes = [maxX - minX, maxY - minY, maxZ - minZ];
      const axis = sizes[0] >= sizes[1] && sizes[0] >= sizes[2] ? 0 : sizes[1] >= sizes[2] ? 1 : 2;
      order.subarray(start, end).sort((a, b) => points[a * 3 + axis] - points[b * 3 + axis] || a - b);
      const middle = start + Math.floor((end - start) / 2);
      tree[id * 4 + 2] = build(start, middle);
      tree[id * 4 + 3] = build(middle, end);
    }
    return id;
  };
  if (count) build(0, count);
  return { points, radii, order, bounds: new Float32Array(bounds), tree: new Int32Array(tree) };
}
function pickMemoryNode(index, camera, scale, width, height, screenX, screenY, focus = -1, scratch) {
  if (!index.tree.length) return -1;
  const { bounds, tree, points, radii, order } = index;
  const cy = Math.cos(camera.yaw), sy = Math.sin(camera.yaw), cp = Math.cos(camera.pitch), sp = Math.sin(camera.pitch);
  const px = screenX - width / 2, py = height / 2 - screenY, zoomScale = scale * camera.zoom, rootZoom = Math.sqrt(camera.zoom);
  const stack = scratch && scratch.length >= tree.length / 4 ? scratch : new Int32Array(tree.length / 4);
  stack[0] = 0;
  let remaining = 1, selected = -1, bestDepth = Infinity;
  while (remaining) {
    const id = stack[--remaining], at = id * 5, cx = bounds[at], yy = bounds[at + 1], zz = bounds[at + 2], radius = bounds[at + 3];
    const x = cx * cy + zz * sy, d = -cx * sy + zz * cy, y = yy * cp - d * sp, z = yy * sp + d * cp;
    if (z - radius > bestDepth) continue;
    const near = 650 / Math.max(120, 650 + (z - radius) * scale), far = 650 / Math.max(120, 650 + (z + radius) * scale);
    const padding = Math.max(7, bounds[at + 4] * near * rootZoom * 1.5 + 3);
    const minX = (x - radius) * zoomScale, maxX = (x + radius) * zoomScale, minY = (y - radius) * zoomScale, maxY = (y + radius) * zoomScale;
    if (px < Math.min(minX * near, minX * far) - padding || px > Math.max(maxX * near, maxX * far) + padding || py < Math.min(minY * near, minY * far) - padding || py > Math.max(maxY * near, maxY * far) + padding) continue;
    const row = id * 4, left = tree[row + 2], right = tree[row + 3];
    if (left >= 0) {
      const l = left * 5, r = right * 5;
      const leftDepth = bounds[l + 1] * sp + (-bounds[l] * sy + bounds[l + 2] * cy) * cp;
      const rightDepth = bounds[r + 1] * sp + (-bounds[r] * sy + bounds[r + 2] * cy) * cp;
      if (leftDepth < rightDepth) {
        stack[remaining++] = right;
        stack[remaining++] = left;
      } else {
        stack[remaining++] = left;
        stack[remaining++] = right;
      }
      continue;
    }
    for (let i = tree[row]; i < tree[row + 1]; i++) {
      const node = order[i], offset = node * 3, nx = points[offset] * cy + points[offset + 2] * sy, nd = -points[offset] * sy + points[offset + 2] * cy;
      const ny = points[offset + 1] * cp - nd * sp, nz = points[offset + 1] * sp + nd * cp;
      if (nz > bestDepth) continue;
      const perspective = 650 / Math.max(120, 650 + nz * scale);
      const hitRadius = Math.max(7, Math.max(1, radii[node] * perspective * rootZoom) * (node === focus ? 1.5 : 1) + 3);
      const dx = nx * zoomScale * perspective - px, dy = ny * zoomScale * perspective - py;
      if (dx * dx + dy * dy <= hitRadius * hitRadius && (nz < bestDepth || selected < 0 || node < selected)) {
        selected = node;
        bestDepth = nz;
      }
    }
  }
  return selected;
}

// wasm-picker.ts
async function loadWasmPicker(bytes2, index, precomputed = false) {
  const instantiateStart = performance.now();
  const { instance } = await WebAssembly.instantiate(bytes2, { math: { sin: Math.sin, cos: Math.cos } });
  const instantiateMs = performance.now() - instantiateStart;
  const setupStart = performance.now();
  const memory = instance.exports.memory;
  const kernel = instance.exports.pick_node;
  const precalculatedKernel = instance.exports.pick_node_precomputed;
  const base = Number(instance.exports.__heap_base.value);
  const arrays = [index.points, index.radii, index.order, index.bounds, index.tree];
  const scratchBytes = index.tree.length;
  const copiedBytes = arrays.reduce((sum, array) => sum + array.byteLength, 0);
  const end = base + copiedBytes + scratchBytes;
  if (end > memory.buffer.byteLength) memory.grow(Math.ceil((end - memory.buffer.byteLength) / 65536));
  const pointers = [];
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
    pick: precomputed ? function(camera, scale, width, height, x, y, focus = -1) {
      return precalculatedKernel(points, radii, order, bounds, tree, scratch, treeLength, Math.cos(camera.yaw), Math.sin(camera.yaw), Math.cos(camera.pitch), Math.sin(camera.pitch), camera.zoom, scale, width, height, x, y, focus);
    } : function(camera, scale, width, height, x, y, focus = -1) {
      return kernel(points, radii, order, bounds, tree, scratch, treeLength, camera.yaw, camera.pitch, camera.zoom, scale, width, height, x, y, focus);
    }
  };
}

// cases.ts
function typedIndex(saved) {
  const d = saved.input.index;
  return { points: new Float32Array(d.points), radii: new Float32Array(d.radii), order: new Uint32Array(d.order), bounds: new Float32Array(d.bounds), tree: new Int32Array(d.tree) };
}
function trajectory(saved) {
  return Array.from({ length: 600 }, (_, i) => {
    const elapsed = (i + 1) * 1e3 / 60, now = 246284.9 + elapsed;
    const width = 898.5078125, height = 460;
    return { camera: { yaw: 0.3 + (i + 1) * 0.012, pitch: Math.sin(elapsed / 3e3) * 0.5, zoom: 1 + Math.sin(elapsed / 1800) * 0.3 }, scale: saved.input.scale * height / saved.input.height, width, height, x: width * (0.5 + 0.2 * Math.sin(now / 1700)), y: height / 2, focus: -1 };
  });
}
function generated(count, coincident = false) {
  let state = 17;
  const points = new Float32Array(count * 3), radii = new Float32Array(count);
  for (let i = 0; i < points.length; i++) {
    state = Math.imul(state, 1664525) + 1013904223 >>> 0;
    points[i] = coincident ? 0 : (state / 4294967296 - 0.5) * 300;
  }
  for (let i = 0; i < count; i++) radii[i] = 1 + i % 7;
  return buildMemoryPickIndex(points, radii);
}
function randomQueries(count) {
  let state = 491;
  const next = () => {
    state = Math.imul(state, 1664525) + 1013904223 >>> 0;
    return state / 4294967296;
  };
  return Array.from({ length: count }, () => ({ camera: { yaw: next() * 12 - 6, pitch: next() * 3 - 1.5, zoom: 0.2 + next() * 4 }, scale: 0.2 + next() * 3, width: 900, height: 600, x: next() * 1100 - 100, y: next() * 800 - 100, focus: -1 }));
}

// verify.ts
var bytes = await readFile(new URL("./picking.wasm", import.meta.url));
var cases = [];
for (const count of [2e3, 5e4]) {
  const saved = JSON.parse(await readFile(new URL(`./actual-${count}.json`, import.meta.url), "utf8"));
  cases.push({ name: `captured-${count}`, index: typedIndex(saved), queries: [...trajectory(saved), ...randomQueries(5e3), { ...saved.input }] });
}
for (const count of [0, 1, 24, 25, 2e3, 5e4]) {
  cases.push({ name: `generated-${count}`, index: generated(count), queries: randomQueries(5e3) });
}
cases.push({ name: "coincident-tie-and-focus", index: generated(1e3, true), queries: [...randomQueries(1e3), ...Array.from({ length: 1e3 }, (_, focus) => ({ camera: { yaw: 0, pitch: 0, zoom: 1 }, scale: 1, width: 900, height: 600, x: 450, y: 300, focus }))] });
var result = [];
for (const precomputed of [false, true]) for (const test of cases) {
  const wasm = await loadWasmPicker(bytes, test.index, precomputed), stack = new Int32Array(test.index.tree.length / 4);
  let previous = -1, mismatches = 0;
  const examples = [];
  for (let i = 0; i < test.queries.length; i++) {
    const q = test.queries[i], focus = q.focus >= 0 ? q.focus : previous;
    const js = pickMemoryNode(test.index, q.camera, q.scale, q.width, q.height, q.x, q.y, focus, stack);
    const c = wasm.pick(q.camera, q.scale, q.width, q.height, q.x, q.y, focus);
    if (js !== c) {
      mismatches++;
      if (examples.length < 5) examples.push({ i, js, c });
    }
    previous = js;
  }
  result.push({ name: test.name, precomputed, count: test.index.radii.length, queries: test.queries.length, mismatches, examples, setup: wasm.setup });
}
await writeFile(new URL("./equivalence-results.json", import.meta.url), JSON.stringify({ runtime: process.version, v8: process.versions.v8, result }, null, 2) + "\n");
console.log(JSON.stringify(result.map(({ name, queries, mismatches }) => ({ name, queries, mismatches }))));
if (result.some((r) => r.mismatches)) process.exitCode = 1;
