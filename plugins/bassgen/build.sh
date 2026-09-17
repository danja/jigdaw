#!/usr/bin/env bash
# plugins/bassgen/build.sh
#
# Build the wasm, then generate profile.ttl with the digests of the files that
# were actually produced. The profile is generated rather than hand-edited
# because a digest written by hand is a digest that goes stale on the next
# build, silently, and the failure is a refused plugin.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
root="$(cd "$here/../.." && pwd)"
cd "$here"

cargo build --release --target wasm32-unknown-unknown
cp target/wasm32-unknown-unknown/release/bassgen.wasm bassgen.wasm

node "$root/bin/write-profile.js" "$here"
echo "built $(wc -c < bassgen.wasm) bytes of wasm, profile.ttl regenerated"
