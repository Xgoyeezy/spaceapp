#!/usr/bin/env bash
set -euo pipefail
clang --target=wasm32 -O3 -nostdlib -fno-fast-math -ffp-contract=off \
  -Wall -Wextra -Werror picking.c \
  -Wl,--no-entry -Wl,--export=pick_node -Wl,--export=pick_node_precomputed -Wl,--export=__heap_base \
  -Wl,--export-memory -Wl,--strip-all -o picking.wasm
clang --version > compiler.txt
sha256sum picking.c picking.wasm > SHA256SUMS
