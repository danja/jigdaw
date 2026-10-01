#!/usr/bin/env bash
# plugins/keyframe/build.sh
#
# Build the wasm, then generate profile.ttl with the digests of the files that
# were actually produced.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
root="$(cd "$here/../.." && pwd)"
cd "$here"

cargo build --release --target wasm32-unknown-unknown
cp target/wasm32-unknown-unknown/release/keyframe.wasm keyframe.wasm

node "$root/bin/write-profile.js" "$here"
echo "built $(wc -c < keyframe.wasm) bytes of wasm, profile.ttl regenerated"
