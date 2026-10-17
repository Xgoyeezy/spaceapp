# SpaceApp frame timing and startup investigation

Source baseline: `38f2622b2cdb15e2587f4b8bd437ead7ebf57bc3`.
Submitted source: `f0a2078918870b0abb0ed6cf7c02d6dea8b07e7f`.
Hardware: Apple M2, 8 CPU cores, 16 GiB RAM, macOS 27.0.1;
Chrome 155 with ANGLE Metal. [PR #133](https://github.com/oll4com/spaceapp/pull/133)
remains draft. The [issue's limits](https://github.com/oll4com/spaceapp/issues/62)
include 2k frame p95 ≤16.7 ms, 50k frame p95 ≤33 ms, 50k picking ≤4 ms and
no main-thread load/layout task over 100 ms at 50k.
All work used existing local tools and free resources. No browser debugger,
browser-setting changes, graphics-quality reductions or benchmark filtering were used.

## Power comparison

The Mac was on battery for the first diagnostic captures. After the user plugged
it in, `pmset -g batt` confirmed AC Power. The same compiled diagnostic build,
2,000-node graph, 898.5078125 × 516 CSS-pixel surface, DPR 2 and enabled titles
were used for the direct comparison. Each run retained 600 intervals.

| Condition | Frame interval p95 | CPU p95 | Maximum pick |
| --- | ---: | ---: | ---: |
| Battery, graph | 17.6 ms | 2.1 ms | 3.0 ms |
| AC, graph | 17.6 ms | 2.3 ms | 4.0 ms |
| AC, scheduling-only control | 17.6 ms | 0 ms | No picking |

Plugging in did not improve this measured frame interval. Chrome's Energy Saver
setting was not inspected: internal settings navigation was blocked by browser
security policy, and no workaround was attempted. Google's documentation says
Energy Saver does not activate while plugged in; this does not establish that it
was enabled during the battery run. The OS Low Power Mode setting was zero for
both battery and AC. These findings do not establish the absence of all power or
thermal effects.

The temporary diagnostic recorder exported the numeric inputs to the largest
pick. Its overhead may affect a run, so these captures are diagnostic rather than
clean acceptance measurements. The patch is retained and removed from the source.
Selected power-comparison metrics are saved in [power-comparison.json](power-comparison.json).

## Independent frame-scheduling experiment

`frame-worker.html` draws the same moving rectangle on a main-thread canvas and
on an OffscreenCanvas in a dedicated worker, both at DPR 2. The worker records its
own callback timestamps. Both visible runs retained 600 intervals on AC power.

| Drawing location | Interval p95 | Average interval | Intervals over 25 ms |
| --- | ---: | ---: | ---: |
| Main thread | 17.6 ms | 16.7223 ms | 2 |
| Worker | 17.7 ms | 16.6673 ms | 0 |

The worker did not meet the strict 16.7 ms p95 either. This small experiment gives
no evidence that moving the entire graph renderer to a worker would solve this
specific p95 result. It is not a graph benchmark or proof of physical frame
presentation. Full samples are in [frame-worker-comparison.json](frame-worker-comparison.json),
with the standalone page in [frame-worker.html](frame-worker.html).

The read-only system display report listed an internal Apple M2 display at
60.00 Hz, logical 1470 × 956 with a 2940 × 1912 backing surface, and a reported
2560 × 1664 panel. This suggests a scaling comparison could be useful, but it
does not prove scaling caused the measured jitter. Computer Use denied access
to System Settings, including a second attempt explicitly approved by the user.
No settings were inspected or changed, and no alternate access path was attempted.
No display-mode comparison was performed. The proposed comparison was the current
1470 × 956 logical mode versus 1280 × 832 HiDPI, if offered, followed by restoration.
It remains untested, not an established remedy.

## Picking experiments

Captured graph queries were replayed independently of the renderer. A separate
instrumented traversal counted work after the timed run and checked every selected
node. The actual-graph trajectory uses a fixed approximation of the earlier
camera movement; it does not exactly replay the earlier 36.7 ms event.

On that trajectory the original picker peaked at 1.8 ms in one Chrome run and
14.7 ms in another, while examining at most 265 points per query. The latter peak
occurred at query 239, examined 144 points, and replayed in 0–0.1 ms afterward.
That run overlapped the user's power-source transition, so it is excluded from
a controlled battery/AC or implementation speed comparison. It remains evidence
that a spike can occur away from the first few queries. It does not identify the
cause of the stall. Zero-duration values reflect timer granularity, not zero work.
These isolated pages drew no graph and recorded 33.4 ms frame-interval p95.
They are picking diagnostics, not comparable graph-rendering frame results.
Their recorded visibility check does not identify why their callback cadence differed.

A variant split the query into smaller functions. Its two Chrome trajectory
maxima were 1.3 and 0.4 ms, but fresh-process Node tests were mixed: baseline
maxima 1.219/1.186/1.167 ms, variant 1.261/0.793/0.949 ms. Selection results matched.
Both Node variants showed optimization and deoptimization activity; Node's V8
version differs from Chrome's. This evidence does not prove browser JIT caused
the spikes or that the variant fixes them. The variant was not adopted.

## Clean baseline on AC

The original source was rebuilt after removing the recorder. Browser measurements
ran after the build finished, without concurrent local tests or builds. Both
graphs used the same viewport and quality as the power comparison. Each is the
first measurement after a page load, not a claim of a fresh browser engine or GPU
cache. Other user applications remained open.

| Nodes / edges | Frame p95 | CPU p95 | Pick p95 / max | Largest task since Memory opened |
| --- | ---: | ---: | ---: | ---: |
| 2,000 / 6,000 | 17.6 ms | 2.8 ms | 0.2 / 12.6 ms | 88 ms |
| 50,000 / 150,000 | 17.7 ms | 2.5 ms | 0.2 / 1.0 ms | 104 ms |

The 2k pick peak was sample 28. The 50k 104 ms task occurred during layout,
before measurement started; its exact code attribution is unknown. It is retained
as a failed load/layout result. Complete displayed metrics, with source and power
annotations, are saved in `startup-baseline.json`.

## Submitted startup change

The old component creates the graphics context, initializes GPU programs and
uploads the graph within one React effect. The candidate schedules those phases
as three separate tasks. This gives the browser a task boundary between phases,
avoids repeating the initial upload in the mount effects, and prevents the costs
of all three phases from accumulating in the same React task. It does not make
an individual WebGL operation interruptible or change the frame clock.

The canvas remains busy and benchmark buttons remain disabled until setup
finishes. Closing the view or losing the context cancels pending stages. Context
restoration starts again using current graph/layout references. Failure enters
the existing Canvas fallback. Four added tests cover these lifecycle boundaries;
the existing four benchmark-validity tests also pass.

The final source was rebuilt and tested with AC power, titles enabled, DPR 2,
the same 898.5078125 × 516 CSS-pixel graph and 600 intervals per run. Local builds
and tests had stopped; other user applications remained open. Each row is the
first measurement after its page load, not a fresh browser-engine or GPU-cache claim.

| Nodes / edges | Frame p95 | CPU p95 | Pick p95 / max | Largest task after Memory opened |
| --- | ---: | ---: | ---: | ---: |
| 2,000 / 6,000 | 17.5 ms | 2.1 ms | 0.2 / 4.1 ms | None observed ≥50 ms |
| 10,000 / 30,000 | 17.7 ms | 3.0 ms | 0.2 / 9.9 ms | 72 ms |
| 50,000 / 150,000 | 17.7 ms | 2.1 ms | 0.2 / 1.3 ms | 167 ms |

The 2k context creation and program setup took 37.1 and 21.5 ms in separate tasks.
That run had no observed task of at least 50 ms after Memory opened; the reported
zero means no observed long task, not zero work. The page-wide task maximum was
177 ms, outside that Memory window. One run does not establish a consistent
startup improvement.

The 50k 167 ms task occurred during layout, before the benchmark started, and
fails the 100 ms load/layout requirement. The marked application operations do
not fully attribute it: the largest positions/picking update was 34.3 ms, labels
24.6 ms and layout-message receipt 21.8 ms. The 10k 9.9 ms pick occurred at sample
517, so the spikes are not limited to initial use. The earlier 50k 36.7 ms picking
outlier remains in the [previous evidence](https://github.com/Xgoyeezy/spaceapp/blob/287f50e393470fd77ddb6a469422a4427b378f44/bounty-evidence/graph-picking-follow-up.md).

The startup task boundaries, cancellation and readiness behavior are implemented
and tested. They do not establish a frame-time speedup or a consistent solution
to load/layout stalls. The 2k 16.7 ms frame target remains unmet. Complete displayed
results are in [startup-final.json](startup-final.json), with the clean earlier
source in [startup-baseline.json](startup-baseline.json).

Real browser checks confirmed that context loss shows the Canvas fallback,
restoration returns to a ready WebGL canvas, keyboard rotation changes the camera,
and the titles toggle works. No detailed Chrome profiler capture was obtained.

## Validation

The local root check and production build passed. Hygiene passed before the
source commit. The full macOS test command failed: 119 named failures repeated
from the previous run, plus one newly observed random arcade-test failure.
The latter was reproduced with seed 424: the Sentinel fired during the simulation,
but no enemy shot remained at the final frame. The test now uses that deterministic
seed and observes firing during the simulation; production arcade code is unchanged.
The final focused run passed all 15 tests across the graph and arcade files.

Linux validation passed for the exact submitted source: the root check, all
329 web files / 3201 tests, and the production build. See
[run 39002886966](https://github.com/Xgoyeezy/spaceapp/actions/runs/39002886966).
Its scope is the root check, all web regression tests and the production build.
The earlier full Linux public/workspace pass applies to source `38f2622`, not the
new revision. The final run outcome is recorded in
[startup-validation.json](startup-validation.json).

## What would resolve the remaining uncertainty

For the 2k interval, compare the same graph and independent rectangle control
on the maintainer's reference display, or perform the proposed display-mode test
if native Settings access is available. Keep both runs visible, use the same graph
surface and DPR, retain all 600 intervals, and restore the original display mode.
A change in both controls would support a display/scheduling contribution;
a graph-only delay would justify targeting application work. Neither result is
assumed. The reference configuration and measurement method were requested in the
[existing maintainer comment](https://github.com/oll4com/spaceapp/pull/133#issuecomment-6229042692);
there was no maintainer reply when checked on 2026-10-17.

For load/layout and picking, the next useful code experiment needs to reproduce
and attribute the intermittent stall. Separate measurements already show that
it is not consistently tied to the first pick or a large traversal. A trace on
an allowed profiling surface, or bounded application instrumentation around a
repeatable failing phase, can distinguish blocking browser work from application
work. There is no evidence yet to justify adopting the split-picker experiment
or rewriting the renderer around OffscreenCanvas. The acceptance thresholds remain
unchanged, and no merge or bounty qualification is claimed.

## Sources

- [Google Chrome performance settings](https://support.google.com/chrome/answer/12929150?hl=en-GB1): Energy Saver and AC power; accessed 2026-10-17.
- [MDN worker requestAnimationFrame](https://developer.mozilla.org/en-US/docs/Web/API/DedicatedWorkerGlobalScope/requestAnimationFrame): worker animation and timestamp semantics; accessed 2026-10-17.
- [MDN WebGL best practices](https://developer.mozilla.org/en-US/docs/Web/API/WebGL_API/WebGL_best_practices): synchronous shader-status queries and parallel compilation; accessed 2026-10-17. This guidance identifies potential blocking calls, not the cause of a particular measured stall.
- [V8 tiering](https://github.com/v8/v8/blob/main/docs/runtime/tiering.md) and [Maglev](https://v8.dev/blog/maglev): runtime-tiering hypotheses; accessed 2026-10-17. Not direct evidence about these Chrome pauses.

- [Apple display resolution guidance](https://support.apple.com/en-ie/guide/mac-help/mchl86d72b76/27/mac/27): scaled resolutions may affect performance. No specific improvement is assumed for this machine.
