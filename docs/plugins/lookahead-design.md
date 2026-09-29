# Lookahead: a plugin that changes its latency

Covers [latency.md](../latency.md) section 2, which no plugin exercises and no host
acts on (testbed.md, "What nothing exercises yet"). Smallest plugin for the clause
plus the host half, which is the larger piece of work.

## The plugin

A switchable lookahead delay, JavaScript only (no `jig:module`, like Tremolo and
Squelch), with two positions: direct, or held back by 512 frames. Changing position
changes the plugin's latency, which is the whole point: a bare delay line is the
least DSP that still has a latency worth reporting.

- Profile declares the worst case, `jig:latencyFrames 512`, as module-abi.md
  requires of a module whose latency moves with its settings. There is no module
  here, but the rule is about the declaration, not the module: a host compiling
  from the profile before `ready` arrives must assume the worst.
- The processor reports the actual figure in `ready` (0 at the default position)
  and posts `{ type: 'latency', latencyFrames, fromFrame }` whenever it changes,
  per messaging.md 1.3.
- `fromFrame` is the start of the quantum in which the new position is first
  read. Position arrives as a k-rate AudioParam, so a change is visible at a
  quantum boundary, never mid-quantum; the processor reads the worklet's
  `currentFrame` there, which is the host's stream domain, not its own count.
- `position` is an enumeration with exactly two scale points (`Direct`, `512
  frames`), so the generated panel draws a switch whose readout names the
  position rather than saying on and off.
- The delay line (512 frames per channel) is allocated in the constructor,
  before `ready`. `process()` never allocates, after Tremolo.

## The host half

Jiggy recompiles compensation when a `latency` message arrives, scheduled against
`fromFrame` rather than against message arrival (latency.md section 6 forbids
the latter; only `src/wam/WamModule.js` reads the message today).

- `OpDispatcher.addPlugin` subscribes to each natively loaded node through
  `Engine.onMessage`, beside `EventRouter.observe`. Foreign nodes are excluded:
  a WAM speaks its own latency protocol over the same port (no `fromFrame`),
  and `WamModule` already consumes it.
- On a valid message the dispatcher writes the figure into the engine entry's
  `ready.latencyFrames` (which is what `#latencyOf` compiles from), recompiles
  the unchanged project, and retimes the compensation delays whose values moved.
  A latency change is not an edit: no revision, no history, no undo entry.
- `Engine.retime(connection, delayFrames, { atTime })` moves one compensated
  link: an existing delay node is driven with `delayTime.setValueAtTime` at
  `fromFrame / sampleRate` (clamped to the current time when `fromFrame` has
  passed); a newly needed one is inserted as a passthrough first and switched
  at the same time. Removing a node cannot be scheduled, so a delay that falls
  to zero stays in the graph as a passthrough until the next full rebuild.
- An invalid message (non-numeric or negative figure or frame) is ignored and
  reported naming the plugin and the field, per contract 10.1. A recompile that
  newly fails (less latency can expose an undelayed cycle) keeps the previous
  links rather than applying half a compensation.

## Tests

- `tests/host/lookahead.test.js`: worst case in the profile, actual figure in
  `ready`, impulse passthrough at 0 and offset by exactly 512 at 512, one
  `latency` message per change carrying the quantum-start frame, and silence
  before `ready`.
- `tests/engine/Engine.test.js`: retiming an existing delay, inserting a new
  one, zeroing to a passthrough, and clamping a past `fromFrame` to now.
- `tests/ops/latency.test.js`: a `latency` message updates the node, recompiles
  a parallel path onto its new alignment, schedules the delay change at
  `fromFrame / sampleRate` rather than at arrival, ignores an invalid message,
  and records no undo entry.

## Out of scope

Listening to it (a person), a parallel-path check in a live browser, and
removing zeroed delay nodes on a schedule. The panel is generated; the plugin
ships no `jig:ui`.
