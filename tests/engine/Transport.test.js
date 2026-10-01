// tests/engine/Transport.test.js
import { describe, it, expect } from 'vitest'
import { Transport } from '../../src/engine/Transport.js'
import { Project } from '../../src/model/Project.js'

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

describe('a tempo that moves', () => {
  const ramp = (curve, extra = []) => new Transport({ tempoPoints: [{ atBeat: 0, bpm: 60, curve }, { atBeat: 4, bpm: 120 }, ...extra], sampleRate: 48000 })

  it('keeps a map with no curves exactly as it was: each tempo holds until the next point', () => {
    const t = new Transport({ tempoPoints: [{ atBeat: 0, bpm: 60 }, { atBeat: 4, bpm: 120 }] })
    expect(t.secondsAtBeat(4)).toBe(4)
    expect(t.secondsAtBeat(8)).toBe(6)
    expect(t.tempoAtBeat(3.9)).toBe(60)
    expect(t.beatAtSeconds(5)).toBe(6)
  })

  it('takes the time a straight-line change should: 60 over the slope, times the log of the change', () => {
    const t = ramp('linear')
    // Slope 15 bpm per beat, from 60 to 120: (60 / 15) * ln(2) seconds.
    expect(t.secondsAtBeat(4)).toBeCloseTo(4 * Math.LN2, 10)
    expect(t.tempoAtBeat(2)).toBe(90)
    expect(t.tempoAtBeat(4)).toBe(120)
    // And it is faster than holding the starting tempo, and slower than holding the ending one.
    expect(t.secondsAtBeat(4)).toBeLessThan(4)
    expect(t.secondsAtBeat(4)).toBeGreaterThan(2)
  })

  it('holds the last tempo after the last point', () => {
    const t = ramp('linear')
    expect(t.tempoAtBeat(100)).toBe(120)
    expect(t.secondsAtBeat(8) - t.secondsAtBeat(4)).toBeCloseTo(2, 10)
  })

  it('maps seconds back to the same beat, on a ramp, a smooth change and across both', () => {
    for (const t of [ramp('linear'), ramp('smooth'), ramp('linear', [{ atBeat: 8, bpm: 30, curve: 'smooth' }, { atBeat: 12, bpm: 200 }])]) {
      for (const beat of [0, 0.3, 1, 2.5, 3.999, 4, 5.5, 8, 9.1, 11.7, 12, 20]) {
        expect(t.beatAtSeconds(t.secondsAtBeat(beat)), `beat ${beat}`).toBeCloseTo(beat, 8)
      }
    }
  })

  it('never goes backwards in time, and a faster tempo takes less time per beat', () => {
    const t = ramp('smooth')
    let last = -1
    for (let beat = 0; beat <= 10; beat += 0.125) {
      const seconds = t.secondsAtBeat(beat)
      expect(seconds).toBeGreaterThanOrEqual(last)
      last = seconds
    }
    expect(t.secondsAtBeat(1) - t.secondsAtBeat(0)).toBeGreaterThan(t.secondsAtBeat(4) - t.secondsAtBeat(3))
  })

  it('a smooth change starts and ends gently: slower near its ends than a straight one in the middle', () => {
    const smooth = ramp('smooth')
    expect(smooth.tempoAtBeat(0.25)).toBeLessThan(ramp('linear').tempoAtBeat(0.25))
    expect(smooth.tempoAtBeat(2)).toBeCloseTo(90, 5)
    expect(smooth.tempoAtBeat(4)).toBe(120)
  })

  it('reports where the transport is on a ramp, from the frames that have passed', () => {
    const t = ramp('linear')
    const position = t.positionAtElapsed(48000 * 4 * Math.LN2)
    expect(position.beat).toBeCloseTo(4, 6)
    expect(position.tempo).toBeCloseTo(120, 5)
  })
})

describe('a tempo envelope in a project', () => {
  it('is the tempo map when there is one with points, and the transport\'s own points otherwise', () => {
    const p = new Project()
    p.apply([{ op: 'setTransport', tempoPoints: [{ atBeat: 0, bpm: 100 }] }])
    expect(Transport.fromProject(p, 48000).tempoAtBeat(2)).toBe(100)
    p.apply([{ op: 'addEnvelope', target: { kind: 'tempo' }, points: [{ atBeat: 0, value: 60, curve: 'linear' }, { atBeat: 4, value: 120, curve: 'step' }] }])
    const t = Transport.fromProject(p, 48000)
    expect(t.tempoAtBeat(2)).toBe(90)
    expect(t.secondsAtBeat(4)).toBeCloseTo(4 * Math.LN2, 10)
    p.apply([{ op: 'setEnvelope', id: p.envelopes[0].id, points: [] }])
    expect(Transport.fromProject(p, 48000).tempoAtBeat(2)).toBe(100)
  })
})
