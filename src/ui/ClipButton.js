// src/ui/ClipButton.js
//
// One clip on a lane: a button that names itself, is moved and resized by the pointer or the keyboard, and
// draws its waveform. It holds no state of the timeline's. What it needs from there (the scale, the shared
// time view, the selection and the handlers that send a request to the dispatcher) is handed in, the same
// split as Dial.js and Tabs.js.
//
// A drag listens for the move and the release on the document once the pointer is down, not on the button: a
// drag that stops at the button's own edge is the failure CLAUDE.md names.
import { describeClip } from './ClipText.js'
import { attachMenu } from './ContextMenu.js'
import { playedContent, oneMoreRepeat } from '../model/ClipLoop.js'

/**
 * `ppb()` is the current pixels per beat, a function because zoom changes it. The handlers are Timeline's own
 * (see createTimeline): onMove, onResize, onOpen, onRemove, onSplit, onDuplicate, onMute, onCopy, onCut, onPaste,
 * onLock and onTrim. `menu` is the page's context menu (ContextMenu.js), or null for none.
 *
 * A MIDI clip can be repeated to fill more time (`onRepeat(clipId, lengthBeats)`, src/model/ClipLoop.js): by dragging the loop handle
 * at its top right, by R (one more pattern), and from the menu, which can also stop the repeating (`onStopRepeat(clipId)`). Without
 * `onRepeat` there is none of it. A locked clip has no loop handle, since it would only be refused.
 */
export function createClipButton (document, { ppb, view, selection, onMove, onResize, onOpen, onRemove, onSplit, onDuplicate, onMute, onCopy, onCut, onPaste, onLock, onTrim, onRepeat = null, onStopRepeat = null, menu = null }) {
  function clipButton (clip, { beatsPerBar, playsIntoNothing, peaks, problem, color = null }) {
    const button = document.createElement('button')
    button.type = 'button'
    button.id = `clip-${clip.id}`
    button.className = `clip clip-${clip.kind}${playsIntoNothing ? ' clip-orphan' : ''}${clip.muted ? ' clip-muted' : ''}${clip.locked ? ' clip-locked' : ''}`
    button.style.left = `${clip.startBeat * ppb()}px`
    button.style.width = `${clip.lengthBeats * ppb()}px`
    const description = describeClip(clip, { beatsPerBar, playsIntoNothing, color }) + (problem ? `, cannot play: ${problem}` : '')
    button.setAttribute('aria-label', description)
    button.title = description
    // Shown as well as said: a clip that plays into nothing, or cannot play,
    // is marked in text, not only by a colour.
    button.textContent = clip.kind === 'midi' ? `${clip.notes.length}♪${playsIntoNothing ? ' !' : ''}` : `∿${problem ? ' !' : ''}`
    if (problem) button.classList.add('clip-orphan')
    // The colour is a person's mark, said in the spoken name too, never the only thing telling clips apart.
    if (color) { button.classList.add('clip-colored'); button.style.setProperty('--clip-color', color) }
    // Said in the label as well as faded, so it is not colour or opacity alone.
    if (clip.muted) button.textContent = `\u2298 ${button.textContent}`
    if (clip.locked) button.textContent = `\u25A3 ${button.textContent}`
    // Where the pattern comes round again, as a line, so a repeated clip reads as repeats and not as one long clip.
    if (clip.kind === 'midi' && clip.loopBeats && clip.loopBeats < clip.lengthBeats) {
      const every = clip.loopBeats * ppb()
      button.classList.add('clip-looped')
      button.style.backgroundImage = `repeating-linear-gradient(to right, transparent 0, transparent ${every - 1}px, var(--loop-line) ${every - 1}px, var(--loop-line) ${every}px)`
    }
    if (peaks) button.append(waveform(peaks))
    else if (clip.kind === 'midi' && clip.notes.length > 0) button.append(noteGlyph(clip))

    button.addEventListener('keydown', event => {
      const direction = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0
      if (direction !== 0) {
        event.preventDefault()
        // One grid step, or a beat when snapping is off: an arrow key that moved
        // by nothing would do nothing.
        const step = direction * (view.step(beatsPerBar) ?? 1)
        if (event.shiftKey) {
          const length = clip.lengthBeats + step
          if (length > 0) onResize(clip.id, length)
        } else {
          const start = clip.startBeat + step
          if (start >= 0) onMove(clip.id, start)
        }
      } else if (event.key === ' ' && !event.ctrlKey && !event.metaKey && !event.altKey) {
        // Space adds the clip to the selection or takes it out, as Ctrl with a click does; Enter still opens it. Prevented, so the browser's own
        // press of the button, which would select and open it, does not follow.
        event.preventDefault()
        selection.toggle('clip', clip.id)
      } else if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault()
        onRemove(clip.id)
      } else if (!event.ctrlKey && !event.metaKey && !event.altKey && event.key.toLowerCase() === 's') {
        event.preventDefault()
        onSplit(clip.id)
      } else if (!event.ctrlKey && !event.metaKey && !event.altKey && event.key.toLowerCase() === 'd') {
        event.preventDefault()
        onDuplicate(clip.id)
      } else if (!event.ctrlKey && !event.metaKey && !event.altKey && event.key.toLowerCase() === 'm') {
        event.preventDefault()
        onMute(clip.id, !clip.muted)
      } else if ((event.ctrlKey || event.metaKey) && !event.altKey && ['c', 'x', 'v'].includes(event.key.toLowerCase())) {
        event.preventDefault()
        const which = event.key.toLowerCase()
        if (which === 'c') onCopy(clip.id)
        else if (which === 'x') onCut(clip.id)
        else onPaste(clip.id)
      } else if (onRepeat && clip.kind === 'midi' && !event.ctrlKey && !event.metaKey && !event.altKey && event.key.toLowerCase() === 'r') {
        event.preventDefault()
        onRepeat(clip.id, oneMoreRepeat(clip))
      } else if (!event.ctrlKey && !event.metaKey && !event.altKey && event.key.toLowerCase() === 'l') {
        event.preventDefault()
        onLock(clip.id, !clip.locked)
      } else if (!event.ctrlKey && !event.metaKey && !event.altKey && (event.key === '[' || event.key === ']')) {
        event.preventDefault()
        onTrim(clip.id, event.key === '[' ? 'start' : 'end')
      }
    })
    button.addEventListener('click', event => {
      if (dragged) return
      // Shift or Ctrl adds to the selection; a plain click selects and opens.
      if (event.shiftKey || event.ctrlKey || event.metaKey) { selection.toggle('clip', clip.id); return }
      selection.set('clip', [clip.id])
      onOpen(clip.id)
    })
    // Right click, or the Menu key: the same actions the keys above make. A clip not yet selected is selected first, as the
    // menu acts on what is selected. A locked clip is protected from being cut, split, trimmed or deleted, so those are left out.
    if (menu) {
      attachMenu(button, menu, () => {
        if (!selection.has('clip', clip.id)) selection.set('clip', [clip.id])
        const editable = !clip.locked
        return [
          { label: clip.kind === 'midi' ? 'Open in the piano roll' : 'Select', run: () => onOpen(clip.id) },
          '-',
          ...(editable ? [{ label: 'Split at the playhead', hint: 'S', run: () => onSplit(clip.id) }] : []),
          { label: 'Duplicate', hint: 'D', run: () => onDuplicate(clip.id) },
          '-',
          { label: 'Copy', hint: 'Ctrl+C', run: () => onCopy(clip.id) },
          ...(editable ? [{ label: 'Cut', hint: 'Ctrl+X', run: () => onCut(clip.id) }] : []),
          { label: 'Paste at the playhead', hint: 'Ctrl+V', run: () => onPaste(clip.id) },
          '-',
          ...(onRepeat && clip.kind === 'midi' && editable
            ? [{ label: 'Repeat once more', hint: 'R', run: () => onRepeat(clip.id, oneMoreRepeat(clip)) },
                ...(onStopRepeat && clip.loopBeats ? [{ label: 'Stop repeating', run: () => onStopRepeat(clip.id) }] : []),
                '-']
            : []),
          { label: 'Mute', hint: 'M', checked: Boolean(clip.muted), run: () => onMute(clip.id, !clip.muted) },
          { label: 'Lock', hint: 'L', checked: Boolean(clip.locked), run: () => onLock(clip.id, !clip.locked) },
          ...(editable
            ? ['-',
                { label: 'Trim the start to the playhead', hint: '[', run: () => onTrim(clip.id, 'start') },
                { label: 'Trim the end to the playhead', hint: ']', run: () => onTrim(clip.id, 'end') },
                '-',
                { label: 'Delete', hint: 'Delete', danger: true, run: () => onRemove(clip.id) }]
            : [])
        ]
      })
    }
    const selected = selection.has('clip', clip.id)
    button.classList.toggle('selected', selected)
    button.setAttribute('aria-current', String(selected))

    const handle = document.createElement('span')
    handle.className = 'clip-resize'
    handle.setAttribute('aria-hidden', 'true')
    button.append(handle)
    // The corner that repeats the clip. Drawn only where it can act, and not read: R and the menu do the same for a keyboard.
    let loopHandle = null
    if (onRepeat && clip.kind === 'midi' && !clip.locked) {
      loopHandle = document.createElement('span')
      loopHandle.className = 'clip-loop'
      loopHandle.setAttribute('aria-hidden', 'true')
      loopHandle.textContent = '\u21BB'
      button.append(loopHandle)
    }

    let dragged = false
    button.addEventListener('pointerdown', event => {
      if (event.button !== 0) return
      const repeating = loopHandle !== null && event.target === loopHandle
      const resizing = event.target === handle || repeating
      const originX = event.clientX
      dragged = false
      // Where the clip's edge lands: the pointer's movement in beats, on the
      // grid unless Alt is held. `min` is the shortest a clip may be.
      const step = view.step(beatsPerBar)
      const min = step ?? 0.25
      const target = e => {
        const at = (resizing ? clip.startBeat + clip.lengthBeats : clip.startBeat) + (e.clientX - originX) / ppb()
        return view.snap(at, beatsPerBar, { bypass: e.altKey })
      }
      const place = e => (resizing
        ? { length: Math.max(min, target(e) - clip.startBeat) }
        : { start: Math.max(0, target(e)) })
      const move = e => {
        const to = place(e)
        // A drag only once the clip has actually moved, so a click with a little jitter still opens it.
        if (resizing ? to.length !== clip.lengthBeats : to.start !== clip.startBeat) dragged = true
        // Shown while dragging; sent once, on release.
        if (resizing) button.style.width = `${to.length * ppb()}px`
        else button.style.left = `${to.start * ppb()}px`
      }
      const up = e => {
        const to = place(e)
        if (repeating) { if (to.length !== clip.lengthBeats) onRepeat(clip.id, to.length) } else if (resizing) { if (to.length !== clip.lengthBeats) onResize(clip.id, to.length) } else if (to.start !== clip.startBeat) onMove(clip.id, to.start)
      }
      // Escape during a drag puts the clip back and sends nothing.
      const stop = () => {
        document.removeEventListener('pointermove', move)
        document.removeEventListener('pointerup', release)
        document.removeEventListener('keydown', cancel)
      }
      function release (e) { stop(); up(e) }
      function cancel (e) {
        if (e.key !== 'Escape') return
        e.preventDefault()
        stop()
        dragged = true
        button.style.left = `${clip.startBeat * ppb()}px`
        button.style.width = `${clip.lengthBeats * ppb()}px`
      }
      document.addEventListener('pointermove', move)
      document.addEventListener('pointerup', release)
      document.addEventListener('keydown', cancel)
    })
    return button
  }

  /** A waveform, drawn and not read: the clip's own label says what it is. */
  function waveform (peaks) {
    const ns = 'http://www.w3.org/2000/svg'
    const svg = document.createElementNS(ns, 'svg')
    svg.setAttribute('class', 'clip-wave')
    svg.setAttribute('aria-hidden', 'true')
    svg.setAttribute('viewBox', `0 -1 ${peaks.length} 2`)
    svg.setAttribute('preserveAspectRatio', 'none')
    const path = document.createElementNS(ns, 'path')
    let d = ''
    for (let i = 0; i < peaks.length; i++) d += `M${i + 0.5} ${-peaks[i]}V${peaks[i]}`
    path.setAttribute('d', d)
    svg.append(path)
    return svg
  }

  /**
   * The notes as short lines, time across and pitch up, scaled to the clip's own range so even a one-octave
   * figure fills the height. One path per clip, because a song has thousands of notes; drawn and not read, as
   * the waveform is: the clip's label already gives the note count.
   */
  function noteGlyph (clip) {
    const ns = 'http://www.w3.org/2000/svg'
    const svg = document.createElementNS(ns, 'svg')
    svg.setAttribute('class', 'clip-notes')
    svg.setAttribute('aria-hidden', 'true')
    svg.setAttribute('viewBox', `0 0 ${clip.lengthBeats} 1`)
    svg.setAttribute('preserveAspectRatio', 'none')
    let low = Infinity
    let high = -Infinity
    // What plays, repeats included, so a repeated clip shows its notes coming round and not only the first pattern.
    const { notes } = playedContent(clip)
    for (const n of notes) { low = Math.min(low, n.pitch); high = Math.max(high, n.pitch) }
    const span = high - low
    let d = ''
    for (const n of notes) {
      if (n.startBeat >= clip.lengthBeats) continue
      const y = span === 0 ? 0.5 : Math.round((0.1 + 0.8 * (high - n.pitch) / span) * 1000) / 1000
      d += `M${n.startBeat} ${y}h${Math.min(n.lengthBeats, clip.lengthBeats - n.startBeat)}`
    }
    const path = document.createElementNS(ns, 'path')
    path.setAttribute('d', d)
    svg.append(path)
    return svg
  }

  return clipButton
}
