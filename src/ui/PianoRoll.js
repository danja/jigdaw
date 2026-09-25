// src/ui/PianoRoll.js
//
// A MIDI clip's notes, as a grid of pitch against time.
//
// Built for the keyboard first (CLAUDE.md: keyboard before pointer). The grid
// is one tab stop holding a cursor, a roving tabindex: arrow keys move it,
// Page Up and Page Down move it an octave, Home and End go to either end of
// the clip. Enter or Space adds a note at the cursor, or removes the one
// there. Shift with Left or Right makes the note under the cursor shorter or
// longer by a step, and Alt with Up or Down makes it quieter or louder. A
// click on a cell does what Enter does there.
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
 * `onChange(clipId, notes)` sends a whole new list of notes. `onClose()` is
 * called by its Close button. Returns `{ element, show, draw, hide, clipId }`.
 */
export function createPianoRoll (document, { onChange, onClose }) {
  if (typeof onChange !== 'function' || typeof onClose !== 'function') {
    throw new Error('createPianoRoll needs onChange and onClose')
  }
  const element = document.createElement('section')
  element.className = 'piano-roll'
  element.hidden = true

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
  help.textContent = 'Arrows move. Enter adds or removes a note. Shift with Left or Right changes its length, ' +
    'Alt with Up or Down its velocity. Page Up and Page Down move an octave.'

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
  scroller.append(grid)
  element.append(header, help, scroller, status)

  let clip = null
  let options = null
  let cursor = { pitch: 60, step: 0 }
  let low = 48

  const say = message => { status.textContent = message }
  const steps = () => Math.round(clip.lengthBeats * STEPS_PER_BEAT)
  const beatOf = step => step / STEPS_PER_BEAT
  const where = step => barBeat(beatOf(step), options.beatsPerBar)

  /** Keep the cursor inside the clip and the window around the cursor. */
  function clampCursor () {
    cursor.pitch = Math.max(0, Math.min(127, cursor.pitch))
    cursor.step = Math.max(0, Math.min(steps() - 1, cursor.step))
    if (cursor.pitch < low) low = cursor.pitch
    if (cursor.pitch >= low + VISIBLE_PITCHES) low = cursor.pitch - VISIBLE_PITCHES + 1
    low = Math.max(0, Math.min(128 - VISIBLE_PITCHES, low))
  }

  function describe (pitch, step) {
    const note = noteAt(clip.notes, pitch, beatOf(step))
    const base = `${spokenName(pitch)}, ${where(step)}`
    if (!note) return base
    const start = note.startBeat === beatOf(step) ? 'note' : 'inside a note'
    return `${base}, ${start}, ${beats(note.lengthBeats)}, velocity ${note.velocity}`
  }

  function draw (next = clip) {
    clip = next
    if (!clip) return
    const hadFocus = grid.contains(document.activeElement)
    clampCursor()
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
        const note = noteAt(clip.notes, pitch, beatOf(step))
        const starts = note && note.startBeat === beatOf(step)
        cell.className = `piano-roll-cell${note ? ' on' : ''}${starts ? ' start' : ''}${step % STEPS_PER_BEAT === 0 ? ' beat' : ''}`
        // Marked in text too, so a note is not shown by colour alone.
        cell.textContent = starts ? '■' : note ? '–' : ''
        cell.setAttribute('aria-label', describe(pitch, step))
        const here = pitch === cursor.pitch && step === cursor.step
        cell.tabIndex = here ? 0 : -1
        if (here) cell.classList.add('cursor')
        cell.addEventListener('click', () => {
          cursor = { pitch, step }
          toggle()
        })
        row.append(cell)
      }
      grid.append(row)
    }
    if (hadFocus) document.getElementById(`roll-${cursor.pitch}-${cursor.step}`)?.focus({ preventScroll: false })
  }

  function send (notes, message) {
    say(message)
    onChange(clip.id, notes)
  }

  function toggle () {
    const beat = beatOf(cursor.step)
    const here = noteAt(clip.notes, cursor.pitch, beat)
    if (here) {
      send(clip.notes.filter(n => n !== here), `Removed ${spokenName(here.pitch)} at ${barBeat(here.startBeat, options.beatsPerBar)}`)
    } else {
      const note = { startBeat: beat, lengthBeats: 1, pitch: cursor.pitch, velocity: 100 }
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
    else if (key === 'End') move(0, steps() - 1 - cursor.step)
    else if (key === 'Enter' || key === ' ') { event.preventDefault(); toggle() }
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
      element.hidden = false
      draw(next)
      document.getElementById(`roll-${cursor.pitch}-${cursor.step}`)?.focus()
    },
    draw,
    hide () {
      clip = null
      element.hidden = true
      grid.textContent = ''
    }
  }
}
