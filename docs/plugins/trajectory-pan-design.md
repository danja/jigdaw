# Trajectory pan: an auto-panner whose position follows a path, per band

**Status:** design. Nothing is built. An auto-panner whose position follows trajectories other than one LFO: a circle, a
random walk and jumps driven by the signal's own envelope, with the spectrum split into bands that move on their own so low
and high content do not travel together. This records the decisions that need making first.

## What moves, and what it must not do

**The mono-compatibility rule decides the design, so it comes first.** A panner that works by delaying one channel, or by
inverting a polarity, sounds wide and then cancels when the output is summed to mono, which is what a phone speaker and a
radio do. So this panner moves level only. It never delays a channel, never inverts one, and mixes no channel into the
other. The mono sum of a level-only pan stays between the input's level and 3 dB above it for an equal-power law, and
cannot go to zero. It is a rule the tests hold the plugin to: the mono sum of the output, for every trajectory and band
setting, is never below the input's level less a stated tolerance.

A stereo input is treated as a stereo source whose balance moves, with no cross-channel mixing, so an existing image is
moved and not collapsed. A mono input (the same signal on both channels) pans as a source.

## The trajectories

- **Circle.** A phase `θ` advances at `rate`, and the position is `x = depth * sin(θ)`. A circle in the horizontal plane
  has a depth as well as a width, and the front-to-back axis is drawn as a level and a slight high-frequency roll-off,
  both things a level-only panner may do, so it adds a `depth_cue` amount to the circle and nothing else changes.
- **Random walk.** A seeded generator steps the position by a small random amount each control tick, smoothed, and the walk
  reflects off the ends of `depth`, so it can never leave the field. The seed is a parameter, so a performance repeats.
- **Follower jump.** An envelope follower on the band's own signal (attack and release in milliseconds) drives a threshold.
  Each upward crossing picks a new position, glides to it over `glide` ms, and holds it until the next one. This is the only
  trajectory that depends on the input, and the only one that needs a transient to move.

**Recommendation: the shape is a switch, `Circle`, `Random walk`, `Follower jump`, with the others' controls left out when
they do not apply.** Combining all three at once is a larger design and no harder to add later.

## Bands

**One to three bands, split with Linkwitz-Riley fourth-order crossovers.** They sum to a flat magnitude at neutral, which is
the property that lets the bands move independently and still return to the input when they all sit in the centre. Each band
has its own phase for the circle, its own random walk and its own follower, offset from its neighbour by `spread`, so the
low end can orbit slowly while the highs jump. The crossovers are `low_split` (default 200 Hz) and `high_split` (default
2000 Hz); with fewer bands the unused one is left out of the panel.

The split costs a phase shift around the crossover point, which a level-only pan does not hear, but which the mono sum does:
two bands panned apart and then summed are the same signals added, so the sum stays flat. A test checks that the summed
magnitude of an unmoved split is flat within 0.1 dB.

## Parameters

| symbol | range | default | unit | acts on |
|---|---|---|---|---|
| `shape` | Circle, Random walk, Follower jump | Circle | scale points | the trajectory |
| `bands` | 1, 2, 3 | 1 | scale points | how many bands move independently |
| `rate` | 0.02 to 20 | 0.5 | Hz | circle speed and random-walk step rate |
| `depth` | 0 to 100 | 70 | percent | how far from the centre the position reaches |
| `spread` | 0 to 360 | 90 | degrees | phase offset between neighbouring bands |
| `low_split`, `high_split` | 50 to 800, 800 to 8000 | 200, 2000 | Hz | the crossovers |
| `threshold` | -60 to 0 | -30 | dB | follower-jump trigger |
| `glide` | 1 to 500 | 60 | ms | follower-jump movement time |
| `seed` | 1 to 9999 | 1 | | random walk and jump positions |
| `mix` | 0 to 1 | 1 | | dry and wet |

`rate` can be tempo-synced later by taking the host transport. It is free in Hz in version one, because the transport is a
separate dependency and the effect is useful without it.

## Language and tests

Plain JavaScript, no module: a few filters, a table sine and a generator.

- **Mono safety:** for every shape, band count and rate, the mono sum of the output is within 0.1 dB of the input for the
  centred position and never below the input less 0.5 dB at any position.
- **Neutral:** `depth` 0 returns the input, to the crossover's phase, with every band count.
- **Bounds:** a random walk stays inside `depth` over a long run; the same seed gives the same output exactly.
- **The follower:** a click train moves the position at each click and not between them, and a signal below the threshold
  never moves it.
- **No allocation in `process()`**, as with every processor.

## Open decisions

1. **The pan law.** Constant power gives a centre 3 dB below the sides and a mono sum that rises 3 dB at the edges. A
   -4.5 dB law splits the difference. Constant power is the recommendation because it is the one people expect.
2. **Whether a circle's front-to-back cue belongs in version one.** It adds a filter and a level, and it is what makes a
   circle a circle and not a pendulum.
3. **Whether the followers listen to their own band or to the full input.** Their own band makes each move on its own
   material; the full input makes them move together, which is a different effect.
