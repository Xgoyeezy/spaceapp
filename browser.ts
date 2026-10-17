import { pickMemoryNode } from "./baseline.js";
import { loadWasmPicker } from "./wasm-picker.js";
import { trajectory, typedIndex } from "./cases.js";
const params = new URLSearchParams(location.search), count = Number(params.get("nodes") ?? 50000);
const first = params.get("first") === "wasm" ? "wasm" : "js";
const precomputed = params.get("mode") === "precomputed";
const label = params.get("label") === "foreground" ? "foreground" : "initial";
const saved = await (await fetch(`./actual-${count}.json`)).json();
const index = typedIndex(saved), queries = trajectory(saved), stack = new Int32Array(index.tree.length / 4);
const bytes = await (await fetch("./picking.wasm")).arrayBuffer();
const wasm = await loadWasmPicker(bytes, index, precomputed);
const run = document.querySelector<HTMLButtonElement>("#run")!, download = document.querySelector<HTMLButtonElement>("#download")!;
const output = document.querySelector("#result")!, status = document.querySelector("#status")!;
const results: any[] = [];
const percentile = (values: number[], p: number) => [...values].sort((a, b) => a - b)[Math.ceil(values.length * p) - 1];
const stats = (values: number[]) => ({ p50Ms: percentile(values, .5), p95Ms: percentile(values, .95), maxMs: Math.max(...values), meanMs: values.reduce((a, b) => a + b, 0) / values.length });
status.textContent = `Ready: ${count.toLocaleString()} nodes. First call: ${first}. Camera math: ${precomputed ? "JavaScript" : "Wasm imports"}. 600 individual queries plus 4,800 batched queries per implementation. Keep this tab visible.`;
run.disabled = false;
run.onclick = () => {
  run.disabled = true; download.disabled = true;
  const samples: any[] = [], batches: any[] = [];
  let invalid = document.visibilityState !== "visible", focus = -1, sample = 0, mismatches = 0, checksum = 0;
  const focusAtStart = document.hasFocus(), startedAt = new Date().toISOString();
  let blurEvents = 0;
  const blur = () => { blurEvents++; };
  window.addEventListener("blur", blur);
  const hide = () => { if (document.visibilityState !== "visible") invalid = true; };
  document.addEventListener("visibilitychange", hide);
  status.textContent = "Measuring individual calls, then short batches…";
  const call = (implementation: string, q: any) => {
    const start = performance.now();
    const selected = implementation === "js"
      ? pickMemoryNode(index, q.camera, q.scale, q.width, q.height, q.x, q.y, q.focus, stack)
      : wasm.pick(q.camera, q.scale, q.width, q.height, q.x, q.y, q.focus);
    return { selected, ms: performance.now() - start };
  };
  const finish = () => {
    document.removeEventListener("visibilitychange", hide);
    window.removeEventListener("blur", blur);
    const focusAtEnd = document.hasFocus();
    const result = { count, run: results.length, first, precomputed, label, startedAt, focusAtStart, focusAtEnd, blurEvents, visibilityValid: !invalid, valid: !invalid && focusAtStart && focusAtEnd && blurEvents === 0, mismatches, checksum, userAgent: navigator.userAgent, setup: wasm.setup, wasmBytes: bytes.byteLength,
      individual: { js: stats(samples.map(s => s.js.ms)), wasm: stats(samples.map(s => s.wasm.ms)) },
      batchPerQuery: { js: stats(batches.map(b => b.js.ms / b.queries)), wasm: stats(batches.map(b => b.wasm.ms / b.queries)) }, samples, batches };
    results.push(result); output.textContent = JSON.stringify(result, null, 2);
    status.textContent = `Complete. ${mismatches} mismatches. Visible throughout: ${!invalid}. Focused throughout: ${focusAtStart && focusAtEnd && blurEvents === 0}.`;
    run.disabled = false; download.disabled = false;
  };
  let batch = 0;
  const batchFrame = () => {
    hide();
    const offset = batch * 25, batchQueries = 200;
    const measure = (implementation: string) => {
      let sum = 0;
      const start = performance.now();
      for (let repeat = 0; repeat < 8; repeat++) for (let i = offset; i < offset + 25; i++) {
        const q = queries[i]!;
        sum += implementation === "js"
          ? pickMemoryNode(index, q.camera, q.scale, q.width, q.height, q.x, q.y, q.focus, stack)
          : wasm.pick(q.camera, q.scale, q.width, q.height, q.x, q.y, q.focus);
      }
      return { ms: performance.now() - start, checksum: sum };
    };
    const order = (batch % 2 === 0) === (first === "js") ? ["js", "wasm"] : ["wasm", "js"];
    const a = measure(order[0]!), b = measure(order[1]!);
    const values: any = { [order[0]!]: a, [order[1]!]: b };
    batches.push({ batch, queries: batchQueries, order, ...values });
    if (values.js.checksum !== values.wasm.checksum) mismatches++;
    checksum += a.checksum + b.checksum;
    if (++batch < 24) requestAnimationFrame(batchFrame); else finish();
  };
  const frame = (timestamp: number) => {
    hide();
    const q = queries[sample]!; q.focus = focus;
    const order = (sample % 2 === 0) === (first === "js") ? ["js", "wasm"] : ["wasm", "js"];
    const a = call(order[0]!, q), b = call(order[1]!, q);
    const values: any = { [order[0]!]: a, [order[1]!]: b };
    if (a.selected !== b.selected) mismatches++;
    focus = values.js.selected;
    samples.push({ sample, timestamp, order, ...values });
    if (++sample < 600) requestAnimationFrame(frame); else requestAnimationFrame(batchFrame);
  };
  requestAnimationFrame(frame);
};
download.onclick = () => {
  const url = URL.createObjectURL(new Blob([JSON.stringify(results, null, 2)], { type: "application/json" }));
  const a = document.createElement("a"); a.href = url; a.download = `wasm-picking-${count}-${first}-${precomputed ? "precomputed" : "imports"}-${label}-results.json`; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};
