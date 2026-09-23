#!/usr/bin/env bash
# plugins/squelch/build.sh
#
# No compile step: this plugin has no WebAssembly module, only the profile to
# regenerate with the digest of the processor as it stands on disk.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
root="$(cd "$here/../.." && pwd)"

node "$root/bin/write-profile.js" "$here"
echo "profile.ttl regenerated"
