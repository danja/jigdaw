// tests/ui/RollEuclid.test.js
//
// The Euclidean control: what it sends, what it says, and that the piano roll offers it even for a clip with no notes.
import { describe, it, expect, beforeEach } from 'vitest'
import { parseHTML } from 'linkedom'
import { createRollEuclid } from '../../src/ui/RollEuclid.js'
import { createPianoRoll, noteName } from '../../src/ui/PianoRoll.js'

let document, window
beforeEach(() => { ({ document, window } = parseHTML('<!doctype html><body></body>')) })
const click = el => el.dispatchEvent(new window.Event('click', { bubbles: true }))
const set = (id, value) => { document.getElementById(id).value = String(value) }

function build (answer = undefined) {
  const asked = []
  const euclid = createRollEuclid(document, { onEuclid: options => { asked.push(options); return answer }, nameOf: noteName })
  document.body.append(euclid.element)
  return { asked, said: () => document.getElementById('roll-euclid-said').textContent }
}

describe('the Euclidean control', () => {
  it('starts as a kick, three onsets in eight sixteenths, and sends what it shows', () => {
    const { asked } = build()
    click(document.getElementById('roll-euclid-lay'))
    expect(asked).toEqual([{ pitch: 36, pulses: 3, steps: 8, rotation: 0, stepBeats: 0.25 }])
  })

  it('sends what was typed and chosen', () => {
    const { asked } = build()
    set('roll-euclid-pitch', 38); set('roll-euclid-pulses', 5); set('roll-euclid-steps', 16); set('roll-euclid-rotation', -2)
    const options = [...document.getElementById('roll-euclid-length').options]
    options[0].selected = false
    options[1].selected = true
    click(document.getElementById('roll-euclid-lay'))
    expect(asked[0]).toMatchObject({ pitch: 38, pulses: 5, steps: 16, rotation: -2, stepBeats: 0.5 })
  })

  it('says what it did, naming the note and that other notes were kept', () => {
    const { said } = build()
    click(document.getElementById('roll-euclid-lay'))
    expect(said()).toBe('3 onsets in 8 steps laid at C2. Notes already at C2 were replaced; the others were kept.')
  })

  it('says why it was refused, and not that it worked', () => {
    const { said } = build('pulses is a whole number from 0 to the 4 steps: 9')
    click(document.getElementById('roll-euclid-lay'))
    expect(said()).toBe('Not changed: pulses is a whole number from 0 to the 4 steps: 9')
  })

  it('has every field named by a visible label and a status the reader hears', () => {
    build()
    for (const id of ['pitch', 'pulses', 'steps', 'rotation', 'length']) expect(document.getElementById(`roll-euclid-${id}`).closest('label')).not.toBeNull()
    expect(document.getElementById('roll-euclid-said').getAttribute('role')).toBe('status')
  })
})

describe('in the piano roll', () => {
  const make = onEuclid => {
    const roll = createPianoRoll(document, { onChange () {}, onClose () {}, ...(onEuclid ? { onEuclid } : {}) })
    document.body.append(roll.element)
    return roll
  }

  it('is offered for a clip with no notes, hidden with no clip open, and sent the clip\'s id', () => {
    const asked = []
    const roll = make((id, options) => { asked.push(id); return undefined })
    expect(document.getElementById('roll-euclid-lay').closest('.piano-roll-euclid').hidden).toBe(true)
    roll.show({ id: 'c9', startBeat: 0, lengthBeats: 4, notes: [] }, { beatsPerBar: 4, label: 'Keys' })
    expect(document.getElementById('roll-euclid-lay').closest('.piano-roll-euclid').hidden).toBe(false)
    click(document.getElementById('roll-euclid-lay'))
    expect(asked).toEqual(['c9'])
  })

  it('is left out where the host cannot edit notes', () => {
    make(null)
    expect(document.getElementById('roll-euclid-lay')).toBeNull()
  })
})
