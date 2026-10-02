// src/engine/Metronome.js
//
// The click: one per beat, louder on the first of a bar, and a count-in of whole bars before beat zero. Message
// thread only. It is a host aid and not a part of the session, so it is never in the compiled graph, never in a
// bounce and never saved: it asks for a sound to be made through `click`, and where that goes is the page's.
//
// A click is located by its stream position like a note: an elapsed time, fired in the window that contains it,
// never by its index inside a block and never by equality with a boundary. Looping unrolls the way notes do
// (Scheduler.js `segments`), so the click keeps time through the loop end.
import { segments } from './Scheduler.js'

/**
 * The clicks that fall in elapsed [start, end): `[{ at, accent }]`, `at` in elapsed seconds. A beat is a whole
 * number of beats of the transport; the first of every `beatsPerBar` is the accent.
 */
export function clicksBetween (transport, start, end) {
  const found = []
  const bar = transport.beatsPerBar
  for (const seg of segments(transport, start, end)) {
    // The part of this stretch that is inside the window, in the song's own seconds.
    const lo = Math.max(seg.lo, start - seg.shift)
    const hi = Math.min(seg.hi, end - seg.shift)
    if (hi <= lo) continue
    for (let beat = Math.ceil(transport.beatAtSeconds(lo) - 1e-9); ; beat++) {
      const song = transport.secondsAtBeat(beat)
      if (song >= hi) break
      if (song < lo - 1e-9) continue
      found.push({ at: song + seg.shift, accent: beat % bar === 0 })
    }
  }
  return found
}

/**
 * A count-in of `bars` bars at the tempo the song starts on: `[{ at, accent }]` with `at` negative, ending one
 * beat before beat zero, and the `duration` in seconds that beat zero has to be put back by.
 */
export function countIn (transport, bars) {
  if (!Number.isInteger(bars) || bars < 0) throw new Error(`a count-in is a whole number of bars, not ${bars}`)
  const beats = bars * transport.beatsPerBar
  const length = transport.secondsAtBeat(1)
  const clicks = []
  for (let i = 0; i < beats; i++) clicks.push({ at: -(beats - i) * length, accent: i % transport.beatsPerBar === 0 })
  return { clicks, duration: beats * length }
}

export class Metronome {
  #now
  #lookahead
  #transport
  #click
  #enabled
  #origin = null
  #until = 0

  /**
   * - `now()`: the audio clock in seconds.
   * - `lookahead`: seconds ahead of the clock to schedule to, from configuration, never defaulted here.
   * - `transport()`: the Transport as it is now.
   * - `click(when, accent)`: make the sound at `when` on the audio clock.
   * - `enabled()`: whether to click, read every tick so the switch is heard at the next one.
   */
  constructor ({ now, lookahead, transport, click, enabled }) {
    if ([now, transport, click, enabled].some(f => typeof f !== 'function')) throw new Error('Metronome needs now, transport, click and enabled')
    if (!(lookahead > 0)) throw new Error('Metronome needs a lookahead in seconds, from configuration')
    this.#now = now
    this.#lookahead = lookahead
    this.#transport = transport
    this.#click = click
    this.#enabled = enabled
  }

  get running () { return this.#origin !== null }

  /** Start at the clock time beat zero is heard. */
  start (atTime) {
    this.#origin = atTime
    this.#until = 0
  }

  /** Schedule every click up to the lookahead. */
  tick () {
    if (!this.running) return
    const elapsed = this.#now() - this.#origin
    const end = elapsed + this.#lookahead
    // A click that is already past is not made late: switching on mid-bar starts from the next beat.
    const start = Math.max(this.#until, elapsed)
    if (end <= start) return
    if (this.#enabled()) {
      for (const { at, accent } of clicksBetween(this.#transport(), start, end)) this.#click(this.#origin + at, accent)
    }
    this.#until = end
  }

  stop () { this.#origin = null }
}
