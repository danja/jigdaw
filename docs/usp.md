# What sets Jiggy apart

Jiggy is the browser host for JigDAW. This document lists what it does that
[openDAW](https://github.com/andremichelle/openDAW), [webdaw](https://github.com/ai-music/webdaw)
and [GridSound](https://github.com/gridsound/daw) do not, and where it is behind them. It is a
claim about a moving target, so each entry says what it rests on and whether it is built.

How the others were read: their repositories were indexed and their documents and directory
layouts read on 2026-09-30. GridSound's source lives in submodules that were empty in the local
checkout, so what is said of it comes from its README only. None of the three was run.

## The differences

### A plugin is an address, not a build

**Built.** A Jig is loaded from one IRI. Fetching it returns a description, its code, and a
digest for each. Publishing a plugin is putting files where a browser can fetch them: no
installer, no registry, no rebuild of the host. The tree holds **27 plugins** written this way,
in Rust, JavaScript, JSFX and hand-written WebAssembly.

The others compile their instruments and effects into the application. openDAW's stock devices
are crates in its repository, and its own plan for loading devices at runtime
(`plans/loading-devices-at-runtime.md`) is a plan. webdaw lists Web Audio Modules as a
milestone, not yet ticked. Neither loads a stranger's plugin from a URL today, as far as the
documents say.

Rests on: [host-plugin-contract.md](host-plugin-contract.md), `src/host/PluginLoader.js`.

### A simple page beside the studio

**Built, first version.** `simple.html` is a second front end over the same engine and panels: six
tunes as big buttons, Play, a Speed slider, and a card per track with On and Off and its plugins'
generated controls, usable while it plays. Not yet tried on a phone.

### Installs, and works with the server gone

**Built.** Jiggy is an installable web app with one service worker. With the server stopped, the
page, the presets and every plugin already opened load from the cache and play, and each plugin
is still checked against its digest: an altered cached file fails to load. Checked on a desktop
browser only; a phone is not yet tried.

Rests on: [pwa.md](pwa.md), `web/sw.js`, `tests/web/Pwa.test.js`.

### Verified before it runs

**Built.** Every resource is checked against its SHA-384 digest before it is instantiated, with
no continue-anyway path. A plugin's own interface loads into a sandboxed cross-origin frame,
never into the host page. A bundle can carry a signature, and an unsigned one is reported as a
claim by whoever handed it over.

Rests on: [host-plugin-contract.md](host-plugin-contract.md), [plugin-bundles.md](plugin-bundles.md),
`src/host/Integrity.js`, `src/host/Signature.js`. Not yet closed: a plugin editor's digest is
not checked (TODO.md, loose end 4).

### A session is a graph of IRIs

**Built.** A saved session is RDF. It names its plugins by IRI, so it reopens on a machine that
has never seen them and fetches what it needs. The output is deterministic, so a diff shows what
changed. Layout (node positions, track order, colour, lane size) is a second document in the
same zip, so moving something never changes the project's revision.

openDAW and webdaw keep projects in their own formats, which name devices the host already has.

Rests on: [project-format.md](project-format.md), `src/rdf/ProjectWriter.js`.

### Routing is the model

**Built in the model, partly in sound.** A track holds plugins joined by named connections, audio
and MIDI both, with latency declared by each plugin and compensated across parallel paths. Each
track's chain is drawn under its lane with what each plugin takes, gives and sends, including
sends to plugins on other tracks, and a plugin can be connected to any compatible port on any
track from the dock. A Routing tab lays every output against every input as one keyboard-navigable table. Loops of MIDI connections are refused.
Sends (before or after the fader), bus outputs and a master strip are in the format, act on the
audio, are refused when they would loop, and are undoable. Markers, regions, signature changes
and envelopes are in the format too; the scheduler does not yet act on envelopes or signature
changes.

The others give a track a fixed chain and treat routing as a send level. openDAW has a richer
device model than that (effect stacks and layers are in its plans) and it is ahead on
automation and on a mixer with sends today.

Rests on: [latency.md](latency.md), [track-view-terms.md](track-view-terms.md). The view of
this on the track is Phase T3 in TODO.md.

### The agent uses the same Ops as the person

**Built.** **52 tools** are offered to an agent through WebMCP, over the one dispatcher the page
uses. A changeset carries the revision it expects and can be run as a dry run first, so an
agent checks a chain before committing it and a stale edit is refused with the current
revision.

Rests on: [webmcp.md](webmcp.md), `src/mcp/tools.js`.

### The same plugin runs outside the browser

**Built.** The portable module format lets a Jig load in a native VST3, CLAP or LV2 host through
the adapter in `native/jigdaw-adapter`, and in the transmission host. A REAPER JSFX effect is
imported to a Jig by a compiler in `src/jsfx`. A Web Audio Module can be wrapped, and a foreign
one hosted under stricter rules than the WAM API asks for. Not yet checked against a real
REAPER session for the render script (testbed.md).

### Generative plugins ship in the box

**Built.** MelGen, BassGen, DrumGen, Cadence, Counterpointer and Ground write music from a seed,
in time with the transport, as plugins like any other, and can be chained and steered from
another plugin's output. **7 presets** are bundled, one of them a chiptune piece across six
tracks. The others are sample and clip based, as one would expect of a DAW; none of them was
seen to ship generators as plugins.

### Accessibility and phones are rules, with tests

**Built as a rule, checked in a browser as views are added.** Every control has a name, a role
and a value said as text; the keyboard reaches everything the pointer does; state is never
colour alone; a control nobody can use is left out, not disabled; touch targets are 44px and
text inputs 16px. The panel for a plugin is generated from its declared ports, so one
accessible generator covers every plugin.

The others were not audited for this, so no comparison is made. Known gaps in Jiggy are in
TODO.md, for example controls not yet measured at phone width.

## Where Jiggy is behind

The three examples have these and Jiggy does not yet. They are the reason for the track view
plan in TODO.md, and none is a difference in Jiggy's favour.

- Folders and groups of tracks (Phase T2), and takes and comping (Phase A).
- A metronome and count-in, and signature changes drawn on the ruler.
- A clip launcher, a sample browser, DAWproject import and export, live collaboration.
- Export to MP3 and the other compressed formats: the page renders and exports WAV only.

## Keeping this true

The counts above are checked by `tests/docs/usp.test.js`, which counts the plugins, the presets
and the agent tools and fails when the figures here are stale. A sentence that a test does not
cover is a claim; change it when the system changes.
