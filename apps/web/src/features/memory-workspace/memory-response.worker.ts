import { yieldMemoryWork } from "./memory-yield.js";
import { MemoryWorkerDiagnostics } from "./memory-worker-diagnostics.js";
export type MemoryResponseRequest = ArrayBuffer | { bytes: ArrayBuffer; diagnosticGeneration: number };
self.onmessage = async (event: MessageEvent<MemoryResponseRequest>) => {
  const request = event.data;
  const bytes = "bytes" in request ? request.bytes : request;
  const diagnostics = "diagnosticGeneration" in request ? new MemoryWorkerDiagnostics("response", request.diagnosticGeneration) : undefined;
  const measure = <T>(name: string, fn: () => T): T => diagnostics ? diagnostics.measure(name, fn) : fn();
  const post = (message: object) => diagnostics ? diagnostics.post(message) : self.postMessage(message);
  const pause = () => diagnostics ? diagnostics.pause(yieldMemoryWork) : yieldMemoryWork();
  try {
    const raw = measure("text.decode", () => new TextDecoder().decode(bytes));
    let value;
    try { value = measure("json.parse", () => JSON.parse(raw)); } catch { post({ value: raw }); return; }
    if (!Array.isArray(value?.data?.nodes) || !Array.isArray(value?.data?.edges)) { post({ value }); return; }
    const { nodes, edges, ...metadata } = value.data;
    for (let i = 0; i < nodes.length; i += 1000) {
      post({ nodes: measure("nodes.batch", () => nodes.slice(i, i + 1000)) });
      await pause();
    }
    for (let i = 0; i < edges.length; i += 2000) {
      post({ edges: measure("edges.batch", () => edges.slice(i, i + 2000)) });
      await pause();
    }
    post({ value: { ...value, data: metadata }, graph: true });
  } catch { post({ error: "Memory response could not be decoded." }); }
  finally { diagnostics?.finish(); }
};
export {};
