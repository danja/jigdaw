// src/ui/LoopRow.js
//
// The loop under the ruler: a brace with a handle at each end, and the row a drag on
// draws a new loop in. It sends one range through `onSetLoop` and never edits the model.

import { barBeat } from './ClipText.js'

export function createLoopRow (document, { view, bpb, onSetLoop, snapBeat }) {
  const ppb = () => view.pixelsPerBeat
  const loopRow = document.createElement('div')
  loopRow.className = 'timeline-loop'
  loopRow.setAttribute('role', 'group')
  const brace = document.createElement('div')
  brace.className = 'loop-brace'
  brace.setAttribute('aria-hidden', 'true')
  const braceText = document.createElement('span')
  brace.append(braceText)
  const handle = edge => {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = `loop-handle loop-${edge}`
    button.id = `loop-${edge}`
    return button
  }
  const startHandle = handle('start')
  const endHandle = handle('end')
  loopRow.append(brace, startHandle, endHandle)
  let loopNow = { start: 0, end: 0, enabled: false }

  const minLoop = () => view.step(bpb()) ?? 0.25
  const x = e => e.clientX - loopRow.getBoundingClientRect().left

  function drawLoop (loop, width) {
    loopNow = loop ?? { start: 0, end: 0, enabled: false }
    const set = loopNow.end > loopNow.start
    loopRow.style.width = `${width}px`
    loopRow.setAttribute('aria-label', set ? `Loop, ${loopNow.enabled ? 'on' : 'off'}` : 'Loop, not set')
    brace.hidden = !set
    startHandle.hidden = !set
    endHandle.hidden = !set
    if (!set) {
      braceText.textContent = ''
      return
    }
    brace.style.left = `${loopNow.start * ppb()}px`
    brace.style.width = `${(loopNow.end - loopNow.start) * ppb()}px`
    brace.classList.toggle('on', loopNow.enabled)
    braceText.textContent = loopNow.enabled ? 'Loop on' : 'Loop off'
    startHandle.style.left = `${loopNow.start * ppb() - 22}px`
    endHandle.style.left = `${loopNow.end * ppb() - 22}px`
    startHandle.setAttribute('aria-label', `Loop start, ${barBeat(loopNow.start, bpb())}. Left and Right move it.`)
    endHandle.setAttribute('aria-label', `Loop end, ${barBeat(loopNow.end, bpb())}. Left and Right move it.`)
  }

  /** Send one range, refusing one that would end at or before its start. */
  function sendLoop (start, end) {
    const lo = Math.max(0, Math.min(start, end))
    const hi = Math.max(start, end)
    if (hi - lo < minLoop() - 1e-9) return
    if (lo === loopNow.start && hi === loopNow.end) return
    onSetLoop({ start: lo, end: hi })
  }

  for (const [edge, button] of [['start', startHandle], ['end', endHandle]]) {
    const other = () => (edge === 'start' ? loopNow.end : loopNow.start)
    const put = beat => (edge === 'start' ? sendLoop(beat, other()) : sendLoop(other(), beat))
    button.addEventListener('keydown', event => {
      const direction = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0
      if (direction === 0) return
      event.preventDefault()
      const step = event.shiftKey ? bpb() : (view.step(bpb()) ?? 1)
      put(Math.max(0, (edge === 'start' ? loopNow.start : loopNow.end) + direction * step))
    })
    button.addEventListener('pointerdown', event => {
      if (event.button !== 0) return
      event.preventDefault()
      event.stopPropagation()
      const from = edge === 'start' ? loopNow.start : loopNow.end
      const originX = event.clientX
      const beatAt = e => snapBeat(from + (e.clientX - originX) / ppb(), e)
      const move = e => {
        // Shown while dragging; sent once, on release.
        const beat = beatAt(e)
        const lo = edge === 'start' ? beat : loopNow.start
        const hi = edge === 'start' ? loopNow.end : beat
        if (hi > lo) {
          brace.style.left = `${lo * ppb()}px`
          brace.style.width = `${(hi - lo) * ppb()}px`
          button.style.left = `${beat * ppb() - 22}px`
        }
      }
      const up = e => {
        document.removeEventListener('pointermove', move)
        document.removeEventListener('pointerup', up)
        put(beatAt(e))
        drawLoop(loopNow, parseFloat(loopRow.style.width))
      }
      document.addEventListener('pointermove', move)
      document.addEventListener('pointerup', up)
    })
  }

  // A drag on the empty row draws a loop.
  loopRow.addEventListener('pointerdown', event => {
    if (event.button !== 0 || event.target !== loopRow) return
    event.preventDefault()
    const from = snapBeat(x(event) / ppb(), event)
    const move = e => {
      const to = snapBeat(x(e) / ppb(), e)
      brace.hidden = false
      brace.classList.remove('on')
      brace.style.left = `${Math.min(from, to) * ppb()}px`
      brace.style.width = `${Math.abs(to - from) * ppb()}px`
    }
    const up = e => {
      document.removeEventListener('pointermove', move)
      document.removeEventListener('pointerup', up)
      sendLoop(from, snapBeat(x(e) / ppb(), e))
      drawLoop(loopNow, parseFloat(loopRow.style.width))
    }
    document.addEventListener('pointermove', move)
    document.addEventListener('pointerup', up)
  })

  return { element: loopRow, draw: drawLoop }
}
