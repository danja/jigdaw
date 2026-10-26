#!/usr/bin/env bash
# plugins/octet/build.sh
#
# Build the wasm, then generate profile.ttl with the digests of the files that
# were actually produced. The profile is generated rather than hand-edited
# because a digest written by hand is a digest that goes stale on the next
# build, silently, and the failure is a refused plugin.
#
# No Emscripten. A JigDAW module must instantiate with no imports
# (docs/module-abi.md), so this is clang targeting wasm32 with -nostdlib and
# wasm-ld doing the link. shim/ supplies the few libc functions that leaves
# missing, as it does for plugins/mop/ and plugins/sam/. No libm either: the maths
# is written in octet.cpp and checked against Math.* by the tests.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
root="$(cd "$here/../.." && pwd)"
cd "$here"

build="$here/build"
mkdir -p "$build"

CXX="${CXX:-clang++}"
CC="${CC:-clang}"
command -v "$CXX" >/dev/null || { echo "$CXX not found" >&2; exit 1; }
command -v "$CC" >/dev/null || { echo "$CC not found" >&2; exit 1; }

# ---- the linker -------------------------------------------------------------
if command -v wasm-ld >/dev/null; then
  : # already on PATH
else
  rustlld="$(find "${RUSTUP_HOME:-$HOME/.rustup}/toolchains" -name rust-lld -type f -print -quit 2>/dev/null || true)"
  [ -n "$rustlld" ] || {
    echo "no wasm-ld and no rust-lld: install lld (see HUMANS.md) or a rust toolchain" >&2
    exit 1
  }
  ln -sf "$rustlld" "$build/wasm-ld"
  ln -sf "$rustlld" "$build/wasm-ld-$("$CXX" -dumpversion | cut -d. -f1)"
  PATH="$build:$PATH"
fi

# ---- compile ----------------------------------------------------------------
cflags=(
  --target=wasm32 -O2 -nostdlib
  -fno-exceptions -fno-rtti -fno-threadsafe-statics
  -I"$here"
)
"$CXX" "${cflags[@]}" -std=c++17 -Wall -Wextra -c octet.cpp -o "$build/octet.o"
"$CXX" "${cflags[@]}" -std=c++17 -c shim/nostdlib.cpp -o "$build/nostdlib.o"

# ---- link -------------------------------------------------------------------
# Every export is named, rather than --export-all: an export is part of the ABI
# and a list is a thing a reader can check against docs/module-abi.md.
# --allow-undefined is deliberately NOT passed: a module that resolves a missing
# symbol to an import fails to instantiate in a host that has none to give.
"$CXX" "${cflags[@]}" -o "$build/octet.wasm" \
  "$build/octet.o" "$build/nostdlib.o" \
  -Wl,--no-entry \
  -Wl,-z,stack-size=262144 \
  -Wl,--export=jig_init \
  -Wl,--export=jig_max_frames \
  -Wl,--export=jig_input_ptr \
  -Wl,--export=jig_output_ptr \
  -Wl,--export=jig_process \
  -Wl,--export=jig_set_param \
  -Wl,--export=jig_midi_in_ptr \
  -Wl,--export=jig_midi_in_capacity \
  -Wl,--export=jig_midi_in \
  -Wl,--export=jig_latency_frames \
  -Wl,--export=jig_math \
  -Wl,--export=jig_spectrum_ptr \
  -Wl,--export=jig_spectrum_bins \
  -Wl,--export=jig_spectrum_serial \
  -Wl,--export=jig_spectrum_edge_hz \
  -Wl,--export=jig_live_active \
  -Wl,--export=jig_live_value \
  -Wl,--export=jig_param_min \
  -Wl,--export=jig_param_max \
  -Wl,--export=jig_param_default \
  -Wl,--export=jig_param \
  -Wl,--export-memory

cp "$build/octet.wasm" "$here/octet.wasm"

node "$root/bin/write-profile.js" "$here"
echo "built $(wc -c < octet.wasm) bytes of wasm, profile.ttl regenerated"
