// src/ui/RollPointer.js
//
// The piano roll's pointer: a press on an empty square draws a note, on a note moves it (or resizes it from its last square), a second press soon after
// removes it, and Shift with a press chooses a note or starts a rubber band. A gesture listens for its moves and its release on the document once it
// has begun, not on the grid, so a drag that leaves the grid still ends. What is dragged is drawn as a preview and sent once, on release. The roll
// keeps the clip, the cursor and the choice; they are lent here as `g`, with the roll's own functions for drawing, speaking, sending and removing.
//
//   g.clip(), g.options()                      the open clip, and `{ beatsPerBar }`
//   g.cursor, g.preview, g.band, g.abandon     the roll's state, read and set here
//   g.chosen                                   the Set of note keys chosen, changed in place or replaced
import { barBeat } from './Timeline.js'
import { STEPS_PER_BEAT, spokenName, keyOf, beats, noteAt } from './RollNotes.js'

const same = (a, b) => a.startBeat === b.startBeat && a.pitch === b.pitch
const beatOf = step => step / STEPS_PER_BEAT

export function attachRollPointer (grid, { document, g, now, onAudition, snap, draw, say, send, remove, toggleChosen, where }) {
  // The last press on a note, for telling a double click.
  let lastPress = null

  const cellOf = target => {
    const cell = target?.closest?.('[data-step]')
    return cell ? { pitch: Number(cell.dataset.pitch), step: Number(cell.dataset.step) } : null
  }

  /** What a drag of `kind` from `from` to `to` makes of the notes, or null for no change. */
  function dragged (kind, from, to, note) {
    if (kind === 'draw') {
      const first = Math.min(from.step, to.step)
      const last = Math.max(from.step, to.step)
      // A click alone is a beat; a drag is exactly as long as the drag.
      const lengthBeats = first === last ? 1 : beatOf(last - first + 1)
      return [...g.clip().notes, { startBeat: beatOf(first), lengthBeats, pitch: snap(from.pitch), velocity: 100 }]
    }
    if (kind === 'move') {
      const pitch = snap(Math.max(0, Math.min(127, note.pitch + to.pitch - from.pitch)))
      const startBeat = Math.max(0, note.startBeat + beatOf(to.step - from.step))
      if (pitch === note.pitch && startBeat === note.startBeat) return null
      return g.clip().notes.map(n => (same(n, note) ? { ...n, pitch, startBeat } : n))
    }
    // resize
    const lengthBeats = Math.max(beatOf(1), beatOf(to.step + 1) - note.startBeat)
    if (lengthBeats === note.lengthBeats) return null
    return g.clip().notes.map(n => (same(n, note) ? { ...n, lengthBeats } : n))
  }

  /** Follow a rubber band from `from`, and choose the notes it touches on release. */
  function startBand (from) {
    g.band = { from, to: from }
    draw()
    const over = e => {
      const at = cellOf(e.target)
      if (!at || (at.pitch === g.band.to.pitch && at.step === g.band.to.step)) return
      g.band = { from, to: at }
      draw()
    }
    const release = () => {
      grid.removeEventListener('pointerover', over)
      document.removeEventListener('pointerup', up)
      document.removeEventListener('pointercancel', cancel)
      g.abandon = null
    }
    const cancel = () => { release(); g.band = null; draw() }
    g.abandon = cancel
    const up = () => {
      release()
      const { from: a, to: b } = g.band
      g.band = null
      const low = Math.min(a.pitch, b.pitch)
      const high = Math.max(a.pitch, b.pitch)
      const first = beatOf(Math.min(a.step, b.step))
      const last = beatOf(Math.max(a.step, b.step) + 1)
      // A note is touched when any part of it is inside the band.
      g.chosen = new Set(g.clip().notes.filter(n => n.pitch >= low && n.pitch <= high && n.startBeat < last && n.startBeat + n.lengthBeats > first).map(keyOf))
      draw()
      say(`${g.chosen.size} note${g.chosen.size === 1 ? '' : 's'} chosen`)
    }
    grid.addEventListener('pointerover', over)
    document.addEventListener('pointerup', up)
    document.addEventListener('pointercancel', cancel)
  }

  grid.addEventListener('pointerdown', event => {
    if (!g.clip() || event.button !== 0) return
    const from = cellOf(event.target)
    if (!from) return
    event.preventDefault()
    g.abandon?.()
    const note = noteAt(g.clip().notes, from.pitch, beatOf(from.step))
    if (note && event.shiftKey) {
      g.cursor = { pitch: note.pitch, step: Math.round(note.startBeat * STEPS_PER_BEAT) }
      toggleChosen(note)
      document.getElementById(`roll-${g.cursor.pitch}-${g.cursor.step}`)?.focus({ preventScroll: true })
      return
    }
    if (!note && event.shiftKey) { startBand(from); return }
    const at = now()

    // A second press on the same note, soon after the first, removes it.
    if (note && lastPress && same(lastPress.note, note) && at - lastPress.at < 400) {
      lastPress = null
      remove(note)
      return
    }
    lastPress = note ? { note, at } : null

    // The last square of a note longer than one step is its handle.
    const lastStep = note ? Math.round((note.startBeat + note.lengthBeats) * STEPS_PER_BEAT) - 1 : null
    const kind = !note ? 'draw' : from.step === lastStep && note.lengthBeats > beatOf(1) ? 'resize' : 'move'
    g.cursor = note ? { pitch: note.pitch, step: Math.round(note.startBeat * STEPS_PER_BEAT) } : { ...from }
    if (note) onAudition(note.pitch, note.velocity)
    g.preview = kind === 'draw' ? dragged('draw', from, from) : null
    draw()
    document.getElementById(`roll-${g.cursor.pitch}-${g.cursor.step}`)?.focus({ preventScroll: true })

    let to = from
    const over = e => {
      const at = cellOf(e.target)
      if (!at || (at.pitch === to.pitch && at.step === to.step)) return
      // A drawn note stays on the row it started on; only its length follows.
      to = kind === 'draw' ? { pitch: from.pitch, step: at.step } : at
      const next = dragged(kind, from, to, note)
      if (kind === 'move' && next && to.pitch !== from.pitch) onAudition(Math.max(0, Math.min(127, note.pitch + to.pitch - from.pitch)), note.velocity)
      g.preview = next
      draw()
    }
    const release = () => {
      grid.removeEventListener('pointerover', over)
      document.removeEventListener('pointerup', up)
      document.removeEventListener('pointercancel', cancel)
      g.abandon = null
    }
    const cancel = () => { release(); g.preview = null; draw() }
    g.abandon = cancel
    const up = () => {
      release()
      const next = dragged(kind, from, to, note)
      g.preview = null
      if (kind === 'draw') {
        const made = next.at(-1)
        onAudition(made.pitch, made.velocity)
        send(next, `Added ${spokenName(made.pitch)} at ${where(Math.min(from.step, to.step))}, ${beats(made.lengthBeats)}`)
      } else if (next) {
        const changed = next.find(n => !g.clip().notes.some(o => same(o, n) && o.lengthBeats === n.lengthBeats))
        // A chosen note that is moved is still the chosen note.
        if (kind === 'move' && g.chosen.delete(keyOf(note))) g.chosen.add(keyOf(changed))
        send(next, kind === 'move'
          ? `Moved to ${spokenName(changed.pitch)} at ${barBeat(changed.startBeat, g.options().beatsPerBar)}`
          : `Length ${beats(changed.lengthBeats)}`)
      } else {
        draw()
        say(`Selected ${spokenName(note.pitch)} at ${barBeat(note.startBeat, g.options().beatsPerBar)}, ${beats(note.lengthBeats)}`)
      }
    }
    grid.addEventListener('pointerover', over)
    document.addEventListener('pointerup', up)
    document.addEventListener('pointercancel', cancel)
  })
}
