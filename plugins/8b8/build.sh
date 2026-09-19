#!/usr/bin/env bash
# plugins/8b8/build.sh
#
# Build the firmware to WebAssembly, then generate the profile with the
# digests of the files that were actually produced.
#
# No Emscripten. A JigDAW module must instantiate with no imports
# (docs/module-abi.md), and an emcc build brings a libc and its imports with
# it, so this is clang targeting wasm32 with -nostdlib and wasm-ld doing the
# link. plugins/8b8/shim/ supplies the few libc functions that leaves missing.
#
# wasm-ld comes from LLVM's lld. Ubuntu's clang package does not include it,
# so this falls back to the rust-lld that rustup already installs for the
# other plugins in this directory: it is the same linker under another name,
# and invoked through a symlink called wasm-ld it selects the wasm flavour by
# itself. HUMANS.md asks for lld to be installed properly.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
root="$(cd "$here/../.." && pwd)"
cd "$here"

build="$here/build"
mkdir -p "$build"

CXX="${CXX:-clang++}"
command -v "$CXX" >/dev/null || { echo "$CXX not found" >&2; exit 1; }
CXX_PROBE="$CXX"

# ---- the linker -------------------------------------------------------------
if command -v wasm-ld >/dev/null; then
  : # already on PATH
else
  rustlld="$(find "${RUSTUP_HOME:-$HOME/.rustup}/toolchains" -name rust-lld -type f -print -quit 2>/dev/null || true)"
  [ -n "$rustlld" ] || {
    echo "no wasm-ld and no rust-lld: install lld (see HUMANS.md) or a rust toolchain" >&2
    exit 1
  }
  # Both names: the clang driver looks for a version-suffixed wasm-ld first
  # and --ld-path is ignored for the wasm target, so this goes on PATH.
  ln -sf "$rustlld" "$build/wasm-ld"
  ln -sf "$rustlld" "$build/wasm-ld-$("$CXX_PROBE" -dumpversion | cut -d. -f1)"
  PATH="$build:$PATH"
fi



# ---- the parameter definition, into the profile and the module --------------
node make.js

# ---- compile ----------------------------------------------------------------
# -x c++ because the firmware is a .ino and the compiler has never heard of
# one. The warnings turned off are the ones the firmware's own Arduino build
# does not raise: an AVR int is 16 bits and the source is written for it.
flags=(
  --target=wasm32 -std=c++17 -O2 -nostdlib
  -fno-exceptions -fno-rtti -fno-threadsafe-statics
  -Wno-narrowing -Wno-write-strings -Wno-unused-value
  -I"$here" -I"$here/shim"
)

"$CXX" "${flags[@]}" -c 8b8.cpp -o "$build/8b8.o"
"$CXX" "${flags[@]}" -c shim/nostdlib.cpp -o "$build/nostdlib.o"

# ---- link -------------------------------------------------------------------
# --no-entry because there is no main. Every export is named, rather than
# --export-all: an export is part of the ABI and a list is a thing a reader
# can check against docs/module-abi.md.
#
# --allow-undefined is deliberately NOT passed. A module that resolves a
# missing symbol to an import is a module that fails to instantiate in the
# host with no imports to give it, and it fails at load rather than at build,
# which is the wrong end.
"$CXX" "${flags[@]}" -o "$build/8b8.wasm" \
  "$build/8b8.o" "$build/nostdlib.o" \
  -Wl,--no-entry \
  -Wl,--export=jig_init \
  -Wl,--export=jig_max_frames \
  -Wl,--export=jig_output_ptr \
  -Wl,--export=jig_process \
  -Wl,--export=jig_set_param \
  -Wl,--export=jig_midi_in_ptr \
  -Wl,--export=jig_midi_in_capacity \
  -Wl,--export=jig_midi_in \
  -Wl,--export=jig_x_register \
  -Wl,--export=jig_x_voice_playing \
  -Wl,--export=jig_x_param \
  -Wl,--export-memory

cp "$build/8b8.wasm" "$here/8b8.wasm"

node "$root/bin/write-profile.js" "$here"
echo "built $(wc -c < 8b8.wasm) bytes of wasm, profile.ttl regenerated"
