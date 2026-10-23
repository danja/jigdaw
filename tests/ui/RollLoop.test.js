// tests/ui/RollLoop.test.js
import { describe, it, expect, beforeEach } from 'vitest'
import { parseHTML } from 'linkedom'
import { createRollLoop } from '../../src/ui/RollLoop.js'
import { createPianoRoll } from '../../src/ui/PianoRoll.js'

let document
let window
beforeEach(() => { ({ document, window } = parseHTML('<!doctype html><body></body>')) })
const click = el => el.dispatchEvent(new window.Event('click', { bubbles: true }))
const note = startBeat => ({ startBeat, lengthBeats: 1, pitch: 60, velocity: 90 })

function build () {
  const asked = []
  const loop = createRollLoop(document, { onLoop: beats => asked.push(beats) })
  document.body.append(loop.element)
  return { loop, asked, said: () => document.getElementById('roll-loop-said').textContent }
}

describe('the roll loop control', () => {
  it('asks for the length typed, in beats, when Loop is pressed', () => {
    const { asked } = build()
    document.getElementById('roll-loop').value = '2.5'
    click(document.getElementById('roll-loop-apply'))
    expect(asked).toEqual([2.5])
  })
  it('refuses a length below a quarter beat and sends nothing', () => {
    const { asked } = build()
    document.getElementById('roll-loop').value = '0'
    click(document.getElementById('roll-loop-apply'))
    expect(asked).toEqual([])
  })
  it('has Clear only while the clip loops, and asks for null when it is pressed', () => {
    const { loop, asked } = build()
    const clear = document.getElementById('roll-loop-clear')
    loop.show({ lengthBeats: 8, notes: [note(0)] })
    expect(clear.hidden).toBe(true)
    loop.show({ lengthBeats: 8, loopBeats: 4, notes: [note(0)] })
    expect(clear.hidden).toBe(false)
    expect(document.getElementById('roll-loop').value).toBe('4')
    click(clear)
    expect(asked).toEqual([null])
  })
  it('says in words what the loop does, and how many notes after its end are not played', () => {
    const { loop, said } = build()
    loop.show({ lengthBeats: 8, loopBeats: 4, notes: [note(0), note(5), note(6)] })
    expect(said()).toBe('The first 4 beats repeat to fill the clip. 2 notes lie after the loop end and are not played.')
    loop.show({ lengthBeats: 8, loopBeats: 4, notes: [note(5)] })
    expect(said()).toContain('1 note lies after the loop end and is not played.')
    loop.show({ lengthBeats: 4, loopBeats: 4, notes: [note(0)] })
    expect(said()).toBe('The loop is as long as the clip, so nothing repeats.')
    loop.show({ lengthBeats: 4, notes: [] })
    expect(said()).toBe('')
  })
})

describe('the loop control in the piano roll', () => {
  const roll = options => {
    const r = createPianoRoll(document, { onChange: () => {}, onClose: () => {}, ...options })
    document.body.append(r.element)
    return r
  }
  it('is drawn when the host can store a loop, shown with the clip, and asks for the open clip', () => {
    const asked = []
    const r = roll({ onLoop: (id, beats) => asked.push([id, beats]) })
    expect(document.getElementById('roll-loop')).not.toBeNull()
    expect(document.querySelector('.piano-roll-loop').hidden).toBe(true)
    r.show({ id: 'c', startBeat: 0, lengthBeats: 8, loopBeats: 4, notes: [note(0)] }, { beatsPerBar: 4, label: 'Keys' })
    expect(document.querySelector('.piano-roll-loop').hidden).toBe(false)
    expect(document.getElementById('roll-loop').value).toBe('4')
    click(document.getElementById('roll-loop-clear'))
    expect(asked).toEqual([['c', null]])
  })
  it('leaves the control out when the host gives no onLoop', () => {
    roll({})
    expect(document.getElementById('roll-loop')).toBeNull()
  })
})
