import { readFile, writeFile } from "node:fs/promises";
import { pickMemoryNode } from "./baseline.js";
import { loadWasmPicker } from "./wasm-picker.js";
import { generated, randomQueries, trajectory, typedIndex } from "./cases.js";
const bytes = await readFile(new URL("./picking.wasm", import.meta.url));
const cases: any[] = [];
for (const count of [2000, 50000]) {
  const saved = JSON.parse(await readFile(new URL(`./actual-${count}.json`, import.meta.url), "utf8"));
  cases.push({ name: `captured-${count}`, index: typedIndex(saved), queries: [...trajectory(saved), ...randomQueries(5000), { ...saved.input }] });
}
for (const count of [0, 1, 24, 25, 2000, 50000]) {
  cases.push({ name: `generated-${count}`, index: generated(count), queries: randomQueries(5000) });
}
cases.push({ name: "coincident-tie-and-focus", index: generated(1000, true), queries: [...randomQueries(1000), ...Array.from({ length: 1000 }, (_, focus) => ({ camera: { yaw: 0, pitch: 0, zoom: 1 }, scale: 1, width: 900, height: 600, x: 450, y: 300, focus }))] });
const result = [];
for (const precomputed of [false, true]) for (const test of cases) {
  const wasm = await loadWasmPicker(bytes, test.index, precomputed), stack = new Int32Array(test.index.tree.length / 4);
  let previous = -1, mismatches = 0;
  const examples = [];
  for (let i = 0; i < test.queries.length; i++) {
    const q = test.queries[i], focus = q.focus >= 0 ? q.focus : previous;
    const js = pickMemoryNode(test.index, q.camera, q.scale, q.width, q.height, q.x, q.y, focus, stack);
    const c = wasm.pick(q.camera, q.scale, q.width, q.height, q.x, q.y, focus);
    if (js !== c) { mismatches++; if (examples.length < 5) examples.push({ i, js, c }); }
    previous = js;
  }
  result.push({ name: test.name, precomputed, count: test.index.radii.length, queries: test.queries.length, mismatches, examples, setup: wasm.setup });
}
await writeFile(new URL("./equivalence-results.json", import.meta.url), JSON.stringify({ runtime: process.version, v8: process.versions.v8, result }, null, 2) + "\n");
console.log(JSON.stringify(result.map(({ name, queries, mismatches }) => ({ name, queries, mismatches }))));
if (result.some(r => r.mismatches)) process.exitCode = 1;
