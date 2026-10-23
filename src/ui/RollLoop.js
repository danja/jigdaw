// src/ui/RollLoop.js
//
// The Loop control above the note roll: a length in beats to repeat the clip's first beats to fill it, and a Clear button
// that exists only while the clip loops. The text beside it says what is happening in words, including how many notes
// lie after the loop end and so are kept but not played (src/model/ClipLoop.js).
import { createAmountField } from './AmountField.js'

/** `onLoop(beats | null)` is asked to set or clear the open clip's loop. */
export function createRollLoop (document, { onLoop }) {
  const element = document.createElement('div')
  element.className = 'piano-roll-loop'
  element.setAttribute('role', 'group')
  element.setAttribute('aria-label', 'Loop the clip')
  const field = createAmountField(document, { id: 'roll-loop', label: 'Loop length', unit: 'beats', min: 0.25, max: 256, step: 0.25, onApply: beats => onLoop(beats) })
  field.element.querySelector('button').textContent = 'Loop'
  const clear = document.createElement('button')
  clear.type = 'button'
  clear.id = 'roll-loop-clear'
  clear.textContent = 'Clear loop'
  clear.addEventListener('click', () => onLoop(null))
  const said = document.createElement('p')
  said.className = 'note'
  said.id = 'roll-loop-said'
  said.setAttribute('role', 'status')
  element.append(field.element, clear, said)

  return {
    element,
    /** Show a clip's loop: the field holds its length, Clear is there only while it loops. */
    show (clip) {
      const loop = clip.loopBeats ?? null
      clear.hidden = loop === null
      if (loop === null) { said.textContent = ''; return }
      field.input.value = String(loop)
      const hidden = clip.notes.filter(n => n.startBeat >= loop).length
      said.textContent = loop >= clip.lengthBeats
        ? `The loop is as long as the clip, so nothing repeats.`
        : `The first ${loop} beats repeat to fill the clip.${hidden > 0 ? ` ${hidden} note${hidden === 1 ? ' lies' : 's lie'} after the loop end and ${hidden === 1 ? 'is' : 'are'} not played.` : ''}`
    }
  }
}
