#!/usr/bin/env bash
# plugins/sam/build.sh
#
# Build the wasm, then generate profile.ttl with the digests of the files that
# were actually produced. The profile is generated rather than hand-edited
# because a digest written by hand is a digest that goes stale on the next
# build, silently, and the failure is a refused plugin.
#
# No Emscripten. A JigDAW module must instantiate with no imports
# (docs/module-abi.md), so this is clang targeting wasm32 with -nostdlib and
# wasm-ld doing the link. shim/ supplies the few libc functions that leaves
# missing, as it does for plugins/mop/.
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
  -I"$here" -I"$here/shim"
)
# SAM is 1982 code with its own idioms; its warnings are not this plugin's.
objects=()
for src in sam reciter render processframes createtransitions debug; do
  "$CC" "${cflags[@]}" -std=gnu11 -w -c "third_party/$src.c" -o "$build/$src.o"
  objects+=("$build/$src.o")
done
"$CXX" "${cflags[@]}" -std=c++17 -c sam.cpp -o "$build/sam-core.o"
"$CXX" "${cflags[@]}" -std=c++17 -c shim/nostdlib.cpp -o "$build/nostdlib.o"

# ---- link -------------------------------------------------------------------
# Every export is named, rather than --export-all: an export is part of the ABI
# and a list is a thing a reader can check against docs/module-abi.md.
# --allow-undefined is deliberately NOT passed: a module that resolves a missing
# symbol to an import fails to instantiate in a host that has none to give.
"$CXX" "${cflags[@]}" -o "$build/sam.wasm" \
  "${objects[@]}" "$build/sam-core.o" "$build/nostdlib.o" \
  -Wl,--no-entry \
  -Wl,-z,stack-size=262144 \
  -Wl,--export=jig_init \
  -Wl,--export=jig_max_frames \
  -Wl,--export=jig_output_ptr \
  -Wl,--export=jig_process \
  -Wl,--export=jig_set_param \
  -Wl,--export=jig_midi_in_ptr \
  -Wl,--export=jig_midi_in_capacity \
  -Wl,--export=jig_midi_in \
  -Wl,--export=jig_transport_ptr \
  -Wl,--export=jig_text_ptr \
  -Wl,--export=jig_text_capacity \
  -Wl,--export=jig_set_text \
  -Wl,--export=jig_latency_frames \
  -Wl,--export=jig_active_voices \
  -Wl,--export=jig_out_word \
  -Wl,--export=jig_word_count \
  -Wl,--export=jig_exp2 \
  -Wl,--export-memory

cp "$build/sam.wasm" "$here/sam.wasm"

node "$root/bin/write-profile.js" "$here"
echo "built $(wc -c < sam.wasm) bytes of wasm, profile.ttl regenerated"
