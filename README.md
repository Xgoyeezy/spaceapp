# Isolated C/WebAssembly picking experiment

This diagnostic compares a C port with SpaceApp's existing JavaScript picker at
`f0a2078918870b0abb0ed6cf7c02d6dea8b07e7f`. It does not change PR #133 or claim a
frame-time acceptance pass. Source preparation used AI assistance.

The numeric index is copied once into persistent WebAssembly memory. Every
timed query includes the JavaScript wrapper and four imported Math sin/cos calls.
Double arithmetic and disabled floating-point contraction preserve the existing
calculation order. No rendering, networking or React code is ported.

`bash build.sh` compiles with Clang and the WebAssembly linker. The public free
GitHub runner provides the linker so nothing needs installing on the local Mac.
See LICENSE for the upstream SpaceApp license retained for this derivative.
