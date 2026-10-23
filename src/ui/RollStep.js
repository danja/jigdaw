// src/ui/RollStep.js
//
// Step input for the note roll: with it on, notes are entered one at a time at the roll's cursor and the cursor moves on by
// the chosen length, the way notes are written into a tracker or a notation tool. The keys follow the on-screen keyboard's
// layout (A is C, W is C sharp, S is D, and so on up to L), so one set of fingers knows both. The same actions are buttons
// of at least 44px, so a phone can do all of it with no keyboard. A control that cannot act is left out: while step input is
// off the rest of the panel is not drawn.

/** Computer key to semitones above C of the current octave, laid out as the black and white keys of a piano. */
export const STEP_KEYS = Object.freeze({
  a: 0, w: 1, s: 2, e: 3, d: 4, f: 5, t: 6, g: 7, y: 8, h: 9, u: 10, j: 11, k: 12, o: 13, l: 14
})

const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
const LENGTHS = [['0.25', 'Quarter beat'], ['0.5', 'Half beat'], ['1', 'Beat'], ['2', '2 beats'], ['4', '4 beats']]
export const MIN_OCTAVE = 0
export const MAX_OCTAVE = 8

/** The MIDI pitch for `semitone` above C in `octave`, where octave 4 starts at 60. */
export const pitchFor = (octave, semitone) => (octave + 1) * 12 + semitone

export function createRollStep (document, { onNote, onRest, onBack, onChange }) {
  const element = document.createElement('div')
  element.className = 'piano-roll-step'
  element.setAttribute('role', 'group')
  element.setAttribute('aria-label', 'Step input')

  const state = { active: false, octave: 4, lengthBeats: 1, chord: false }

  const button = (id, text, run, label = null) => {
    const b = document.createElement('button')
    b.type = 'button'
    b.id = id
    b.textContent = text
    if (label) b.setAttribute('aria-label', label)
    b.addEventListener('click', run)
    return b
  }

  const toggle = button('roll-step', 'Step input', () => set(!state.active))
  const body = document.createElement('div')
  body.className = 'piano-roll-step-body'

  const lengthLabel = document.createElement('label')
  lengthLabel.append(document.createTextNode('Step length '))
  const length = document.createElement('select')
  length.id = 'roll-step-length'
  LENGTHS.forEach(([value, text], i) => {
    const option = document.createElement('option')
    option.value = value
    option.textContent = text
    option.selected = value === '1'
    length.append(option)
  })
  length.addEventListener('change', () => { state.lengthBeats = Number(length.value); onChange() })
  lengthLabel.append(length)

  const octaveSaid = document.createElement('span')
  octaveSaid.id = 'roll-step-octave'
  const setOctave = octave => {
    state.octave = Math.min(MAX_OCTAVE, Math.max(MIN_OCTAVE, octave))
    sync()
    onChange()
  }
  const octaveDown = button('roll-step-octave-down', 'Octave down', () => setOctave(state.octave - 1))
  const octaveUp = button('roll-step-octave-up', 'Octave up', () => setOctave(state.octave + 1))

  const chord = button('roll-step-chord', 'Chord', () => { state.chord = !state.chord; sync() })
  chord.title = 'While on, a note is entered without moving on, so the next one joins it'

  const notes = document.createElement('div')
  notes.className = 'piano-roll-step-notes'
  const noteButtons = NAMES.map((name, semitone) => {
    const b = button(`roll-step-note-${semitone}`, name, () => onNote(pitchFor(state.octave, semitone), { advance: !state.chord }))
    notes.append(b)
    return b
  })
  const rest = button('roll-step-rest', 'Rest', () => onRest())
  const back = button('roll-step-back', 'Back', () => onBack(), 'Back one step, clearing the notes that start there')

  const help = document.createElement('p')
  help.className = 'note'
  help.textContent = 'Keys: A W S E D F T G Y H U J K O L enter notes from C, Shift holds the step for a chord, Space rests, ' +
    'Backspace steps back and clears, Z and X change octave. S no longer chooses a note while this is on.'

  body.append(lengthLabel, octaveDown, octaveSaid, octaveUp, chord, notes, rest, back, help)
  element.append(toggle, body)

  function sync () {
    toggle.setAttribute('aria-pressed', String(state.active))
    body.hidden = !state.active
    octaveSaid.textContent = `Octave ${state.octave}`
    octaveDown.hidden = state.octave <= MIN_OCTAVE
    octaveUp.hidden = state.octave >= MAX_OCTAVE
    chord.setAttribute('aria-pressed', String(state.chord))
    noteButtons.forEach((b, semitone) => {
      const pitch = pitchFor(state.octave, semitone)
      b.setAttribute('aria-label', `Enter ${NAMES[semitone]}${state.octave}${pitch > 127 ? ' (out of range)' : ''}`)
      b.hidden = pitch > 127
    })
  }
  function set (active) {
    state.active = active
    sync()
    onChange()
  }
  sync()

  return {
    element,
    get active () { return state.active },
    get octave () { return state.octave },
    get lengthBeats () { return state.lengthBeats },
    get chord () { return state.chord },
    set,
    setOctave,
    /** Hidden with the roll when no clip is open, and off again so the next clip starts as usual. */
    reset () { state.active = false; sync() }
  }
}
