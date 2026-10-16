import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { mkdtemp, mkdir, readdir, copyFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
const require = createRequire(import.meta.url);
const vitestCli = join(dirname(require.resolve("vitest/package.json")), "vitest.mjs");
const temporary = await mkdtemp(join(tmpdir(), "spaceapp-synthetic-histories-"));
try {
  const result = spawnSync(process.execPath, [vitestCli, "run", "tests/temporal-workflows.test.ts"], {
    stdio: "inherit", env: { ...process.env, SPACE_TEMPORAL_RECORD_HISTORIES: "1", SPACE_TEMPORAL_HISTORY_DIR: temporary }
  });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
  if (result.status === 0) {
    const destination = fileURLToPath(new URL("../fixtures/workflow-histories/", import.meta.url));
    await mkdir(destination, { recursive: true });
    for (const name of await readdir(temporary)) await copyFile(join(temporary, name), join(destination, name));
    console.log("Recorded synthetic histories. Review fixture changes; never overwrite history to hide an incompatible workflow change.");
  }
} finally {
  await rm(temporary, { recursive: true, force: true });
}
