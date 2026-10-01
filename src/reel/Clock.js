// src/reel/Clock.js
//
// Fires Reel's `at` and `every` statements by transport position. It is the page's second clock beside
// src/engine/Scheduler.js, built the same way and on the same loop logic: a tick covers the elapsed
// window since the last one, half open, and a statement fires in the tick whose window contains it.
// Never by a timer started for the statement, never by equality with a tick boundary, and never by an
// index within a block (CLAUDE.md, the real-time rules): a tick that is late, or a position that falls
// between two ticks, still fires exactly once.
//
// A firing is a message-thread operation, so it is accurate to the tick and not to the sample, which
// docs/livecoding.md says. Sample accuracy for a parameter is an envelope, and a ramp already is one.
//
// A statement fires at most once per tick. A page that stalls for a bar and then ticks does not replay the
// bar's firings: the latest one is done and the rest are dropped, because replaying a stalled `every` as
// a burst is worse than missing it.
import { segments } from '../engine/Scheduler.js'

export class ReelClock {
  #now
  #transport
  #origin = null
  #until = 0
  #jobs = []
  #sequence = 0

  /**
   * - `now()`: the audio clock in seconds, AudioContext.currentTime.
   * - `transport()`: the Transport as it is now, read every tick so a tempo or loop edit is followed.
   */
  constructor ({ now, transport }) {
    if (typeof now !== 'function' || typeof transport !== 'function') throw new Error('ReelClock needs now and transport')
    this.#now = now
    this.#transport = transport
  }

  get running () { return this.#origin !== null }

  /** Start at the clock time the transport's beat zero is heard, as Scheduler.start does. */
  start (atTime) {
    this.#origin = atTime
    this.#until = 0
  }

  stop () {
    this.#origin = null
  }

  /**
   * Fire `fn` once when the transport passes `beat`, on every pass of a loop. Returns a cancel.
   * `fn` is given `{ at }`, the elapsed time of the position that fired it.
   *
   * `since` is an elapsed time to count from instead of the last tick, once. A script that takes over at
   * a bar line is registered a moment after the tick that found the bar line, and its own downbeat is
   * in that tick's window, so it asks to count from there and the downbeat is not lost.
   */
  at (beat, fn, { since = null } = {}) {
    return this.#add({ kind: 'at', beat, fn, since })
  }

  /** Fire `fn` at every multiple of `beats`, starting at beat 0. Returns a cancel. Takes `since` as `at` does. */
  every (beats, fn, { since = null } = {}) {
    if (!(beats > 0)) throw new Error('every needs a length above zero')
    return this.#add({ kind: 'every', beats, fn, since })
  }

  #add (job) {
    job.live = true
    job.order = this.#sequence++
    this.#jobs.push(job)
    return () => { job.live = false; this.#jobs = this.#jobs.filter(j => j.live) }
  }

  /** Fire what the transport has passed since the last tick. Call often; a tick with nothing new does nothing. */
  tick () {
    if (!this.running) return
    const end = this.#now() - this.#origin
    const start = this.#until
    if (end <= start) return
    const transport = this.#transport()
    const earliest = this.#jobs.reduce((m, j) => (j.live && j.since !== null ? Math.min(m, j.since) : m), start)
    const all = [...segments(transport, Math.max(0, earliest), end)]

    const due = []
    for (const job of this.#jobs) {
      if (!job.live) continue
      // A job that asked to count from earlier looks further back, once; the rest see this tick's window.
      const from = job.since !== null ? Math.max(0, Math.min(start, job.since)) : start
      job.since = null
      const passes = from === start ? [...segments(transport, start, end)] : all
      const at = job.kind === 'at' ? this.#lastAt(transport, passes, job.beat, from, end) : this.#lastEvery(transport, passes, job.beats, from, end)
      if (at !== null) due.push({ at, order: job.order, job })
    }
    // Advance first: a firing that edits the transport, or throws, must not make this window fire twice.
    this.#until = end
    due.sort((a, b) => a.at - b.at || a.order - b.order)
    for (const { job, at } of due) {
      if (!job.live) continue // an earlier firing in this tick cancelled it
      try {
        Promise.resolve(job.fn({ at })).catch(() => {})
      } catch { /* a firing that throws is the runner's to report; it does not stop the clock */ }
    }
  }

  /** The latest elapsed time in [start, end) at which the transport reaches `beat`, or null. */
  #lastAt (transport, passes, beat, start, end) {
    const song = transport.secondsAtBeat(beat)
    let found = null
    for (const pass of passes) {
      if (song < pass.lo || song >= pass.hi) continue
      const elapsed = song + pass.shift
      if (elapsed >= start && elapsed < end) found = found === null ? elapsed : Math.max(found, elapsed)
    }
    return found
  }

  /** The latest elapsed time in [start, end) at which the transport reaches a multiple of `period` beats, or null. */
  #lastEvery (transport, passes, period, start, end) {
    let found = null
    for (const pass of passes) {
      const from = Math.max(start, pass.from)
      const to = Math.min(end, pass.to)
      if (!(to > from)) continue
      // Song seconds in this pass, and the beats they span. The same arithmetic at both ends of every window,
      // so a window's end is the next window's start exactly and a multiple falls in one of them and not both.
      const a = from - pass.shift
      const b = to - pass.shift
      const beatA = transport.beatAtSeconds(a)
      const beatB = transport.beatAtSeconds(b)
      let k = Math.ceil(beatA / period)
      if (k * period < beatA) k++
      let last = null
      for (; k * period < beatB; k++) last = k
      if (last === null) continue
      const elapsed = transport.secondsAtBeat(last * period) + pass.shift
      found = found === null ? elapsed : Math.max(found, elapsed)
    }
    return found
  }
}
