import type { MemoryCoordinates } from "./memory-coordinates.js";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { MemoryGraphNode, MemoryGraphEdge } from "@space/contracts";
import type { MemoryAtlasPosition } from "./memory-atlas.js";
import { DEFAULT_MEMORY_CAMERA, memory3DVolumeRatio, type MemoryCamera3D } from "./memory-3d.js";
import { MemoryGraph3DFallback } from "./MemoryGraph3DFallback.js";
import { memoryFallbackGraph, prepareMemoryGpuData } from "./memory-webgl-data.js";
import { MemoryWebGLRenderer } from "./memory-webgl-renderer.js";
import { queueMemoryWebGLSetup } from "./memory-webgl-setup.js";
import { MemoryRendererSync } from "./memory-renderer-sync.js";

import { buildMemoryPickIndex, type MemoryPickIndex } from "./memory-picking.js";
import { memoryBenchmarkEnabled, measureMemoryWork, memoryWorkDurations } from "./memory-benchmark.js";
import { getMemoryDiagnostics, downloadMemoryDiagnostics, downloadMemoryBenchmark, memoryReplayInput } from "./memory-diagnostics.js";
const EMPTY_PICK_IDS: string[] = [];

type Props = {
  nodes: MemoryGraphNode[]; edges: MemoryGraphEdge[];
  positions: Map<string, MemoryAtlasPosition>; coordinates: MemoryCoordinates;
  gpuPositions?: Float32Array; extent?: number; volume?: number;
  showTitles: boolean; selectedNodeId: string | null; onSelectNode: (id: string) => void;
  loading: boolean; resetToken: number; picking?: MemoryPickIndex; pickIds?: string[]; loadStartedAt?: number; gpuData?: ReturnType<typeof prepareMemoryGpuData>;
};
const percentile = (values: number[], fraction: number) => [...values].sort((a, b) => a - b)[Math.max(0, Math.ceil(values.length * fraction) - 1)] ?? 0;

export function MemoryGraph3D(props: Props) {
  const { nodes, edges, positions, coordinates, loading, showTitles, selectedNodeId, resetToken } = props;
  const canvasRef = useRef<HTMLCanvasElement>(null), labelsRef = useRef<HTMLCanvasElement>(null);
  const camera = useRef<MemoryCamera3D>({ ...DEFAULT_MEMORY_CAMERA });
  const current = useRef(props);
  const redraw = useRef<() => void>(() => {});
  const renderer = useRef<MemoryWebGLRenderer | null>(null);
  const graphData = useMemo(() => props.gpuData ?? prepareMemoryGpuData(nodes, edges, positions), [nodes, edges, positions, props.gpuData]);
  const graphDataRef = useRef(graphData);
  const resolvedPicking = useMemo(() => {
    if (props.picking) return { index: props.picking, ids: props.pickIds ?? EMPTY_PICK_IDS };
    // Small standalone showcases do not run a layout worker.
    if (coordinates.size > 2000 || !coordinates.size) return { index: null, ids: EMPTY_PICK_IDS };
    const ids = [...coordinates.keys()], points = new Float32Array(ids.length * 3), radii = new Float32Array(ids.length);
    ids.forEach((id, i) => { const p = coordinates.get(id)!; points.set([p.x, p.y, p.z], i * 3); radii[i] = graphData.radii[graphData.index.get(id) ?? -1] ?? 2.1; });
    return { index: buildMemoryPickIndex(points, radii), ids };
  }, [props.picking, props.pickIds, coordinates, graphData]);
  const snapshot = useMemo(() => ({ nodes, data: graphData, coordinates, positions: props.gpuPositions, extent: props.extent,
    picking: resolvedPicking.index, ids: resolvedPicking.ids, index: props.gpuData?.index }), [nodes, graphData, coordinates, props.gpuPositions, props.extent, resolvedPicking, props.gpuData]);
  const snapshotRef = useRef(snapshot);
  const synchronization = useMemo(() => new MemoryRendererSync(), []);
  const rendererGeneration = useRef(0);
  useLayoutEffect(() => { current.current = props; graphDataRef.current = graphData; snapshotRef.current = snapshot; });
  const [fallback, setFallback] = useState(false);
  const [initializing, setInitializing] = useState(true);
  const fallbackGraph = useMemo(() => fallback ? memoryFallbackGraph(nodes, edges) : null, [fallback, nodes, edges]);
  const fallbackCoordinates = useMemo(() => new Map(fallbackGraph?.nodes.flatMap(node => {
    const p = coordinates.get(node.id); return p ? [[node.id, p] as const] : [];
  }) ?? []), [fallbackGraph, coordinates]);
  const volume = useMemo(() => measureMemoryWork("layout volume", () => props.volume ?? memory3DVolumeRatio([...coordinates.values()])), [coordinates, props.volume]);
  const benchmarkEnabled = memoryBenchmarkEnabled();
  const diagnostics = useMemo(getMemoryDiagnostics, []);
  const observerSupport = useMemo(() => {
    const types = typeof PerformanceObserver === "undefined" ? [] : PerformanceObserver.supportedEntryTypes ?? [];
    return { longTasks: types.includes("longtask"), longAnimationFrames: types.includes("long-animation-frame") };
  }, []);
  const [benchmarkResult, setBenchmarkResult] = useState("");
  const benchmark = useRef<{ mode: "render" | "scheduler" | "replay"; start: number; previous: number; frame: number[]; cpu: number[]; pick: number[]; callbackEntries: number[] } | null>(null);
  const longTasks = useRef<number[]>([]);
  const longestMemoryTask = useRef<{ startTime: number; duration: number } | null>(null);
  const pageLongTasks = useRef<number[]>([]);
  const longFrames = useRef<unknown[]>([]);
  const benchmarkStart = useRef<(mode?: "render" | "scheduler" | "replay") => void>(() => {}), loseContext = useRef<() => void>(() => {});
  const loadStarted = useRef(props.loadStartedAt ?? performance.now());

  useEffect(() => {
    if (!benchmarkEnabled || typeof PerformanceObserver === "undefined") return;
    const observer = observerSupport.longTasks ? new PerformanceObserver(list => {
      for (const entry of list.getEntries()) {
        diagnostics?.entry(entry);
        pageLongTasks.current.push(entry.duration);
        if (entry.startTime >= loadStarted.current) {
          longTasks.current.push(entry.duration);
          if (entry.duration > (longestMemoryTask.current?.duration ?? 0)) longestMemoryTask.current = { startTime: entry.startTime, duration: entry.duration };
        }
      }
    }) : null;
    observer?.observe({ type: "longtask", buffered: true });
    const frames = observerSupport.longAnimationFrames ? new PerformanceObserver(list => {
      for (const entry of list.getEntries()) {
        diagnostics?.entry(entry);
        if (entry.startTime < loadStarted.current || entry.duration < 100) continue;
        const detail = entry as PerformanceEntry & { scripts?: Array<{ duration: number; invoker: string; sourceURL: string; sourceFunctionName: string; sourceCharPosition: number }> };
        if (longFrames.current.length < 20) longFrames.current.push({ startTime: entry.startTime, duration: entry.duration, scripts: detail.scripts?.map(script => ({ duration: script.duration, invoker: script.invoker, source: script.sourceURL, function: script.sourceFunctionName, position: script.sourceCharPosition })) });
      }
    }) : null;
    frames?.observe({ type: "long-animation-frame", buffered: true });
    return () => { observer?.disconnect(); frames?.disconnect(); };
  }, [benchmarkEnabled, observerSupport, diagnostics]);

  useEffect(() => {
    const canvas = canvasRef.current, labelCanvas = labelsRef.current;
    if (!canvas || !labelCanvas) return;
    let context: CanvasRenderingContext2D | null = null;
    let gl: WebGL2RenderingContext | null = null;
    let cancelSetup = () => {};
    let pendingRenderer: MemoryWebGLRenderer | null = null;
    let frame = 0, hover: string | null = null, pointer: { x: number; y: number } | null = null;
    let dragged = false, downX = 0, downY = 0, disposed = false;
    let pendingBenchmark: "render" | "scheduler" | "replay" | null = null;
    const invalidateBenchmark = (reason: string) => {
      const sample = benchmark.current;
      if (sample || pendingBenchmark) setBenchmarkResult(JSON.stringify({ status: "invalid", valid: false, mode: sample?.mode ?? pendingBenchmark, reason, frames: sample?.frame.length ?? 0 }, null, 2));
      diagnostics?.event("benchmark-invalidated", renderer.current?.diagnosticTags, { reason });
      benchmark.current = null;
      pendingBenchmark = null;
    };
    const pointers = new Map<number, { x: number; y: number }>();
    let readyGraph: object | null = null, rendererReady = false;
    const render = (now: number) => {
      const callbackEntry = diagnostics ? performance.now() : 0;
      frame = 0;
      const active = renderer.current, labelContext = context;
      if (!active || !labelContext) return;
      diagnostics?.frame(now, callbackEntry, active.diagnosticTags);
      if (diagnostics && rendererReady && !current.current.loading && current.current.nodes.length && readyGraph !== current.current.nodes && active.diagnosticTags.graph === diagnostics.identity(current.current.nodes) && active.diagnosticTags.layout === diagnostics.identity(current.current.gpuPositions ?? current.current.coordinates)) { readyGraph = current.current.nodes; diagnostics.event("first-ready-frame", active.diagnosticTags); }
      if (benchmark.current && document.visibilityState !== "visible") invalidateBenchmark("The tab became hidden. Keep it visible and start a new run.");
      const sample = benchmark.current;
      if (sample) {
        if (diagnostics) sample.callbackEntries.push(callbackEntry);
        if (sample.mode === "replay") {
          const replay = memoryReplayInput(sample.cpu.length, active.width, active.height);
          camera.current = replay.camera; pointer = replay.pointer;
        }
        if (sample.mode === "render") {
        camera.current.yaw += 0.012; camera.current.pitch = Math.sin((now - sample.start) / 3000) * 0.5;
        camera.current.zoom = 1 + Math.sin((now - sample.start) / 1800) * 0.3;
        }
        if (sample.previous) sample.frame.push(now - sample.previous);
        sample.previous = now;
        if (sample.mode === "render") pointer = { x: active.width * (0.5 + 0.2 * Math.sin(now / 1700)), y: active.height * 0.5 };
      }
      const started = performance.now();
      if (pointer && sample?.mode !== "scheduler") {
        const pickStart = performance.now(); hover = active.pick(pointer.x, pointer.y, camera.current);
        const pickEnd = sample || diagnostics ? performance.now() : pickStart;
        if (sample) sample.pick.push(pickEnd - pickStart);
        diagnostics?.record("picking", pickStart, pickEnd, active.diagnosticTags);
        pointer = null; canvas.style.cursor = hover ? "pointer" : "grab";
      }
      if (sample?.mode !== "scheduler") {
      active.setFocus(hover ?? current.current.selectedNodeId);
      measureMemoryWork("draw GPU frame", () => active.render(camera.current), active.diagnosticTags);
      measureMemoryWork("draw labels", () => active.labels(labelContext, camera.current, current.current.showTitles), active.diagnosticTags);
      canvas.dataset.rotation = `${camera.current.yaw.toFixed(3)},${camera.current.pitch.toFixed(3)}`;
      }
      if (sample) {
        sample.cpu.push(performance.now() - started);
        if (sample.frame.length >= 600) {
          diagnostics?.event("benchmark-end", active.diagnosticTags, { mode: sample.mode, samples: sample.frame.length });
          const debug = gl?.getExtension("WEBGL_debug_renderer_info");
          setBenchmarkResult(JSON.stringify({ status: "complete", valid: true, authoritative: sample.mode === "render", diagnostic: Boolean(diagnostics), build: import.meta.env.VITE_MEMORY_BUILD_ID ?? null, rawFrameIntervals: sample.frame, rawCpuDurations: sample.cpu, rawPickDurations: sample.pick, callbackEntries: diagnostics ? sample.callbackEntries : null, visibility: document.visibilityState, mode: sample.mode, nodes: current.current.nodes.length, edges: current.current.edges.length, frames: sample.frame.length,
            frameMinMs: Math.min(...sample.frame), frameP50Ms: percentile(sample.frame, 0.5), frameP95Ms: percentile(sample.frame, 0.95), cpuP95Ms: percentile(sample.cpu, 0.95), pickP95Ms: percentile(sample.pick, 0.95), pickMaxMs: Math.max(0, ...sample.pick),
            observerSupport, maxLoadOrLayoutTaskMs: observerSupport.longTasks ? Math.max(0, ...longTasks.current) : null, maxPageTaskMs: observerSupport.longTasks ? Math.max(0, ...pageLongTasks.current) : null, longestMemoryTask: longestMemoryTask.current, loadStartedAt: loadStarted.current, benchmarkStartedAt: sample.start, longFrames: observerSupport.longAnimationFrames ? longFrames.current : null, pickWorstFrame: sample.pick.indexOf(Math.max(0, ...sample.pick)), maxWorkMs: memoryWorkDurations(), width: active.width, height: active.height, dpr: active.dpr,
            renderer: debug && gl ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : gl?.getParameter(gl.RENDERER), userAgent: navigator.userAgent }, null, 2));
          benchmark.current = null;
        } else schedule();
      }
    };
    const schedule = () => { if (!frame && !disposed) frame = requestAnimationFrame(render); };
    redraw.current = schedule;
    const resize = () => {
      const rect = canvas.getBoundingClientRect(), dpr = Math.min(window.devicePixelRatio || 1, 2);
      const active = renderer.current;
      if (benchmark.current && active && (Math.max(1, rect.width) !== active.width || Math.max(1, rect.height) !== active.height || dpr !== active.dpr)) invalidateBenchmark("The graph size or pixel density changed. Start a new run at a fixed size.");
      try { renderer.current?.resize(rect.width, rect.height, dpr); }
      catch { renderer.current?.dispose(); renderer.current = null; setFallback(true); }
      const labelWidth = Math.max(1, Math.round(rect.width * dpr)), labelHeight = Math.max(1, Math.round(rect.height * dpr));
      if (labelCanvas.width !== labelWidth) labelCanvas.width = labelWidth;
      if (labelCanvas.height !== labelHeight) labelCanvas.height = labelHeight;
      context?.setTransform(dpr, 0, 0, dpr, 0, 0); schedule();
    };
    const initialize = () => {
      rendererGeneration.current++;
      diagnostics?.event("renderer-initialize", { contextGeneration: rendererGeneration.current });
      rendererReady = false; readyGraph = null;
      cancelSetup();
      pendingRenderer?.dispose(); pendingRenderer = null;
      setInitializing(true);
      cancelSetup = queueMemoryWebGLSetup([() => {
        context = labelCanvas.getContext("2d");
        gl = measureMemoryWork("create WebGL context", () => canvas.getContext("webgl2", { alpha: true, antialias: false, depth: true, preserveDrawingBuffer: false }));
        if (!gl || !context) throw new Error("WebGL2 unavailable");
      }, () => {
        pendingRenderer = measureMemoryWork("initialize GPU programs", () => new MemoryWebGLRenderer(gl!));
        if (diagnostics) pendingRenderer.diagnosticTags.contextGeneration = rendererGeneration.current;
      }, () => {
        const active = pendingRenderer!;
        synchronization.synchronize(active, rendererGeneration.current, snapshotRef.current);
        renderer.current = active; pendingRenderer = null;
        rendererReady = true;
        diagnostics?.event("webgl-ready", active.diagnosticTags);
        setFallback(false); setInitializing(false); resize();
      }], () => { pendingRenderer?.dispose(); pendingRenderer = null; renderer.current?.dispose(); renderer.current = null; setInitializing(false); setFallback(true); });
    };
    const lost = (event: Event) => { rendererReady = false; diagnostics?.event("context-lost", renderer.current?.diagnosticTags); event.preventDefault(); cancelSetup(); invalidateBenchmark("The WebGL context was lost. Restore it before starting a new run."); cancelAnimationFrame(frame); frame = 0; pendingRenderer = null; renderer.current = null; setInitializing(false); setFallback(true); };
    const restored = () => { diagnostics?.event("context-restored"); if (!disposed) initialize(); };
    canvas.addEventListener("webglcontextlost", lost); canvas.addEventListener("webglcontextrestored", restored);
    initialize();
    const local = (event: PointerEvent) => { const rect = canvas.getBoundingClientRect(); return { x: event.clientX - rect.left, y: event.clientY - rect.top }; };
    const down = (event: PointerEvent) => {
      canvas.focus(); canvas.setPointerCapture(event.pointerId); const p = local(event);
      pointers.set(event.pointerId, p); downX = p.x; downY = p.y; dragged = false; hover = null; pointer = null;
    };
    const move = (event: PointerEvent) => {
      const p = local(event), previous = pointers.get(event.pointerId);
      if (previous) {
        if (Math.hypot(p.x - downX, p.y - downY) > 4) dragged = true;
        if (pointers.size === 2) {
          const other = [...pointers].find(([id]) => id !== event.pointerId)![1];
          const before = Math.hypot(previous.x - other.x, previous.y - other.y), after = Math.hypot(p.x - other.x, p.y - other.y);
          if (before > 1) camera.current.zoom = Math.max(0.35, Math.min(5, camera.current.zoom * after / before));
        } else { camera.current.yaw += (p.x - previous.x) * 0.009; camera.current.pitch += (p.y - previous.y) * 0.009; }
        pointers.set(event.pointerId, p);
      } else pointer = p;
      schedule();
    };
    const up = (event: PointerEvent) => {
      if (!dragged && pointers.size === 1) { const p = local(event), id = renderer.current?.pick(p.x, p.y, camera.current); if (id) current.current.onSelectNode(id); }
      pointers.delete(event.pointerId); if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    };
    const cancel = (event: PointerEvent) => { pointers.delete(event.pointerId); dragged = true; };
    const leave = () => { pointer = null; hover = null; schedule(); };
    const wheel = (event: WheelEvent) => { event.preventDefault(); camera.current.zoom = Math.max(0.35, Math.min(5, camera.current.zoom * Math.exp(-event.deltaY * 0.001))); schedule(); };
    const key = (event: KeyboardEvent) => {
      if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) {
        event.preventDefault(); camera.current.yaw += event.key === "ArrowLeft" ? -0.15 : event.key === "ArrowRight" ? 0.15 : 0;
        camera.current.pitch += event.key === "ArrowUp" ? -0.15 : event.key === "ArrowDown" ? 0.15 : 0;
      } else if (["+", "=", "-"].includes(event.key)) { event.preventDefault(); camera.current.zoom = Math.max(0.35, Math.min(5, camera.current.zoom * (event.key === "-" ? 0.85 : 1.15))); }
      else if (event.key === "Enter") { const id = current.current.selectedNodeId ?? current.current.nodes[graphDataRef.current.labels[0] ?? 0]?.id; if (id) current.current.onSelectNode(id); }
      schedule();
    };
    const observer = new ResizeObserver(resize); observer.observe(canvas);
    const fontsChanged = () => { renderer.current?.invalidateLabelMeasurements(); schedule(); };
    document.fonts?.addEventListener("loadingdone", fontsChanged);
    canvas.addEventListener("pointerdown", down); canvas.addEventListener("pointermove", move); canvas.addEventListener("pointerup", up); canvas.addEventListener("pointercancel", cancel); canvas.addEventListener("pointerleave", leave);
    canvas.addEventListener("wheel", wheel, { passive: false }); canvas.addEventListener("keydown", key);
    benchmarkStart.current = (mode = "render") => {
      benchmark.current = null;
      if (document.visibilityState !== "visible") {
        pendingBenchmark = mode;
        setBenchmarkResult("Waiting for this tab to become visible. Bring the Memory tab to the front; the run will start automatically.");
        return;
      }
      pendingBenchmark = null;
      if (mode === "replay") { hover = null; pointer = null; renderer.current?.setFocus(current.current.selectedNodeId); }
      benchmark.current = { mode, start: performance.now(), previous: 0, frame: [], cpu: [], pick: [], callbackEntries: [] };
      diagnostics?.event("benchmark-start", renderer.current?.diagnosticTags, { mode });
      setBenchmarkResult(mode === "replay" ? "Measuring fixed diagnostic replay (not acceptance)…" : mode === "render" ? "Measuring 600 rotating and zooming frames…" : "Measuring browser frame scheduling without rendering…");
      schedule();
    };
    const visibilityChanged = () => {
      if (document.visibilityState !== "visible") {
        if (benchmark.current) invalidateBenchmark("The tab became hidden. Keep it visible and start a new run.");
      } else if (pendingBenchmark) benchmarkStart.current(pendingBenchmark);
    };
    if (benchmarkEnabled) document.addEventListener("visibilitychange", visibilityChanged);
    let restoreTimer: ReturnType<typeof setTimeout> | undefined;
    loseContext.current = () => { const extension = gl?.getExtension("WEBGL_lose_context"); extension?.loseContext(); restoreTimer = setTimeout(() => extension?.restoreContext(), 3000); };
    return () => {
      diagnostics?.event("renderer-unmount", renderer.current?.diagnosticTags);
      disposed = true; cancelSetup(); clearTimeout(restoreTimer); observer.disconnect(); cancelAnimationFrame(frame); pendingRenderer?.dispose(); pendingRenderer = null; renderer.current?.dispose(); renderer.current = null; redraw.current = () => {};
      benchmark.current = null; pendingBenchmark = null;
      document.removeEventListener("visibilitychange", visibilityChanged);
      document.fonts?.removeEventListener("loadingdone", fontsChanged);
      canvas.removeEventListener("webglcontextlost", lost); canvas.removeEventListener("webglcontextrestored", restored);
      canvas.removeEventListener("pointerdown", down); canvas.removeEventListener("pointermove", move); canvas.removeEventListener("pointerup", up); canvas.removeEventListener("pointercancel", cancel); canvas.removeEventListener("pointerleave", leave);
      canvas.removeEventListener("wheel", wheel); canvas.removeEventListener("keydown", key);
    };
  }, [benchmarkEnabled, diagnostics, observerSupport, synchronization]);
  useEffect(() => { measureMemoryWork("GPU snapshot synchronization", () => { if (renderer.current) synchronization.synchronize(renderer.current, rendererGeneration.current, snapshot); }); redraw.current(); }, [snapshot, synchronization]);
  useEffect(() => { redraw.current(); }, [showTitles, selectedNodeId]);
  useEffect(() => { camera.current = { ...DEFAULT_MEMORY_CAMERA }; redraw.current(); }, [resetToken]);
  return <>
    <div className="memory-3d-surface" style={fallback ? { visibility: "hidden", pointerEvents: "none" } : undefined}>
      <canvas ref={canvasRef} tabIndex={fallback ? -1 : 0} role="application" aria-hidden={fallback} aria-label="3D memory graph. Drag or use arrow keys to rotate 360 degrees. Scroll, pinch, or use plus/minus to zoom. Click a node to open." aria-busy={loading || initializing} data-renderer="webgl2" data-titles-visible={showTitles} data-layout-volume={volume.toFixed(4)} />
      <canvas ref={labelsRef} aria-hidden="true" className="memory-3d-labels" />
      <span className="memory-3d-hint">Drag or arrows to rotate · Scroll, pinch or +/− to zoom · Click to explore</span>
    </div>
    {fallback && fallbackGraph ? <><MemoryGraph3DFallback {...props} {...fallbackGraph} coordinates={fallbackCoordinates} /><span className="memory-3d-fallback-notice" role="status">Canvas view · showing up to 2,000 nodes</span></> : null}
    {benchmarkEnabled ? <div className="memory-3d-benchmark"><button disabled={fallback || loading || initializing} onClick={() => benchmarkStart.current()}>Measure 600 frames</button><button disabled={fallback || loading || initializing} onClick={() => benchmarkStart.current("scheduler")}>Measure scheduling baseline</button><button disabled={fallback || initializing} onClick={() => loseContext.current()}>Test context recovery</button>{diagnostics ? <><button disabled={fallback || loading || initializing} onClick={() => benchmarkStart.current("replay")}>Run fixed diagnostic replay</button><button onClick={() => downloadMemoryDiagnostics(benchmarkResult)}>Download diagnostics</button></> : null}<button disabled={!benchmarkResult.startsWith("{")} onClick={() => downloadMemoryBenchmark(benchmarkResult)}>Download benchmark result</button><pre data-testid="memory-benchmark-result">{benchmarkResult}</pre></div> : null}
  </>;
}
