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

describe('the grid as a screen reader sees it', () => {
  it('says there are 128 rows and where each drawn one sits, highest pitch first', () => {
    build([{ startBeat: 0, lengthBeats: 1, pitch: 60, velocity: 100 }])
    const grid = document.querySelector('[role=grid]')
    expect(grid.getAttribute('aria-rowcount')).toBe('128')
    const rows = [...grid.querySelectorAll('[role=row]')]
    expect(rows).toHaveLength(24)
    // The top row drawn is the highest pitch shown, and the rows count up as the pitches go down.
    const indices = rows.map(r => Number(r.getAttribute('aria-rowindex')))
    expect(indices).toEqual([...indices].sort((a, b) => a - b))
    expect(new Set(indices).size).toBe(24)
    const middleC = rows.find(r => r.querySelector('[data-pitch="60"]'))
    expect(middleC.getAttribute('aria-rowindex')).toBe('68')
  })

  it('counts the row header as the first column, so the squares start at column 2', () => {
    build()
    const grid = document.querySelector('[role=grid]')
    const steps = Number(grid.getAttribute('aria-colcount')) - 1
    const row = grid.querySelector('[role=row]')
    expect(row.querySelector('[role=rowheader]').getAttribute('aria-colindex')).toBe('1')
    const cells = [...row.querySelectorAll('[role=gridcell]')]
    expect(cells).toHaveLength(steps)
    expect(cells[0].getAttribute('aria-colindex')).toBe('2')
    expect(cells.at(-1).getAttribute('aria-colindex')).toBe(String(steps + 1))
  })

  it('keeps every row index equal to 128 minus its pitch after the window scrolls an octave', () => {
    build()
    const grid = document.querySelector('[role=grid]')
    grid.querySelector('[tabindex="0"]').dispatchEvent(Object.assign(new window.Event('keydown', { bubbles: true, cancelable: true }), { key: 'PageUp' }))
    const rows = [...grid.querySelectorAll('[role=row]')]
    expect(rows).toHaveLength(24)
    for (const row of rows) {
      expect(Number(row.getAttribute('aria-rowindex'))).toBe(128 - Number(row.querySelector('[data-pitch]').dataset.pitch))
    }
    // The window really did move: it no longer starts where a fresh one does.
    expect(rows[0].querySelector('[data-pitch]').dataset.pitch).not.toBe('71')
  })
})

describe('the scale', () => {
  const click = id => document.getElementById(id).dispatchEvent(new window.Event('click', { bubbles: true }))
  const choose = (id, index) => { document.getElementById(id).options[index].selected = true; document.getElementById(id).dispatchEvent(new window.Event('change', { bubbles: true })) }
  function open (notes = [{ startBeat: 0, lengthBeats: 1, pitch: 60, velocity: 100 }]) {
    const asked = []
    const sent = []
    // A clock that moves a second each time it is read, so two presses are never taken for a double click.
    let clock = 0
    const roll = createPianoRoll(document, { onChange: (id, next) => sent.push(next), onClose: () => {}, onTransform: (name, options) => asked.push([name, options]), now: () => (clock += 1000) })
    document.body.append(roll.element)
    roll.show({ id: 'c', startBeat: 0, lengthBeats: 4, notes }, { beatsPerBar: 4, label: 'Keys' })
    return { roll, asked, sent }
  }
  const rowLabel = pitch => [...document.querySelectorAll('.piano-roll-key')].find(k => k.textContent.startsWith(`${noteName(pitch)} `) || k.textContent === noteName(pitch))

  it('starts with none: no key, no fit button, no row marked', () => {
    open()
    expect(document.getElementById('roll-scale').options[0].textContent).toBe('None')
    expect(document.getElementById('roll-scale-key').parentNode.hidden).toBe(true)
    expect(document.getElementById('roll-fit-scale').hidden).toBe(true)
    expect(document.querySelectorAll('.off-scale')).toHaveLength(0)
  })

  it('marks the rows outside the chosen scale in words and a dot, and offers the key and Fit', () => {
    open()
    choose('roll-scale', 1) // major
    expect(document.getElementById('roll-scale-key').parentNode.hidden).toBe(false)
    expect(document.getElementById('roll-fit-scale').hidden).toBe(false)
    const black = rowLabel(61)
    expect(black.textContent).toBe('C#4 ·')
    expect(black.getAttribute('aria-label')).toBe('C sharp 4, outside the scale')
    expect(black.parentNode.classList.contains('off-scale')).toBe(true)
    expect(rowLabel(62).parentNode.classList.contains('off-scale')).toBe(false)
  })

  it('draws a pressed out-of-scale square as the nearest pitch in the scale', () => {
    const { sent } = open()
    choose('roll-scale', 1)
    cell(61, 8).dispatchEvent(pointer('pointerdown'))
    document.dispatchEvent(pointer('pointerup'))
    expect(sent.at(-1).at(-1).pitch).toBe(60)
  })

  it('snaps a dragged note into the scale', () => {
    const { sent } = open()
    choose('roll-scale', 1)
    cell(60, 0).dispatchEvent(pointer('pointerdown'))
    cell(61, 0).dispatchEvent(pointer('pointerover'))
    document.dispatchEvent(pointer('pointerup'))
    // 61 snaps to 60, which is where the note was: no change to send.
    expect(sent).toEqual([])
    cell(60, 0).dispatchEvent(pointer('pointerdown'))
    cell(62, 0).dispatchEvent(pointer('pointerover'))
    document.dispatchEvent(pointer('pointerup'))
    expect(sent.at(-1)[0].pitch).toBe(62)
  })

  it('asks to fit the notes to the chosen key and scale', () => {
    const { asked } = open()
    choose('roll-scale', 2) // minor
    choose('roll-scale-key', 9) // A
    click('roll-fit-scale')
    expect(asked).toEqual([['fitScale', { root: 9, scale: 'minor' }]])
  })

  it('goes back to none, and the marks and the button go with it', () => {
    open()
    choose('roll-scale', 1)
    choose('roll-scale', 0)
    expect(document.querySelectorAll('.off-scale')).toHaveLength(0)
    expect(document.getElementById('roll-fit-scale').hidden).toBe(true)
  })
})

describe('the transform buttons', () => {
  const click = id => document.getElementById(id).dispatchEvent(new window.Event('click', { bubbles: true }))
  function withTransform (notes) {
    const asked = []
    const roll = createPianoRoll(document, { onChange: () => {}, onClose: () => {}, onTransform: (name, options) => asked.push([name, options]) })
    document.body.append(roll.element)
    roll.show({ id: 'c', startBeat: 0, lengthBeats: 4, notes }, { beatsPerBar: 4, label: 'Keys' })
    return { roll, asked }
  }
  const note = { startBeat: 0, lengthBeats: 1, pitch: 60, velocity: 100 }

  it('quantizes part of the way when a strength is chosen, and says so', () => {
    const { asked } = withTransform([note])
    document.getElementById('roll-quantize-strength').options[2].selected = true
    click('roll-quantize')
    expect(asked).toEqual([['quantize', { grid: 0.25, strength: 0.5, ends: false }]])
    expect(document.querySelector('.piano-roll [role=status]').textContent).toBe('Quantized every note 50% of the way to the grid')
  })

  it('asks to move ends too when told to', () => {
    const { asked } = withTransform([note])
    document.getElementById('roll-quantize-ends').options[1].selected = true
    click('roll-quantize')
    expect(asked[0][1].ends).toBe(true)
  })

  it('asks for invert, and for humanize with a seed', () => {
    const { asked } = withTransform([note])
    click('roll-invert'); click('roll-humanize')
    expect(asked[0]).toEqual(['invert', {}])
    expect(asked[1][0]).toBe('humanize')
    expect(asked[1][1]).toMatchObject({ timing: 0.05, velocity: 10 })
    expect(Number.isInteger(asked[1][1].seed)).toBe(true)
  })

  it('ask for each transform with its amount', () => {
    const { asked } = withTransform([note])
    document.getElementById('roll-quantize-grid').options[1].selected = true
    for (const id of ['roll-quantize', 'roll-down', 'roll-octave-up', 'roll-softer', 'roll-louder', 'roll-reverse']) click(id)
    expect(asked).toEqual([
      ['quantize', { grid: 0.5, strength: 1, ends: false }], ['transpose', { semitones: -1 }], ['transpose', { semitones: 12 }],
      ['scaleVelocity', { factor: 0.8 }], ['scaleVelocity', { factor: 1.25 }], ['reverse', {}]
    ])
  })

  it('are not drawn for a clip with no notes', () => {
    withTransform([])
    expect(document.querySelector('.piano-roll-tools').hidden).toBe(true)
  })

  it('are left out when the host gives no way to act on them', () => {
    const roll = createPianoRoll(document, { onChange: () => {}, onClose: () => {} })
    document.body.append(roll.element)
    roll.show({ id: 'c', startBeat: 0, lengthBeats: 4, notes: [note] }, { beatsPerBar: 4, label: 'Keys' })
    expect(document.querySelector('.piano-roll-tools').hidden).toBe(true)
    expect(document.getElementById('roll-quantize')).toBeNull()
  })
})

describe('what the transform buttons say', () => {
  it('speaks what was done, and why an edit was refused', () => {
    let reply
    const roll = createPianoRoll(document, { onChange: () => {}, onClose: () => {}, onTransform: () => reply })
    document.body.append(roll.element)
    roll.show({ id: 'c', startBeat: 0, lengthBeats: 4, notes: [{ startBeat: 0, lengthBeats: 1, pitch: 60, velocity: 100 }] }, { beatsPerBar: 4, label: 'Keys' })
    const status = document.querySelector('.piano-roll [role=status]')
    document.getElementById('roll-up').dispatchEvent(new window.Event('click', { bubbles: true }))
    expect(status.textContent).toBe('Every note up a semitone')
    reply = 'would put pitch 120 outside 0 to 127'
    document.getElementById('roll-octave-up').dispatchEvent(new window.Event('click', { bubbles: true }))
    expect(status.textContent).toBe('Not changed: would put pitch 120 outside 0 to 127')
  })
})

describe('Escape', () => {
  it('closes the roll from the grid', () => {
    const { roll, closed } = build([{ startBeat: 0, lengthBeats: 1, pitch: 60, velocity: 100 }])
    const target = document.getElementById('roll-60-0')
    const e = new window.Event('keydown', { bubbles: true, cancelable: true })
    Object.defineProperty(e, 'key', { value: 'Escape' })
    target.dispatchEvent(e)
    expect(closed()).toBe(1)
    expect(e.defaultPrevented).toBe(true)
    expect(roll.clipId).toBe('c')
  })
})

describe('choosing notes', () => {
  const click = id => document.getElementById(id).dispatchEvent(new window.Event('click', { bubbles: true }))
  const three = [
    { startBeat: 0, lengthBeats: 1, pitch: 60, velocity: 100 },
    { startBeat: 1, lengthBeats: 1, pitch: 62, velocity: 100 },
    { startBeat: 2, lengthBeats: 1, pitch: 64, velocity: 100 }
  ]
  // Stands in for the host: applies the semitone shift to the indices it is given, sorted as the model sorts.
  function build3 () {
    let roll
    let clip = { id: 'c', startBeat: 0, lengthBeats: 4, notes: three }
    const asked = []
    roll = createPianoRoll(document, {
      onChange: () => {},
      onClose: () => {},
      onTransform: (name, options, { indices }) => {
        asked.push(indices)
        const notes = clip.notes.map((n, i) => (indices === null || indices.includes(i) ? { ...n, pitch: n.pitch + options.semitones } : n))
        clip = { ...clip, notes: notes.sort((a, b) => a.startBeat - b.startBeat || a.pitch - b.pitch) }
        roll.draw(clip)
      }
    })
    document.body.append(roll.element)
    roll.show(clip, { beatsPerBar: 4, label: 'Keys' })
    return { asked, clip: () => clip }
  }

  it('changes every note until some are chosen, then only those', () => {
    const { asked, clip } = build3()
    click('roll-up')
    expect(asked).toEqual([null])
    cell(63, 4).dispatchEvent(pointer('pointerdown', { shiftKey: true }))
    expect(cell(63, 4).getAttribute('aria-label')).toContain('chosen')
    click('roll-down')
    expect(asked[1]).toEqual([1])
    expect(document.querySelector('.piano-roll [role=status]').textContent).toBe('Chosen notes down a semitone')
    expect(clip().notes.map(n => n.pitch)).toEqual([61, 62, 65])
  })

  it('keeps the choice on the notes it became', () => {
    const { asked } = build3()
    key(document.activeElement, 's')
    click('roll-up')
    click('roll-up')
    expect(asked).toEqual([[0], [0]])
    expect(document.querySelectorAll('.piano-roll-cell.chosen.start').length).toBe(1)
  })

  it('chooses all with Ctrl+A, and Escape lets go before it closes', () => {
    let closed = 0
    const roll = createPianoRoll(document, { onChange: () => {}, onClose: () => { closed += 1 } })
    document.body.append(roll.element)
    roll.show({ id: 'c', startBeat: 0, lengthBeats: 4, notes: three }, { beatsPerBar: 4, label: 'Keys' })
    key(document.activeElement, 'a', { ctrlKey: true })
    expect(document.querySelectorAll('.piano-roll-cell.chosen.start').length).toBe(3)
    key(document.activeElement, 'Escape')
    expect(closed).toBe(0)
    expect(document.querySelectorAll('.piano-roll-cell.chosen').length).toBe(0)
    key(document.activeElement, 'Escape')
    expect(closed).toBe(1)
  })

  it('chooses the notes a shift-drag over empty squares touches, and edits nothing', () => {
    const sent = []
    const roll = createPianoRoll(document, { onChange: (...a) => sent.push(a), onClose: () => {} })
    document.body.append(roll.element)
    roll.show({ id: 'c', startBeat: 0, lengthBeats: 4, notes: three }, { beatsPerBar: 4, label: 'Keys' })
    // From an empty square above the first two notes down to the first note's row.
    cell(65, 0).dispatchEvent(pointer('pointerdown', { shiftKey: true }))
    cell(60, 5).dispatchEvent(pointer('pointerover'))
    expect(document.querySelectorAll('.piano-roll-cell.band').length).toBeGreaterThan(0)
    document.dispatchEvent(pointer('pointerup'))
    expect(document.querySelectorAll('.piano-roll-cell.band').length).toBe(0)
    expect(document.querySelectorAll('.piano-roll-cell.chosen.start').length).toBe(2)
    expect(cell(64, 8).getAttribute('aria-label')).not.toContain('chosen')
    expect(sent).toEqual([])
  })

  it('drops a cancelled drag without adding a note, and the next release commits only its own gesture', () => {
    const { sent } = build()
    cell(60, 0).dispatchEvent(pointer('pointerdown'))
    cell(60, 3).dispatchEvent(pointer('pointerover'))
    document.dispatchEvent(pointer('pointercancel'))
    document.dispatchEvent(pointer('pointerup'))
    expect(sent).toEqual([])
    // A press whose release never came is replaced by the next press, not committed beside it.
    cell(60, 0).dispatchEvent(pointer('pointerdown'))
    cell(62, 8).dispatchEvent(pointer('pointerdown'))
    document.dispatchEvent(pointer('pointerup'))
    expect(sent).toHaveLength(1)
    expect(sent[0]).toEqual([{ startBeat: 2, lengthBeats: 1, pitch: 62, velocity: 100 }])
  })

  it('keeps a chosen note chosen when it is dragged to a new place', () => {
    const { roll } = build([{ startBeat: 0, lengthBeats: 1, pitch: 60, velocity: 100 }])
    cell(60, 0).dispatchEvent(pointer('pointerdown', { shiftKey: true }))
    expect(cell(60, 0).getAttribute('aria-label')).toContain('chosen')
    cell(60, 0).dispatchEvent(pointer('pointerdown'))
    cell(62, 4).dispatchEvent(pointer('pointerover'))
    document.dispatchEvent(pointer('pointerup'))
    expect(cell(62, 4).getAttribute('aria-label')).toContain('chosen')
    expect(roll.clipId).toBe('c')
  })

  it('toggles a note with a shift press', () => {
    build3()
    cell(62, 4).dispatchEvent(pointer('pointerdown', { shiftKey: true }))
    expect(cell(62, 4).getAttribute('aria-label')).toContain('chosen')
    cell(62, 4).dispatchEvent(pointer('pointerdown', { shiftKey: true }))
    expect(cell(62, 4).getAttribute('aria-label')).not.toContain('chosen')
  })
})
