// src/ui/TimeView.js
//
// The horizontal axis every view of the arrangement shares: how many pixels a
// beat is, where the view starts, and where a drag snaps to. The ruler, the
// lanes, the piano roll and automation all read one of these, so zooming one
// zooms all of them. Beats are the unit throughout, as in the project: the
// tempo map turns beats into seconds and this file never does.

export const MIN_PIXELS_PER_BEAT = 2
export const MAX_PIXELS_PER_BEAT = 240
export const DEFAULT_PIXELS_PER_BEAT = 24

/** Grid choices: a fraction of a beat, or the bar. `off` snaps to nothing. */
export const GRIDS = Object.freeze(['bar', 'beat', '1/2', '1/4', '1/8', 'off'])

export class TimeView {
  #pixelsPerBeat = DEFAULT_PIXELS_PER_BEAT
  #scrollBeat = 0
  #grid = 'beat'
  #listeners = new Set()

  get pixelsPerBeat () { return this.#pixelsPerBeat }
  get scrollBeat () { return this.#scrollBeat }
  get grid () { return this.#grid }

  subscribe (fn) {
    this.#listeners.add(fn)
    return () => this.#listeners.delete(fn)
  }

  /** Pixel offset from the left edge of the view. */
  beatToX (beat) { return (beat - this.#scrollBeat) * this.#pixelsPerBeat }
  xToBeat (x) { return x / this.#pixelsPerBeat + this.#scrollBeat }

  scrollTo (beat) {
    this.#update({ scrollBeat: Math.max(0, finite(beat, 'scroll position')) })
  }

  /** Zoom by a factor, keeping the beat under `anchorX` where it is. */
  zoomBy (factor, anchorX = 0) {
    if (!(factor > 0) || !Number.isFinite(factor)) throw new Error('a zoom factor must be above zero')
    const anchorBeat = this.xToBeat(anchorX)
    const pixelsPerBeat = clamp(this.#pixelsPerBeat * factor, MIN_PIXELS_PER_BEAT, MAX_PIXELS_PER_BEAT)
    this.#update({ pixelsPerBeat, scrollBeat: Math.max(0, anchorBeat - anchorX / pixelsPerBeat) })
  }

  /** Show `lengthBeats` across `widthPx`, from the start. */
  fit (lengthBeats, widthPx) {
    if (!(lengthBeats > 0) || !(widthPx > 0)) throw new Error('fit needs a length and a width above zero')
    this.#update({ pixelsPerBeat: clamp(widthPx / lengthBeats, MIN_PIXELS_PER_BEAT, MAX_PIXELS_PER_BEAT), scrollBeat: 0 })
  }

  setGrid (grid) {
    if (!GRIDS.includes(grid)) throw new Error(`no such grid: ${grid}; one of ${GRIDS.join(', ')}`)
    this.#update({ grid })
  }

  /** The grid step in beats, or null when snapping is off. */
  step (beatsPerBar) {
    switch (this.#grid) {
      case 'bar': return beatsPerBar
      case 'beat': return 1
      case '1/2': return 1 / 2
      case '1/4': return 1 / 4
      case '1/8': return 1 / 8
      default: return null
    }
  }

  /** Nearest grid line, never before zero. `bypass` is the modifier key held. */
  snap (beat, beatsPerBar, { bypass = false } = {}) {
    const step = bypass ? null : this.step(beatsPerBar)
    const snapped = step === null ? beat : Math.round(beat / step) * step
    return Math.max(0, snapped)
  }

  #update (next) {
    const before = [this.#pixelsPerBeat, this.#scrollBeat, this.#grid]
    if ('pixelsPerBeat' in next) this.#pixelsPerBeat = next.pixelsPerBeat
    if ('scrollBeat' in next) this.#scrollBeat = next.scrollBeat
    if ('grid' in next) this.#grid = next.grid
    if (before[0] === this.#pixelsPerBeat && before[1] === this.#scrollBeat && before[2] === this.#grid) return
    for (const fn of [...this.#listeners]) fn(this)
  }
}

function clamp (n, lo, hi) { return Math.min(hi, Math.max(lo, n)) }
function finite (n, what) {
  if (!Number.isFinite(n)) throw new Error(`${what} must be a finite number`)
  return n
}
