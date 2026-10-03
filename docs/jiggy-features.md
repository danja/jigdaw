# What Jiggy does

Jiggy is the browser host for JigDAW: a page that loads Jigs by IRI, plays and edits a piece, and
saves it as RDF. This document lists what it does now. It is a catalogue of what is built, not a
plan; what is not built is in [TODO.md](../TODO.md), and where Jiggy stands against other browser
DAWs is in [usp.md](usp.md). A figure here is checked by a test against what it counts.

There are two pages over one model and one set of operations. The **studio** (`index.html`) is the
whole thing: a track view, plugin routing, automation and rendering. The **simple page**
(`simple.html`) is for playing with a piece: pick a tune, press Play, change the sound. A phone
starts on the simple page.

## Playing

- Play, Stop and Loop in the transport bar, a tempo field, a time signature field, a position
  readout and a level meter. The loop can be drawn on the timeline and is played as a loop.
- Record keeps each track as it was heard as an audio clip, in one edit, so one undo takes the pass
  back out.
- Web MIDI input plays into the armed track, or the selected one when none is armed, with a note
  stamp located by stream position.
- A microphone can be recorded into a new track from the simple page.
- Events are scheduled ahead of the audio clock and located by stream position, never by block
  count, so a note fires in the block that contains it.

## The track view

- **Tracks.** Rename, colour, three lane sizes, reorder (Alt with Up or Down on a name), select several
  and edit them together, delete with their plugins in one undoable step. A track says its own latency
  and how much it was delayed to line up with the others.
- **Timeline.** A ruler with zoom, a snap grid (bar, beat, halves, quarters, eighths, off), a loop row with
  a draggable brace, and a playhead that follows and stops following when you scroll.
- **Dock.** A panel under the lanes that follows the selection: a MIDI clip opens the piano roll, an audio
  clip its numbers, a track its chain and routing, a plugin its ports and connections.
- **Clips.** MIDI and audio, added from a lane, imported from a file, or recorded. Move and resize by drag
  or by keys. Split at the playhead (S), duplicate (D), mute (M), lock (L), trim the start or end to the
  playhead ([ and ]), copy, cut and paste (Ctrl or Cmd with C, X and V), delete, colour. Each is one edit
  and one undo, with a button for each above the lanes for a phone. Cuts and trims snap to the grid.
  Audio clips have fades in and out, straight lines in level.
- **Piano roll.** Draw, move, resize and delete notes with the pointer or the keyboard, with an audition.

## Plugins and routing

- **Finding and loading.** A browser panel searches a catalogue of Jigs by role, signal and other facets,
  loads one by IRI, and opens a collection or a preset. The page checks every file's digest before it runs.
- **Generated panels.** Every plugin's controls are drawn from its declared ports, so there is no
  per-plugin interface code: knobs, selectors and switches with units spoken out, named and reachable by
  keyboard.
- **Chain strip.** Under each track, its plugins in signal order with what each takes and gives. Bypass a
  plugin (it keeps its state, passes the signal on, and is put back instantly). Move one earlier or later
  (Alt with Left or Right, or the buttons), which rewires the joins as one edit.
- **Composite plugins.** A plugin made of other plugins, such as an effects rack, loads as one plugin: one node, with the few
  controls its author exposed, which saves and reopens, undoes as one edit and is bypassed as a whole. Its members are loaded and wired
  behind it and compensated for latency as if wired by hand, and a bad member refuses the whole thing, naming it. The page generates its
  panel from the controls the author exposed. This was run in Chrome on 2026-10-02: it loads from an IRI, a real key played through it is
  governed by its Drive control, a composite pinned to a profile that has since changed is refused with the session untouched, and remove
  and undo restore it. A second run covered a MIDI clip played from the transport through Pulse and the rack (silent at Drive 0, a peak of
  0.25 at the default), saving a session and reopening it with the setting and the author's voicing restored, and the Routing and Mixer
  tabs. Its catalogue search lists it as loadable, and `plugins/stomp-rack/` is the worked example. Not yet done: a phone, listening to it, and loading it from a
  search result, which fetches the canonical address and so waits for the rack to be deployed. A composite's card has an **Unpack** button, on
  composites only: it turns the rack back into the plugins it is made of, each with the value it had inside, joined to what the rack was joined
  to, as one undo step (checked in Chrome: Drive 0.6 became Boost's Gain 0.6, and the author's tremolo rate became a knob). The agent tools
  `node_unpack` and `composite_pack` do the same, and the second describes a selection as a composite profile to publish and changes nothing.
  See [nested-plugins.md](nested-plugins.md).
- **Routing matrix.** Every output against every input, joined or not, by pointer or arrow keys.
- **Connections.** Audio and MIDI, within a track or across tracks. A connection that would make a loop
  with no declared delay is refused with the reason, and so is a loop of MIDI connections. A MIDI
  connection can be watched: the last 24 events over it, in words.
- **Sends, buses and the master.** Sends before or after the fader, a track's output to another track, and
  a master with level, pan and mute, all acting on the sound. A cycle of them is refused.
- **Sidechain.** A plugin can mark an input as a key, and the matrix names it "Sidechain key". Dynamix
  ducks from a kick on another track.
- **Latency.** Declared latency is compensated between connected plugins, and tracks are delayed so that
  parallel tracks arrive together, with a switch.

## Automation

- An envelope on any plugin parameter, on the master level or pan, or on the tempo, with step, linear and
  smooth curves between points. Played on the audio clock, looped passes included, and Stop puts every
  parameter back to the value set by hand.
- Lanes under each track and a row for the master and tempo: each point is a button named in words, moved
  by keys or by dragging, with a click on empty lane to add one. Every gesture is one undo.
- A hand edit while a lane plays takes over at once and pauses that lane until Stop.
- A tempo envelope is the tempo map, so notes, audio clips and the position all follow it.

## Rendering

- **Export** renders the mix to a WAV in the page, faster than it plays, without disturbing playback. The loop,
  when it is on, is what is rendered.
- **Stems** render every track that makes sound to its own WAV in one zip.
- **Freeze** renders one track as heard to an audio clip on a new track and mutes the original, in one edit.
- Rendering uses a second engine built from a snapshot of the session: the same plugins, scheduler, clips,
  envelopes and transport messages, with the audio context suspended each tick.

## Sessions

- A session is RDF (Turtle), or a zip of it with its audio and a separate `editor.ttl` for layout, colours and
  positions. Layout is kept apart from the model and is not part of undo.
- Undo and redo cover every edit; a changeset is atomic and carries a revision.
- Save and Open, seven bundled presets that play a generated piece on their own, and a piece carried between
  the two pages: following the link to the other page keeps the open session and the other page offers it.

## The simple page

- Six tunes as big buttons, Play and Stop, a Speed slider in plain words, and a card per instrument with On
  and Off, its loudness, and "Change the sound".
- "Change the sound" opens a rack screen for that track: its plugins as generated panels, with Back, a
  history entry so the browser's Back works too.
- Record your voice into a new track, save the piece, and make a sound file (a WAV).
- Targets are 44px and the layout is one column with no sideways scroll at phone width.

## The Reel page

- `reel.html` is for writing Reel scripts ([livecoding.md](livecoding.md)), on a phone first. A menu and an Open button pick one of the bundled pieces; Play, Stop, speed and the meter stay at the foot of the screen.
- Four tabs. **Script** is the editor with Run, Check only and Stop, and saves or opens a `.reel` file (opening one does not run it). **Examples** has ready-made scripts, each written for one bundled piece: "Edit this" puts it in the editor, "Play it" opens the piece, starts the music and runs it. **This piece** lists the names a script can use in the open piece and their parameters, with an Insert button that writes the line to set one. **Reference** is the language: statements, units, functions, naming and limits, with an Insert button on each example.
- The examples, the reference and the Insert lines are checked by tests against the real pieces, plugin profiles and parser, so none of them can name a parameter or a form that is not there.

## Installing and offline

- A web app manifest and icons, a service worker that keeps the page and what you have opened, an update
  notice that never reloads under a playing piece, an install button, and an offline indicator. A cached
  plugin is still checked against its digest when it is run.

## For agents

- **52 tools** over the same dispatcher the page uses, through WebMCP: search and load plugins, edit tracks
  and clips, connect and bypass and reorder nodes, set and reset parameters, write envelopes, undo and redo, and play and stop.
  Nothing an agent does goes around the operations the interface uses, so it is undoable and checked the same
  way ([webmcp.md](webmcp.md)).
- **A Script tab** drives the plugins from text, in Reel ([livecoding.md](livecoding.md)): every plugin a script loads is
  fetched and validated before anything runs, a script with a problem changes nothing and says which lines, a new script
  takes over at the next bar line (or now), and one run is one undo step. Control+Enter runs it and
  Control+Shift+Enter runs it now. Checked in Chrome, at phone width too.

## The plugins

**27 plugins** are served beside the page, written in Rust, C++, JavaScript and JSFX, each described by a
profile and loadable by its IRI:

- *Instruments:* Pulse (subtractive), Canticle (tonal), DrumKit, Mop (OPL3 FM), 8-Bit 8asterd (AY chip).
- *Generators:* MelGen, BassGen, DrumGen, Ground, Cadence and Counterpointer play a piece from a few settings
  and the transport.
- *MIDI processors:* Dice (probability gate) and MIDI Filter (channel, transpose, note range).
- *Effects:* Cascade (reverb), Ferrite (neural amp and cabinet or room), Dynamix (compressor, limiter,
  clipper, with a sidechain key), Squelch (acid filter), Tremolo, Quefrency (formant and pitch), Lookahead,
  Boost, and three JSFX effects (gain trim, one-pole filter, soft clipper).

**7 presets** are bundled: Chiptune, Acid, Generative through effects, Amp into a room, Fender into the
Ropery, Fugue, and Through Keyframe. Each is played offline in a test and must put sound on every track that has a sound maker.

## Built to be used by everyone

- Every control has a name, a role and a value said as text. The keyboard reaches everything the pointer does.
  State is never colour alone. A control nobody can use is left out, not shown disabled.
- Touch targets are at least 44px and text inputs 16px. One column below 720px, with no sideways scroll,
  measured in a real browser.
- Standard icons carry their words as their accessible name.
