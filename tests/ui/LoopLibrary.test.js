// tests/ui/LoopLibrary.test.js
//
// The loop library: what is accepted as a loop and what is refused with its id, how loops are grouped and described, the change that adds one, the
// events that play one, and the dialog. The real library file is checked as well, since a library that does not load is a dialog with nothing in it.
import { describe, it, expect, beforeEach } from 'vitest'
import { parseHTML } from 'linkedom'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { KINDS, checkLoop, loopsFromIndex, groupsOf, lengthText, addClipChange, eventsFor, createLoopBrowser } from '../../src/ui/LoopLibrary.js'

let document
let window
beforeEach(() => { ({ document, window } = parseHTML('<!doctype html><body></body>')) })

const loop = over => ({
  id: 'rock', label: 'Rock', kind: 'drums', lengthBeats: 4, about: 'A beat.', licence: 'CC0-1.0',
  notes: [{ startBeat: 0, lengthBeats: 0.25, pitch: 36, velocity: 100 }, { startBeat: 2, lengthBeats: 0.25, pitch: 38, velocity: 100 }], ...over
})

describe('checkLoop', () => {
  it('accepts a loop with everything in it', () => {
    expect(checkLoop(loop())).toMatchObject({ id: 'rock' })
  })

  it('refuses each malformed part, naming the loop and the reason, and repairs nothing', () => {
    const cases = [
      [{ id: 'Bad Id' }, /needs an id/],
      [{ label: '' }, /needs a label/],
      [{ kind: 'vocals' }, /kind vocals/],
      [{ about: '' }, /needs a line/],
      [{ licence: '' }, /needs a licence/],
      [{ lengthBeats: 0 }, /length in beats above zero/],
      [{ notes: [] }, /at least one note/],
      [{ notes: [{ startBeat: -1, lengthBeats: 1, pitch: 60, velocity: 90 }] }, /note 0 starts before the loop/],
      [{ notes: [{ startBeat: 0, lengthBeats: 0, pitch: 60, velocity: 90 }] }, /note 0 has no length/],
      [{ notes: [{ startBeat: 4, lengthBeats: 1, pitch: 60, velocity: 90 }] }, /starts at or after the end/],
      [{ notes: [{ startBeat: 3.5, lengthBeats: 1, pitch: 60, velocity: 90 }] }, /runs past the end/],
      [{ notes: [{ startBeat: 0, lengthBeats: 1, pitch: 128, velocity: 90 }] }, /pitch 128/],
      [{ notes: [{ startBeat: 0, lengthBeats: 1, pitch: 60.5, velocity: 90 }] }, /pitch 60.5/],
      [{ notes: [{ startBeat: 0, lengthBeats: 1, pitch: 60, velocity: 0 }] }, /velocity 0/],
      [{ notes: [{ startBeat: 0, lengthBeats: 1, pitch: 60, velocity: 128 }] }, /velocity 128/]
    ]
    for (const [over, pattern] of cases) expect(() => checkLoop(loop(over)), JSON.stringify(over)).toThrow(pattern)
    expect(() => checkLoop(loop({ id: 'x' , kind: 'vocals' }))).toThrow(/^loop x:/)
  })

  it('refuses something that is not an object', () => {
    expect(() => checkLoop(null)).toThrow(/is not an object/)
  })
})

describe('loopsFromIndex', () => {
  it('returns the checked loops', () => {
    expect(loopsFromIndex({ loops: [loop(), loop({ id: 'house' })] }).map(l => l.id)).toEqual(['rock', 'house'])
  })

  it('refuses a missing list and two loops with one id', () => {
    expect(() => loopsFromIndex({})).toThrow(/no loops list/)
    expect(() => loopsFromIndex(null)).toThrow(/no loops list/)
    expect(() => loopsFromIndex({ loops: [loop(), loop()] })).toThrow(/another loop has the same id/)
  })
})

describe('groupsOf and lengthText', () => {
  it('groups by kind in the order of KINDS and leaves out a kind with nothing', () => {
    const groups = groupsOf([loop({ id: 'a', kind: 'melody' }), loop({ id: 'b', kind: 'drums' }), loop({ id: 'c', kind: 'drums' })])
    expect(groups.map(g => g.heading)).toEqual(['Drums', 'Melody'])
    expect(groups[0].loops.map(l => l.id)).toEqual(['b', 'c'])
    expect(KINDS.map(k => k.kind)).toEqual(['drums', 'bass', 'chords', 'melody'])
  })

  it('says a length in bars when it is a whole number of them, and in beats when not', () => {
    expect(lengthText({ lengthBeats: 4 })).toBe('1 bar')
    expect(lengthText({ lengthBeats: 8 })).toBe('2 bars')
    expect(lengthText({ lengthBeats: 6 })).toBe('6 beats')
    expect(lengthText({ lengthBeats: 6 }, 3)).toBe('2 bars')
  })
})

describe('addClipChange', () => {
  it('is one addClip at the beat, the loop\'s length, and its notes', () => {
    const change = addClipChange({ loop: loop(), track: 't1', startBeat: 8 })
    expect(change).toMatchObject({ op: 'addClip', track: 't1', kind: 'midi', startBeat: 8, lengthBeats: 4 })
    expect(change.notes).toHaveLength(2)
  })

  it('copies the notes, so editing the clip does not change the library', () => {
    const source = loop()
    const change = addClipChange({ loop: source, track: 't1', startBeat: 0 })
    change.notes[0].pitch = 99
    expect(source.notes[0].pitch).toBe(36)
  })

  it('refuses a start before the beginning, rather than clamping it', () => {
    expect(() => addClipChange({ loop: loop(), track: 't', startBeat: -1 })).toThrow(/at or after the start/)
    expect(() => addClipChange({ loop: loop(), track: 't', startBeat: NaN })).toThrow()
  })
})

describe('eventsFor', () => {
  const options = { bpm: 120, sampleRate: 48000, startFrame: 1000 }

  it('puts each note on at its beat and its note off after, at the tempo, from the start frame', () => {
    const events = eventsFor(loop(), options)
    // 120 bpm is half a second a beat: 24000 frames.
    expect(events.map(e => [e.frame, e.bytes[0], e.bytes[1]])).toEqual([
      [1000, 0x90, 36], [1000 + 6000, 0x80, 36], [1000 + 48000, 0x90, 38], [1000 + 48000 + 6000, 0x80, 38]
    ])
  })

  it('is in time order, with a note off before a note on at the same frame, so a repeated pitch is cut and then struck', () => {
    const repeated = loop({ notes: [{ startBeat: 0, lengthBeats: 1, pitch: 60, velocity: 90 }, { startBeat: 1, lengthBeats: 1, pitch: 60, velocity: 90 }] })
    const events = eventsFor(repeated, options)
    expect(events.map(e => e.frame)).toEqual([...events.map(e => e.frame)].sort((a, b) => a - b))
    const atSecondBeat = events.filter(e => e.frame === 1000 + 24000)
    expect(atSecondBeat.map(e => e.bytes[0])).toEqual([0x80, 0x90])
  })

  it('sends a note off for every note on', () => {
    const events = eventsFor(loop(), options)
    expect(events.filter(e => e.bytes[0] === 0x90)).toHaveLength(events.filter(e => e.bytes[0] === 0x80).length)
  })

  it('scales with the tempo', () => {
    const slow = eventsFor(loop(), { ...options, bpm: 60 })
    const fast = eventsFor(loop(), { ...options, bpm: 240 })
    expect(slow.at(-1).frame - 1000).toBe((fast.at(-1).frame - 1000) * 4)
  })

  it('refuses a tempo or a sample rate that is not above zero', () => {
    expect(() => eventsFor(loop(), { ...options, bpm: 0 })).toThrow(/tempo and a sample rate/)
    expect(() => eventsFor(loop(), { ...options, sampleRate: 0 })).toThrow()
  })
})

describe('the real library', () => {
  const index = JSON.parse(readFileSync(resolve(import.meta.dirname, '../../web/loops/index.json'), 'utf8'))
  const loops = loopsFromIndex(index)

  it('loads, with every kind and a handful of loops in each', () => {
    expect(loops.length).toBeGreaterThanOrEqual(12)
    for (const k of KINDS) expect(loops.filter(l => l.kind === k.kind).length, k.kind).toBeGreaterThanOrEqual(3)
  })

  it('is offered under one licence that each loop says, so a person can tell what they may do with it', () => {
    expect(index.licence).toBe('CC0-1.0')
    for (const l of loops) expect(l.licence, l.id).toBe('CC0-1.0')
  })

  it('has loops whose length is a whole number of bars, so they repeat on the bar line', () => {
    for (const l of loops) expect(Number.isInteger(l.lengthBeats / 4), l.id).toBe(true)
  })

  it('keeps each kind in its own register, so a bass loop is low and a melody is not', () => {
    const range = kind => loops.filter(l => l.kind === kind).flatMap(l => l.notes.map(n => n.pitch))
    expect(Math.max(...range('bass'))).toBeLessThan(55)
    expect(Math.min(...range('melody'))).toBeGreaterThanOrEqual(55)
    expect(Math.min(...range('drums'))).toBeGreaterThanOrEqual(35)
    expect(Math.max(...range('drums'))).toBeLessThanOrEqual(59)
  })

  it('says what each is in a sentence, and does not use an em dash', () => {
    for (const l of loops) {
      expect(l.about, l.id).toMatch(/[.!?]$/)
      expect(l.about.includes(String.fromCharCode(0x2014)), l.id).toBe(false)
    }
  })
})

describe('the loop dialog', () => {
  const groups = [{ heading: 'Drums', kind: 'drums', loops: [loop()] }, { heading: 'Bass', kind: 'bass', loops: [loop({ id: 'walk', label: 'Walk', kind: 'bass', lengthBeats: 8 })] }]
  const build = (options = {}) => {
    const calls = []
    const browser = createLoopBrowser(document, { groups, canHear: true, onHear: l => calls.push(`hear ${l.id}`), onAdd: l => calls.push(`add ${l.id}`), onClose: () => calls.push('close'), ...options })
    document.body.append(browser.element)
    return { ...browser, calls }
  }
  const click = (name) => [...document.querySelectorAll('button')].find(b => b.getAttribute('aria-label') === name || b.textContent === name).dispatchEvent(new window.Event('click', { bubbles: true }))

  it('is a named dialog with a status line, and a heading and a list for each kind', () => {
    const { element } = build()
    expect(element.getAttribute('aria-labelledby')).toBe('loops-title')
    expect(element.querySelector('[role="status"]')).not.toBeNull()
    expect([...element.querySelectorAll('h3')].map(h => h.textContent)).toEqual(['Drums', 'Bass'])
    for (const list of element.querySelectorAll('ul.sound-list')) expect(document.getElementById(list.getAttribute('aria-labelledby')).tagName).toBe('H3')
  })

  it('says each loop\'s length in words beside its name, with a name on each button that says which loop', () => {
    const { element } = build()
    expect([...element.querySelectorAll('.sound-mark')].map(m => m.textContent)).toEqual(['(1 bar)', '(2 bars)'])
    expect([...element.querySelectorAll('li button')].map(b => b.getAttribute('aria-label'))).toEqual(['Hear Rock', 'Add Rock', 'Hear Walk', 'Add Walk'])
  })

  it('runs what was pressed, with the loop, and Close, and Escape as Close', () => {
    const { calls, element } = build()
    click('Hear Walk')
    click('Add Rock')
    click('Close')
    element.dispatchEvent(new window.Event('cancel'))
    expect(calls).toEqual(['hear walk', 'add rock', 'close', 'close'])
  })

  it('leaves Hear out, and says what to do, where there is no instrument to play through', () => {
    const { element } = build({ canHear: false })
    expect([...element.querySelectorAll('li button')].map(b => b.getAttribute('aria-label'))).toEqual(['Add Rock', 'Add Walk'])
    expect(element.querySelector('p.note').textContent).toMatch(/Select a track with an instrument to hear/)
  })

  it('can decide Hear loop by loop, so a drum loop is offered Hear where a bass loop is not', () => {
    const { element } = build({ canHear: l => l.kind === 'drums' })
    expect([...element.querySelectorAll('li button')].map(b => b.getAttribute('aria-label'))).toEqual(['Hear Rock', 'Add Rock', 'Add Walk'])
    expect(element.querySelector('p.note').textContent).not.toMatch(/Select a track with an instrument to hear/)
  })

  it('says what to do only when no loop at all can be heard', () => {
    const { element } = build({ canHear: () => false })
    expect(element.querySelector('p.note').textContent).toMatch(/Select a track with an instrument to hear/)
  })

  it('says there are none, rather than showing an empty dialog, when it has no loops', () => {
    const { element } = build({ groups: [] })
    expect(element.textContent).toMatch(/There are no loops to offer/)
  })
})
