#!/usr/bin/env bash
# plugins/boost/build.sh
#
# Build the wasm, then generate profile.ttl with the digests of the files
# that were actually produced.
#
# No Emscripten, and no shim, unlike plugins/8b8: clang++ targeting wasm32
# with -nostdlib, and boost.cpp calls nothing an nostdlib build leaves
# missing. A plugin whose own DSP does need a libc function copies
# plugins/8b8/shim/ rather than this file.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
root="$(cd "$here/../.." && pwd)"
cd "$here"

build="$here/build"
mkdir -p "$build"

CXX="${CXX:-clang++}"
command -v "$CXX" >/dev/null || { echo "$CXX not found" >&2; exit 1; }

# ---- the linker -------------------------------------------------------------
# wasm-ld comes from LLVM's lld. Where it is not on PATH, rust-lld (which
# rustup already installs for the Rust-based plugins in this directory) is
# the same linker under another name; see plugins/8b8/build.sh for the same
# fallback, done identically so the two do not silently drift apart.
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

# ---- compile and link --------------------------------------------------------
# --no-entry because there is no main. Every export is named, rather than
# --export-all: an export is part of the ABI and a list is a thing a reader
# can check against docs/module-abi.md.
#
# --allow-undefined is deliberately NOT passed. A module that resolves a
# missing symbol to an import is a module that fails to instantiate in a
# host with no imports to give it, and it fails at load rather than at build,
# which is the wrong end.
flags=(--target=wasm32 -std=c++17 -O2 -nostdlib -fno-exceptions -fno-rtti -fno-threadsafe-statics)

"$CXX" "${flags[@]}" -o "$build/boost.wasm" boost.cpp \
  -Wl,--no-entry \
  -Wl,--export=jig_init \
  -Wl,--export=jig_max_frames \
  -Wl,--export=jig_input_ptr \
  -Wl,--export=jig_output_ptr \
  -Wl,--export=jig_process \
  -Wl,--export=jig_set_param \
  -Wl,--export-memory

cp "$build/boost.wasm" "$here/boost.wasm"

node "$root/bin/write-profile.js" "$here"
echo "built $(wc -c < boost.wasm) bytes of wasm, profile.ttl regenerated"
