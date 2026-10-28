import { expect, it, vi } from "vitest";
import { TemporalHarness, deferred } from "./support/temporal-harness.js";

it("closes a Temporal environment only once, including concurrent callers", async () => {
  const harness = new TemporalHarness();
  const gate = deferred();
  const teardown = vi.fn(async () => { await gate.promise; });
  const cleanup = vi.spyOn(harness, "cleanup").mockResolvedValue(undefined);
  Reflect.set(harness, "environment", { teardown });
  const shutdown = vi.fn();
  harness.workers.push({ getState: () => "RUNNING", shutdown } as unknown as TemporalHarness["workers"][number]);
  harness.runs.push(Promise.resolve());
  const first = harness.close();
  const second = harness.close();
  expect(second).toBe(first);
  gate.resolve();
  await Promise.all([first, second]);
  await harness.close();
  expect(cleanup).toHaveBeenCalledTimes(1);
  expect(shutdown).toHaveBeenCalledTimes(1);
  expect(teardown).toHaveBeenCalledTimes(1);
  expect(harness.workers).toEqual([]);
  expect(harness.runs).toEqual([]);
  expect(() => harness.env).toThrow("not running");
});

it("tears down the environment even when a worker run fails", async () => {
  const harness = new TemporalHarness();
  const teardown = vi.fn(async () => {});
  vi.spyOn(harness, "cleanup").mockResolvedValue(undefined);
  Reflect.set(harness, "environment", { teardown });
  harness.runs.push(Promise.reject(new Error("synthetic worker failure")));
  await expect(harness.close()).rejects.toThrow("synthetic worker failure");
  expect(teardown).toHaveBeenCalledTimes(1);
  expect(() => harness.env).toThrow("not running");
});

it("tears down the environment when cleanup fails without repeating teardown", async () => {
  const harness = new TemporalHarness();
  const teardown = vi.fn(async () => {});
  vi.spyOn(harness, "cleanup").mockRejectedValue(new Error("synthetic cleanup failure"));
  Reflect.set(harness, "environment", { teardown });
  await expect(harness.close()).rejects.toThrow("synthetic cleanup failure");
  await expect(harness.close()).rejects.toThrow("synthetic cleanup failure");
  expect(teardown).toHaveBeenCalledTimes(1);
});
