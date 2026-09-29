# Mop

An OPL3 FM General MIDI instrument: the AdLib / Sound Blaster sound of
DOS-era games. Eighteen 2-op voices from an Opal YMF262 emulator, capped by
the Voices control, playing the FM timbres in the embedded bank.

This is [mop](https://github.com/graybox/mop) with its MIDI file player
removed. The Opal core in `opal/` is included unmodified, the bank parsing,
register programming, voice allocation and channel handling are mop's, and
`mop.bnk` in this directory is mop's own bank, embedded into the wasm so the
module is self-contained. Live MIDI arrives through the jig:Abi2 event
buffer instead of a file.

## Controls

| Control | MIDI |
|---|---|
| Instrument: Program (128 General MIDI presets) | program change, per channel |
| Instrument: Voices (1-18, default 8) | CC 70, any channel |
| Output: Gain | CC 71, any channel |
| Pitch: Bend Range (semitones) | CC 72, any channel |
| Pitch: Tuning (cents) | CC 73, any channel |
| Response: Velocity | CC 74, any channel |

Per-channel performance messages behave as mop does: volume (CC 7),
expression (CC 11), pan (CC 10), sustain (CC 64), pitch bend, program change,
and all-notes-off (CC 120/123, plus 121 to reset the controllers). Drums are
MIDI channel 10, notes 35 to 81.

## Build

```sh
./build.sh
```

clang targeting wasm32 with -nostdlib; `shim/` supplies the libc pieces that
leaves missing. The profile is generated from `profile.json` with the digests
of the files produced. Tests are `tests/dsp/mop.test.js`.
