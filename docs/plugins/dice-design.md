# Dice: a second plugin answering state requests

Covers the open half of contract section 8. Ferrite is the only plugin that
answers a `stateRequest`, so token correlation and ordering with two stateful
nodes is untested. This adds the smallest plugin with genuine non-parameter
state, plus a round-trip test with Ferrite loaded alongside proving two
`state` replies route to the right nodes by token.

## Why a probability gate

Parameters are not state (contract 8.2), so this cannot be bolted onto an
existing plugin: whatever the host already saves is the wrong population. What
qualifies is small, serializable, and otherwise unknowable: an xorshift32
generator whose 32-bit state advances with every gated note. Two instances with
identical parameters diverge after different histories, and restoring a saved
state re-converges them exactly. That divergence is the behavioural proof the
state channel carries something the parameters do not.

Dice gates note-ons by probability and passes each note-off if and only if its
note-on passed, so a dropped note never leaves a stuck one downstream. Every
other message passes through untouched.

## Ports, all three earning their place

- `probability` 0..1, default 1 (open: silent on load, like Lookahead's
  Direct). k-rate dial.
- `seed` 1..9999, default 1. k-rate dial. The initial generator state, and
  nothing else: it does not follow the generator as it advances.
- `reseed`, toggled, default 0. A rising-edge trigger in the style of
  DrumGen's New/Mutate: crossing 0.5 loads `seed` into the generator. Without
  it the seed control would be dead after the first draw, and without the
  edge (a plain level) a restore carrying `reseed 1` would re-seed on load and
  destroy the restored state it arrived with.

State is `{ rng }`, one unsigned integer, structured-cloneable. On `init`
without saved state the generator starts from the seed default; a restorable
`seed` the person changed is applied only through `reseed`, never implicitly.
On `stateRequest` the processor replies `{ token, state }` with the same token.

## The token test

One engine, Dice beside Ferrite. Both `requestState` calls in flight at once
must resolve with their own node's state: Dice's integer against Ferrite's
asset bytes, in either initiation order. `Engine.requestState` already keys
pending requests by token; the test proves two stateful nodes do not cross,
which one stateful node cannot show.

## Out of scope

A panel beyond the generated one (three ordinary controls), transport
awareness (the gate needs none, so unlike the generative MIDI plugins it
declares no `trn:HostTransport`), and velocity scaling or pattern memory,
which would make the plugin larger without making the state question any
clearer.
