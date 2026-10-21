// src/ui/Ruler.js
//
// The bar numbers above the lanes. It is for the eye only (aria-hidden): the Go to
// bar field and the position readout say the same in words. A click on it cues or
// moves the playhead there. Not a drag, because the loop brace beneath has its own.

export function createRuler (document, { ppb, onSeek = null, snapBeat }) {
  // Kept for as long as the timeline is, and rewritten in place on a redraw.
  const element = document.createElement('div')
  element.className = 'timeline-ruler'
  element.setAttribute('aria-hidden', 'true')
  element.addEventListener('click', e => {
    if (!onSeek) return
    onSeek(Math.max(0, snapBeat((e.clientX - element.getBoundingClientRect().left) / ppb(), e)))
  })

  return {
    element,
    draw ({ bars, beatsPerBar, width }) {
      element.replaceChildren()
      element.style.width = `${width}px`
      // A label every few bars once a bar is too narrow to hold one, so zoomed out
      // the numbers stay readable rather than running together.
      const every = Math.max(1, Math.ceil(40 / (beatsPerBar * ppb())))
      for (let bar = 0; bar < bars; bar += every) {
        const mark = document.createElement('span')
        mark.style.left = `${bar * beatsPerBar * ppb()}px`
        mark.textContent = String(bar + 1)
        element.append(mark)
      }
      if (ppb() >= 12) {
        for (let beat = 0; beat < bars * beatsPerBar; beat++) {
          if (beat % beatsPerBar === 0) continue
          const tick = document.createElement('i')
          tick.style.left = `${beat * ppb()}px`
          element.append(tick)
        }
      }
    }
  }
}
