// baseline.ts
function pickMemoryNode(index2, camera, scale, width, height, screenX, screenY, focus = -1, scratch) {
  if (!index2.tree.length) return -1;
  const { bounds, tree, points, radii, order } = index2;
  const cy = Math.cos(camera.yaw), sy = Math.sin(camera.yaw), cp = Math.cos(camera.pitch), sp = Math.sin(camera.pitch);
  const px = screenX - width / 2, py = height / 2 - screenY, zoomScale = scale * camera.zoom, rootZoom = Math.sqrt(camera.zoom);
  const stack2 = scratch && scratch.length >= tree.length / 4 ? scratch : new Int32Array(tree.length / 4);
  stack2[0] = 0;
  let remaining = 1, selected = -1, bestDepth = Infinity;
  while (remaining) {
    const id = stack2[--remaining], at = id * 5, cx = bounds[at], yy = bounds[at + 1], zz = bounds[at + 2], radius = bounds[at + 3];
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
        stack2[remaining++] = right;
        stack2[remaining++] = left;
      } else {
        stack2[remaining++] = left;
        stack2[remaining++] = right;
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
async function loadWasmPicker(bytes2, index2, precomputed2 = false) {
  const instantiateStart = performance.now();
  const { instance } = await WebAssembly.instantiate(bytes2, { math: { sin: Math.sin, cos: Math.cos } });
  const instantiateMs = performance.now() - instantiateStart;
  const setupStart = performance.now();
  const memory = instance.exports.memory;
  const kernel = instance.exports.pick_node;
  const precalculatedKernel = instance.exports.pick_node_precomputed;
  const base = Number(instance.exports.__heap_base.value);
  const arrays = [index2.points, index2.radii, index2.order, index2.bounds, index2.tree];
  const scratchBytes = index2.tree.length;
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
  const scratch = next, treeLength = index2.tree.length;
  return {
    setup: { instantiateMs, copyAndMemoryMs: performance.now() - setupStart, copiedBytes, memoryBytes: memory.buffer.byteLength },
    pick: precomputed2 ? function(camera, scale, width, height, x, y, focus = -1) {
      return precalculatedKernel(points, radii, order, bounds, tree, scratch, treeLength, Math.cos(camera.yaw), Math.sin(camera.yaw), Math.cos(camera.pitch), Math.sin(camera.pitch), camera.zoom, scale, width, height, x, y, focus);
    } : function(camera, scale, width, height, x, y, focus = -1) {
      return kernel(points, radii, order, bounds, tree, scratch, treeLength, camera.yaw, camera.pitch, camera.zoom, scale, width, height, x, y, focus);
    }
  };
}

// cases.ts
function typedIndex(saved2) {
  const d = saved2.input.index;
  return { points: new Float32Array(d.points), radii: new Float32Array(d.radii), order: new Uint32Array(d.order), bounds: new Float32Array(d.bounds), tree: new Int32Array(d.tree) };
}
function trajectory(saved2) {
  return Array.from({ length: 600 }, (_, i) => {
    const elapsed = (i + 1) * 1e3 / 60, now = 246284.9 + elapsed;
    const width = 898.5078125, height = 460;
    return { camera: { yaw: 0.3 + (i + 1) * 0.012, pitch: Math.sin(elapsed / 3e3) * 0.5, zoom: 1 + Math.sin(elapsed / 1800) * 0.3 }, scale: saved2.input.scale * height / saved2.input.height, width, height, x: width * (0.5 + 0.2 * Math.sin(now / 1700)), y: height / 2, focus: -1 };
  });
}

// browser.ts
var params = new URLSearchParams(location.search);
var count = Number(params.get("nodes") ?? 5e4);
var first = params.get("first") === "wasm" ? "wasm" : "js";
var precomputed = params.get("mode") === "precomputed";
var label = params.get("label") === "foreground" ? "foreground" : "initial";
var saved = await (await fetch(`./actual-${count}.json`)).json();
var index = typedIndex(saved);
var queries = trajectory(saved);
var stack = new Int32Array(index.tree.length / 4);
var bytes = await (await fetch("./picking.wasm")).arrayBuffer();
var wasm = await loadWasmPicker(bytes, index, precomputed);
var run = document.querySelector("#run");
var download = document.querySelector("#download");
var output = document.querySelector("#result");
var status = document.querySelector("#status");
var results = [];
var percentile = (values, p) => [...values].sort((a, b) => a - b)[Math.ceil(values.length * p) - 1];
var stats = (values) => ({ p50Ms: percentile(values, 0.5), p95Ms: percentile(values, 0.95), maxMs: Math.max(...values), meanMs: values.reduce((a, b) => a + b, 0) / values.length });
status.textContent = `Ready: ${count.toLocaleString()} nodes. First call: ${first}. Camera math: ${precomputed ? "JavaScript" : "Wasm imports"}. 600 individual queries plus 4,800 batched queries per implementation. Keep this tab visible.`;
run.disabled = false;
run.onclick = () => {
  run.disabled = true;
  download.disabled = true;
  const samples = [], batches = [];
  let invalid = document.visibilityState !== "visible", focus = -1, sample = 0, mismatches = 0, checksum = 0;
  const focusAtStart = document.hasFocus(), startedAt = (/* @__PURE__ */ new Date()).toISOString();
  let blurEvents = 0;
  const blur = () => {
    blurEvents++;
  };
  window.addEventListener("blur", blur);
  const hide = () => {
    if (document.visibilityState !== "visible") invalid = true;
  };
  document.addEventListener("visibilitychange", hide);
  status.textContent = "Measuring individual calls, then short batches\u2026";
  const call = (implementation, q) => {
    const start = performance.now();
    const selected = implementation === "js" ? pickMemoryNode(index, q.camera, q.scale, q.width, q.height, q.x, q.y, q.focus, stack) : wasm.pick(q.camera, q.scale, q.width, q.height, q.x, q.y, q.focus);
    return { selected, ms: performance.now() - start };
  };
  const finish = () => {
    document.removeEventListener("visibilitychange", hide);
    window.removeEventListener("blur", blur);
    const focusAtEnd = document.hasFocus();
    const result = {
      count,
      run: results.length,
      first,
      precomputed,
      label,
      startedAt,
      focusAtStart,
      focusAtEnd,
      blurEvents,
      visibilityValid: !invalid,
      valid: !invalid && focusAtStart && focusAtEnd && blurEvents === 0,
      mismatches,
      checksum,
      userAgent: navigator.userAgent,
      setup: wasm.setup,
      wasmBytes: bytes.byteLength,
      individual: { js: stats(samples.map((s) => s.js.ms)), wasm: stats(samples.map((s) => s.wasm.ms)) },
      batchPerQuery: { js: stats(batches.map((b) => b.js.ms / b.queries)), wasm: stats(batches.map((b) => b.wasm.ms / b.queries)) },
      samples,
      batches
    };
    results.push(result);
    output.textContent = JSON.stringify(result, null, 2);
    status.textContent = `Complete. ${mismatches} mismatches. Visible throughout: ${!invalid}. Focused throughout: ${focusAtStart && focusAtEnd && blurEvents === 0}.`;
    run.disabled = false;
    download.disabled = false;
  };
  let batch = 0;
  const batchFrame = () => {
    hide();
    const offset = batch * 25, batchQueries = 200;
    const measure = (implementation) => {
      let sum = 0;
      const start = performance.now();
      for (let repeat = 0; repeat < 8; repeat++) for (let i = offset; i < offset + 25; i++) {
        const q = queries[i];
        sum += implementation === "js" ? pickMemoryNode(index, q.camera, q.scale, q.width, q.height, q.x, q.y, q.focus, stack) : wasm.pick(q.camera, q.scale, q.width, q.height, q.x, q.y, q.focus);
      }
      return { ms: performance.now() - start, checksum: sum };
    };
    const order = batch % 2 === 0 === (first === "js") ? ["js", "wasm"] : ["wasm", "js"];
    const a = measure(order[0]), b = measure(order[1]);
    const values = { [order[0]]: a, [order[1]]: b };
    batches.push({ batch, queries: batchQueries, order, ...values });
    if (values.js.checksum !== values.wasm.checksum) mismatches++;
    checksum += a.checksum + b.checksum;
    if (++batch < 24) requestAnimationFrame(batchFrame);
    else finish();
  };
  const frame = (timestamp) => {
    hide();
    const q = queries[sample];
    q.focus = focus;
    const order = sample % 2 === 0 === (first === "js") ? ["js", "wasm"] : ["wasm", "js"];
    const a = call(order[0], q), b = call(order[1], q);
    const values = { [order[0]]: a, [order[1]]: b };
    if (a.selected !== b.selected) mismatches++;
    focus = values.js.selected;
    samples.push({ sample, timestamp, order, ...values });
    if (++sample < 600) requestAnimationFrame(frame);
    else requestAnimationFrame(batchFrame);
  };
  requestAnimationFrame(frame);
};
download.onclick = () => {
  const url = URL.createObjectURL(new Blob([JSON.stringify(results, null, 2)], { type: "application/json" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `wasm-picking-${count}-${first}-${precomputed ? "precomputed" : "imports"}-${label}-results.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1e3);
};
