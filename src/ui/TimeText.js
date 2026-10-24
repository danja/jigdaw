// src/ui/TimeText.js
//
// The transport's clock as a person reads it: minutes, seconds and tenths, from the seconds the tempo map gives for the position.
// A pure function, so what the readout says is tested without a page.

/** `0:00.0` for a position in seconds; anything that is not a number of seconds at or after zero reads as zero, never as NaN. */
export function formatClock (seconds) {
  const safe = Number.isFinite(seconds) && seconds > 0 ? seconds : 0
  const tenths = Math.floor(safe * 10 + 1e-9)
  const minutes = Math.floor(tenths / 600)
  const rest = tenths - minutes * 600
  const whole = Math.floor(rest / 10)
  return `${minutes}:${String(whole).padStart(2, '0')}.${rest % 10}`
}
