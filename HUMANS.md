# What needs a person

Actions only you can take. Everything else is in [AGENTS.md](AGENTS.md) and
[TODO.md](TODO.md).

Ordered by what blocks most.

## 1. Try the new interface and say what is still wrong

Tracks, a mixer of one fader per track, an arrangement with a piano roll and audio clips, and
plugin editors were built on 2026-09-24 against the "not usable and intuitive" item in
TODO.md. Whether it is usable now is a judgement only a person using it can make. `npm run
serve`, open `http://127.0.0.1:8748/`, open the "Square lead" preset, add a clip on the
Arrangement tab, and play it. Do it with the window in front and with real keys: the
automated check could only dispatch key events, because its browser window was in the
background (TODO.md, loose end 5). To see a plugin's own editor, load
`http://localhost:8748/plugins/tremolo/` from the page on `127.0.0.1`, because an editor on
the page's own origin is refused. While there, collapse the browser with the arrow in the
sidebar header and check the rail at phone width: the automated check covers classes and
names only, and AGENTS.md requires `documentElement.scrollWidth` compared against
`innerWidth` in a narrow iframe in a real browser before the layout half is claimed
(TODO.md, sidebar arrow item). While there, press Rec with the window in front,
play, Stop, remove every plugin, and play the takes: the automated check proves takes
are kept and placed, but no headless check has heard one. Move Lookahead's Position
while a parallel dry path plays beside it: the automated check proves the dry path is
delayed from the reported frame, but no headless check has heard the realignment. Note what is wrong in INBOX.md.

## 2. Confirm the Mop glitch diagnosis in Reaper

Headless measurement says Mop costs 1.70x realtime through the adapter's
WAMR interpreter (8 s of line plus drums took 13.6 s wall; 8b8 takes 0.20x
through the same path), so every realtime block overruns and the symptom
should be continuous dropouts. Two things only you can check: freeze (or
bounce) the Mop track and play it back — if it plays clean frozen, the fault
is throughput rather than corruption — and report the buffer size, sample
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

**wabt (`wasm2wat`), for the exact `memory.grow` static check.** TODO.md's WebAssembly ABI
item is open on its harder half: whether a module ever executes `memory.grow`. A hand-rolled
instruction decoder here would be wrong in exactly the way AGENTS.md calls worse than no
check, and `@webassemblyjs/wasm-parser` fails on this project's own plugins. Disassembling
with the reference toolchain and grepping the mnemonic is exact instead: `memory.grow` is a
dedicated opcode that always prints as such. With it, `npm run check-wasm-abi` grows the
check in `src/validate/WasmAbi.js` plus a test that reverts to red on a growing module.
Until then, only the coarse wall-clock render budget covers it.

```sh
sudo apt install wabt
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
