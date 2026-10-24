// src/ui/RollTools.js
//
// The buttons above the note roll that change many notes at once: Quantize with its grid, strength and ends, transposing by a semitone or an
// octave, softer and louder, reverse, invert, legato, strum, humanize, fit to the scale, and choosing all notes or none. Each asks the page for
// a whole-clip edit through `onTransform` (src/model/NoteTransform.js), and what was done, or why not, is spoken here, since the host's log is
// not where a person is looking. The roll keeps the notes and the choice; this is handed what it reads through accessors.
//
//   getClip(), getChosen(), setChosen(set)   the open clip, and the keys (start:pitch) of the notes chosen
//   getScale()                               the scale chosen for the roll, or null
//   say(text), draw(), chooseAll()           speak, draw again, choose every note
//   keyOf(note)                              how a note is named in the choice
//   now()                                    the clock, for the humanize seed

/** Returns `{ element, fitButton, selectAll, selectNone }`. The element is hidden by the roll until a clip has notes. */
export function createRollTools (document, { onTransform, getClip, getChosen, setChosen, getScale, say, draw, chooseAll, keyOf, now }) {
  const tools = document.createElement('div')
  tools.className = 'piano-roll-tools'
  tools.setAttribute('role', 'group')
  tools.setAttribute('aria-label', 'Change the notes')
  const fitButton = document.createElement('button')
  fitButton.type = 'button'
  fitButton.id = 'roll-fit-scale'
  fitButton.textContent = 'Fit notes to the scale'
  fitButton.hidden = true
  const gridLabel = document.createElement('label')
  gridLabel.append(document.createTextNode('Grid '))
  const gridSelect = document.createElement('select')
  gridSelect.id = 'roll-quantize-grid'
  for (const [value, text] of [['1', 'Beat'], ['0.5', 'Half beat'], ['0.25', 'Quarter beat']]) {
    const option = document.createElement('option')
    option.value = value
    option.textContent = text
    option.selected = value === '0.25'
    gridSelect.append(option)
  }
  gridLabel.append(gridSelect)
  tools.append(gridLabel)
  // How far Quantize moves a note toward the grid: all the way, or part of it to keep some of the feel.
  const strengthLabel = document.createElement('label')
  strengthLabel.append(document.createTextNode('Strength '))
  const strengthSelect = document.createElement('select')
  strengthSelect.id = 'roll-quantize-strength'
  for (const [value, text] of [['1', '100%'], ['0.75', '75%'], ['0.5', '50%'], ['0.25', '25%']]) {
    const option = document.createElement('option')
    option.value = value
    option.textContent = text
    option.selected = value === '1'
    strengthSelect.append(option)
  }
  strengthLabel.append(strengthSelect)
  tools.append(strengthLabel)
  const endsLabel = document.createElement('label')
  endsLabel.append(document.createTextNode('Move '))
  const endsSelect = document.createElement('select')
  endsSelect.id = 'roll-quantize-ends'
  for (const [value, text] of [['starts', 'Starts'], ['both', 'Starts and ends']]) {
    const option = document.createElement('option')
    option.value = value
    option.textContent = text
    option.selected = value === 'starts'
    endsSelect.append(option)
  }
  endsLabel.append(endsSelect)
  tools.append(endsLabel)
  // `onTransform` returns an error message when the edit is refused; what was done or why not is spoken here,
  // since the host's log is not where a person is looking.
  const ask = (name, options, done) => () => {
    const indices = getChosen().size === 0 ? null : getClip().notes.flatMap((n, i) => (getChosen().has(keyOf(n)) ? [i] : []))
    const before = getClip().notes
    const refused = onTransform(name, options, { indices })
    if (typeof refused === 'string') { say(`Not changed: ${refused}`); return }
    // The getChosen() notes were rewritten, so choose what they became: the notes now present that no unchosen note accounts for.
    if (indices !== null) {
      const rest = before.filter(n => !getChosen().has(keyOf(n)))
      const keep = new Set()
      const unmatched = [...getClip().notes]
      for (const n of rest) { const at = unmatched.findIndex(m => keyOf(m) === keyOf(n) && m.lengthBeats === n.lengthBeats && m.velocity === n.velocity); if (at >= 0) unmatched.splice(at, 1) }
      for (const n of unmatched) keep.add(keyOf(n))
      setChosen(keep)
      draw()
    }
    say(indices === null ? done : done.replace(/^Every note/, 'Chosen notes').replace('every note', 'the getChosen() notes').replace(/^Notes/, 'Chosen notes'))
  }
  // How likely each note is to sound every time it comes round (jig:chance). 100% takes the chance away.
  const chanceLabel = document.createElement('label')
  chanceLabel.append(document.createTextNode('Chance '))
  const chanceSelect = document.createElement('select')
  chanceSelect.id = 'roll-chance-value'
  for (const [value, text] of [['1', '100%, always'], ['0.75', '75%'], ['0.5', '50%'], ['0.25', '25%'], ['0.1', '10%']]) {
    const option = document.createElement('option')
    option.value = value
    option.textContent = text
    option.selected = value === '0.5'
    chanceSelect.append(option)
  }
  chanceLabel.append(chanceSelect)
  tools.append(chanceLabel)
  const chosenChance = () => Number([...chanceSelect.options].find(o => o.selected).value)
  const buttons = [
    ['roll-quantize', 'Quantize', () => ask('quantize', { grid: Number(gridSelect.value), strength: Number(strengthSelect.value), ends: endsSelect.value === 'both' }, strengthSelect.value === '1' ? 'Quantized every note to the grid' : `Quantized every note ${Math.round(Number(strengthSelect.value) * 100)}% of the way to the grid`)()],
    ['roll-down', 'Down a semitone', ask('transpose', { semitones: -1 }, 'Every note down a semitone')],
    ['roll-up', 'Up a semitone', ask('transpose', { semitones: 1 }, 'Every note up a semitone')],
    ['roll-octave-down', 'Down an octave', ask('transpose', { semitones: -12 }, 'Every note down an octave')],
    ['roll-octave-up', 'Up an octave', ask('transpose', { semitones: 12 }, 'Every note up an octave')],
    ['roll-softer', 'Softer', ask('scaleVelocity', { factor: 0.8 }, 'Every note softer')],
    ['roll-louder', 'Louder', ask('scaleVelocity', { factor: 1.25 }, 'Every note louder')],
    ['roll-reverse', 'Reverse', ask('reverse', {}, 'Notes reversed in time')],
    // About the first note's pitch, so a rising line falls.
    ['roll-invert', 'Invert pitches', ask('invert', {}, 'Notes inverted about the first note')],
    // A fresh seed for each press, so pressing again gives a different feel; the edit itself is reproducible from it.
    ['roll-legato', 'Legato', ask('legato', {}, 'Every note held until the next one starts')],
    ['roll-strum', 'Strum', ask('strum', { spread: 0.0625, direction: 'up' }, 'Chords strummed upward')],
    ['roll-chance', 'Set chance', () => { const chance = chosenChance(); return ask('setChance', { chance }, chance === 1 ? 'Every note will always sound' : `Every note given a ${Math.round(chance * 100)}% chance of sounding each time round`)() }],
    ['roll-humanize', 'Humanize', () => ask('humanize', { timing: 0.05, velocity: 10, seed: now() }, 'Notes humanized a little in time and velocity')()]
  ]
  for (const [id, text, run] of buttons) {
    const button = document.createElement('button')
    button.type = 'button'
    button.id = id
    button.textContent = text
    button.addEventListener('click', run)
    tools.append(button)
  }
  const pick = (id, text, run) => {
    const button = document.createElement('button')
    button.type = 'button'
    button.id = id
    button.textContent = text
    button.addEventListener('click', run)
    tools.append(button)
    return button
  }
  // Left out until a scale is getChosen(), as there is nothing to fit to.
  fitButton.addEventListener('click', () => ask('fitScale', { ...getScale() }, 'Every note moved into the scale')())
  tools.append(fitButton)
  const selectAll = pick('roll-select-all', 'Choose all notes', () => { chooseAll() })
  const selectNone = pick('roll-select-none', 'Let go of the choice', () => { setChosen(new Set()); draw(); say('No notes getChosen()') })

  return { element: tools, fitButton, selectAll, selectNone }
}
