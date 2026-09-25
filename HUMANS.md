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
the page's own origin is refused. Note what is wrong in INBOX.md.

## 2. Tools that would help

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
