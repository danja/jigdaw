#!/usr/bin/env bash
# plugins/8b8/sync.sh
#
# Re-vendor the firmware snapshot and the parameter definition from the
# 8bit8asterd repository.
#
# JigDAW depends on none of the related repositories, so the firmware lives
# here as a snapshot rather than as a path into a sibling checkout: a plugin
# that cannot be built from this repository alone is not a plugin, it is a
# build instruction. The snapshot records the commit it came from so a stale
# copy is visible rather than merely old.
#
# Nothing in the build runs this. Run it when the firmware moves, then
# ./build.sh, then npm test: tests/dsp/8b8.test.js binds params.json to the
# vendored parameters.h and the profile to both, so a half-finished re-vendor
# fails rather than shipping.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
src="${1:-$HOME/github/8bit8asterd}"

[ -f "$src/8b8_firmware.ino" ] || {
  echo "no 8b8_firmware.ino under $src" >&2
  echo "usage: $0 [path to the 8bit8asterd checkout]" >&2
  exit 1
}

for f in 8b8_firmware.ino parameters.h temperaments.h; do
  cp "$src/$f" "$here/firmware/$f"
done
cp "$src/emulator/ay8910.h" "$here/firmware/ay8910.h"

# The parameter definition, straight out of the single source of truth rather
# than out of the generated header: the header carries ranges but not the
# labels, groups, units or enumeration options that a JigDAW port needs.
python3 "$here/read-params.py" "$src" > "$here/params.json"

commit="$(git -C "$src" rev-parse HEAD)"
dirty="$(git -C "$src" status --porcelain | head -c 1)"
date="$(git -C "$src" log -1 --format=%cI)"

cat > "$here/firmware/PROVENANCE.md" <<EOF
# Where this came from

A snapshot of https://github.com/danja/8bit8asterd, taken with
[../sync.sh](../sync.sh).

| | |
|---|---|
| commit | \`$commit\` |
| committed | $date |
| working tree | ${dirty:+dirty at the time of copy}${dirty:-clean at the time of copy} |

\`8b8_firmware.ino\`, \`parameters.h\` and \`temperaments.h\` are the firmware
that runs on the Arduino Leonardo. \`ay8910.h\` is that repository's model of
the AY-3-8910, from its own emulator.

None of these four files is edited here. The firmware already carries an
\`AY_EMULATOR\` seam in \`writeReg()\` that hands register writes to an emulated
chip, which is the only accommodation it needs, and it was added there rather
than here so that the hardware and the emulation cannot drift apart.

\`../shim/\` supplies the Arduino and AVR surface the firmware compiles against.
EOF

echo "vendored firmware at $commit"
echo "wrote params.json with $(python3 -c 'import json,sys; print(len(json.load(open(sys.argv[1]))["params"]))' "$here/params.json") parameters"
echo "now run ./build.sh"
