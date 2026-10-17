# C/WebAssembly picking experiment

C is usable in this website through WebAssembly. A direct C translation of the
existing tree-based pointer picker did not produce a consistent latency benefit
in this experiment. It is not being added to PR #133.

## What was tested

- JavaScript source: `memory-picking.ts` from SpaceApp `f0a2078918870b0abb0ed6cf7c02d6dea8b07e7f`.
- Two C variants: one importing trigonometric functions, one computing those
  functions in JavaScript before one call into C.
- Same numeric indexes, camera paths, pruning, depth rules and focus behavior.
- Persistent Wasm memory; the index is copied once. Per-query wrapper and
  trigonometric work are included in the reported timings.
- Clang 18.1.3, `-O3`, no fast-math or fused floating-point contraction. The
  tested two-export module is 1,332 bytes. The source and module hashes were
  checked after downloading the successful free Linux compilation artifact.
- Correctness: 43,202 cases per C variant, 86,404 comparisons total, zero
  mismatches. Cases include the 2k and 50k captured synthetic indexes, random
  queries, empty/single-node indexes, leaf-boundary sizes and coincident nodes.
- Final browser comparison: four fresh page loads, 2k and 50k nodes, both initial
  call orders. Native Chrome tab selection was confirmed. The harness requires
  document focus at start/end and no blur or hidden-page events for validity.
  All four runs passed these checks. No local compiler or test suite ran during
  the measurements; other user applications remained open.
- Each run records the first query, 600 individual queries per implementation,
  then 24 short batches of 200 queries per implementation. Each frame alternates
  which implementation runs first. Individual selections and batch checksums
  agreed in all four runs.

## Results

All results below use the second C variant, with trigonometry in JavaScript.
Times include JavaScript-to-Wasm call overhead. The first 600-query phase is
retained, including initial calls and outliers.

| Nodes / initial order | Individual pick p95, JS / C | Maximum pick, JS / C | Batched mean per query, JS / C |
| --- | --- | --- | --- |
| 2,000 / JS first | 0.1 / 0.1 ms | 0.3 / 0.2 ms | 0.00710 / 0.00912 ms |
| 2,000 / C first | 0.1 / 0.1 ms | 1.0 / 2.0 ms | 0.00827 / 0.00781 ms |
| 50,000 / JS first | 0.2 / 0.1 ms | 0.6 / 1.1 ms | 0.00952 / 0.01190 ms |
| 50,000 / C first | 0.2 / 0.1 ms | 2.1 / 4.5 ms | 0.00775 / 0.00840 ms |

At 2k, the individual-query p95 was unchanged. The batched C result was about
5.5% faster in one order and 28.4% slower in the other. At 50k, the individual
p95 was lower, but the C batched mean was 8.3% and 24.9% slower, and maxima were
higher. These mixed results do not justify adding a Wasm loading and memory
management path to the app.

Individual times are quantized at roughly 0.1 ms in this browser. Batched values
divide elapsed batch time by 200 and are averages, not individual-call latency
percentiles. They do not make the underlying timer more precise or remove
scheduling noise. The full results retain samples, order, focus state, setup
times and batch checksums. With only two focused runs per size, this is a bounded
feasibility experiment, not a statistical proof that C is always slower.

Three earlier exploratory downloads are retained under `initial-*`. Their
original validity flag only checked page visibility; native tab selection was
not confirmed. They are not included in the focused comparison above. This
distinction includes the earlier 17.5 ms C outlier; no sample has been deleted.

## What this means for the graph

This isolated page does not render nodes or labels, run React, upload GPU data,
or time graph loading. It therefore cannot establish a full-app frame-time
improvement or reproduce every earlier application stall. Neither the previous
36.7 ms JavaScript picking outlier nor the 167 ms load/layout task is resolved by
these results.

The earlier display experiment measured a 17.6 ms frame-interval p95 for both
the graph and a no-drawing scheduling control. That does not establish that
JavaScript computation causes the remaining gap to 16.7 ms. Saving time inside
a picker does not directly subtract that time from browser frame intervals.
[requestAnimationFrame callbacks follow browser/display scheduling](https://developer.mozilla.org/en-US/docs/Web/API/Window/requestAnimationFrame).
[WebAssembly works alongside JavaScript within the browser](https://developer.mozilla.org/en-US/docs/WebAssembly/Guides/Concepts).

The next concrete application experiment is to instrument and bound the
layout-receive and GPU-position upload path. Code inspection shows that a graph
change can call `setPositions` from both the graph-upload effect and the
positions/picking effect in `MemoryGraph3D.tsx`. Avoiding duplicate upload work
and yielding between remaining synchronous phases are testable candidates.
These are candidates, not an attribution of the complete 167 ms task or an
implemented fix. The existing startup phase yielding remains in the PR.

## Reproduction and evidence

- [Correctness results](equivalence-results.json)
- [Summary of the four focused browser runs](summary-results.json)
- [Current environment](environment-local.json), with identifiers omitted
- [C source](picking.c), [JavaScript/Wasm wrapper](wasm-picker.ts), [browser harness](browser.ts)
- [Compiler artifact build](https://github.com/Xgoyeezy/spaceapp/actions/runs/39005189063), source commit `3eb801e73102c652b81ccae4b07db820c05f6c3a`
- `wasm-picking-*-foreground-results.json`: the four unmodified browser downloads
- `actual-2000.json` and `actual-50000.json`: numeric synthetic graph inputs
- `SHA256SUMS`: compiled C source and Wasm module hashes

No app source or PR head changed. No tool was installed on the local Mac, no
paid resource was used, and no performance acceptance pass is claimed.
