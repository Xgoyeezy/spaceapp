import type { MemoryGraphEdge, MemoryGraphNode } from "@space/contracts";
import { getMemoryDiagnostics } from "./memory-diagnostics.js";
import type { MemoryWorkerTrace } from "./memory-worker-diagnostics.js";

/** Parse large graph responses off-thread and return bounded object batches. */
export async function readLargeMemoryResponse(response: Response): Promise<unknown> {
  const diagnostics = getMemoryDiagnostics();
  const started = diagnostics ? performance.now() : 0;
  const bytes = await response.arrayBuffer();
  diagnostics?.record("response.read.wait", started, performance.now(), {}, { bytes: bytes.byteLength });
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./memory-response.worker.ts", import.meta.url), { type: "module" });
    const nodes: MemoryGraphNode[] = [], edges: MemoryGraphEdge[] = [];
    worker.onerror = () => { worker.terminate(); reject(new Error("Memory response could not be decoded.")); };
    worker.onmessage = (event: MessageEvent<{ nodes?: MemoryGraphNode[]; edges?: MemoryGraphEdge[]; value?: unknown; graph?: boolean; error?: string; workerTrace?: MemoryWorkerTrace }>) => {
      if (event.data.workerTrace) {
        diagnostics?.worker(event.data.workerTrace, performance.now());
        if (event.data.workerTrace.complete) { worker.terminate(); return; }
      }
      if (event.data.error) { worker.terminate(); reject(new Error(event.data.error)); }
      else if (event.data.nodes) nodes.push(...event.data.nodes);
      else if (event.data.edges) edges.push(...event.data.edges);
      else {
        if (!diagnostics) worker.terminate();
        const value = event.data.value as { data: Record<string, unknown> };
        resolve(event.data.graph ? { ...value, data: { ...value.data, nodes, edges } } : value);
      }
    };
    worker.postMessage(diagnostics ? { bytes, diagnosticGeneration: diagnostics.identity(response) } : bytes, [bytes]);
  });
}
