// src/ui/Meter.js
//
// A level meter: bars for the level now and, beside them, the peak of the last moment in decibels as
// text. The bars are for the eye and are hidden from assistive technology, since a stream of lit and
// unlit shapes says nothing; the number is the information, and it is not announced either, because a
// figure that changes sixty times a second would drown everything else. Nothing here is live. A person
// who wants the level reads the number where they are, and a clip is said by a Clip button, which stays until pressed.
import { litBars, readout, createPeakHold } from './MeterModel.js'
import { createClipHold } from './ClipHold.js'

/**
 * `label` names what is measured, for the group's name. `set(peak, nowMs)` is called once per frame with
 * the largest absolute sample since the last call; the DOM is touched only when what it shows changes.
 */
export function createMeter (document, { label, bars = 12 } = {}) {
  if (!label) throw new Error('createMeter needs a label')
  const element = document.createElement('div')
  element.className = 'meter-group'
  element.setAttribute('role', 'group')
  element.setAttribute('aria-label', `Level of ${label}`)

  const strip = document.createElement('span')
  strip.className = 'meter'
  strip.setAttribute('aria-hidden', 'true')
  const cells = Array.from({ length: bars }, () => document.createElement('i'))
  strip.append(...cells)

  const number = document.createElement('span')
  number.className = 'meter-readout'
  number.textContent = readout(0)

  // Held until pressed, as the transport bar's is, and drawn only while there is something to clear (a control
  // nobody can use is left out, not shown disabled).
  const clipHold = createClipHold()
  const clip = document.createElement('button')
  clip.type = 'button'
  clip.className = 'meter-clip'
  clip.textContent = 'Clip'
  clip.hidden = true
  clip.setAttribute('aria-label', `${label} clipped. Press to clear`)
  clip.addEventListener('click', () => { clipHold.clear(); clip.hidden = true })

  element.append(strip, number, clip)
  const hold = createPeakHold()
  let lit = -1
  let shown = number.textContent

  return {
    element,
    set (peak, nowMs) {
      const count = litBars(peak, bars)
      if (count !== lit) {
        lit = count
        // The top two are the hot ones, as on the transport bar's meter.
        cells.forEach((cell, i) => { cell.className = i < count ? (i >= bars - 2 ? 'hot' : 'on') : '' })
      }
      if (clipHold.update(peak) && clip.hidden) clip.hidden = false
      const text = readout(hold.update(peak, nowMs))
      if (text !== shown) { shown = text; number.textContent = text }
    }
  }
}
