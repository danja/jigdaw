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
  silent until 2026-09-30 and has not been heard), "Amp into a room" and "Fender into the Ropery" (levels set by a meter), and
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
- **Use the Script tab with a screen reader and a real phone** (new 2026-10-01): run a script with an error and listen to whether
  "Problems" and the status are announced and the "Go to line" buttons make sense, run one that plays, and use Control+Enter. The
  studio page sends a phone to the simple page, so add `?studio` to the address to reach the tab on one.
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
