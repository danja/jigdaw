// src/ui/MeterModel.js
//
// What a level meter shows, as arithmetic a test can check: how many bars are lit for a peak, the number
// beside them, and a peak that is held for a moment so the eye can read it. Pure: it is handed a peak and
// a time and touches nothing.
//
// Bars run on a decibel scale, because loudness is heard in decibels. On a linear one a mix 30 dB down
// lights almost nothing and a quiet track looks silent.

/** The level, in decibels, at which the first bar lights. Below it a meter shows nothing. */
export const FLOOR_DB = -48

/** A peak (linear, 0 to 1 and above) as decibels, minus infinity for silence. */
export function peakDb (peak) {
  return peak > 0 ? 20 * Math.log10(peak) : -Infinity
}

/** How many of `bars` are lit for a peak. Full scale lights all of them, and a peak above it no more. */
export function litBars (peak, bars, { floorDb = FLOOR_DB } = {}) {
  if (!(bars > 0)) throw new Error(`a meter has at least one bar: ${bars}`)
  if (!(floorDb < 0)) throw new Error(`a meter's floor is below 0 dB: ${floorDb}`)
  const db = peakDb(peak)
  if (!(db > floorDb)) return 0
  return Math.min(bars, Math.max(1, Math.round(((db - floorDb) / -floorDb) * bars)))
}

/** The number beside the bars, in the words a person reads: "-12.3 dB", "-inf dB", "+1.6 dB". */
export function readout (peak) {
  const db = peakDb(peak)
  if (db === -Infinity) return '-inf dB'
  return `${db > 0 ? '+' : ''}${db.toFixed(1)} dB`
}

/**
 * A peak held for `holdMs` after it was seen, then released to what is there now. `update(peak, nowMs)`
 * returns the figure to show.
 */
export function createPeakHold ({ holdMs = 1500 } = {}) {
  if (!(holdMs >= 0)) throw new Error(`a hold time is zero or more milliseconds: ${holdMs}`)
  let held = 0
  let heldAt = -Infinity
  return {
    update (peak, nowMs) {
      if (peak >= held || nowMs - heldAt > holdMs) {
        held = peak
        heldAt = nowMs
      }
      return held
    }
  }
}
