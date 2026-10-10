// src/ui/NoteRange.js
//
// The two fields that say which notes a MIDI route lets through: the lowest and the highest. Left empty, an
// end is the end of the keyboard, so a route with both empty passes everything. Each field is a native
// number input with its own label, so it has a name, a role and a value without anything added; the note's
// name sits beside it in text, since "60" and "C4" are different information to a person who plays.
//
// A change is reported when the field is committed, not on every keystroke, and as the whole range's two
// ends with null for an empty one, which is how the model takes an end away.

const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']

/** A MIDI note as a name and octave, middle C (60) being C4. */
export function noteName (note) {
  if (!(Number.isInteger(note) && note >= 0 && note <= 127)) throw new Error(`a MIDI note is a whole number from 0 to 127: ${note}`)
  return `${NAMES[note % 12]}${Math.floor(note / 12) - 1}`
}

/**
 * `idBase` makes the two fields' ids, which stay the same across redraws so the focus can be put back on one.
 * `onChange({ lowNote, highNote })` is called with the two ends, each a number or null.
 */
export function createNoteRange (document, { idBase, what, onChange }) {
  if (!idBase) throw new Error('createNoteRange needs an idBase')
  if (typeof onChange !== 'function') throw new Error('createNoteRange needs onChange')
  const element = document.createElement('span')
  element.className = 'note-range'
  element.setAttribute('role', 'group')
  element.setAttribute('aria-label', `Notes let through ${what}`)

  const fields = {}
  const build = (key, text) => {
    const label = document.createElement('label')
    label.className = 'note-range-end'
    const caption = document.createElement('span')
    caption.textContent = text
    const input = document.createElement('input')
    input.type = 'number'
    input.min = '0'
    input.max = '127'
    input.step = '1'
    input.id = `${idBase}-${key}`
    input.placeholder = key === 'lowNote' ? '0' : '127'
    const name = document.createElement('span')
    name.className = 'note-name'
    input.addEventListener('change', () => {
      const raw = input.value.trim()
      onChange({ ...read(), [key]: raw === '' ? null : Number(raw) })
    })
    label.append(caption, input, name)
    fields[key] = { input, name }
    return label
  }
  const read = () => ({
    lowNote: fields.lowNote.input.value.trim() === '' ? null : Number(fields.lowNote.input.value),
    highNote: fields.highNote.input.value.trim() === '' ? null : Number(fields.highNote.input.value)
  })
  element.append(build('lowNote', 'Lowest note'), build('highNote', 'Highest note'))

  return {
    element,
    /** Show a route's range. An end that is not set is shown empty, with the end of the keyboard as the hint. */
    show ({ lowNote, highNote }, focused = null) {
      for (const [key, value] of [['lowNote', lowNote], ['highNote', highNote]]) {
        const { input, name } = fields[key]
        // Not under a hand that is typing in it.
        if (focused !== input) input.value = value === undefined || value === null ? '' : String(value)
        name.textContent = value === undefined || value === null ? '' : noteName(value)
      }
    }
  }
}
