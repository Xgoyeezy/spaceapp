# Isolated C/WebAssembly picking experiment

This diagnostic compares a C port with SpaceApp's existing JavaScript picker at
`f0a2078918870b0abb0ed6cf7c02d6dea8b07e7f`. It does not change PR #133 or claim a
frame-time acceptance pass. Source preparation used AI assistance.

The numeric index is copied once into persistent WebAssembly memory. Every
timed query includes the JavaScript wrapper. The first variant imports four
Math sin/cos calls; the second computes them in JavaScript before entering C.
Double arithmetic and disabled floating-point contraction preserve the existing
calculation order. No rendering, networking or React code is ported.

`bash build.sh` compiles with Clang and the WebAssembly linker. The public free
GitHub runner provides the linker so nothing needs installing on the local Mac.
See LICENSE for the upstream SpaceApp license retained for this derivative.

The [findings](findings.md) describe the actual result and its limits. The tested
module, generated browser bundle, numeric fixtures, correctness checks, and
browser downloads are included. The module is 1,332 bytes; it is not a runtime
dependency of SpaceApp.

To reproduce with the existing SpaceApp checkout's esbuild and Node:

```sh
SPACEAPP=/path/to/spaceapp
"$SPACEAPP/node_modules/esbuild/bin/esbuild" browser.ts --bundle --format=esm --target=es2022 --outfile=browser.js
"$SPACEAPP/node_modules/esbuild/bin/esbuild" verify.ts --bundle --platform=node --format=esm --target=es2022 --outfile=verify.mjs
node verify.mjs
python3 -m http.server 4924 --bind 127.0.0.1
```

Open `http://127.0.0.1:4924/?nodes=2000&first=js&mode=precomputed&label=foreground`
in Chrome, select the tab in the native browser, and click Run comparison.
Repeat with `first=wasm`, then both orders at `nodes=50000`. Keep the page focused
until it completes. The Download comparison button retains every timing sample.

The baseline's type-only import is erased when bundling; the benchmark does not
require the rest of the app at runtime. Numeric fixtures come from the earlier
synthetic graph diagnostic and contain no user memory contents.
