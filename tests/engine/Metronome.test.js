// tests/engine/Metronome.test.js
import { describe, it, expect } from 'vitest'
import { Transport } from '../../src/engine/Transport.js'
import { Metronome, clicksBetween, countIn } from '../../src/engine/Metronome.js'

const transport = (over = {}) => new Transport({ sampleRate: 48000, tempoPoints: [{ atBeat: 0, bpm: 120, curve: 'step' }], beatsPerBar: 4, beatUnit: 4, ...over })
// 120 bpm: a beat is half a second.

describe('clicksBetween', () => {
  it('puts a click on every beat, and the accent on the first of each bar', () => {
    const found = clicksBetween(transport(), 0, 4.2)
    expect(found.map(c => c.at)).toEqual([0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4])
    expect(found.map(c => c.accent)).toEqual([true, false, false, false, true, false, false, false, true])
  })

  it('fires a click in the window that contains it, and only once, whatever the window edges', () => {
    const t = transport()
    const a = clicksBetween(t, 0, 0.73)
    const b = clicksBetween(t, 0.73, 1.19)
    const c = clicksBetween(t, 1.19, 2.3)
    expect([...a, ...b, ...c].map(x => x.at)).toEqual([0, 0.5, 1, 1.5, 2])
  })

  it('does not drop a click that sits exactly on a window edge', () => {
    const t = transport()
    expect(clicksBetween(t, 0, 0.5).map(c => c.at)).toEqual([0])
    expect(clicksBetween(t, 0.5, 1).map(c => c.at)).toEqual([0.5])
  })

  it('keeps time through a loop, so the accent returns at the loop start', () => {
    // A two-beat loop at 120 bpm is one second; beats 0 and 1 repeat.
    const t = transport({ loopStart: 0, loopEnd: 2, loopEnabled: true })
    const found = clicksBetween(t, 0, 3.2)
    expect(found.map(c => c.at)).toEqual([0, 0.5, 1, 1.5, 2, 2.5, 3])
    expect(found.map(c => c.accent)).toEqual([true, false, true, false, true, false, true])
  })

  it('follows a tempo change', () => {
    const t = transport({ tempoPoints: [{ atBeat: 0, bpm: 120, curve: 'step' }, { atBeat: 2, bpm: 60, curve: 'step' }] })
    expect(clicksBetween(t, 0, 3.9).map(c => c.at)).toEqual([0, 0.5, 1, 2, 3])
  })
})

describe('countIn', () => {
  it('is whole bars of clicks ending a beat before zero, with the accent first', () => {
    const { clicks, duration } = countIn(transport(), 1)
    expect(clicks.map(c => c.at)).toEqual([-2, -1.5, -1, -0.5])
    expect(clicks.map(c => c.accent)).toEqual([true, false, false, false])
    expect(duration).toBe(2)
  })

  it('is nothing for no bars, and refuses a part of a bar or a negative one', () => {
    expect(countIn(transport(), 0)).toEqual({ clicks: [], duration: 0 })
    expect(() => countIn(transport(), 1.5)).toThrow(/whole number of bars/)
    expect(() => countIn(transport(), -1)).toThrow(/whole number of bars/)
  })
})

describe('Metronome', () => {
  const build = ({ enabled = () => true } = {}) => {
    let time = 10
    const made = []
    const m = new Metronome({ now: () => time, lookahead: 0.12, transport: () => transport(), click: (when, accent) => made.push([when, accent]), enabled })
    return { m, made, at: t => { time = t } }
  }

  it('refuses to be built without what it needs', () => {
    expect(() => new Metronome({ now: () => 0, lookahead: 0.1 })).toThrow(/needs/)
    expect(() => new Metronome({ now: () => 0, lookahead: 0, transport: () => 0, click () {}, enabled: () => true })).toThrow(/lookahead/)
  })

  it('makes each click once across ticks, at the audio clock time it is due', () => {
    const { m, made, at } = build()
    m.start(10)
    for (const t of [10, 10.1, 10.2, 10.3, 10.4, 10.5, 10.6, 10.7, 10.8, 10.9, 11.0, 11.1]) { at(t); m.tick() }
    expect(made.map(c => c[0])).toEqual([10, 10.5, 11])
    expect(made[0][1]).toBe(true)
  })

  it('makes nothing while switched off, and starts from the next beat when switched on', () => {
    let on = false
    const { m, made, at } = build({ enabled: () => on })
    m.start(10)
    at(10.0); m.tick(); at(10.4); m.tick()
    expect(made).toEqual([])
    on = true
    // The 10.5 click fell in a window that was ticked while it was off, so it is not made late: the next one is.
    at(10.45); m.tick()
    expect(made).toEqual([])
    at(10.95); m.tick()
    expect(made.map(c => c[0])).toEqual([11])
  })

  it('makes nothing before it is started or after it is stopped', () => {
    const { m, made, at } = build()
    m.tick()
    m.start(10); m.stop(); at(10.2); m.tick()
    expect(made).toEqual([])
  })
})
