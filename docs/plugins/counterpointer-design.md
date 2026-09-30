# Counterpointer: a learned counter-melody processor as a Jig

Ports downspout's `counterpointer` (`/home/danny/github/downspout/plugins/counterpointer`,
design notes at `docs/design.md` there) to a Rust `no_std` Abi2 MIDI processor,
after `plugins/cadence/`. The downspout core is about 1900 lines of portable C++
(`counterpointer_engine.cpp` 1238, `counterpointer_serialization.cpp` 416,
`counterpointer_transport.cpp` 71, plus four headers): it captures incoming MIDI
against a transport-synced cycle, and at each cycle boundary scores a
monophonic counter-phrase that plays back through the next cycle.

## What the port keeps

The capture and scoring model unchanged: per-segment onset weight, pitch and
velocity sums, duration profile over 12 classes, timing bins; candidate scoring
over scale membership, register fit, consonance against the captured source
note, voice-leading distance, follow/counter direction weights, and bounded
deterministic jitter from `short_random`. Rhythm blends the source onset bin
with an answer position, moved by `syncopation`; `embellish` adds up to two
extra hits per segment. The strict fugal answering path (high Regularity and
Counter, low randoms: learned subject answered around the dominant, interval
inversion on Jazz-capable scales at high Color) and the Bass Descend response
mode (low center, falling cycle target, extra contrary weight against rising
source motion) both carry over, selected by the existing controls rather than a
new switch.

## Ports: the 24 controls, not the status signals

Key 0..11, Scale 0..23 (the 24-entry ScaleId list, Chromatic through Bebop
Minor, as scale points), Cycle Bars 1..8 default 2, Granularity 0..2
(Beat/Half-bar/Bar), Follow/Counter/Short Random/Long Random/Density/Rhythm
Follow/Syncopation/Consonance/Color/Embellish/Regularity/Span/Velocity Follow
as 0..1 at the downspout defaults, Register 0..2 (Low/Mid/High), Gate 0.10..1
default 0.72, Pass Input toggled default 1, Output Channel 0..16 default 0
(0 follows input), Freeze toggled, Learn as a rising-edge trigger in the style
of Cadence's Learn and DrumGen's New, Response Mode 0..1
(Counterpoint/Bass Descend). The wrapper's output-only status signals (Ready,
MIDI In/Out activity) stay out: they are diagnostic UI LEDs, and a Jig
declares parameters, not LEDs. The UI's Randomise button stays out for the
same reason the engine never had it: it was a UI gesture, not portable state.

## Three porting deltas, each marked in code

`std::pow(1 - longRandom, 2.5)` in the mutation interval becomes a square, the
same substitution the melgen port carries for the same reason (core has no
pow). The beat clock flywheels between transport messages, because a host that
reports the beat on a slow loop would otherwise quantise capture to that grid;
melgen, drumgen and bassgen all carry this flywheel. Scales, consonance tables
and jitter use integer tables and the xorshift the cadence port already uses,
so `jig_process` needs no transcendental functions.

## Transport, pass-through and learning readiness

Silent generation until transport rolls and one full `cycle_bars` cycle of
input is captured, exactly the downspout routing contract: with Pass enabled,
incoming MIDI forwards immediately (including while stopped or still
learning); generated notes start at the next cycle boundary after the phrase
is ready. Learn re-arms capture from the next boundary; Freeze holds the
current playback phrase across boundaries while capture continues underneath.
Monophonic output by construction: a new step ends the previous note, and a
held note with no note-off is ended on transport stop rather than left
sustaining. Rewind restarts the cycle grid; a landing position inside a held
generated note sounds it, the way the melgen port's `sync_to_position` does.

## State: a candidate for the second stateful plugin, undecided

The learned phrase plus variation counters are genuine non-parameter state in
the contract 8.2 sense: two instances with identical parameters diverge after
different input histories. The downspout core already serializes them
(`counterpointer_serialization.cpp`, 416 lines). Whether the Jig answers
`stateRequest` with them, which would close the open "second plugin answering
state requests" item in TODO.md beside Ferrite, is left to implementation: the
simpler port regenerates from input each cycle and declines state, and the
docstring there says which was built. Built 2026-09-30 without the state
channel: the phrase rebuilds from input each cycle, so the "second plugin
answering state requests" item stays open.

## Tests

`tests/host/counterpointer.test.js` against the real module: silent while
stopped; pass-through immediate with Pass on; a captured C major cycle yields
a deterministic monophonic answer at the next boundary (same input twice gives
the same line); high Regularity/Counter with low randoms answers around the
dominant; Bass Descend centers low with contrary motion against a rising
source; density 0 thins to nothing; parameter/port/module triple agreement per
the melgen test's binding check. Profile validates and canonicalises; bundle
rebuilt.

## Out of scope

A panel beyond the generated one, the status LEDs, the Randomise gesture,
polyphonic output, and any new scale or mode the downspout core does not have.
