// tests/engine/Transport.test.js
import { describe, it, expect } from 'vitest'
import { Transport } from '../../src/engine/Transport.js'

const at = (bpm, sampleRate = 48000) =>
  new Transport({ tempoPoints: [{ atBeat: 0, bpm }], sampleRate })

describe('a constant tempo', () => {
  it('puts a beat at the right place', () => {
    expect(at(120).secondsAtBeat(1)).toBeCloseTo(0.5, 10)
    expect(at(60).secondsAtBeat(4)).toBeCloseTo(4, 10)
  })

  it('advances by frames', () => {
    expect(at(120).positionAtElapsed(48000).beat).toBeCloseTo(2, 10)
  })

  it('reports beats per frame, which is what a plugin advances by', () => {
    expect(at(120).beatsPerFrame(0)).toBeCloseTo(120 / 60 / 48000, 12)
  })

  it('starts at zero rather than somewhere', () => {
    expect(at(120).positionAtElapsed(0).beat).toBe(0)
    expect(at(120).secondsAtBeat(-5)).toBe(0)
  })
})

describe('a tempo map', () => {
  const map = new Transport({
    tempoPoints: [{ atBeat: 0, bpm: 120 }, { atBeat: 4, bpm: 240 }],
    sampleRate: 48000
  })

  it('applies each tempo from the beat it takes effect at', () => {
    expect(map.secondsAtBeat(4)).toBeCloseTo(2, 10)
    expect(map.secondsAtBeat(8)).toBeCloseTo(3, 10)
  })

  it('inverts exactly, so a position round trips', () => {
    for (const beat of [0, 1, 3.5, 4, 4.001, 7, 12]) {
      expect(map.beatAtSeconds(map.secondsAtBeat(beat))).toBeCloseTo(beat, 9)
    }
  })

  it('reports the tempo in force, not the nearest one', () => {
    expect(map.tempoAtBeat(3.999)).toBe(120)
    expect(map.tempoAtBeat(4)).toBe(240)
    expect(map.tempoAtBeat(1000)).toBe(240)
  })

  it('takes points in any order, because a map is keyed by beat', () => {
    const shuffled = new Transport({ tempoPoints: [{ atBeat: 4, bpm: 240 }, { atBeat: 0, bpm: 120 }] })
    expect(shuffled.secondsAtBeat(8)).toBeCloseTo(map.secondsAtBeat(8), 10)
  })

  it('covers the opening bars when the map does not start at zero', () => {
    const late = new Transport({ tempoPoints: [{ atBeat: 8, bpm: 90 }] })
    expect(late.tempoAtBeat(0)).toBe(90)
    expect(late.secondsAtBeat(1)).toBeCloseTo(60 / 90, 10)
  })

  it('falls back to a usable tempo rather than dividing by zero', () => {
    const empty = new Transport({ tempoPoints: [] })
    expect(empty.tempoAtBeat(0)).toBe(120)
    expect(Number.isFinite(empty.secondsAtBeat(4))).toBe(true)
  })
})

describe('looping', () => {
  const looped = new Transport({
    tempoPoints: [{ atBeat: 0, bpm: 120 }],
    sampleRate: 48000,
    loopStart: 0, loopEnd: 4, loopEnabled: true
  })

  it('wraps back into the loop', () => {
    expect(looped.positionAtElapsed(48000 * 5).beat).toBeCloseTo(2, 6)
  })

  it('costs the same however long it has been running', () => {
    const start = performance.now()
    const beat = looped.positionAtElapsed(48000 * 60 * 60).beat
    expect(performance.now() - start).toBeLessThan(50)
    expect(beat).toBeGreaterThanOrEqual(0)
    expect(beat).toBeLessThan(4)
  })

  it('does not wrap before the loop end is reached', () => {
    expect(looped.positionAtElapsed(48000).beat).toBeCloseTo(2, 6)
  })

  it('ignores a loop that ends before it starts', () => {
    const bad = new Transport({ loopStart: 8, loopEnd: 2, loopEnabled: true })
    expect(bad.loop.enabled).toBe(false)
  })

  it('loops within a region that does not start at zero', () => {
    const later = new Transport({
      tempoPoints: [{ atBeat: 0, bpm: 120 }], sampleRate: 48000,
      loopStart: 4, loopEnd: 8, loopEnabled: true
    })
    const beat = later.positionAtElapsed(48000 * 6).beat
    expect(beat).toBeGreaterThanOrEqual(4)
    expect(beat).toBeLessThan(8)
  })
})

describe('the transport message', () => {
  it('carries everything contract section 7 requires', () => {
    const message = at(120).messageAt(48000, { frame: 96000 })
    expect(message.type).toBe('transport')
    expect(message.frame).toBe(96000)
    expect(message.beat).toBeCloseTo(2, 10)
    expect(message.tempo).toBe(120)
    expect(message.beatsPerFrame).toBeGreaterThan(0)
    expect(message.timeSignature).toEqual({ beatsPerBar: 4, beatUnit: 4 })
    expect(message.playing).toBe(true)
  })

  it('reports no loop when none is enabled', () => {
    expect(at(120).messageAt(0, { frame: 0 }).loop).toBeNull()
  })

  it('counts from where play started, not from where the context did', () => {
    // The two differ after a stop and restart, and using the wrong one is the
    // class of bug contract section 7 exists to prevent.
    const t = at(120)
    expect(t.positionAtElapsed(0, { startBeat: 8 }).beat).toBeCloseTo(8, 10)
    expect(t.positionAtElapsed(48000, { startBeat: 8 }).beat).toBeCloseTo(10, 10)
  })
})
