# Sam

Software Automatic Mouth: the 1982 Commodore 64 formant speech synthesiser, as an instrument. Type some text,
then either **play it from MIDI** (each note speaks the next word, sung at the pitch of the key) or **let the host
transport read it aloud** (one word per step from a start bar, locked to the bars and beats).

Ported from the Downspout VST3 of the same name. The speech is SAM's own C, vendored in `third_party/` with the
local fixes listed in `third_party/PATCHES.md`; it **has no licence** (abandonware, see
`third_party/SAM-LICENSE.md` and HUMANS.md). The engine around it is rewritten for a module with no libc and no
heap: `sam.cpp`, built by `build.sh` with `clang --target=wasm32 -nostdlib`, the same way as `plugins/mop/`.

No audio input. Stereo output (the voice is mono, sent to both channels). One MIDI input. Declares `jig:Abi2` and
`trn:HostTransport`.

## Modes

| Mode | What plays | Pitch | Needs |
|---|---|---|---|
| Keys | A note speaks one word; **Advance** picks which: *Next word* cycles through the text (and starts over when the transport starts), *Key = word* speaks word `(note - 48)` modulo the word count | The key, tuned | MIDI |
| Transport | Word *n* starts at step *n* counted from **Start Bar**; **Loop** repeats the text. A word entered mid-step (after a locate or a loop wrap) is spoken from the matching point | **Pitch**, or the fixed **Monotone** pitch | Host transport. Silent while stopped; **Speak** plays one pass without it |

Words are the whitespace-separated pieces of the text. A lone `_` is a rest and still takes its slot. **Phonetic**
reads SAM phoneme codes (`/HEH3LOW2 WER4LD`: digits 1 to 8 are stress, `/H` a breath) instead of English.

## The text

The words are the `text` asset, `text.txt`, marked `jig:userReplaceable`: choose a plain text file of your own from
the panel and it replaces them, up to 2000 printable ASCII characters and 512 words. It is saved with the session as
the plugin's `jig:nodeState`. Anything that is not printable ASCII is dropped; newlines and tabs count as spaces.

## Differences from the VST3

- The text is a file you load, not an editor box, so there is no highlight of the word being spoken. The module
  still tracks it (`jig_out_word`, for the tests).
- The six voice presets (SAM, Elf, Robot, Stuffy, Old Lady, Alien) are not in the panel. Set Speed, Pitch, Throat
  and Mouth by hand: Elf is 72/64/110/160, Robot 92/60/190/190, Stuffy 82/72/110/105, Old Lady 82/32/145/145,
  Alien 100/64/150/200 (speed/pitch/throat/mouth).
- Transport position is the host's `beat` and time signature numerator, in the host's beats.

## Tuning

SAM sets pitch as a whole number of ticks of 3.24 samples at 22.05 kHz, so the nearest pitch can be well off a key.
Each note is rendered at the nearest pitch and resampled the rest of the way; the voice's formants move by the same
ratio (under 4% up to C5, about 13% near B6). `tests/dsp/sam.test.js` measures the result within 25 cents of the
key at C3, C4 and C5.

## Testing

`tests/dsp/sam.test.js` binds the profile, the processor and the module to each other and drives the compiled module
directly, offline. `tests/host/sam.test.js` loads it through the real `PluginLoader` and `Engine`.
