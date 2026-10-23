# What Jiggy can take from Oxide Studio

**Status:** written 2026-10-23. This is a reading of the source and documents of
[Oxide Studio](https://github.com/juancruzmunozalbelo/oxide-studio), a native Rust DAW. I read its GUI panels, shortcut table,
layout budget, browser, transport, clip view, mixer, MCP tool list and web workstation, and I did not build or run it. Its
README figures (tests passing, tools, frames checked) are its own claims and I have not checked them. It describes itself as a
clean-room rebuild of Ableton Live's workflow, so what follows takes general DAW ideas only. No code, colours, names or
Ableton-specific tokens are proposed for copying, and its instruments and DSP are out of scope.

Each item below says what Oxide Studio does, what it would cost here, and whether it fits the rules that decide what Jiggy may
add: the term comes first (a sound or musical idea is a `trn:` or `jig:` term before it is code), one change is one Op, and the
interface follows WCAG 2.2 AA.

## Worth building

| Idea | What Oxide Studio does | Cost here | Fit |
| --- | --- | --- | --- |
| **Swap a plugin in place** | A "hot swap" in the device chain replaces a device and keeps its place in the chain. | Medium. One new Op that removes a plugin and loads another at its position, rejoining connections whose port names exist on both, and copying values for parameters whose port IRIs match. One undo step. | Fits. The Op is the whole feature, and the matching is by IRI, which is data. A swap that cannot rejoin a connection has to say which one and why. |
| **A keys overlay** | `?` or F1 opens a table of every shortcut. | Low. One table of key, action and scope that the key handlers and the overlay both read, with a test binding them. | Fits, and it is also a WCAG 2.1.4 aid. It is a dialog with a visible focus and Escape to close. |
| **Layout checked in a real browser over every tab and width** | A layout guard computes a fixed budget per zone and audits each rendered frame at many resolutions for overflow and missing glyphs. | Medium. Jiggy cannot test layout in linkedom, so the same idea is a script in the `check:skins` style: open each tab at several widths in Chrome and assert `scrollWidth` equals `innerWidth`. | Fits the interface rules and the standing measure-do-not-reason rule. It would have found the unmeasured five-tab row and the 28px header square. |
| **Bounds on the dock height** | The bottom deck is clamped to a share of the window so the centre keeps at least 55 percent. | Low. `src/ui/Dock.js` clamps between fixed `DOCK_MIN` and `DOCK_MAX` pixel values, so on a short window the dock can leave the lanes too little room. Clamp the maximum by a share of the window height. | Fits the size-by-proportion rule. |
| **Mixer sections that can be hidden** | The session mixer toggles I/O, sends, returns and crossfader rows. | None: checked on 2026-10-24 and it does not apply. A Jiggy strip holds only a name, level, pan, Mute, Solo and a meter, and sends live in the dock, so there is nothing to hide. | Dropped. Revisit if strips grow rows. |
| **Audio to MIDI** | `oxide-bounce` turns a recorded take into notes. | Medium to large. A pure function from take bytes to notes (monophonic pitch tracking) run offline, then one `addClip` Op. | Fits as an Op. It is an offline render in the same family as bounce, so it stays off the real-time path. Quality is the risk, and it needs a listening check by a person. |
| **Chance on a note** | A probability lane in the clip view. | Medium. A `jig:chance` on a note, read by the scheduler. The draw must be seeded from the clip and the note, or an offline render and the live play would differ. | Fits only with the seeded draw. Without it the offline render stops being reproducible, which the project's tests depend on. |
| **More note transforms** | Strum, Euclidean, legato, ornament and recombine alongside quantize. | Low each. `src/model/ClipEdit.js` and the transform tool already take a named transform. | Fits. Each is a pure function of the notes, so each is testable and one undo step. |
| **Find similar** | Cosine similarity over a feature vector ranks sounds like a chosen one. | Low to medium. Jiggy has roles and signals as facets, so a similarity by shared facets (Jaccard) needs no vector. | Fits if it is a query over the catalogue graph, in `sparql/queries/`. |
| **A load readout** | CPU gauge in the top bar. | Unknown. `process()` has no clock, so a gauge needs underrun counts or a measured render time, not a timer in the processor. | Open. Worth a design note before code, since the Mop dropouts show why people want one. |

## Already planned, with what Oxide Studio adds

- **Clip launcher.** Its slots carry explicit states (empty, stopped, queued to play, playing, queued to stop), a launch
  quantisation choice (4 bars down to none), a stop row, a stop-all button and scene launch. The state set is the useful part:
  write it as the launcher's model before drawing anything, and keep the quantisation as a project setting like the loop.
- **Browser categories.** Ten categories include Templates. Jiggy now has templates in their own panel; if the browser grows
  categories, Templates is one of them rather than a second place.
- **MIDI learn and key map.** It has a map mode for each. The open question for Jiggy is the one already in the TODO: whether a
  binding is session data (`jig:` term in the revision, undoable) or editor metadata. A binding changes what a controller does
  to the sound, so it is session data.
- **Groove pool and swing.** A swing slider sits in its transport bar, and a pool applies a groove to a clip. A per-clip swing
  transform is the cheap part; extraction of a groove from audio is not planned.
- **Take lanes and comping.** Already under Clip operations in the TODO.
- **Scale and key in the roll.** Jiggy has this in `src/ui/RollScale.js` as a view setting. Oxide Studio also has a global
  scale lock. Moving the key and scale to the session is the only open question, and it needs a `trn:` term first.

## Looked at and left out

- **Tab as a view switch.** It binds Tab to Session and Arrangement. Jiggy must keep Tab for moving focus; a view switch needs
  another key, and the keys overlay should say which.
- **Single-key shortcuts such as 0, S, Z, X, C and V.** WCAG 2.1.4 wants a way to turn these off or remap them, or to make them
  active only while their control has focus. Jiggy's clip keys are handled on the focused clip button (`src/ui/ClipButton.js`), which is the safe form. Do not adopt a
  global single-key shortcut.
- **A chat copilot panel.** Jiggy's agent surface is WebMCP, and a chat panel in the page would be a second adapter with its
  own behaviour. An agent works through the tools; a person works through the controls.
- **Stem separation by a neural model, an out-of-process plugin scanner, native Metal rendering.** They solve problems of a
  native host. A Jig is already sandboxed in a frame, and a model of that size does not belong in a page.
- **`.als` import and export.** It is a proprietary format reverse engineered by its authors. DAWproject is the open
  interchange target already in the TODO.
- **Its colour tokens, track-header palette and exact layout.** They follow a commercial product's look. Jiggy's track colours
  and lettered Mute and Solo squares stay as they are.
- **Ghost slider (a second marker for the modulated value).** The idea is good: a control shows both the value set and the
  value in effect. It needs the processor-to-panel feed that Quefrency's controller read-out also waits for, so it belongs with
  that item, not on its own. It must not rely on colour alone.

## What to do next

The items under Worth building are copied into [TODO.md](../TODO.md) with this document as their source. The order suggested
here is the keys overlay, the layout script, the dock bound, swap in place, then the transforms, since the first four are small
and the layout script would also settle the open phone-width checks.
