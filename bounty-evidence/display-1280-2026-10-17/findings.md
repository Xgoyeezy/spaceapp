# Display scaling comparison at 1280 × 832

The user manually selected 1280 × 832. A read-only display report confirmed
1280 × 832 at 60 Hz with a 2560 × 1664 rendering surface. AC power was confirmed.
The earlier setting was 1470 × 956 with a 2940 × 1912 surface. This test did not
change the display mode or use browser viewport emulation.

Source remained `f0a2078918870b0abb0ed6cf7c02d6dea8b07e7f`, using the existing
compiled build, Chrome 155 / ANGLE Metal on Apple M2. No local build or test suite
ran during the measurements. Other user applications remained open. The graph
used 2,000 nodes, 6,000 edges, titles enabled and native DPR 2.

## Results

Every run completed visibly and retained all 600 intervals for its calculation.
No intervals were excluded. Graph runs were ordered render, scheduling-only,
render. The independent drawing control followed, main thread then worker.

| Run at 1280 × 832 | Frame interval p95 | CPU p95 | Maximum pick |
| --- | ---: | ---: | ---: |
| 2k graph, first measurement | 17.6 ms | 2.4 ms | 2.1 ms |
| In-app scheduling-only control | 17.6 ms | 0 ms | No picking |
| 2k graph, repeat | 17.6 ms | 2.2 ms | 2.5 ms |
| Independent rectangle, main thread | 17.6 ms | Not measured | Not applicable |
| Independent rectangle, worker | 17.6 ms | Not measured | Not applicable |

The independent control kept the same 900 × 460 CSS-pixel canvas and
1800 × 920 backing buffer as the earlier test. Its source file is unchanged.
The earlier main-thread and worker p95 results were 17.6 and 17.7 ms respectively.
At 1280, their average intervals were 16.7212 and 16.6667 ms. The main-thread
control had one interval over 25 ms; the worker had none. A 60 FPS average does
not imply that the 95th-percentile interval meets 16.7 ms.

The graph's responsive canvas became 792.7578125 × 382 CSS pixels, compared with
898.5078125 × 516 in the earlier 1470-mode measurements. It retained DPR 2 and
titles. Browser window sizing was inspected and briefly toggled before measuring,
then toggled back. Matching the original graph canvas could not be achieved
with native window sizing in this run; viewport emulation was not used because
it would change pixel density. The graph results therefore are not a perfectly
matched display-mode A/B test. The independent control does match its earlier
canvas and backing-buffer sizes.

The graph recorded a cumulative 111 ms main-thread task after Memory opened,
plus longer animation frames during the pre-measurement period. These values
include the window-sizing and setup period and are not a new, isolated loading
test. They remain in the captured JSON. All three graph runs had complete,
visible, uninterrupted measurement windows.

## Interpretation

Changing to 1280 did not improve the observed p95 frame interval, including on
the independent control with matching drawing dimensions. These results do not
support display scaling as a fix for the 16.7 ms target on this setup. They do
not establish a hardware defect, eliminate every browser/OS scheduling effect,
or demonstrate that the graph's intermittent picking and loading stalls are fixed.

The 2k frame requirement remains unmet. The earlier 167 ms load/layout task at
50k and the earlier 36.7 ms picking outlier remain unresolved. Source and
acceptance thresholds are unchanged; [PR #133](https://github.com/oll4com/spaceapp/pull/133)
remains draft. The next useful comparison is the graph and supplied control on
the maintainer's reference display, with the intended frame-time method confirmed.
That question is already in the [existing maintainer comment](https://github.com/oll4com/spaceapp/pull/133#issuecomment-6229042692).
Attributing the intermittent application stalls is separate work.

## Evidence

- [Environment confirmation](environment.json): display dimensions and power source; hardware identifiers omitted.
- [Complete displayed graph results](graph-results.json): all three emitted result objects, including task and animation-frame observations. The graph harness emits aggregate frame statistics, not individual frame intervals.
- [Control results and all 1,200 raw intervals](frame-worker-comparison.json).
- [Unchanged standalone control](frame-worker.html).
- [Comparison summary](comparison.json), including the control source hash.
- [Earlier 1470-mode results](https://github.com/Xgoyeezy/spaceapp/blob/d0f74d217019f4c574fe82c5da2adb6585890175/bounty-evidence/graph-power-startup-2026-10-17/findings.md).

No source change, new dependency, paid resource or performance acceptance pass
is claimed by this follow-up. The existing Linux validation at this source
passed the root check, 3,201 web tests and production build; no duplicate build
or test run was needed for a display-only experiment.
