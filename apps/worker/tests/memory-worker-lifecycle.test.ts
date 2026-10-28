import { afterEach, beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  run: vi.fn(), create: vi.fn(), connect: vi.fn(), closeConnection: vi.fn(),
  closeTelemetry: vi.fn(), stopReload: vi.fn(), watchReload: vi.fn(),
  workerOptions: { sinks: { synthetic: {} }, interceptors: { workflowModules: ["synthetic-telemetry"] } }
}));
vi.mock("@temporalio/worker", () => ({ NativeConnection: { connect: state.connect }, Worker: { create: state.create } }));
vi.mock("../src/worker-telemetry.js", () => ({ createWorkerTelemetry: () => ({ close: state.closeTelemetry, workerOptions: state.workerOptions }) }));
vi.mock("../src/deployed-code-reload.js", () => ({ reloadWhenServicesCommitChanges: state.watchReload }));
vi.mock("../src/memory-maintenance-activities.js", () => ({ refreshMemoryGraphSnapshot: vi.fn() }));
vi.mock("../src/memory-mutation-activity.js", () => ({ executePersistedMemoryChangeSet: vi.fn() }));
vi.mock("../src/memory-maintenance-config.js", () => ({ MEMORY_MAINTENANCE_TASK_QUEUE: "synthetic-maintenance", memoryMaintenanceEnabled: () => true, memoryMaintenanceWorkerOptions: {} }));
vi.mock("../src/memory-mutation-config.js", () => ({ MEMORY_MUTATION_TASK_QUEUE: "synthetic-mutation", memoryMutationsEnabled: () => true, memoryMutationWorkerOptions: {} }));
let exitCode: typeof process.exitCode;
beforeEach(() => {
  vi.resetModules(); vi.resetAllMocks();
  exitCode = process.exitCode;
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  state.connect.mockResolvedValue({ close: state.closeConnection });
  state.create.mockResolvedValue({ run: state.run });
  state.watchReload.mockReturnValue(state.stopReload);
  state.run.mockResolvedValue(undefined);
  state.closeConnection.mockResolvedValue(undefined);
  state.closeTelemetry.mockResolvedValue(undefined);
});
afterEach(() => { process.exitCode = exitCode; vi.restoreAllMocks(); });

for (const kind of ["maintenance", "mutation"]) {
  const load = () => import(new URL(`../src/memory-${kind}-worker.ts`, import.meta.url).href);
  it(`${kind} stops the reload watcher and closes telemetry and the connection after a worker failure`, async () => {
    state.run.mockRejectedValue(new Error("synthetic run failure"));
    if (kind === "maintenance") await load();
    else await expect(load()).rejects.toThrow("synthetic run failure");
    expect(state.create).toHaveBeenCalledWith(expect.objectContaining(state.workerOptions));
    expect(state.watchReload).toHaveBeenCalledTimes(1);
    expect(state.stopReload).toHaveBeenCalledTimes(1);
    expect(state.closeTelemetry).toHaveBeenCalledTimes(1);
    expect(state.closeConnection).toHaveBeenCalledTimes(1);
  });
  it(`${kind} closes telemetry and the connection when worker creation fails`, async () => {
    state.create.mockRejectedValue(new Error("synthetic creation failure"));
    if (kind === "maintenance") await load();
    else await expect(load()).rejects.toThrow("synthetic creation failure");
    expect(state.watchReload).not.toHaveBeenCalled();
    expect(state.closeTelemetry).toHaveBeenCalledTimes(1);
    expect(state.closeConnection).toHaveBeenCalledTimes(1);
  });
  it(`${kind} closes its connection even when telemetry shutdown fails`, async () => {
    state.closeTelemetry.mockRejectedValue(new Error("synthetic telemetry failure"));
    await expect(load()).rejects.toThrow("synthetic telemetry failure");
    expect(state.stopReload).toHaveBeenCalledTimes(1);
    expect(state.closeConnection).toHaveBeenCalledTimes(1);
  });
}
