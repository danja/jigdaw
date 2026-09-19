# Where this came from

A snapshot of https://github.com/danja/8bit8asterd, taken with
[../sync.sh](../sync.sh).

| | |
|---|---|
| commit | `ded9e5ace6e9e71967d852ee8a88fa5cd238b422` |
| committed | 2026-09-18T21:52:28-04:00 |
| working tree | clean at the time of copy |

`8b8_firmware.ino`, `parameters.h` and `temperaments.h` are the firmware
that runs on the Arduino Leonardo. `ay8910.h` is that repository's model of
the AY-3-8910, from its own emulator.

None of these four files is edited here. The firmware already carries an
`AY_EMULATOR` seam in `writeReg()` that hands register writes to an emulated
chip, which is the only accommodation it needs, and it was added there rather
than here so that the hardware and the emulation cannot drift apart.

`../shim/` supplies the Arduino and AVR surface the firmware compiles against.
