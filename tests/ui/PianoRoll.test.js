// tests/ui/PianoRoll.test.js
//
// Driven by the keys a person presses, and read back by what the cells say
// and what document.activeElement is afterwards: CLAUDE.md, a control that can
// be nudged once by keyboard and then loses the focus passes every test that
// does not read the focus.
import { describe, it, expect, beforeEach } from 'vitest'
import { parseHTML } from 'linkedom'
import { createPianoRoll, noteName, spokenName, STEPS_PER_BEAT } from '../../src/ui/PianoRoll.js'

let document
let window
// linkedom has focus() and no activeElement, so focus() records what it was
// called on. That is the one thing stubbed: the piano roll's own reading of
// the focus before a redraw and its moving of it after are the real code.
beforeEach(() => {
  ({ document, window } = parseHTML('<!doctype html><body></body>'))
  window.HTMLElement.prototype.focus = function () { document.activeElement = this }
})

const key = (target, k, mods = {}) => {
  const e = new window.Event('keydown', { bubbles: true, cancelable: true })
  Object.defineProperty(e, 'key', { value: k })
  for (const [m, v] of Object.entries(mods)) Object.defineProperty(e, m, { value: v })
  target.dispatchEvent(e)
}

function build (notes = []) {
  let clip = { id: 'c', startBeat: 0, lengthBeats: 4, notes }
  const sent = []
  const lengths = []
  const heard = []
  let closed = 0
  let clock = 0
  const roll = createPianoRoll(document, {
    // Stands in for the dispatcher: takes the notes, sorts them as the model
    // does, and draws again from what it kept.
    onChange: (id, next, { lengthBeats } = {}) => {
      sent.push(next)
      lengths.push(lengthBeats)
      clip = { ...clip, lengthBeats: lengthBeats ?? clip.lengthBeats, notes: [...next].sort((a, b) => a.startBeat - b.startBeat || a.pitch - b.pitch) }
      roll.draw(clip)
    },
    onClose: () => { closed += 1 },
    onAudition: (pitch, velocity) => heard.push([pitch, velocity]),
    now: () => clock
  })
  document.body.append(roll.element)
  roll.show(clip, { beatsPerBar: 4, label: 'Keys' })
  const focused = () => document.activeElement
  return { roll, sent, lengths, heard, focused, clip: () => clip, closed: () => closed, tick: ms => { clock += ms } }
}

/** A pointer event, with the fields linkedom will not set from an init dictionary. */
const pointer = (type, props = {}) => {
  const e = new window.Event(type, { bubbles: true, cancelable: true })
  for (const [k, v] of Object.entries({ button: 0, ...props })) Object.defineProperty(e, k, { value: v })
  return e
}
const cell = (pitch, step) => document.getElementById(`roll-${pitch}-${step}`)
/** Press on one square, pass over the others, and let go on the document, as a real drag arrives. */
function drag (from, ...path) {
  cell(...from).dispatchEvent(pointer('pointerdown'))
  for (const at of path) cell(...at).dispatchEvent(pointer('pointerover'))
  document.dispatchEvent(pointer('pointerup'))
}

describe('names', () => {
  it('names pitches with C4 as 60, and says sharps in words', () => {
    expect(noteName(60)).toBe('C4')
    expect(noteName(61)).toBe('C#4')
    expect(spokenName(61)).toBe('C sharp 4')
    expect(noteName(21)).toBe('A0')
  })
})

describe('the cursor', () => {
  it('starts on middle C in an empty clip, focused', () => {
    const { focused } = build()
    expect(focused().id).toBe('roll-60-0')
    expect(focused().getAttribute('aria-label')).toBe('C4, bar 1 beat 1')
    expect(focused().getAttribute('tabindex')).toBe('0')
    expect(document.querySelectorAll('[role=gridcell][tabindex="0"]')).toHaveLength(1)
  })

  it('moves by arrow, keeps the focus with it, and stays inside the clip', () => {
    const { focused } = build()
    key(focused(), 'ArrowUp')
    key(focused(), 'ArrowRight')
    expect(focused().id).toBe('roll-61-1')
    expect(focused().getAttribute('aria-label')).toBe('C sharp 4, bar 1 beat 1.25')
    key(focused(), 'Home')
    key(focused(), 'ArrowLeft')
    expect(focused().id).toBe('roll-61-0')
    key(focused(), 'End')
    expect(focused().id).toBe(`roll-61-${4 * STEPS_PER_BEAT - 1}`)
  })

  it('moves an octave, scrolling the window of pitches with it', () => {
    const { focused } = build()
    for (let i = 0; i < 3; i++) key(focused(), 'PageUp')
    expect(focused().id).toBe('roll-96-0')
    expect(document.getElementById('roll-96-0')).not.toBeNull()
  })

  it('starts on the first note of a clip that has some', () => {
    const { focused } = build([{ startBeat: 1, lengthBeats: 1, pitch: 67, velocity: 90 }])
    expect(focused().id).toBe(`roll-67-${STEPS_PER_BEAT}`)
    expect(focused().getAttribute('aria-label')).toBe('G4, bar 1 beat 2, note, 1 beat, velocity 90')
  })
})

describe('editing', () => {
  it('adds a note with Enter, as one whole list, and says so', () => {
    const { sent, focused } = build()
    key(focused(), 'Enter')
    expect(sent).toEqual([[{ startBeat: 0, lengthBeats: 1, pitch: 60, velocity: 100 }]])
    expect(focused().id).toBe('roll-60-0')
    expect(focused().textContent).toBe('■')
    expect(document.querySelector('[role=status]').textContent).toBe('Added C4 at bar 1 beat 1, 1 beat')
  })

  it('removes the note under the cursor, even from inside it', () => {
    const { sent, focused, clip } = build([{ startBeat: 0, lengthBeats: 1, pitch: 60, velocity: 100 }])
    key(focused(), 'ArrowRight')
    expect(focused().getAttribute('aria-label')).toMatch(/inside a note/)
    key(focused(), ' ')
    expect(clip().notes).toEqual([])
    expect(sent).toHaveLength(1)
  })

  it('lengthens and shortens by a step, never to nothing', () => {
    const { focused, clip } = build([{ startBeat: 0, lengthBeats: 0.25, pitch: 60, velocity: 100 }])
    key(focused(), 'ArrowRight', { shiftKey: true })
    expect(clip().notes[0].lengthBeats).toBe(0.5)
    key(focused(), 'ArrowLeft', { shiftKey: true })
    key(focused(), 'ArrowLeft', { shiftKey: true })
    expect(clip().notes[0].lengthBeats).toBe(0.25)
  })

  it('changes velocity within MIDI\'s range', () => {
    const { focused, clip } = build([{ startBeat: 0, lengthBeats: 1, pitch: 60, velocity: 120 }])
    key(focused(), 'ArrowUp', { altKey: true })
    expect(clip().notes[0].velocity).toBe(127)
    for (let i = 0; i < 20; i++) key(focused(), 'ArrowDown', { altKey: true })
    expect(clip().notes[0].velocity).toBe(1)
  })

  it('says there is nothing to change where there is no note', () => {
    const { sent, focused } = build()
    key(focused(), 'ArrowUp', { altKey: true })
    expect(sent).toEqual([])
    expect(document.querySelector('[role=status]').textContent).toMatch(/No note at C4/)
  })

  it('removes the note under the cursor with Delete', () => {
    const { focused, clip } = build([{ startBeat: 0, lengthBeats: 1, pitch: 60, velocity: 100 }])
    key(focused(), 'Delete')
    expect(clip().notes).toEqual([])
  })
})

describe('the pointer', () => {
  it('draws a one-beat note with a click, and sounds it', () => {
    const { sent, heard } = build()
    drag([64, 2])
    expect(sent).toEqual([[{ startBeat: 0.5, lengthBeats: 1, pitch: 64, velocity: 100 }]])
    expect(heard.at(-1)).toEqual([64, 100])
  })

  it('draws a note as long as the drag, on the row it started on', () => {
    const { sent } = build()
    drag([60, 4], [61, 5], [61, 9])
    expect(sent).toEqual([[{ startBeat: 1, lengthBeats: 1.5, pitch: 60, velocity: 100 }]])
  })

  it('shows the note while it is drawn, and sends nothing until the release', () => {
    const { sent } = build()
    cell(60, 0).dispatchEvent(pointer('pointerdown'))
    cell(60, 7).dispatchEvent(pointer('pointerover'))
    expect(sent).toEqual([])
    expect(cell(60, 7).classList.contains('on')).toBe(true)
    document.dispatchEvent(pointer('pointerup'))
    expect(sent).toHaveLength(1)
  })

  it('selects a note when pressed, rather than removing it', () => {
    const { sent, focused, heard } = build([{ startBeat: 0, lengthBeats: 1, pitch: 60, velocity: 90 }])
    drag([60, 2])
    expect(sent).toEqual([])
    expect(focused().id).toBe('roll-60-0')
    expect(cell(60, 1).classList.contains('selected')).toBe(true)
    expect(heard.at(-1)).toEqual([60, 90])
  })

  it('moves a note in pitch and time by dragging it, as one edit', () => {
    const { sent, clip } = build([{ startBeat: 0, lengthBeats: 1, pitch: 60, velocity: 100 }])
    drag([60, 1], [61, 2], [62, 5])
    expect(sent).toHaveLength(1)
    expect(clip().notes).toEqual([{ startBeat: 1, lengthBeats: 1, pitch: 62, velocity: 100 }])
  })

  it('changes a note\'s length by dragging its last square', () => {
    const { clip, tick } = build([{ startBeat: 0, lengthBeats: 1, pitch: 60, velocity: 100 }])
    drag([60, 3], [60, 9])
    expect(clip().notes[0].lengthBeats).toBe(2.5)
    // Later, so the second press is not a double click.
    tick(1000)
    drag([60, 9], [60, 1])
    expect(clip().notes[0].lengthBeats).toBe(0.5)
  })

  it('removes a note on a double click, and not on two slow ones', () => {
    const one = build([{ startBeat: 0, lengthBeats: 1, pitch: 60, velocity: 100 }])
    drag([60, 1]); one.tick(1000); drag([60, 1])
    expect(one.clip().notes).toHaveLength(1)
    one.tick(100); drag([60, 1])
    expect(one.clip().notes).toEqual([])
  })

  it('makes the clip longer when a note is drawn into the bar past its end', () => {
    const { lengths, clip } = build()
    expect(cell(60, 16).classList.contains('beyond')).toBe(true)
    expect(cell(60, 16).getAttribute('aria-label')).toMatch(/past the end of the clip/)
    drag([60, 14], [60, 17])
    expect(lengths).toEqual([8])
    expect(clip().lengthBeats).toBe(8)
  })

  it('leaves the clip\'s length alone for a note inside it', () => {
    const { lengths } = build()
    drag([60, 0])
    expect(lengths).toEqual([undefined])
  })

  it('stops following the pointer once released', () => {
    const { sent } = build()
    drag([60, 0], [60, 3])
    cell(60, 10).dispatchEvent(pointer('pointerover'))
    document.dispatchEvent(pointer('pointerup'))
    expect(sent).toHaveLength(1)
  })
})

describe('the playhead', () => {
  it('shows where the transport is inside the clip, and nothing outside it', () => {
    const { roll } = build()
    const head = roll.element.querySelector('.playhead')
    roll.playhead(1.5)
    expect(head.hidden).toBe(false)
    expect(head.style.getPropertyValue('--at')).toBe('6')
    roll.playhead(40)
    expect(head.hidden).toBe(true)
    roll.playhead(null)
    expect(head.hidden).toBe(true)
  })
})

describe('with no clip open', () => {
  it('is still there, and says how to open one, with nothing to close', () => {
    const roll = createPianoRoll(document, { onChange: () => {}, onClose: () => {} })
    document.body.append(roll.element)
    expect(roll.element.hidden).toBe(false)
    expect(roll.element.querySelector('h3').textContent).toBe('Piano roll')
    expect(roll.element.querySelector('.piano-roll-empty').hidden).toBe(false)
    expect(roll.element.querySelector('.piano-roll-empty').textContent).toMatch(/Add clip/)
    expect(roll.element.querySelector('header button').hidden).toBe(true)
    expect(roll.element.querySelector('.piano-roll-scroll').hidden).toBe(true)
  })

  it('goes back to saying so when the clip is closed', () => {
    const { roll } = build()
    expect(roll.element.querySelector('.piano-roll-empty').hidden).toBe(true)
    roll.hide()
    expect(roll.element.querySelector('.piano-roll-empty').hidden).toBe(false)
    expect(roll.clipId).toBeNull()
  })
})

describe('the frame around it', () => {
  it('is a grid named by its heading, with a Close', () => {
    const { roll, closed } = build()
    const grid = document.querySelector('[role=grid]')
    expect(document.getElementById(grid.getAttribute('aria-labelledby')).textContent).toBe('Notes of the clip at bar 1 beat 1 on Keys')
    roll.element.querySelector('header button').dispatchEvent(new window.Event('click'))
    expect(closed()).toBe(1)
  })
})
