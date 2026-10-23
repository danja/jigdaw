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

describe('the velocity lane', () => {
  const lane = () => document.getElementById('roll-lane-velocity')
  const bars = () => [...lane().querySelectorAll('[role=slider]')]
  const two = [{ startBeat: 0, lengthBeats: 1, pitch: 60, velocity: 100 }, { startBeat: 1, lengthBeats: 1, pitch: 64, velocity: 50 }]

  it('has a bar for each note, named by its pitch and place, with the velocity as the value', () => {
    build(two)
    expect(bars().map(b => b.getAttribute('aria-valuenow'))).toEqual(['100', '50'])
    expect(bars()[1].getAttribute('aria-label')).toBe('Velocity of E4 at bar 1 beat 2')
    expect(bars()[1].getAttribute('aria-valuetext')).toBe('50, E4 at bar 1 beat 2')
  })

  it('is left out of a clip with no notes, and comes back with the first', () => {
    const ctx = build()
    expect(lane().hidden).toBe(true)
    key(document.querySelector('[role=grid] [tabindex="0"]'), 'Enter')
    expect(ctx.clip().notes).toHaveLength(1)
    expect(lane().hidden).toBe(false)
  })

  it('sends the whole list with one note changed, as one edit, from a key on a bar', () => {
    const ctx = build(two)
    key(bars()[1], 'ArrowUp', { shiftKey: true })
    expect(ctx.sent).toHaveLength(1)
    expect(ctx.sent[0].map(n => [n.pitch, n.velocity])).toEqual([[60, 100], [64, 60]])
    expect(document.querySelector('.piano-roll [role=status]').textContent).toBe('Velocity 60, E4 at bar 1 beat 2')
    expect(bars()[1].getAttribute('aria-valuenow')).toBe('60')
  })

  it('marks the chosen notes, and follows a note edited in the grid', () => {
    build(two)
    cell(64, 4).dispatchEvent(pointer('pointerdown', { shiftKey: true }))
    expect(bars().map(b => b.classList.contains('chosen'))).toEqual([false, true])
    key(document.querySelector('[role=grid] [tabindex="0"]'), 'ArrowUp', { altKey: true })
    expect(bars()[1].getAttribute('aria-valuenow')).toBe('60')
  })

  it('lines each bar up with its column, in the same units as the grid', () => {
    build(two)
    expect(bars()[1].style.left).toBe('calc(1 * var(--steps-per-beat, 4) * var(--cell) + 0 * var(--cell) / 1)')
    expect(lane().style.getPropertyValue('--steps')).toBe(String(document.querySelector('[role=grid]').getAttribute('aria-colcount') - 1))
  })
})

describe('the controller and pitch bend lanes', () => {
  const sent = []
  const open = (controllers = [], { give = true } = {}) => {
    sent.length = 0
    const roll = createPianoRoll(document, { onChange: () => {}, onClose: () => {}, ...(give ? { onControllers: (id, list) => sent.push([id, list]) } : {}) })
    document.body.append(roll.element)
    const clip = { id: 'c', startBeat: 0, lengthBeats: 4, notes: [{ startBeat: 0, lengthBeats: 1, pitch: 60, velocity: 100 }], controllers }
    roll.show(clip, { beatsPerBar: 4, label: 'Keys' })
    return { roll, clip }
  }
  const choose = value => {
    const select = document.getElementById('roll-lane')
    ;[...select.options].find(o => o.value === value).selected = true
    select.dispatchEvent(new window.Event('change', { bubbles: true }))
  }
  const lane = () => document.getElementById('roll-lane-controller')
  const bars = () => [...lane().querySelectorAll('[role=slider]')]
  const ev = (atBeat, controller, value) => ({ atBeat, controller, value })

  it('offers no chooser to a host that cannot store events', () => {
    open([], { give: false })
    expect(document.getElementById('roll-lane')).toBeNull()
    expect(document.getElementById('roll-lane-velocity').hidden).toBe(false)
  })

  it('starts on velocity, and swaps it for the controller chosen, one lane at a time', () => {
    open([ev(0, 7, 100)])
    expect(document.getElementById('roll-lane').value).toBe('velocity')
    expect(lane()).toBeNull()
    choose('7')
    expect(document.getElementById('roll-lane-velocity').hidden).toBe(true)
    expect(bars().map(b => b.getAttribute('aria-valuenow'))).toEqual(['100'])
    choose('velocity')
    expect(document.getElementById('roll-lane-velocity').hidden).toBe(false)
    expect(lane()).toBeNull()
  })

  it('shows only the events of the controller chosen, named and spoken, with pitch bend in words', () => {
    open([ev(0, 7, 100), ev(1, 1, 5), ev(2, 'pitchBend', -2000), ev(3, 'pitchBend', 0), ev(3, 7, 50)])
    choose('7')
    expect(bars().map(b => b.getAttribute('aria-label'))).toEqual(['Volume at bar 1 beat 1', 'Volume at bar 1 beat 4'])
    choose('pitchBend')
    expect(bars().map(b => b.getAttribute('aria-valuetext'))).toEqual(['-2000, bent down, at bar 1 beat 3', '0, centre, at bar 1 beat 4'])
    expect([bars()[0].getAttribute('aria-valuemin'), bars()[0].getAttribute('aria-valuemax')]).toEqual(['-8192', '8191'])
  })

  it('sends the whole list with one value changed, keeping the other controllers, from a key', () => {
    open([ev(0, 7, 100), ev(1, 1, 5), ev(2, 7, 50)])
    choose('7')
    key(bars()[1], 'ArrowUp', { shiftKey: true })
    expect(sent).toEqual([['c', [ev(0, 7, 100), ev(1, 1, 5), ev(2, 7, 60)]]])
  })

  it('steps a pitch bend in large amounts, as one by one would take forever across 16000 values', () => {
    open([ev(0, 'pitchBend', 0)])
    choose('pitchBend')
    key(bars()[0], 'ArrowUp')
    key(bars()[0], 'PageUp')
    expect(sent.map(([, list]) => list[0].value)).toEqual([64, 1024])
  })

  it('adds an event where the empty lane is pressed, at the step, replacing one already there', () => {
    open([ev(0, 7, 100)])
    choose('7')
    lane().querySelector('.piano-roll-lane-bars').getBoundingClientRect = () => ({ top: 0, left: 0, width: 400, height: 96 })
    const press = (x, y) => lane().querySelector('.piano-roll-lane-bars').dispatchEvent(Object.assign(new window.Event('pointerdown', { bubbles: true, cancelable: true }), { button: 0, clientX: x, clientY: y }))
    const columns = Number(document.getElementById('roll-lane-controller').style.getPropertyValue('--steps'))
    // A quarter of the way along is a quarter of the columns in, which is the step at beat (columns / 4) / 4.
    press(100, 48)
    expect(sent.at(-1)[1].find(e => e.atBeat !== 0)).toEqual(ev(Math.floor(columns / 4) / 4, 7, 64))
    // At the very start it replaces the event there rather than doubling it.
    press(0, 0)
    expect(sent.at(-1)[1]).toEqual([ev(0, 7, 127)])
  })

  it('removes the focused event with Delete', () => {
    open([ev(0, 7, 100), ev(1, 7, 90)])
    choose('7')
    key(bars()[0], 'Delete')
    expect(sent).toEqual([['c', [ev(1, 7, 90)]]])
  })

  it('takes any controller number, and says when the number is not one instead of drawing a lane', () => {
    open([ev(0, 74, 33)])
    choose('other')
    const number = document.getElementById('roll-lane-number')
    expect(number.parentNode.hidden).toBe(false)
    number.value = '74'
    number.dispatchEvent(new window.Event('change', { bubbles: true }))
    expect(bars().map(b => b.getAttribute('aria-valuenow'))).toEqual(['33'])
    expect(bars()[0].getAttribute('aria-label')).toBe('Controller 74 at bar 1 beat 1')
    number.value = '200'
    number.dispatchEvent(new window.Event('change', { bubbles: true }))
    expect(lane()).toBeNull()
    expect(number.getAttribute('aria-invalid')).toBe('true')
  })

  it('shows a lane for a clip with no events yet, so one can be added', () => {
    open([])
    choose('1')
    expect(lane()).not.toBeNull()
    expect(bars()).toHaveLength(0)
  })
})

describe('step input', () => {
  const grid = () => document.querySelector('[role=grid]')
  const press = (k, mods = {}) => key(grid().querySelector('[tabindex="0"]'), k, mods)
  const on = () => document.getElementById('roll-step').dispatchEvent(new window.Event('click', { bubbles: true }))
  const click = id => document.getElementById(id).dispatchEvent(new window.Event('click', { bubbles: true }))
  const choose = (id, index) => { document.getElementById(id).options[index].selected = true; document.getElementById(id).dispatchEvent(new window.Event('change', { bubbles: true })) }
  const cursorAt = () => { const c = grid().querySelector('[tabindex="0"]'); return [Number(c.dataset.pitch), Number(c.dataset.step)] }
  const pairs = ctx => ctx.clip().notes.map(n => [n.startBeat, n.pitch, n.lengthBeats])

  it('is off to start, with only its switch drawn, and available in an empty clip', () => {
    build()
    const toggle = document.getElementById('roll-step')
    expect(toggle.getAttribute('aria-pressed')).toBe('false')
    expect(document.querySelector('.piano-roll-step-body').hidden).toBe(true)
    on()
    expect(toggle.getAttribute('aria-pressed')).toBe('true')
    expect(document.querySelector('.piano-roll-step-body').hidden).toBe(false)
  })

  it('enters a note of the step length at the cursor from a key, and moves on by that length', () => {
    const ctx = build()
    on()
    press('a')
    expect(pairs(ctx)).toEqual([[0, 60, 1]])
    expect(cursorAt()).toEqual([60, 4])
    press('d')
    press('g')
    expect(pairs(ctx)).toEqual([[0, 60, 1], [1, 64, 1], [2, 67, 1]])
    expect(cursorAt()).toEqual([67, 12])
  })

  it('follows the step length and the octave', () => {
    const ctx = build()
    on()
    choose('roll-step-length', 0)
    press('x')
    press('a')
    press('s')
    expect(pairs(ctx)).toEqual([[0, 72, 0.25], [0.25, 74, 0.25]])
    expect(document.getElementById('roll-step-octave').textContent).toBe('Octave 5')
    press('z'); press('z')
    press('a')
    expect(ctx.clip().notes.at(-1).pitch).toBe(48)
  })

  it('holds the step for a chord with Shift, or with the Chord switch', () => {
    const ctx = build()
    on()
    press('A', { shiftKey: true })
    press('d', { shiftKey: true })
    press('g')
    expect(pairs(ctx)).toEqual([[0, 60, 1], [0, 64, 1], [0, 67, 1]])
    expect(cursorAt()[1]).toBe(4)
    click('roll-step-chord')
    press('a')
    press('d')
    expect(pairs(ctx).filter(n => n[0] === 1)).toEqual([[1, 60, 1], [1, 64, 1]])
    expect(cursorAt()[1]).toBe(4)
  })

  it('rests with Space, and steps back with Backspace, clearing what starts there', () => {
    const ctx = build()
    on()
    press('a')
    press(' ')
    expect(cursorAt()[1]).toBe(8)
    expect(pairs(ctx)).toEqual([[0, 60, 1]])
    press('Backspace')
    expect(cursorAt()[1]).toBe(4)
    expect(pairs(ctx)).toEqual([[0, 60, 1]])
    press('Backspace')
    expect(cursorAt()[1]).toBe(0)
    expect(pairs(ctx)).toEqual([])
  })

  it('replaces the same note entered again in the same place, and does not run past either end', () => {
    const ctx = build()
    on()
    press('a', { shiftKey: true })
    press('a', { shiftKey: true })
    expect(pairs(ctx)).toEqual([[0, 60, 1]])
    press('Backspace')
    press('Backspace')
    expect(cursorAt()[1]).toBe(0)
    for (let i = 0; i < 9; i++) press('x')
    expect(document.getElementById('roll-step-octave').textContent).toBe('Octave 8')
    expect(document.getElementById('roll-step-octave-up').hidden).toBe(true)
  })

  it('does the same from the buttons, for a touch screen with no keyboard', () => {
    const ctx = build()
    on()
    click('roll-step-note-0')
    click('roll-step-note-4')
    click('roll-step-rest')
    click('roll-step-octave-up')
    click('roll-step-note-0')
    expect(pairs(ctx)).toEqual([[0, 60, 1], [1, 64, 1], [3, 72, 1]])
    click('roll-step-back')
    expect(pairs(ctx)).toEqual([[0, 60, 1], [1, 64, 1]])
    expect(document.getElementById('roll-step-note-0').getAttribute('aria-label')).toBe('Enter C5')
  })

  it('gives each note button a name that says the octave, and the buttons a face for touch', () => {
    build()
    on()
    expect([...document.querySelectorAll('.piano-roll-step-notes button')].map(b => b.getAttribute('aria-label')).slice(0, 3)).toEqual(['Enter C4', 'Enter C#4', 'Enter D4'])
  })

  it('takes the keys only while on, so S still chooses a note and A does nothing', () => {
    const ctx = build([{ startBeat: 0, lengthBeats: 1, pitch: 60, velocity: 100 }])
    press('a')
    expect(pairs(ctx)).toEqual([[0, 60, 1]])
    press('s')
    expect(document.querySelectorAll('.piano-roll-cell.chosen').length).toBeGreaterThan(0)
    key(grid().querySelector('[tabindex="0"]'), 's')
    on()
    // Chosen cells stay as they were, and S now enters D rather than toggling.
    press('s')
    expect(pairs(ctx).some(n => n[1] === 62)).toBe(true)
  })

  it('leaves Ctrl and Alt chords to the roll', () => {
    const ctx = build([{ startBeat: 0, lengthBeats: 1, pitch: 60, velocity: 100 }])
    on()
    press('a', { ctrlKey: true })
    expect(pairs(ctx)).toEqual([[0, 60, 1]])
    expect(document.querySelectorAll('.piano-roll-cell.chosen.start').length).toBe(1)
  })

  it('lands each entered note in the scale when one is chosen', () => {
    const ctx = build()
    document.getElementById('roll-scale').options[1].selected = true
    document.getElementById('roll-scale').dispatchEvent(new window.Event('change', { bubbles: true }))
    on()
    press('w')
    expect(pairs(ctx)).toEqual([[0, 60, 1]])
  })

  it('is switched off again when the roll closes', () => {
    const ctx = build()
    on()
    ctx.roll.hide()
    expect(document.getElementById('roll-step').getAttribute('aria-pressed')).toBe('false')
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

  it('asks for legato and for an upward strum', () => {
    const { asked } = withTransform([note])
    click('roll-legato'); click('roll-strum')
    expect(asked).toEqual([['legato', {}], ['strum', { spread: 0.0625, direction: 'up' }]])
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
