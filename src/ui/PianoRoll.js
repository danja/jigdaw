// src/ui/PianoRoll.js
//
// A MIDI clip's notes, as a grid of pitch against time.
//
// Built for the keyboard first (CLAUDE.md: keyboard before pointer). The grid
// is one tab stop holding a cursor, a roving tabindex: arrow keys move it,
// Page Up and Page Down move it an octave, Home and End go to either end of
// the clip. Enter or Space adds a note at the cursor, or removes the one
// there, and Delete removes it. Shift with Left or Right makes the note under
// the cursor shorter or longer by a step, and Alt with Up or Down makes it
// quieter or louder.
//
// The pointer does what a piano roll's pointer is expected to. Press on an
// empty square and drag to draw a note as long as the drag; a click alone
// draws one beat. Press on a note to select it and drag to move it, in pitch
// and time; drag its last square to change its length. A double click
// removes it. The press starts on a square, and the move and the release are
// followed from wherever the pointer goes, with the release heard on the
// document: a drag that ended outside the grid would otherwise never finish.
// Nothing is sent until the release, so one drag is one edit and one undo.
//
// Past the end of the clip there is one more bar, dimmed. A note drawn, moved
// or stretched into it makes the clip longer, to the end of the bar it
// reaches, in the same edit.
//
// A note is sounded when it is placed, moved or chosen (`onAudition`), so
// writing one is not silent, and `playhead(beat)` shows where the transport is.
//
// Every cell says what it is: "E4, bar 1 beat 2, note, 1 beat, velocity 100",
// or "E4, bar 1 beat 2.25" where there is none. A note is marked in the cell's
// text as well as its colour, so its state is never colour alone. What an
// edit did is also said in a live region, because a note appearing is
// otherwise silent to a screen reader whose focus did not move.
//
// Every change goes out as the whole list of notes, one edit and one undo,
// and the grid draws again from what comes back.

import { barBeat } from './Timeline.js'

/** Steps per beat: a sixteenth note in 4/4. */
export const STEPS_PER_BEAT = 4
/** How many pitches are shown at once. The cursor scrolls the window. */
export const VISIBLE_PITCHES = 24

const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']

/** C4 is 60. Shown with #, said with "sharp", because a reader says "#" as "number". */
export function noteName (pitch) {
  return `${NAMES[pitch % 12]}${Math.floor(pitch / 12) - 1}`
}
export function spokenName (pitch) {
  return noteName(pitch).replace('#', ' sharp ')
}

const beats = n => `${n} beat${n === 1 ? '' : 's'}`

/** The note sounding at a pitch and a time, if any. */
function noteAt (notes, pitch, beat) {
  return notes.find(n => n.pitch === pitch && n.startBeat <= beat && beat < n.startBeat + n.lengthBeats) ?? null
}

/**
 * Build a piano roll.
 *
 * `onChange(clipId, notes, { lengthBeats })` sends a whole new list of notes,
 * and a new length when the notes have run past the clip's end. `onClose()`
 * is called by its Close button. `onAudition(pitch, velocity)`, if given,
 * sounds a note. Returns `{ element, show, draw, hide, playhead, clipId }`.
 */
export function createPianoRoll (document, { onChange, onClose, onAudition = () => {}, now = () => Date.now() }) {
  if (typeof onChange !== 'function' || typeof onClose !== 'function') {
    throw new Error('createPianoRoll needs onChange and onClose')
  }
  // Always on the page, so it can be found: with no clip open it says how to
  // open one, rather than being absent until somebody already knows it exists.
  const element = document.createElement('section')
  element.className = 'piano-roll'

  const header = document.createElement('header')
  const heading = document.createElement('h3')
  heading.id = 'piano-roll-heading'
  const close = document.createElement('button')
  close.type = 'button'
  close.textContent = 'Close'
  close.addEventListener('click', () => onClose())
  header.append(heading, close)

  const help = document.createElement('p')
  help.className = 'note'
  help.id = 'piano-roll-help'
  help.textContent = 'Click a square for a one-beat note, or drag across to draw it longer. Drag a note to move it, ' +
    'or its last square to change its length. Double-click a note, or press Delete, to remove it. ' +
    'Drawing into the dimmed bar makes the clip longer. Keys: arrows move, Enter adds or removes, ' +
    'Shift with Left or Right changes length, Alt with Up or Down velocity, Page Up and Page Down an octave.'

  const status = document.createElement('p')
  status.className = 'visually-hidden'
  status.setAttribute('role', 'status')
  status.setAttribute('aria-live', 'polite')

  const scroller = document.createElement('div')
  scroller.className = 'piano-roll-scroll'
  const grid = document.createElement('div')
  grid.className = 'piano-roll-grid'
  grid.setAttribute('role', 'grid')
  grid.setAttribute('aria-labelledby', 'piano-roll-heading')
  grid.setAttribute('aria-describedby', 'piano-roll-help')
  const head = document.createElement('div')
  head.className = 'playhead'
  head.setAttribute('aria-hidden', 'true')
  head.hidden = true
  scroller.append(grid)
  const empty = document.createElement('p')
  empty.className = 'note piano-roll-empty'
  empty.textContent = 'No clip is open. Choose Add clip on a track above, or choose a MIDI clip, and its notes appear here to edit.'
  element.append(header, empty, help, scroller, status)

  /** Open or closed: the grid and its controls, or the note saying how to open one. */
  function showOpen (open) {
    empty.hidden = open
    help.hidden = !open
    scroller.hidden = !open
    // Close is left out with nothing to close, not shown disabled.
    close.hidden = !open
    if (!open) heading.textContent = 'Piano roll'
  }
  showOpen(false)

  let clip = null
  let options = null
  let cursor = { pitch: 60, step: 0 }
  let low = 48
  // What a drag in progress would make, drawn but not yet sent.
  let preview = null
  // The last press on a note, for telling a double click.
  let lastPress = null

  const say = message => { status.textContent = message }
  // The clip's own steps, and the bar past its end that drawing into extends it.
  const clipSteps = () => Math.round(clip.lengthBeats * STEPS_PER_BEAT)
  const steps = () => clipSteps() + options.beatsPerBar * STEPS_PER_BEAT
  const beatOf = step => step / STEPS_PER_BEAT
  const where = step => barBeat(beatOf(step), options.beatsPerBar)
  const shown = () => preview ?? clip.notes
  const same = (a, b) => a.startBeat === b.startBeat && a.pitch === b.pitch

  /** Keep the cursor inside the clip and the window around the cursor. */
  function clampCursor () {
    cursor.pitch = Math.max(0, Math.min(127, cursor.pitch))
    cursor.step = Math.max(0, Math.min(steps() - 1, cursor.step))
    if (cursor.pitch < low) low = cursor.pitch
    if (cursor.pitch >= low + VISIBLE_PITCHES) low = cursor.pitch - VISIBLE_PITCHES + 1
    low = Math.max(0, Math.min(128 - VISIBLE_PITCHES, low))
  }

  function describe (pitch, step) {
    const note = noteAt(shown(), pitch, beatOf(step))
    const past = step >= clipSteps() ? ', past the end of the clip' : ''
    const base = `${spokenName(pitch)}, ${where(step)}${past}`
    if (!note) return base
    const start = note.startBeat === beatOf(step) ? 'note' : 'inside a note'
    return `${base}, ${start}, ${beats(note.lengthBeats)}, velocity ${note.velocity}`
  }

  function draw (next = clip) {
    clip = next
    if (!clip) return
    const hadFocus = grid.contains(document.activeElement)
    clampCursor()
    const notes = shown()
    const selected = noteAt(notes, cursor.pitch, beatOf(cursor.step))
    grid.textContent = ''
    grid.setAttribute('aria-rowcount', String(VISIBLE_PITCHES))
    grid.setAttribute('aria-colcount', String(steps()))
    for (let pitch = low + VISIBLE_PITCHES - 1; pitch >= low; pitch--) {
      const row = document.createElement('div')
      row.className = `piano-roll-row${NAMES[pitch % 12].includes('#') ? ' black' : ''}`
      row.setAttribute('role', 'row')
      const label = document.createElement('span')
      label.className = 'piano-roll-key'
      label.setAttribute('role', 'rowheader')
      label.textContent = noteName(pitch)
      row.append(label)
      for (let step = 0; step < steps(); step++) {
        const cell = document.createElement('div')
        cell.setAttribute('role', 'gridcell')
        cell.id = `roll-${pitch}-${step}`
        cell.dataset.pitch = String(pitch)
        cell.dataset.step = String(step)
        const note = noteAt(notes, pitch, beatOf(step))
        const starts = note && note.startBeat === beatOf(step)
        const ends = note && note.startBeat + note.lengthBeats === beatOf(step + 1)
        const classes = ['piano-roll-cell']
        if (note) classes.push('on')
        if (starts) classes.push('start')
        if (ends) classes.push('end')
        if (note && note === selected) classes.push('selected')
        if (step % STEPS_PER_BEAT === 0) classes.push('beat')
        if (step >= clipSteps()) classes.push('beyond')
        cell.className = classes.join(' ')
        // Marked in text too, so a note is not shown by colour alone.
        cell.textContent = starts ? '■' : note ? '–' : ''
        cell.setAttribute('aria-label', describe(pitch, step))
        const here = pitch === cursor.pitch && step === cursor.step
        cell.tabIndex = here ? 0 : -1
        if (here) cell.classList.add('cursor')
        row.append(cell)
      }
      grid.append(row)
    }
    grid.append(head)
    if (hadFocus) document.getElementById(`roll-${cursor.pitch}-${cursor.step}`)?.focus({ preventScroll: true })
  }

  /**
   * Send notes. If they now run past the clip's end, the clip grows to the end
   * of the bar the last one reaches, in the same edit.
   */
  function send (notes, message) {
    say(message)
    const end = Math.max(0, ...notes.map(n => n.startBeat + n.lengthBeats))
    const bar = options.beatsPerBar
    const lengthBeats = end > clip.lengthBeats ? Math.ceil(end / bar) * bar : undefined
    onChange(clip.id, notes, lengthBeats === undefined ? {} : { lengthBeats })
  }

  function remove (note) {
    send(clip.notes.filter(n => !same(n, note)), `Removed ${spokenName(note.pitch)} at ${barBeat(note.startBeat, options.beatsPerBar)}`)
  }

  function toggle () {
    const beat = beatOf(cursor.step)
    const here = noteAt(clip.notes, cursor.pitch, beat)
    if (here) {
      remove(here)
    } else {
      const note = { startBeat: beat, lengthBeats: 1, pitch: cursor.pitch, velocity: 100 }
      onAudition(note.pitch, note.velocity)
      send([...clip.notes, note], `Added ${spokenName(note.pitch)} at ${where(cursor.step)}, 1 beat`)
    }
  }

  function adjust (change, message) {
    const here = noteAt(clip.notes, cursor.pitch, beatOf(cursor.step))
    if (!here) { say(`No note at ${spokenName(cursor.pitch)}, ${where(cursor.step)}`); return }
    const next = change(here)
    if (!next) return
    send(clip.notes.map(n => (n === here ? next : n)), message(next))
  }

  grid.addEventListener('keydown', event => {
    if (!clip) return
    const move = (pitch, step) => { event.preventDefault(); cursor = { pitch: cursor.pitch + pitch, step: cursor.step + step }; draw() }
    const { key, shiftKey, altKey } = event
    if (altKey && (key === 'ArrowUp' || key === 'ArrowDown')) {
      event.preventDefault()
      const by = key === 'ArrowUp' ? 10 : -10
      adjust(n => {
        const velocity = Math.max(1, Math.min(127, n.velocity + by))
        return velocity === n.velocity ? null : { ...n, velocity }
      }, n => `Velocity ${n.velocity}`)
    } else if (shiftKey && (key === 'ArrowLeft' || key === 'ArrowRight')) {
      event.preventDefault()
      const by = (key === 'ArrowRight' ? 1 : -1) / STEPS_PER_BEAT
      adjust(n => {
        const lengthBeats = n.lengthBeats + by
        return lengthBeats <= 0 ? null : { ...n, lengthBeats }
      }, n => `Length ${beats(n.lengthBeats)}`)
    } else if (key === 'ArrowUp') move(1, 0)
    else if (key === 'ArrowDown') move(-1, 0)
    else if (key === 'ArrowLeft') move(0, -1)
    else if (key === 'ArrowRight') move(0, 1)
    else if (key === 'PageUp') move(12, 0)
    else if (key === 'PageDown') move(-12, 0)
    else if (key === 'Home') move(0, -cursor.step)
    // The clip's own last step; the arrows reach the bar past it.
    else if (key === 'End') move(0, clipSteps() - 1 - cursor.step)
    else if (key === 'Enter' || key === ' ') { event.preventDefault(); toggle() }
    else if (key === 'Delete' || key === 'Backspace') {
      event.preventDefault()
      const here = noteAt(clip.notes, cursor.pitch, beatOf(cursor.step))
      if (here) remove(here)
      else say(`No note at ${spokenName(cursor.pitch)}, ${where(cursor.step)}`)
    }
  })

  // ── The pointer ────────────────────────────────────────────────────────────

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
      return [...clip.notes, { startBeat: beatOf(first), lengthBeats, pitch: from.pitch, velocity: 100 }]
    }
    if (kind === 'move') {
      const pitch = Math.max(0, Math.min(127, note.pitch + to.pitch - from.pitch))
      const startBeat = Math.max(0, note.startBeat + beatOf(to.step - from.step))
      if (pitch === note.pitch && startBeat === note.startBeat) return null
      return clip.notes.map(n => (same(n, note) ? { ...n, pitch, startBeat } : n))
    }
    // resize
    const lengthBeats = Math.max(beatOf(1), beatOf(to.step + 1) - note.startBeat)
    if (lengthBeats === note.lengthBeats) return null
    return clip.notes.map(n => (same(n, note) ? { ...n, lengthBeats } : n))
  }

  grid.addEventListener('pointerdown', event => {
    if (!clip || event.button !== 0) return
    const from = cellOf(event.target)
    if (!from) return
    event.preventDefault()
    const note = noteAt(clip.notes, from.pitch, beatOf(from.step))
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
    cursor = note ? { pitch: note.pitch, step: Math.round(note.startBeat * STEPS_PER_BEAT) } : { ...from }
    if (note) onAudition(note.pitch, note.velocity)
    preview = kind === 'draw' ? dragged('draw', from, from) : null
    draw()
    document.getElementById(`roll-${cursor.pitch}-${cursor.step}`)?.focus({ preventScroll: true })

    let to = from
    const over = e => {
      const at = cellOf(e.target)
      if (!at || (at.pitch === to.pitch && at.step === to.step)) return
      // A drawn note stays on the row it started on; only its length follows.
      to = kind === 'draw' ? { pitch: from.pitch, step: at.step } : at
      const next = dragged(kind, from, to, note)
      if (kind === 'move' && next && to.pitch !== from.pitch) onAudition(Math.max(0, Math.min(127, note.pitch + to.pitch - from.pitch)), note.velocity)
      preview = next
      draw()
    }
    const up = () => {
      grid.removeEventListener('pointerover', over)
      document.removeEventListener('pointerup', up)
      const next = dragged(kind, from, to, note)
      preview = null
      if (kind === 'draw') {
        const made = next.at(-1)
        onAudition(made.pitch, made.velocity)
        send(next, `Added ${spokenName(made.pitch)} at ${where(Math.min(from.step, to.step))}, ${beats(made.lengthBeats)}`)
      } else if (next) {
        const changed = next.find(n => !clip.notes.some(o => same(o, n) && o.lengthBeats === n.lengthBeats))
        send(next, kind === 'move'
          ? `Moved to ${spokenName(changed.pitch)} at ${barBeat(changed.startBeat, options.beatsPerBar)}`
          : `Length ${beats(changed.lengthBeats)}`)
      } else {
        draw()
        say(`Selected ${spokenName(note.pitch)} at ${barBeat(note.startBeat, options.beatsPerBar)}, ${beats(note.lengthBeats)}`)
      }
    }
    grid.addEventListener('pointerover', over)
    document.addEventListener('pointerup', up)
  })

  return {
    element,
    get clipId () { return clip?.id ?? null },
    /** Open on a clip. The cursor starts on its first note, or middle C. */
    show (next, { beatsPerBar, label }) {
      options = { beatsPerBar }
      heading.textContent = `Notes of the clip at ${barBeat(next.startBeat, beatsPerBar)} on ${label}`
      close.setAttribute('aria-label', `Close the notes of the clip on ${label}`)
      const first = next.notes[0]
      cursor = first ? { pitch: first.pitch, step: Math.round(first.startBeat * STEPS_PER_BEAT) } : { pitch: 60, step: 0 }
      low = cursor.pitch - Math.floor(VISIBLE_PITCHES / 2)
      showOpen(true)
      draw(next)
      document.getElementById(`roll-${cursor.pitch}-${cursor.step}`)?.focus()
    },
    draw,
    /**
     * Show where the transport is, as a beat of the arrangement, or null to
     * show nothing. Drawn only while it is inside this clip and its extra bar.
     */
    playhead (beat) {
      if (!clip || beat === null) { head.hidden = true; return }
      const step = (beat - clip.startBeat) * STEPS_PER_BEAT
      head.hidden = !(step >= 0 && step < steps())
      head.style.setProperty('--at', String(step))
    },
    /** Close the clip, leaving the note that says how to open one. */
    hide () {
      clip = null
      preview = null
      grid.textContent = ''
      head.hidden = true
      showOpen(false)
    }
  }
}
