# What needs a person

Actions only you can take. Everything else is in [AGENTS.md](AGENTS.md) and
[TODO.md](TODO.md).

Ordered by what blocks most.

## 1. Listen, and use it with real hands

Everything below was checked by code or by reading a meter, never by ear or by a real finger. `npm run serve`, open
`http://127.0.0.1:8748/`, keep the browser window in front (a hidden tab gets no user activation and audio hangs), and note what
is wrong in INBOX.md.

- **Listen to the presets.** All seven, and say which sound bad. "Through Keyframe" (new 2026-10-01) is the one to start with:
  its melody carries a fifth above it from Keyframe's pitch shift, and its drums are pitched down and slurred, so say whether either
  sounds musical or only broken. In particular "Generative, through effects" (its lead line was
  silent until 2026-09-30 and has not been heard), "Fender into the Ropery" (levels set by a meter; its Guitar became Monochord on 2026-10-24, so whether it sounds like a guitar through the amp is unheard), "Sam in a room" (new 2026-10-24: whether the sung words are intelligible, and the level), and
  Chiptune's Lead track, which measures much quieter than the rest.
- **Listen to what the editing and rendering do:** a muted clip (silent?), a fade in and out on an audio clip, a split at a playing
  position, a bypassed plugin against the same chain with it on, an envelope on a filter cutoff, a tempo ramp, a frozen track
  against the live one, and an exported WAV and a stems zip opened in another program.
- **Listen to a composite** (new 2026-10-02): `plugins/stomp-rack/`, a rack of boost, tremolo and cascade, loaded after Pulse in
  Jiggy. It is not on the live site until the next deploy, and the page's search loads an entry from its canonical address, so after deploying, search
  for "rack" and press Load to confirm that path, which has been checked only up to the Load button. It was driven in Chrome and measured at the master, never heard. Say whether Drive, Tremolo depth and Reverb mix do what their names
  say and whether the three together sound like a pedal board. Loading one needs its members served and its pins current: see
  `docs/nested-plugins.md` section 9.2.
- **Listen to Keyframe** (`plugins/keyframe/`, new 2026-10-01): a time rate of 50 on a drum loop, a pitch shift of 7 on a
  chord, and each Quality and Stereo setting against the others. Say whether Economy is usable or only Balanced is, and whether
  Linked stereo moves the image on a wide clip. Nothing here has been heard, only measured.
- **Open `reel.html` and use it** (new 2026-10-03): it has only been checked by tests and a build, because the Chrome extension was not
  connected when it was written. Open it at phone width, choose "Open the filter" under Examples and press "Play it", and say
  whether the piece opens, the music starts, the script runs and the filter is heard to open. Then check the Insert buttons on
  This piece, the Save and Open script file buttons, and that nothing scrolls sideways. The one example not written is a
  `connect`, because wiring a loaded plugin into a piece has not been heard.
- **Use the Script tab with a screen reader and a real phone** (new 2026-10-01): run a script with an error and listen to whether
  "Problems" and the status are announced and the "Go to line" buttons make sense, run one that plays, and use Control+Enter. The
  studio page sends a phone to the simple page, so add `?studio` to the address to reach the tab on one.
- **Open an exported MIDI file in a DAW or notation tool, and import one made elsewhere** (new 2026-10-23): press Export MIDI in the studio page's top bar with a few notes, tempo
  changes and a 6/8 section in the project, and open the .mid in Reaper, MuseScore or another program. Check the notes, tempo
  changes and bar lines land where they do here. I checked the bytes with two separate readers of my own but have no other MIDI
  program here. Then use Import MIDI on a file from a real DAW or a downloaded one and check the tracks, tempo and signature that arrive, and that Undo takes it all back. A tool that would help me: `pip install mido`, so a file can be checked against a library I did not write.
- **Record from a real MIDI keyboard** (new 2026-10-23): press MIDI in and allow it, select or arm a track with a synth, press Rec MIDI, play with the pitch bend wheel and modulation, and press Stop. Check the notes land on the beats you played, the wheel and modulation come out as events in the lanes under the roll, and one Undo removes the take. I only tried the on-screen keys.
- **Listen to a pitch bend and a controller lane** (new 2026-10-23): in the note roll choose Pitch bend or Modulation under the notes, draw a few events on a clip that
  plays an instrument that answers them (the Pulse synth, or any plugin that reads the wheel or modulation), and press play. I checked that the right MIDI messages are sent at the right
  frames and that the file export carries them, but cannot hear a plugin. Also try stopping with the wheel up: it should return to rest.
- **Use the piano roll with a screen reader** (new 2026-10-22): open a MIDI clip and move through the grid. Listen to whether
  "row 68 of 128" and the column numbers make sense as the window scrolls with Page Up and Page Down, whether the long help
  text read on entering the grid is too much, whether the dot and "outside the scale" on rows are clear with a scale chosen, and
  what is said after Quantize, Fit to the scale and choosing notes. I audited the markup against the ARIA grid pattern and cannot
  run a screen reader.
- **Use the new routing controls with a screen reader** (new 2026-10-10): the Master bus section and its audio input menu on the
  Tracks tab, the Add send form with its Audio and MIDI choice, the Lowest note and Highest note fields on a MIDI send and on a
  MIDI connection, the Clip button beside the meter (it hides when pressed, so listen to where the focus goes), and the level
  meters on the Mixer tab, which are meant to say nothing and leave the held peak as text to be read where it is. Say whether the
  names make sense and whether anything is announced that should not be.
- **Use the keys and buttons with real hands:** the clip keys (S, D, M, L, [, ], Ctrl+C, X, V), the chain strip's Alt with Left or
  Right, the automation points (arrows, C, Delete), and the icon buttons, with real key presses and not dispatched events.
- **Record your voice on the simple page** with a real microphone: the browser's permission prompt, the device it picks and how
  the take sounds are untried; the check used a stand-in stream.
- **Use it on a real phone:** install the app, check it starts on the simple page, plays offline once loaded, does not scroll
  sideways, opens "Change the sound" as its own screen, carries a piece to the studio and back, and that the clip button bar is
  usable at that width.
- **Older checks still owed:** press Rec with the window in front, play, Stop, remove every plugin and play the takes; move
  Lookahead's Position while a parallel dry path plays beside it and listen for the realignment; and a real pointer through a
  plugin's own editor frame (load `http://localhost:8748/plugins/tremolo/` from the page on `127.0.0.1`, because an editor on the
  page's own origin is refused).
- **Run the first-hour test** (2026-10-26, [docs/learning-curve.md](docs/learning-curve.md)): give someone who has used another DAW,
  and someone who has not, the eleven steps there with no instructions, and write down where each stopped in their words. The
  Show steps, start screen, Add a track chooser, grouped transport, clip repeat, light and dark themes and "More controls" were all
  checked by code and in Chrome, none by a person who did not build them. Also listen to the Hear button on each of the eight
  instruments, and to a DrumKit loaded through it.
- **Listen to the new sounds and loops** (2026-10-26, nothing here has been heard, only measured): the four "Make notes for me" pairs in the Add a track chooser (BassGen with Pulse, MelGen with Canticle, Markov with Moka, Sprout with Monochord) and whether each pairing is a good one, DrumKit with DrumGen and the Feel pad, and the 19 loops and the Deep house set in the Loops dialog (`web/loops/index.json`), which were written as patterns and never played by a person. Add all of the deep house set and say whether it sounds like the recipe: the bass is Quartet (a mono FM bass, its default voicing) and the stabs and pad are Canticle, not the e-piano described, and there is no delay. Say which are weak or wrong, and whether Hear and Add feel right.
- **Listen to Quartet and Octet and use Octet's editor** (2026-10-26, measured and checked in Chrome, never heard): Quartet's default bass and whether its algorithm and filter controls make sense; Octet on a real signal, its Drift controllers from a real controller, and its editor with a real mouse, the wheel for Q and the keys. The editor shows only for a plugin on another origin than its page, so load `http://localhost:8748/plugins/octet/` from the page on `127.0.0.1`.
- **Deploy the help text:** the page loads plugins from their canonical address, so the help on Pulse's and DrumKit's controls (new 2026-10-26)
  shows on the live site only after a deploy; it was checked by loading the local copies. The same goes for the ranked controls and help on BassGen, DrumGen, MelGen, Moka, Monochord, Canticle and Mop, the pads' end labels, and `web/loops/index.json`. DrumKit's "More controls (61)" was deployed and is live.

## 2. Confirm the Mop glitch diagnosis in Reaper

Headless measurement says Mop costs 1.70x realtime through the adapter's
WAMR interpreter (8 s of line plus drums took 13.6 s wall; 8b8 takes 0.20x
through the same path), so every realtime block overruns and the symptom
should be continuous dropouts. Two things only you can check: freeze (or
bounce) the Mop track and play it back. If it plays clean frozen, the fault
is throughput rather than corruption. Then report the buffer size, sample
rate and machine the glitches were heard on, plus whether raising Voices
changes anything (headlessly the voice cap changes nothing: the emulator
steps the whole chip regardless). The fixes (WAMR AOT/JIT with its LLVM
build dependency, or mop-side surgery) are a maintainer decision; see the
Mop item in TODO.md.

## 2b. Decide whether Sam's speech code may be redistributed

`plugins/sam/third_party/` is SAM (Software Automatic Mouth), a reverse-engineered conversion of a 1982
commercial program whose copyright holder is SoftVoice, Inc. and which has **no licence**: the upstream
README calls it abandonware and says it cannot be put under one
([plugins/sam/third_party/SAM-LICENSE.md](plugins/sam/third_party/SAM-LICENSE.md)). Downspout already vendors the
same files and left this decision open there. Here the files are served by the documentation site and the
deployed host, so shipping them is publishing them. Decide whether `plugins/sam/` stays in the public tree and
the deployment. If not, delete the directory, `web/presets/sam.ttl` and its line in `web/presets/index.json`,
then `npm run build:index`, and `npm run build:precache`. The plugin's profile carries no `pu:licenceId` for this
reason.

## 3. Tools that would help

**lld, for the WebAssembly build of `plugins/8b8/` and `plugins/boost/`.** Ubuntu's `clang`
package ships no `wasm-ld`, so both plugins' `build.sh` link through the `rust-lld` that
rustup already installed for the Rust plugins, found by searching `~/.rustup` and symlinked
under the name the clang driver looks for. It is the same linker and it produces a working
module, but the fallback depends on a rust toolchain being present for a build that otherwise
has nothing to do with rust, and on rustup's internal layout.

```sh
sudo apt install lld-18
```

Both `build.sh` scripts use `wasm-ld` directly when it is on the path and say nothing more
about it.

**REAPER, to verify [`reaper/jigdaw-render.lua`](reaper/jigdaw-render.lua) actually runs.**
None was available to check it against, so it was written against REAPER's documented
ReaScript API (`ExecProcess`, `GetUserInputs`, `InsertMedia`) rather than a real load of the
action. Install it (`reaper/README.md`), run it once against a disposable project, and see
whether `ExecProcess`'s exit-code parsing and `InsertMedia`'s track-insert mode behave as
documented; those are the two most likely to have moved between REAPER versions.

**A SPARQL parser, such as `sparqljs`, as a dev dependency.** The catalogue queries in `sparql/queries/` are tested only by
checking the text that is sent, because nothing installed here can parse or run SPARQL. On 2026-10-02 `search.sparql` was changed to
treat a composite plugin as runnable (`BIND(EXISTS {...} || EXISTS {...} AS ?web)`), which is valid SPARQL 1.1 by reading and has not
been parsed. With a parser, a test could load every `.sparql` file after filling its placeholders and fail on a syntax error, and
with an in-memory store it could run `search.sparql` over the example profiles and check the `?web` column. Until then a query edit
is checked by eye.

```sh
npm install --save-dev sparqljs
```

## Updating a deployment

**[docs/deployment.md](docs/deployment.md) opens with this**, including which changes need the
restart and what to curl afterwards. The short form:

```sh
npm run build && npm test          # on your machine, then commit and push
cd /home/github/jigdaw && git pull
sudo systemctl restart jigdaw      # only when bin/serve.js changed
```

A pull moves the page, the bundle, the profiles and the WebAssembly immediately, because they
are read from disk per request. `bin/serve.js` is loaded once at startup, so a change inside
it is invisible until the restart, and the symptom is a new page talking to an old server.

---

Measured 2026-09-23. Re-check before acting; all of it drifts.
