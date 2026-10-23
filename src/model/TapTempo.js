// src/model/TapTempo.js
//
// A tempo from taps. Each tap is a time in milliseconds; the tempo is the average gap between the last few taps, so one
// uneven tap pulls it a little and not all the way. A pause longer than `maxGapMs` starts a new count, so a person can come
// back and tap again without the silence counting as a very slow beat. Pure: the caller gives the clock.

export function createTapper ({ now, maxGapMs = 2000, taps = 5, min = 20, max = 300 } = {}) {
  if (typeof now !== 'function') throw new Error('a tapper needs a clock, `now`')
  let times = []
  return {
    /** Tap now. Returns the tempo in beats a minute to one decimal place, or null until there are two taps close enough. */
    tap () {
      const at = now()
      if (times.length > 0 && at - times.at(-1) > maxGapMs) times = []
      times.push(at)
      times = times.slice(-taps)
      if (times.length < 2) return null
      const gap = (times.at(-1) - times[0]) / (times.length - 1)
      if (!(gap > 0)) return null
      const bpm = 60000 / gap
      return Math.round(Math.min(max, Math.max(min, bpm)) * 10) / 10
    },
    reset () { times = [] },
    get count () { return times.length }
  }
}
