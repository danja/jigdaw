#!/usr/bin/env bash
# plugins/jigeqb/build.sh
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
root="$(cd "$here/../.." && pwd)"
node "$root/bin/write-profile.js" "$here"
echo "profile.ttl regenerated"
