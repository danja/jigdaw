// src/ui/LaneResize.js
//
// The grip along the bottom edge of a lane: drag it down or up and the lane is that tall, as in other DAWs, where the other way is to choose a size
// from the track's editor. A lane has four sizes (src/model/EditorState.js) and a drag makes a height of its own between them, kept as editor metadata.
//
// A pointer way and not the only way: plus and minus on the track's name, and the lane menu, still make it one size taller or shorter, which also puts
// a dragged height away, so the grip is hidden from assistive technology and has no stop in the tab order. The move and the release are listened for on
// the document once the pointer is down, so a drag that leaves the lane still ends where it is let go. Escape puts the lane back and sends nothing.
import { MIN_LANE_HEIGHT, MAX_LANE_HEIGHT } from '../model/EditorState.js'

/** `height` held to what a lane may be, as a whole number of pixels. */
export const clampHeight = height => Math.min(MAX_LANE_HEIGHT, Math.max(MIN_LANE_HEIGHT, Math.round(height)))

/**
 * `lane` is the element whose minimum height is the lane's height. `onCommit(height)` is called once, on release, with the height the lane was
 * dragged to; `onReset()` when the grip is double clicked, to give the lane back the height of its size. Returns the grip, to be put in the lane.
 */
export function createLaneResize (document, { lane, onCommit, onReset }) {
  const grip = document.createElement('div')
  grip.className = 'lane-resize'
  grip.setAttribute('aria-hidden', 'true')
  grip.title = 'Drag to change the height of this lane. Double click to put it back.'

  grip.addEventListener('pointerdown', event => {
    if (event.button !== 0) return
    event.preventDefault()
    // Not a click on the lane behind it, which would select or add a clip.
    event.stopPropagation()
    const startY = event.clientY
    const before = lane.style.minHeight
    const startHeight = lane.getBoundingClientRect().height
    let height = startHeight
    const move = e => {
      height = clampHeight(startHeight + (e.clientY - startY))
      lane.style.minHeight = `${height}px`
    }
    const stop = () => {
      document.removeEventListener('pointermove', move)
      document.removeEventListener('pointerup', release)
      document.removeEventListener('pointercancel', cancel)
      document.removeEventListener('keydown', escape)
    }
    function release () {
      stop()
      if (Math.round(height) !== Math.round(startHeight)) onCommit(height)
      else lane.style.minHeight = before
    }
    function cancel () { stop(); lane.style.minHeight = before }
    function escape (e) {
      if (e.key !== 'Escape') return
      e.preventDefault()
      cancel()
    }
    document.addEventListener('pointermove', move)
    document.addEventListener('pointerup', release)
    document.addEventListener('pointercancel', cancel)
    document.addEventListener('keydown', escape)
  })
  grip.addEventListener('dblclick', event => { event.stopPropagation(); onReset() })
  return grip
}
