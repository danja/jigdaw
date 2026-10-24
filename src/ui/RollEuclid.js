// src/ui/RollEuclid.js
//
// The Euclidean rhythm control above the note roll: which note, how many onsets, over how many steps, how far to rotate, and how long a
// step is, with one button that lays it into the open clip (src/model/Euclidean.js). Notes already at that pitch are replaced and the
// rest are kept, which the text beside it says. It is shown for an empty clip too, since making notes is what it is for.
import { MAX_STEPS } from '../model/Euclidean.js'

const STEPS = [['0.25', 'a sixteenth'], ['0.5', 'an eighth'], ['1', 'a beat'], ['0.125', 'a thirty-second']]

/** `onEuclid(options)` lays the rhythm in and returns an error message if it was refused. `nameOf(pitch)` is how a pitch is said. */
export function createRollEuclid (document, { onEuclid, nameOf }) {
  const element = document.createElement('div')
  element.className = 'piano-roll-euclid'
  element.setAttribute('role', 'group')
  element.setAttribute('aria-label', 'Euclidean rhythm')

  const number = (id, label, value, min, max) => {
    const wrap = document.createElement('label')
    wrap.append(document.createTextNode(`${label} `))
    const input = document.createElement('input')
    input.type = 'number'
    input.id = id
    input.min = String(min)
    input.max = String(max)
    input.step = '1'
    input.inputMode = 'numeric'
    input.value = String(value)
    wrap.append(input)
    return { wrap, input }
  }
  const pitch = number('roll-euclid-pitch', 'Note', 36, 0, 127)
  const pulses = number('roll-euclid-pulses', 'Onsets', 3, 0, MAX_STEPS)
  const steps = number('roll-euclid-steps', 'Steps', 8, 1, MAX_STEPS)
  const rotation = number('roll-euclid-rotation', 'Rotate', 0, -MAX_STEPS, MAX_STEPS)
  const lengthWrap = document.createElement('label')
  lengthWrap.append(document.createTextNode('A step is '))
  const length = document.createElement('select')
  length.id = 'roll-euclid-length'
  for (const [value, text] of STEPS) {
    const option = document.createElement('option')
    option.value = value
    option.textContent = text
    option.selected = value === '0.25'
    length.append(option)
  }
  lengthWrap.append(length)
  const lay = document.createElement('button')
  lay.type = 'button'
  lay.id = 'roll-euclid-lay'
  lay.textContent = 'Lay rhythm'
  const said = document.createElement('p')
  said.className = 'note'
  said.id = 'roll-euclid-said'
  said.setAttribute('role', 'status')

  const named = () => {
    const value = Number(pitch.input.value)
    return Number.isInteger(value) && value >= 0 && value <= 127 ? nameOf(value) : null
  }
  lay.addEventListener('click', () => {
    const options = {
      pitch: Number(pitch.input.value), pulses: Number(pulses.input.value), steps: Number(steps.input.value),
      rotation: Number(rotation.input.value), stepBeats: Number([...length.options].find(o => o.selected).value)
    }
    const refused = onEuclid(options)
    said.textContent = typeof refused === 'string'
      ? `Not changed: ${refused}`
      : `${options.pulses} onsets in ${options.steps} steps laid at ${named()}. Notes already at ${named()} were replaced; the others were kept.`
  })
  element.append(pitch.wrap, pulses.wrap, steps.wrap, rotation.wrap, lengthWrap, lay, said)
  return { element }
}
