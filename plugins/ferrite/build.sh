#!/usr/bin/env bash
# plugins/ferrite/build.sh
#
# Build the wasm, then generate profile.ttl with the digests of the files
# that were actually produced.
#
# Unlike every other Rust plugin here, this one has a real dependency,
# nam-rs, fetched from crates.io on first build (see src/lib.rs's header for
# why an already-validated implementation rather than one written against
# the .nam format's own documentation). Every later build uses Cargo.lock,
# committed here for the same reason it is committed for a native binary
# rather than a library: this crate is never depended on by anything else,
# and a build that silently picks up a newer nam-rs is a build nobody asked
# to change what the module does.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
root="$(cd "$here/../.." && pwd)"
cd "$here"

cargo build --release --target wasm32-unknown-unknown
cp target/wasm32-unknown-unknown/release/ferrite.wasm ferrite.wasm

node "$root/bin/write-profile.js" "$here"
echo "built $(wc -c < ferrite.wasm) bytes of wasm, profile.ttl regenerated"
