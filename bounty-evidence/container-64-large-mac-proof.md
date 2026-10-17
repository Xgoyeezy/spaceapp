# Large-profile container acceptance on macOS

Tested 2026-10-16/17 UTC on Apple M2, macOS 27.0.1, 8 CPU cores, 16 GiB RAM, Docker Desktop with 8 CPUs and 7.7 GiB allocated. Native Linux ARM64 images were built locally and tagged as runtime 1.1.6. The final browser image includes the Xvfb fix in a1feff8e8c73a8c72985c5ceac1a0e43dfa9427e; the other service sources are unchanged from 3d46d8c.

Commands used from the container-closure checkout:

```sh
docker build --target core -t ghcr.io/oll4com/spaceapp-core:1.1.6 .
docker build --target browser -t ghcr.io/oll4com/spaceapp-browser:1.1.6 .
docker build --target cli -t ghcr.io/oll4com/spaceapp-cli:1.1.6 .
# SPACEAPP_HOME pointed at a fresh, private temporary directory.
node packages/run-spaceapp/bin/spaceapp.mjs install --profile large --local-images --no-open --non-interactive --answers '{"confirm":true,"profile":"large","access":"isolated","companions":false,"telemetry":false,"open":false}'
node packages/run-spaceapp/bin/spaceapp.mjs doctor
```

The installer passed its unmodified CPU, host-memory, engine-memory and disk preflights. `/readyz` returned `ok: true`. A synthetic owner was created through the normal setup endpoint, then signed in through Chrome's visible login page. In Getting Started, the real OpenCode 1.18.4 pane reached its prompt. Create → Add browser pane opened a managed Chromium pane, and its URL field loaded `https://example.com/` with title Example Domain. Both panes are visible in the accompanying unedited screenshot. No AI prompt was submitted and no provider credentials were supplied. The bundled first-launch routine checked its free model candidates.

The first run exposed `BROWSER_XVFB_UNAVAILABLE`. The browser target now installs Xvfb from the same Debian repositories as Chromium. The extended container smoke test uses the real Browser Host socket and PostgreSQL store to start a headed pane, list its page, capture a frame and stop it as uid/gid 10001. It failed on the old image with the same missing-Xvfb error and passed on the corrected image:

```json
{"target":"browser","image":"ghcr.io/oll4com/spaceapp-browser:1.1.6","passed":true,"nonRootProbe":true,"postgresMigrations":true,"chromium":true,"headedBrowserPane":true}
{"target":"browser","cleaned":true}
{"platform":"darwin","profile":"large","engine":"docker","runtimeVersion":"1.1.6","localImages":true,"ownerSetup":true,"ready":true}
```

The application's existing `/opt/spaceapp` dedicated-storage banner remains visible; it did not block these pane operations. Browser Host also restarted during first-boot migration ordering and recovered after the core applied migrations. Neither observation is hidden by this receipt.

After the UI checks, the launcher completed `uninstall --purge-data` with its DELETE confirmation. A separate project-label check verified no test containers remained; that project's volumes and network, temporary configuration and generated credentials were removed.

This verifies the macOS launcher and its Linux ARM64 containers. It does **not** satisfy the issue's separate requirement for the same full-stack test from a Linux host. No resource checks were bypassed and no release was published.
