import { activeMemoryDiagnostics, type MemoryDiagnosticTags } from "./memory-diagnostics.js";
/** Opt-in demo harness only; production workspace state is never affected. */
export function memoryBenchmarkEnabled(): boolean {
  return typeof window !== "undefined" && window.location.pathname.replace(/\/$/, "").endsWith("/demo-workspace") && new URLSearchParams(window.location.search).get("memoryBenchmark") === "1";
}

const workDurations = new Map<string, number>();
export function measureMemoryWork<T>(name: string, run: () => T, tags?: MemoryDiagnosticTags): T {
  if (!memoryBenchmarkEnabled()) return run();
  const started = performance.now();
  try { return run(); }
  finally {
    const ended = performance.now();
    workDurations.set(name, Math.max(workDurations.get(name) ?? 0, ended - started));
    activeMemoryDiagnostics()?.record(name, started, ended, tags);
  }
}
export function memoryWorkDurations() { return Object.fromEntries(workDurations); }
