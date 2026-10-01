# Harmonics: an effect that grows a harmonic series from its input

**Status:** design. Nothing is built. It records the decisions the idea needs before code, with a recommendation for each.
The idea is from r/synthesizers: pitch-shift the input to 2x, 3x and 5x, then feed the result back so the shifters make the
harmonics in between (4x from 2x shifted again, 6x from 2x and 3x, and so on).

## What it produces

**Every harmonic whose number is made only of 2, 3 and 5.** Each pass through a shifter multiplies the frequency by its ratio,
so the loop reaches 2, 3, 4, 5, 6, 8, 9, 10, 12 and every other product of those three, and never 7, 11 or 13. These are the
5-smooth numbers, and the missing ones are what stops the result being a plain sawtooth. A fourth shifter at 7 would add
7, 14, 21 and so on, at the cost of one more branch in the loop. The panel offers 2 and 3 only, 2 3 and 5, or 2 3 5 and 7.

A harmonic that took `k` passes through shifters carries the loop gain to the power `k`, so the series falls away on its own and
its slope is the `feedback` control. That is the bound on gain, and it is the one decision the design has to get right.

## The bound on gain

**Stability needs the summed gain of the branches back into the input to stay below 1.** With three branches each fed back
at gain `g`, the loop gain is at most `3g` in amplitude, so `g` must stay under one third. The `feedback` parameter is
that total, 0 to 90 percent, shared among the branches, so the worst case is `0.9` and a loop can never grow. The test
for it is the one that matters: a full-scale input and `feedback` at its maximum must settle, not rise.

Two more guards, because a bound on gain alone does not stop a loud harmonic series:

- **A ceiling filter in the loop**, a low-pass at `ceiling` (default 12 kHz), because a shifter reading at twice the speed
  folds anything above a quarter of the sample rate back down. Every pass filters, so a harmonic that has gone past the
  ceiling dies by repetition rather than aliasing.
- **A soft limit on the loop's return**, so a transient on a note cannot spend a second in the loop, which a person
  hears as a clipped tail.

## The pitch shifters

**Recommendation: delay-line shifters, two taps with a Hann crossfade.** A read position that moves at `r` times the write
position changes pitch by `r`, and two taps half a window apart, crossfaded, hide each tap's jump back. Cost is a few
operations per sample, so three or four of them in a loop is cheap, and latency is the window, not a frame of an FFT.
The artefact is a modulation at the window rate, which is acceptable in a deliberately coloured effect and tuned by
`window` (10 to 50 ms).

Rejected for version one: a spectral shifter, which gives cleaner results for a single instrument and a good deal more
latency and code, and reuses Quefrency's peak shifting only at that cost. A later `quality` switch, defaulting to the
cheap one, could offer it, as Keyframe does.

## Latency and the cycle

The loop is inside one plugin, so it is not a graph cycle and [latency.md](../latency.md) does not apply to it. Latency is
one window, declared as `jig:latencyFrames`, and the dry path in the mix is delayed by it, so a half mix does not comb.
The loop's own delay is a window per pass, which is why the harmonics arrive a little apart. That is part of the sound.

## Parameters

| symbol | range | default | unit | acts on |
|---|---|---|---|---|
| `series` | 2 3, 2 3 5, 2 3 5 7 | 2 3 5 | scale points | which shifters exist |
| `level_2`, `level_3`, `level_5` | -60 to 0 | -12, -18, -24 | dB | each shifter's contribution to the output |
| `feedback` | 0 to 90 | 40 | percent | total gain of the loop |
| `ceiling` | 2000 to 18000 | 12000 | Hz | the low-pass in the loop |
| `window` | 10 to 50 | 25 | ms | grain length of every shifter |
| `mix` | 0 to 1 | 0.5 | | dry and wet |
| `output` | -24 to +12 | 0 | dB | output gain |

A control with no use is left out: with `series` at 2 3, there is no `level_5` to draw.

## Input

It is for a monophonic line or a single sustained tone. A chord goes through each shifter as a whole, so every note gains
its own series and the series overlap, which is dense and sometimes pleasing and always louder, and the profile's caution says so.

## Language and tests

Plain JavaScript, no module, in the style of Tremolo and Squelch: the whole of it is three delay lines and a filter.

- A 220 Hz sine through it shows the harmonics the settings name (440, 660, 880, 1100, 1320 with `series` 2 3 5) and
  nothing at 1540, the seventh.
- Unity feedback is impossible: at `feedback` 90 and a full-scale square wave the output peak is bounded and the loop
  settles within a stated time after the input stops.
- Neutral: `mix` 0 gives the input delayed by exactly the declared latency.
- Nothing above the ceiling: a 6 kHz sine at 2x leaves no energy at 12 kHz with `ceiling` below it.
- The profile's scale points and the processor's lists are bound by a test, as with every plugin.

## Open decisions

1. **The default `series`.** 2 3 5 is the idea as stated. 2 3 is cleaner and cheaper.
2. **Whether the shifters are exact ratios or can be tuned off them** (a few cents), which thickens the result and
   departs from a harmonic series.
3. **A fourth, 7th, shifter by default or not.** The listening decides; nothing here has been heard.
