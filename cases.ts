import { buildMemoryPickIndex } from "./baseline.js";
export function typedIndex(saved: any) {
  const d = saved.input.index;
  return { points: new Float32Array(d.points), radii: new Float32Array(d.radii), order: new Uint32Array(d.order), bounds: new Float32Array(d.bounds), tree: new Int32Array(d.tree) };
}
export function trajectory(saved: any) {
  return Array.from({ length: 600 }, (_, i) => {
    const elapsed = (i + 1) * 1000 / 60, now = 246284.9 + elapsed;
    const width = 898.5078125, height = 460;
    return { camera: { yaw: .3 + (i + 1) * .012, pitch: Math.sin(elapsed / 3000) * .5, zoom: 1 + Math.sin(elapsed / 1800) * .3 }, scale: saved.input.scale * height / saved.input.height, width, height, x: width * (.5 + .2 * Math.sin(now / 1700)), y: height / 2, focus: -1 };
  });
}
export function generated(count: number, coincident = false) {
  let state = 17;
  const points = new Float32Array(count * 3), radii = new Float32Array(count);
  for (let i = 0; i < points.length; i++) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    points[i] = coincident ? 0 : (state / 4294967296 - .5) * 300;
  }
  for (let i = 0; i < count; i++) radii[i] = 1 + i % 7;
  return buildMemoryPickIndex(points, radii);
}
export function randomQueries(count: number) {
  let state = 491;
  const next = () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296; };
  return Array.from({ length: count }, () => ({ camera: { yaw: next() * 12 - 6, pitch: next() * 3 - 1.5, zoom: .2 + next() * 4 }, scale: .2 + next() * 3, width: 900, height: 600, x: next() * 1100 - 100, y: next() * 800 - 100, focus: -1 }));
}
