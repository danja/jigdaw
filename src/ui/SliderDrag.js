// src/ui/SliderDrag.js
//
// A drag on a native range input that survives the input being taken out of the page and put back.
//
// web/app.js redraws the rack on every edit, and a parameter change is an edit, so the slider a person is dragging is
// detached and re-attached after the first input event. The browser ends a native drag when its element is removed, and the
// drag stops one step in. A generated dial does not have this problem because it listens on the document (src/ui/Dial.js,
// attachDrag), and this does the same for a slider: the move and the release are heard on the document, and the value is
// worked out from where the pointer is over the input as it is then. The keyboard stays the input's own.
//
// Found in Chrome, with a real drag, after every unit test had passed: a DOM with no layout has no native drag to cancel.

// The thumb is about this wide, so the track runs from half of it in to half of it short of the other end.
const THUMB = 16

/**
 * @param {HTMLInputElement} input a range input, already given its min, max and step
 * @param {{ minimum: number, maximum: number }} port
 */
export function attachSliderDrag (input, port) {
  const owner = input.ownerDocument
  const Event = owner.defaultView?.Event
  if (!Event) return

  const span = port.maximum - port.minimum
  const step = Number(input.step) > 0 ? Number(input.step) : span / 200
  let grab = null

  const valueAt = x => {
    const box = input.getBoundingClientRect()
    const room = box.width - THUMB
    if (!(room > 0)) return null
    const fraction = Math.min(1, Math.max(0, (x - box.left - THUMB / 2) / room))
    const raw = port.minimum + fraction * span
    return Math.min(port.maximum, Math.max(port.minimum, port.minimum + Math.round((raw - port.minimum) / step) * step))
  }

  const move = event => {
    if (!grab) return
    const next = valueAt(event.clientX + grab.offset)
    if (next === null || Number(input.value) === next) return
    input.value = String(next)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  }

  const end = () => {
    if (!grab) return
    grab = null
    owner.removeEventListener('pointermove', move)
    owner.removeEventListener('pointerup', end)
    owner.removeEventListener('pointercancel', end)
  }

  input.addEventListener('pointerdown', event => {
    if (event.button !== undefined && event.button !== 0) return
    const box = input.getBoundingClientRect()
    const room = box.width - THUMB
    if (!(room > 0)) return
    // Grabbing the thumb keeps it under the pointer instead of jumping its centre there; a press elsewhere on the track
    // moves the thumb to the press, as the native control does.
    const centre = box.left + THUMB / 2 + ((Number(input.value) - port.minimum) / span) * room
    const onThumb = Math.abs(event.clientX - centre) <= THUMB
    grab = { offset: onThumb ? centre - event.clientX : 0 }
    // The native drag is ours now, so the press does not focus the input by itself.
    input.focus?.({ preventScroll: true })
    event.preventDefault?.()
    owner.addEventListener('pointermove', move)
    owner.addEventListener('pointerup', end)
    owner.addEventListener('pointercancel', end)
    move(event)
  })
}
