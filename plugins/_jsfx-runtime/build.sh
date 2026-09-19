#!/usr/bin/env bash
# plugins/_jsfx-runtime/build.sh
#
# This is not a plugin directory: it has no profile.json and bin/build-plugin-index.js
# skips it (the leading underscore). It is the shared runtime bin/jsfx-import.js copies
# into each converted JSFX plugin's own directory, alongside that plugin's compiled
# script. Building it here just produces jsfx-runtime.wasm for the importer to find.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$here"

cargo build --release --target wasm32-unknown-unknown
cp target/wasm32-unknown-unknown/release/jsfx_runtime.wasm jsfx-runtime.wasm
echo "built $(wc -c < jsfx-runtime.wasm) bytes of wasm"
