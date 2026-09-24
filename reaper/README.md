# A JigDAW plugin in REAPER, without the adapter

`native/jigdaw-adapter/` loads a JigDAW plugin into REAPER as a compiled VST3, CLAP or LV2.
This is the alternative that needs no build: a REAPER ReaScript that drives the project's own
Node reference host and drops the result into the timeline as audio.

## What it does

`jigdaw-render.lua` asks for one or more plugin IRIs and a duration and note list, runs
[`bin/host.js`](../bin/host.js) (a chain of plugins, rendered from silence and MIDI notes to a
WAV file, no browser: see [docs/for-hosts.md](../docs/for-hosts.md)), and inserts the rendered
file as a new track in the current project.

This is an offline bounce, the same shape as freezing a track. It is not a live, playable
instrument and not a way to run a JigDAW effect over REAPER's own audio: `bin/host.js` renders
from silence and MIDI only, because
[`src/host/ReferenceHost.js`](../src/host/ReferenceHost.js) is a chain, not a graph, and takes
no audio input. So this reaches an instrument, or an instrument feeding effects placed after
it in the same IRI list, but never a bare effect on its own.

A live, playable JigDAW plugin on REAPER's actual audio thread needs something compiled into
that slot: a JSFX (REAPER's own scripting plugin format, EEL2) or a persistent external
process REAPER pipes audio to and from in real time. Both are a different, larger piece of
work than this, not attempted here. See `TODO.md` for what each would take.

## Install

Actions > Show action list > New action... > Load ReaScript..., and pick `jigdaw-render.lua`
from inside this checkout. Nothing is copied into REAPER's own Scripts folder, so this keeps
working exactly as long as the checkout stays where it was when the action was added.

Needs Node 20 or later reachable from a shell. REAPER's `ExecProcess` does not set up a login
shell's `PATH` the way a terminal does, so the script runs the command through `/bin/sh -c`,
which resolves `node` from its own inherited `PATH`. If REAPER still cannot find it, open
`jigdaw-render.lua` and set `NODE` near the top to a full path such as `/usr/bin/node`.

Linux and macOS only as written. Windows REAPER needs a `cmd.exe /c` wrapper in place of
`/bin/sh -c`; not written here.

## Use

Run the action with a project open and saved (the render needs somewhere on disk to put the
audio; it is written beside the project). It asks for:

- **Plugin IRI(s), comma separated.** One for a single instrument, or several for a chain,
  same as `bin/host.js`'s own arguments, e.g.
  `https://strandz.it/jigdaw/plugins/pulse/, https://strandz.it/jigdaw/plugins/cascade/`.
- **Seconds.** How long to render.
- **Notes**, as `NOTE@ONTIME[:OFFTIME]`, comma separated, e.g. `69@0:1.5, 72@0.5:1.5` for two
  overlapping notes. A note given no off time rings for the rest of the render.

A failure names the step, the same as running `bin/host.js` by hand would: a bad IRI, a
profile that fails validation, or a plugin this Node host cannot run all show up in the
message box rather than silently producing nothing.

## Status

**Untested against a real REAPER install as of writing:** none was available in the
environment this was written in. Written against REAPER's own ReaScript API documentation
(reaper.fm/sdk/reascript) for `ExecProcess`, `GetUserInputs` and `InsertMedia`. Run it once
against something disposable, with a project you do not mind if it goes wrong, before
trusting it with real project audio. If the API behaves differently than documented here,
that is the first thing to check; `ExecProcess`'s exact timeout semantics and `InsertMedia`'s
mode flags are the two most likely to have moved between REAPER versions.
