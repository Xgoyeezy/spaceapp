#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const args = process.argv.slice(2);
const option = name => args[args.indexOf(name) + 1];
const target = option("--target"), image = option("--image");
if (!args.includes("--target") || !args.includes("--image") || !["core", "browser", "cli"].includes(target) || !image) throw new Error("Usage: container-smoke.mjs --target core|browser|cli --image <local-image>");
const id = `spaceapp-smoke-${target}-${randomBytes(6).toString("hex")}`;
const directory = await mkdtemp(join(tmpdir(), "spaceapp-image-smoke-"));
const password = randomBytes(32).toString("hex"), sessionSecret = randomBytes(32).toString("hex"), setupToken = randomBytes(32).toString("hex");
const containers = [], network = `${id}-net`;
function docker(args, { input, tolerate = false, timeout = 180_000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn("docker", args, { stdio: ["pipe", "pipe", "pipe"] });
    let output = "";
    for (const stream of [child.stdout, child.stderr]) stream.on("data", data => { output += data; });
    child.stdin.on("error", () => {}); child.stdin.end(input);
    const timer = setTimeout(() => child.kill("SIGKILL"), timeout);
    child.once("error", error => { clearTimeout(timer); reject(error); });
    child.once("close", code => {
      clearTimeout(timer);
      for (const secret of [password, sessionSecret, setupToken]) output = output.split(secret).join("[redacted]");
      if (code === 0 || tolerate) resolve(output); else reject(new Error(`docker ${args[0]} failed (${code}): ${output.slice(-4000)}`));
    });
  });
}
async function waitFor(run, label) {
  let last;
  for (let attempt = 0; attempt < 90; attempt++) {
    try { return await run(); } catch (error) { last = error; }
    await delay(1000);
  }
  throw new Error(`${label} failed: ${last.message}`);
}
try {
  await docker(["network", "create", network]);
  const envFile = join(directory, "environment");
  await writeFile(envFile, [
    "SPACE_PUBLIC_DISTRIBUTION=true", "SPACE_RUNTIME_STORE=postgres", "SPACE_INSTANCE=dev", "SPACE_INSTANCE_ENABLED_JOBS=",
    "SPACE_OPTIONAL_MODULES=none", "SPACE_DEV_LOGIN=false", `SPACE_SESSION_SECRET=${sessionSecret}`,
    "SPACEAPP_WORKFLOWS_ENABLED=false", "SPACE_CLI_ENABLED=false", "SPACE_CLI_ROOT_ENABLED=false",
    "SPACE_CLI_HOST_SOCKET=/run/spaceapp-cli/smoke.sock", "SPACE_CLI_ADMIN_HOST_SOCKET=/run/spaceapp-cli/admin.sock",
    `SPACE_BROWSER_SESSIONS_ENABLED=${target === "browser"}`, "SPACE_BROWSER_HOST_TRANSPORT=unix", "SPACE_BROWSER_HOST_SOCKET=/run/spaceapp-browser/smoke.sock",
    "SPACE_API_HOST=127.0.0.1", "SPACE_API_PORT=4910", "SPACE_WEB_HOST=0.0.0.0", "SPACE_WEB_PORT=4911", "SPACE_TELEMETRY_ENABLED=false"
  ].join("\n") + "\n", { mode: 0o600 });
  if (target !== "cli") {
    await writeFile(join(directory, "postgres-env"), `POSTGRES_USER=spaceapp\nPOSTGRES_DB=spaceapp\nPOSTGRES_PASSWORD=${password}\n`, { mode: 0o600 });
    const template = await readFile("packages/run-spaceapp/templates/compose.yml", "utf8");
    const postgresImage = /^  postgres:\n\s+image: (\S+)/m.exec(template)?.[1];
    assert.match(postgresImage ?? "", /@sha256:[0-9a-f]{64}$/);
    containers.push(`${id}-pg`);
    await docker(["run", "-d", "--name", `${id}-pg`, "--network", network, "--network-alias", "postgres", "--env-file", join(directory, "postgres-env"), postgresImage]);
    await waitFor(() => docker(["exec", `${id}-pg`, "pg_isready", "-U", "spaceapp", "-d", "spaceapp"]), "PostgreSQL");
    for (const [name, value] of [["database-url", `postgresql://spaceapp:${password}@postgres:5432/spaceapp`], ["session-secret", sessionSecret], ["setup-token", setupToken]]) await writeFile(join(directory, name), value + "\n", { mode: 0o644 });
    if (target === "browser") {
      const migrations = (await readdir("packages/db/migrations")).filter(name => name.endsWith(".sql")).sort();
      const sql = (await Promise.all(migrations.map(name => readFile(join("packages/db/migrations", name), "utf8")))).join("\n");
      await docker(["exec", "-i", `${id}-pg`, "psql", "-U", "spaceapp", "-d", "spaceapp", "-v", "ON_ERROR_STOP=1"], { input: sql });
    }
  }
  containers.push(id);
  await docker(["run", "-d", "--name", id, "--init", "--network", network, "--env-file", envFile,
    "--mount", `type=bind,src=${directory},dst=/run/secrets,readonly`, image]);
  if (target === "core") {
    await waitFor(() => docker(["exec", "--user", "10001:10001", id, "node", "-e", "fetch('http://127.0.0.1:4911/readyz').then(async r=>{if(!r.ok||(await r.json()).ok!==true)process.exit(1);console.log('readyz ok')}).catch(()=>process.exit(1))"]), "Core readiness after migrations");
    await docker(["exec", "--user", "10001:10001", id, "node", "--input-type=module", "-e", "import {bundleWorkflowCode} from '@temporalio/worker'; await bundleWorkflowCode({workflowsPath:'/app/apps/worker/dist/workflows.js'}); console.log('workflow compiler ok')"]);
  } else {
    const pkg = target === "cli" ? "cli-host" : "browser-host", client = target === "cli" ? "CliHostClient" : "BrowserHostClient";
    const path = target === "cli" ? "/run/spaceapp-cli/smoke.sock" : "/run/spaceapp-browser/smoke.sock";
    const probe = target === "cli"
      ? `import net from 'node:net'; import {encodeLengthPrefixedJson,LengthPrefixedJsonDecoder} from './packages/cli-host/dist/framing.js';
        const socket=net.connect(${JSON.stringify(path)}), decoder=new LengthPrefixedJsonDecoder();
        const timer=setTimeout(()=>{socket.destroy();process.exit(1)},3000);
        socket.on('error',()=>process.exit(1));
        socket.on('connect',()=>socket.write(encodeLengthPrefixedJson({kind:'request',requestId:'smoke',method:'inspect',params:{}})));
        socket.on('data',chunk=>{for(const value of decoder.push(chunk)){if(value.requestId==='smoke'){clearTimeout(timer);socket.end();if(!value.ok||!value.result.hostPid)process.exit(1);console.log('host socket ok')}}});`
      : `import {${client}} from './packages/${pkg}/dist/client.js'; const client = new ${client}({socketPath:${JSON.stringify(path)},healthTimeoutMs:3000}); try { const health = await client.health(); if(!health.hostPid) throw new Error('Missing host PID'); console.log('host socket ok'); } finally { await client.close(); }`;
    await waitFor(() => docker(["exec", "--user", "10001:10001", id, "node", "--input-type=module", "-e", probe], { timeout: 5000 }), `${target} host socket`);
    if (target === "cli") {
      await docker(["exec", "--user", "10001:10001", id, "node", "--input-type=module", "-e", "import pty from 'node-pty'; const child=pty.spawn('/bin/sh',['-c','printf native-pty-ok'],{cwd:'/tmp',env:{PATH:'/usr/bin:/bin'}}); let output=''; const timer=setTimeout(()=>process.exit(1),5000); child.onData(data=>output+=data); child.onExit(({exitCode})=>{clearTimeout(timer);if(exitCode!==0||!output.includes('native-pty-ok'))process.exit(1);console.log('native PTY ok')});"]);
    }
    if (target === "browser") {
      const html = await docker(["exec", "--user", "10001:10001", id, "chromium", "--headless", "--no-sandbox", "--disable-dev-shm-usage", "--dump-dom", "about:blank"]);
      assert.ok(html.includes("<html>"), "Headless Chromium produced a document");
    }
  }
  console.log(JSON.stringify({ target, image, passed: true, nonRootProbe: true, postgresMigrations: target !== "cli", chromium: target === "browser" }));
} catch (error) {
  for (const name of containers) console.error(await docker(["logs", "--tail", "30", name], { tolerate: true }));
  throw error;
} finally {
  for (const name of containers.reverse()) await docker(["rm", "-f", "-v", name], { tolerate: true });
  await docker(["network", "rm", network], { tolerate: true });
  await rm(directory, { recursive: true, force: true });
  const remaining = (await docker(["ps", "-a", "--filter", `name=${id}`, "--format", "{{.Names}}"])).trim();
  assert.equal(remaining, "", "Smoke containers were removed");
  console.log(JSON.stringify({ target, cleaned: true }));
}
