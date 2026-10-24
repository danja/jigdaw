# The clip launcher: what it is before it is drawn

**Status:** a design, written 2026-10-24. Built so far: the clip model, playback from the launch boundary (`src/model/LauncherState.js`, `src/engine/LauncherPlays.js`, the `launcher` option of the scheduler), the tools `launcher_launch`, `launcher_stop`, `launcher_quantise` and `launcher_state`, and the grid on its own Launcher tab. The launch quantisation is saved with the session (`jig:launchQuantise` on the transport, seen changing in Chrome and read back by the tool). Reel has `launch` and `stop` statements (`launch 2`, `launch bass 2`, `stop bass`, `stop`, placed with `at` or `every`). Not built: scene names and recording a performance. It exists because the launcher touches the model, the scheduler, the
tools and Reel at once, and a grid drawn first would fix decisions that belong to the model. It follows the slot states and the
launch quantisation that [Oxide Studio](oxide-studio-review.md) uses, with the Jiggy rules applied: the term first, one Op per
edit, and nothing a person cannot reach by keyboard.

## What it decides

- **A slot is session data, and what is playing is not.** Which clip sits in which slot is part of the piece, so it is in the
  revision, undoable, and saved. Which slots are playing or waiting is a performance, so it is held outside the revision, as the
  script state is, and not saved. Reopening a session shows the grid stopped.
- **A slot holds one MIDI clip to begin with.** Audio clips need their own scheduling and stay in the arrangement until the
  launcher works for notes.
- **A slot's clip is not on the timeline.** It is a pattern that loops (the clip's own `loopBeats` when set, its length
  otherwise) from the moment it is launched. The same clip can sit in several slots only by copying it; sharing one clip between
  slots is the "pattern clips" item in [TODO.md](../TODO.md) and waits for it.
- **Launching is quantised, and the setting is part of the session.** None, beat, bar, two bars and four bars, kept with the
  transport so a reopened piece launches as it did. A launch waits for the next boundary of that size counted from the start of
  the transport, so it lines up with the arrangement and the click.

## The model

**Decided and built on 2026-10-24.** A slot is not a new thing: it is a MIDI clip with a `jig:scene`, a whole number from zero, and
it is kept off the timeline. Its `trn:startBeat` is 0, and the arrangement does not play, draw or export it (`Project.arrangementClips`
is the clips on the timeline and `Project.launcherClips` the others). A track has at most one clip in a scene, so the grid is the
tracks across and the scenes down, and an empty cell is a missing clip. Because it is an ordinary clip, the piano roll, undo, copy,
lock and the agent tools work on it unchanged: `clip_add` and `clip_set` take `scene`, and `setClip` with `scene` null puts a clip
back on the timeline. It is in `vocabs/jigdaw.ttl` and `vocabs/shapes.ttl`, written and read by the session files, and refused by
the model for an audio clip, a second clip in a scene on a track, or a start other than 0.

Scene names are not built. A scene is its number until a name is wanted, and then it is a small record of its own.

The states of one slot are five, and the set is closed:

| State | Meaning | Leaves by |
| --- | --- | --- |
| empty | no clip in the slot | a clip is put there |
| stopped | has a clip, silent | launch |
| queued | will start at the next boundary | the boundary arrives, or a stop |
| playing | looping | stop, or another slot on the track launches |
| stopping | will stop at the next boundary | the boundary arrives |

Only one slot on a track plays at a time, so launching a second queues it and the first stops at the same boundary. This is
state outside the revision, in a `LauncherState` beside `ScriptState` and `EditorState`: no undo, no revision bump, and a listener
so the view draws again.

## Playing it

The scheduler already turns a clip into notes at stream positions and repeats a looped clip (`playedContent`). A playing slot is
the same thing with a start taken from the launch boundary instead of from the clip, repeating until its stop boundary. It plays
into the track's `jig:midiInput` as arrangement clips do. While a slot plays on a track, that track's arrangement clips are
silent, so a person can put a loop over a song and hear only the loop. A stop on the track, or a "back to arrangement" press,
lets the arrangement play again. Launch and stop boundaries are computed in beats from the transport's tempo points, never from
block counts, as the real-time rules say.

If the transport is stopped, launching a slot starts it from the loop start or the top, as Play does, so a person never presses a
cell and hears nothing.

## What an agent and a script get

`launcher_launch` and `launcher_stop` (for a slot, a scene and the whole grid) are performance gestures, like `transport_play`:
they change no revision. They are also the first candidates for Reel statements, because launching on the bar is what a live
script does. The grid itself is edited through `graph_apply_changes` and gets `slot_*` tools only if the changeset proves too
rough to use, which the parity test will say.

## The view

A grid in the Arrangement tab's dock or its own tab, decided by the main-view note, one column per track and one row per scene.
Each cell is a button of at least 44px that says its state in words as well as colour ("Bass, scene 2, playing"), and opening it
edits the clip in the piano roll. Arrow keys move over the grid, Enter launches, a key stops. Scene buttons launch a row. Nothing
is drawn for a track that cannot play a clip, since that would be a control nobody can use.

## Open questions

1. Should recording a launcher performance write it to the arrangement as clips? It is the useful half of Live's design and a
   second feature.
2. Should a slot be able to hold a different tempo or signature? Not in the first version.
3. Is the launcher a tab or a dock? (Built as a tab, the seventh, on 2026-10-24; the measured tab row has no overflow. It can move if the main-view decision says so.)
   Original question: That follows [main-view.md](main-view.md) and the maintainer's decision on the docked mixer.

## What was built and seen, 2026-10-24

- **Playback.** A launched slot plays its clip, looping every clip length, from the boundary until a stop; a note is cut where its pass ends. The
  arrangement on that track is silent between the slot's start and stop beats, and plays again after. The transport's loop is not applied to a
  launched slot, which runs on the clock. A stop of the transport forgets every run.
- **Quantisation** is none, beat, bar, 2 bars or 4 bars, kept on the transport as `jig:launchQuantise` and saved with the session (`LauncherState` works from it each time). A launch with the transport stopped starts
  the transport and the slot together.
- **In Chrome**, with a real click: an empty cell added a clip and opened the piano roll; a click on a cell with two notes started the transport and
  the events reached the plugin four beats apart (every 2.0 seconds at 120 bpm), the cell read "playing", the master meter lit, and `launcher_stop`
  ended it with no further events. Not heard: no audio was listened to, and the arrangement-silencing was tested in the scheduler only.
