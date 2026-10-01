// src/engine/Automation.js
//
// An envelope's points as instructions for an AudioParam, for the stretch of time a scheduler tick
// covers. Pure: it reads points and a transport and returns what to do, and the host turns each
// instruction into the parameter's own scheduling calls, so the timing is the audio clock's and not a
// timer's (CLAUDE.md: an event is located by stream position, never by a block index or by equality
// with a block boundary).
//
// A point's curve is how the value leaves it towards the next point: step holds, linear is a
// straight line, smooth is smoothstep. After the last point the value holds, and before the first it
// holds the first value. When a loop begins a pass, the value is set to what the envelope says at the
// loop start (partway along a segment if the loop starts inside one), so every pass sounds the same.
//
// Instructions, times in elapsed seconds since the transport started:
//   { kind: 'set',   at, value }
//   { kind: 'ramp',  at, value, end, endValue }    straight line from `value` at `at` to `endValue` at `end`
//   { kind: 'curve', at, duration, values }        `values` spread evenly over `duration`, starting at `at`

const SAMPLES_PER_SECOND = 100
const MAX_SAMPLES = 512

/** Smoothstep. */
const smooth = u => u * u * (3 - 2 * u)

/** The value an envelope has at song time `t` (seconds), for points already in seconds and in order. */
export function valueAtSeconds (points, t) {
  if (points.length === 0) return null
  if (t <= points[0].t) return points[0].value
  const last = points[points.length - 1]
  if (t >= last.t) return last.value
  let i = 0
  while (points[i + 1].t <= t) i++
  const a = points[i]
  const b = points[i + 1]
  const u = (t - a.t) / (b.t - a.t)
  if (a.curve === 'linear') return a.value + (b.value - a.value) * u
  if (a.curve === 'smooth') return a.value + (b.value - a.value) * smooth(u)
  return a.value
}

/**
 * From song time `t0` (inside segment `a` to `b`) to `t1` (no later than `b`), as one instruction placed
 * at elapsed `at`, or null when the curve is a step and there is nothing to draw.
 */
function segment (a, b, t0, t1, at) {
  if (a.curve === 'step' || !(t1 > t0)) return null
  const v0 = valueAtSeconds([a, b], t0)
  const v1 = valueAtSeconds([a, b], t1)
  if (a.curve === 'linear') return { kind: 'ramp', at, value: v0, end: at + (t1 - t0), endValue: v1 }
  const count = Math.min(MAX_SAMPLES, Math.max(2, Math.round((t1 - t0) * SAMPLES_PER_SECOND)))
  const values = new Float32Array(count)
  for (let k = 0; k < count; k++) values[k] = valueAtSeconds([a, b], t0 + (t1 - t0) * (k / (count - 1)))
  return { kind: 'curve', at, duration: t1 - t0, values }
}

/**
 * `points` are `{ atBeat, value, curve }` in beat order. `segments` is what Scheduler's own
 * `segments()` yields for the window: `{ from, to, lo, hi, shift }`, elapsed [from, to) playing song
 * seconds [lo, hi). Returns instructions for elapsed [start, end), in time order.
 */
export function automationBetween (transport, points, segments, start, end) {
  if (points.length === 0) return []
  const timed = points.map(p => ({ t: transport.secondsAtBeat(p.atBeat), value: p.value, curve: p.curve ?? 'linear' }))
  const out = []
  for (const seg of segments) {
    const inWindow = t => t >= start && t < end
    // The start of a pass: the value the envelope has at the loop start, and what remains of the
    // segment it starts in.
    if (inWindow(seg.from)) {
      out.push({ kind: 'set', at: seg.from, value: valueAtSeconds(timed, seg.lo) })
      const i = timed.findIndex((p, k) => p.t <= seg.lo && (k === timed.length - 1 || timed[k + 1].t > seg.lo))
      if (i >= 0 && i < timed.length - 1) {
        const partial = segment(timed[i], timed[i + 1], seg.lo, Math.min(timed[i + 1].t, seg.hi), seg.from)
        if (partial) out.push(partial)
      }
    }
    for (let i = 0; i < timed.length; i++) {
      const p = timed[i]
      if (p.t < seg.lo || p.t >= seg.hi) continue
      const at = p.t + seg.shift
      // The pass start already set the value for a point that falls exactly on it.
      if (!inWindow(at) || (at === seg.from && inWindow(seg.from))) continue
      out.push({ kind: 'set', at, value: p.value })
      if (i < timed.length - 1) {
        const leg = segment(p, timed[i + 1], p.t, Math.min(timed[i + 1].t, seg.hi), at)
        if (leg) out.push(leg)
      }
    }
  }
  return out.sort((x, y) => x.at - y.at)
}
