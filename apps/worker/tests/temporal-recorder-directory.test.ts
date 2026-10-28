import { fileURLToPath } from "node:url";
import { expect, it, vi } from "vitest";

const spawn = vi.hoisted(() => vi.fn(() => ({ status: 0 })));
vi.mock("node:child_process", () => ({ spawnSync: spawn }));
vi.mock("node:fs/promises", () => ({
  mkdtemp: vi.fn(async () => "/tmp/synthetic-history-recorder"),
  mkdir: vi.fn(async () => {}),
  readdir: vi.fn(async () => []),
  copyFile: vi.fn(async () => {}),
  rm: vi.fn(async () => {})
}));

it("uses the worker package directory when the recording script is called directly", async () => {
  const previous = process.exitCode;
  try {
    await import(new URL("./support/record-temporal-histories.mjs", import.meta.url).href);
    expect(spawn).toHaveBeenCalledTimes(1);
    const [node, args, options] = spawn.mock.calls[0] as unknown as [string, string[], { cwd: string; env: NodeJS.ProcessEnv }];
    expect(node).toBe(process.execPath);
    expect(args.slice(1)).toEqual(["run", "tests/temporal-workflows.test.ts"]);
    expect(options.cwd).toBe(fileURLToPath(new URL("../", import.meta.url)));
    expect(options.env.SPACE_TEMPORAL_RECORD_HISTORIES).toBe("1");
    expect(options.env.SPACE_TEMPORAL_HISTORY_DIR).toBe("/tmp/synthetic-history-recorder");
  } finally {
    process.exitCode = previous;
  }
});
