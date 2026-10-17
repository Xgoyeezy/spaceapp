# Graph performance follow-up

Source: `38f2622b2cdb15e2587f4b8bd437ead7ebf57bc3`, based on `c2dcf8dfddc20fcfc2971188d62c5b6e7f13563f`. Recorded 2026-10-17 UTC.

The picking optimization and benchmark fixes are pushed. This revision does **not** meet all of issue #62's performance requirements: 2k frame p95 remains above 16.7 ms and the first final-revision 50k run has a 36.7 ms picking outlier. An earlier candidate 50k page also recorded a 159 ms task after Memory opened; its cause and exact phase remain unattributed. Passing warm repeats do not erase these observations.

## Changes

The renderer now owns and reuses the picking traversal buffer. The picker no longer allocates a traversal array and depth closure for each query. Projection, hit radii, depth ordering, labels and resolution are unchanged. Tests compare results with exhaustive projection and cover reused storage after misses, equal-depth hits, focus changes and an undersized scratch buffer.

The benchmark queues a request made while hidden until the tab becomes visible. Hiding an active run, changing its size or pixel density, or losing its WebGL context invalidates the run. Unsupported task observers report null. The existing 600 requestAnimationFrame intervals, percentile calculation and slow frames remain intact. New timestamps help separate loading from later observations; the maximum task metric remains cumulative after Memory opens.

A real context-loss check invalidated an active run at 60 frames. After automatic context restoration, the measurement button was enabled, the fallback notice was gone, and the interrupted result remained invalid. The exact observation is in `graph-benchmark-validity.json`.

## Isolated picking comparison

Ten warmed, alternating-order rounds used 2,000 deterministic points and 6,000 queries per round. Every selected node matched. Median elapsed time fell from 17.6031 to 11.0056 ms, a 37.48% reduction. This is a Node CPU diagnostic, **not a browser frame-rate improvement or acceptance result**. All rounds and the corrected even-sample median are in `graph-picking-cpu.json`.

## Final source measurements

Apple M2, 8 CPU cores, 16 GiB RAM, macOS 27.0.1, Chrome 155/ANGLE Metal. Compiled build, titles enabled, DPR 2, 600 rotating/zooming frames with moving-pointer picking. The graph was 898.5078125 × 460 CSS pixels. Local builds and tests were stopped; unrelated user applications remained open.

| Run | Frame p95 | CPU p95 | Pick p95 / max | Largest task after Memory opened |
| --- | ---: | ---: | ---: | ---: |
| 2k first measurement | 17.6 ms | 2.3 ms | 0.1 / 12.9 ms | 119 ms |
| 2k warm repeat | 17.6 ms | 1.1 ms | 0.1 / 0.3 ms | 119 ms, same cumulative observation |
| 10k first measurement | 17.7 ms | 2.5 ms | 0.2 / 8.9 ms | None observed ≥50 ms |
| 50k first measurement | 17.5 ms | 2.0 ms | 0.2 / 36.7 ms | 64 ms |
| 50k warm repeat | 17.6 ms | 2.9 ms | 0.2 / 2.1 ms | 64 ms, same cumulative observation |

Complete results are in `graph-picking-final.json`. The largest picks occurred at zero-based sample indexes 7, 11 and 3 in the first 2k, 10k and 50k measurements. Warm repeats establish variability; they do not establish whether compilation, garbage collection, scheduling or traversal caused the spikes.

The final 50k task began at 246348.6 ms, after its benchmark started at 246284.9 ms. Therefore its 64 ms cumulative maximum is not attributed to loading. A separate 181.7 ms animation frame during loading had no reported script attribution. Long animation frames and individual long tasks are different measurements. Whole-page task maxima were 160, 185 and 186 ms for the final 2k, 10k and 50k pages.

The manual Chrome foreground attempt did not leave a numeric result in the test tab. These final runs were started through the UI automation and reported visible throughout. They are not presented as proof that the manual attempt completed.

## Earlier controls and failed observations

All seven initial Chrome observations are in `graph-picking-initial.json`: two baseline runs, candidate first and warm runs, the scheduling control, an independent animated rectangle control and a 50k candidate run. They used a 1101.0078125 × 742 CSS-pixel surface at DPR 2. This differs from the final source group and prevents a matching-viewport speedup claim across the groups.

At 2k, baseline maximum picking was 3.9 and 9.7 ms; the candidate measured 1.0 and 2.3 ms. Candidate frame p95 remained 17.6–17.7 ms. The earlier 50k candidate measured 17.6 ms frame p95 and 1.5 ms maximum picking, but its 159 ms cumulative Memory task exceeded the 100 ms bound used by this conservative check. Its cause and exact phase remain unattributed; the field alone cannot assign it to loading or layout.

Both the in-app scheduling control and a separate page drawing one moving rectangle measured 17.6 ms frame p95. The rectangle control uses no application, React, graph, workers or picking and had 0.1 ms CPU p95. Its source is `graph-animated-control.html`. This supports a browser/display scheduling contribution; it does not prove all application or GPU work is negligible and does not satisfy the graph's 16.7 ms requirement.

Safari completed a valid foreground 2k run: 18 ms frame p95, 1 ms CPU p95 and 1 ms maximum picking. Both task observers were unsupported, so their values correctly stayed null. Native accessibility truncated the trailing metadata; `graph-safari-foreground.json` explicitly records a partial capture. No Safari loading pass or matching viewport is claimed.

## Verification

- Local `npm run check`, production build, hygiene preflight and diff checks passed.
- All 329 web test files and 3,197 web tests passed, including the new picking and benchmark validity cases.
- The full macOS workspace test command failed. Failures included Linux-only filesystem/process behavior, loopback assumptions and canonical temporary-path differences. Some timing/order failures also occurred; they are not all conclusively attributed to macOS. Rerunning the 11 runtime path cases with a canonical temporary directory passed without changing source or weakening guards.
- Final-source Linux run: [38997515397](https://github.com/Xgoyeezy/spaceapp/actions/runs/38997515397). Root check, all public/workspace tests and the production build passed. The job explicitly checked out source `38f2622b2cdb15e2587f4b8bd437ead7ebf57bc3`; the workflow itself was `0b5a16379b146e1ebd360b64d4df7e85a49a7815`.

## Remaining decision and reproduction

Keep PR #133 draft. The next useful check is to run the 2k graph and the supplied rectangle control on the maintainer's intended reference machine, using the frame-interval method described in `docs/quality/memory-graph-performance.md`. Confirm the intended display/refresh configuration and percentile method. Do not replace frame intervals with CPU duration, discard slow frames, lower resolution or relax the target. The 50k first-use picking spike and variable loading observations remain separate acceptance gaps.

Detailed Chrome profiling was previously rejected, including the user-approved retry, because raw debugger access was denied by a saved permission or managed policy. No alternative debugger route was used. These findings rely on ordinary source instrumentation, PerformanceObserver and the app's UI harness.

[MDN's requestAnimationFrame documentation](https://developer.mozilla.org/en-US/docs/Web/API/Window/requestAnimationFrame), accessed 2026-10-17, explains that callbacks generally follow display refresh and are commonly paused in background tabs. It does not diagnose this machine's jitter or guarantee the issue's target.

All fixtures are synthetic. No paid services or provider credentials were used.

