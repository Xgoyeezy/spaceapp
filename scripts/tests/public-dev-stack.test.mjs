import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { devCompose, devEnvironment, devStackConfig, pinnedDevImages, pinnedOpenCode } from "../dev-stack-config.mjs";

const config = devStackConfig("/tmp/spaceapp-contributor");
test("dev-stack ports are distinct, loopback-only and separate from installed ports", () => {
  const compose = devCompose(config, { postgres: "fixture-pg", temporal: "fixture-temporal" });
  assert.deepEqual(Object.keys(compose.services), ["postgres", "temporal"]);
  assert.deepEqual(compose.services.postgres.ports, ["127.0.0.1:55432:5432"]);
  assert.deepEqual(compose.services.temporal.ports, ["127.0.0.1:57233:7233"]);
  assert.equal(compose.services.postgres.environment.POSTGRES_PASSWORD_FILE, "/run/secrets/postgres-password");
  assert.ok(!JSON.stringify(compose).includes("POSTGRES_PASSWORD\""));
  for (const value of ["4910", "4911", "80", "65536", "0.0.0.0:5000", "1e4", "5000; echo wrong"]) {
    assert.throws(() => devStackConfig(config.root, { SPACE_DEV_API_PORT: value }));
  }
  assert.throws(() => devStackConfig(config.root, { SPACE_DEV_API_PORT: "54911" }), /distinct/);
});

test("state identity is stable per checkout and refuses destructive path choices", () => {
  assert.deepEqual(devStackConfig(config.root), config);
  assert.notEqual(devStackConfig("/tmp/another-checkout").project, config.project);
  assert.notEqual(devStackConfig(config.root, { SPACE_DEV_STACK_DIR: ".dev-stack-second" }).project, config.project);
  for (const state of ["/", "/tmp", ".", "..", "node_modules", "apps", "../.dev-stack"]) {
    assert.throws(() => devStackConfig(config.root, { SPACE_DEV_STACK_DIR: state }));
  }
  assert.throws(() => devStackConfig("/tmp/" + "a".repeat(120)), /Unix sockets/);
});

test("image and provider versions come from the distribution's current sources", async () => {
  const template = await readFile(new URL("../../packages/run-spaceapp/templates/compose.yml", import.meta.url), "utf8");
  const dockerfile = await readFile(new URL("../../Dockerfile", import.meta.url), "utf8");
  const images = pinnedDevImages(template);
  assert.match(images.postgres, /^pgvector\/pgvector:.+@sha256:[0-9a-f]{64}$/);
  assert.match(images.temporal, /^temporalio\/auto-setup:.+@sha256:[0-9a-f]{64}$/);
  assert.match(pinnedOpenCode(dockerfile), /^\d+\.\d+\.\d+$/);
  assert.throws(() => pinnedDevImages(template.replace(/@sha256:[0-9a-f]{64}/g, "")), /pin/);
  assert.throws(() => pinnedOpenCode("opencode-ai@latest"));
  assert.throws(() => pinnedOpenCode("opencode-ai@1.2.3 opencode-ai@1.2.4"));
});

test("child processes cannot inherit installed services or provider credentials", () => {
  const inherited = { PATH: "/usr/bin:/bin", USER: "developer", HOME: "/private/user", OPENAI_API_KEY: "do-not-inherit", NODE_OPTIONS: "--require private-preload", SPACE_DATABASE_URL: "postgres://installed", SPACE_TEMPORAL_ADDRESS: "installed:7233", SPACE_INSTANCE_ENABLED_JOBS: "telegram-bridge", SPACE_DEV_LOGIN: "true" };
  const env = devEnvironment(config, { database: "synthetic-password", session: "synthetic-session" }, inherited);
  assert.equal(env.OPENAI_API_KEY, undefined);
  assert.equal(env.NODE_OPTIONS, undefined);
  assert.equal(env.SPACE_DEV_LOGIN, "false");
  assert.equal(env.SPACE_INSTANCE, "dev");
  assert.equal(env.SPACE_INSTANCE_ENABLED_JOBS, "");
  assert.equal(env.SPACEAPP_WORKFLOWS_ENABLED, "true");
  assert.equal(env.SPACE_API_HOST, "127.0.0.1");
  assert.equal(env.SPACE_WEB_HOST, "127.0.0.1");
  assert.ok(env.HOME.startsWith(config.state + "/"));
  assert.ok(!Object.values(env).some(value => value.includes("installed") || value.includes("do-not-inherit")));
});
