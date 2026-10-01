// tests/reel/Clock.test.js
//
// Driven by an injected clock and a real Transport, so every assertion is about exact positions. The two
// failures CLAUDE.md names for anything located in time are both here: a statement exactly on a tick
// boundary, and one between two ticks, must each fire, once.
import { describe, it, expect } from 'vitest'
import { Transport } from '../../src/engine/Transport.js'
import { ReelClock } from '../../src/reel/Clock.js'

const RATE = 48000
// 120 bpm: half a second a beat, so a 4/4 bar is two seconds.
const transport = (over = {}) => new Transport({ sampleRate: RATE, ...over })

function rig ({ t = transport(), start = 10 } = {}) {
  let clock = start
  const clockObj = new ReelClock({ now: () => clock, transport: () => t })
  const fired = []
  const mark = name => () => { fired.push([name, Math.round((clock - start) * 1000) / 1000]) }
  return {
    clock: clockObj,
    fired,
    mark,
    t,
    /** Move the audio clock to `seconds` after the start, and tick. */
    at (seconds) { clock = start + seconds; clockObj.tick() },
    begin () { clockObj.start(start) }
  }
}

describe('at', () => {
  it('fires once when the transport passes the beat, and not before', () => {
    const r = rig()
    r.clock.at(4, r.mark('a')) // beat 4 is 2 s
    r.begin()
    r.at(1.9)
    expect(r.fired).toEqual([])
    r.at(2.1)
    expect(r.fired).toEqual([['a', 2.1]])
    r.at(5)
    expect(r.fired).toHaveLength(1)
  })

  it('fires a statement exactly on a tick boundary, once', () => {
    const r = rig()
    r.clock.at(4, r.mark('a'))
    r.begin()
    r.at(1)
    r.at(2) // the window [1, 2) does not contain it; the next, [2, 3), does
    expect(r.fired).toEqual([])
    r.at(3)
    expect(r.fired).toEqual([['a', 3]])
  })

  it('fires a statement that falls between two ticks, in the next tick that finds it', () => {
    const r = rig()
    r.clock.at(5, r.mark('a')) // 2.5 s
    r.begin()
    r.at(2.4)
    r.at(2.6)
    expect(r.fired).toHaveLength(1)
  })

  it('fires a statement at beat 0 in the first tick', () => {
    const r = rig()
    r.clock.at(0, r.mark('a'))
    r.begin()
    r.at(0.05)
    expect(r.fired).toHaveLength(1)
  })

  it('does not fire before start, or after stop', () => {
    const r = rig()
    r.clock.at(0, r.mark('a'))
    r.at(1)
    expect(r.fired).toEqual([])
    r.begin()
    r.clock.stop()
    r.at(2)
    expect(r.fired).toEqual([])
  })

  it('does not fire for a position the transport never reaches because it was started later', () => {
    const r = rig()
    r.clock.at(2, r.mark('early'))
    r.begin()
    r.at(10) // one very late tick: the window holds it, so it fires, once
    expect(r.fired).toHaveLength(1)
  })

  it('follows a tempo change: beat 8 comes sooner at a faster tempo', () => {
    const t = transport({ tempoPoints: [{ atBeat: 0, bpm: 240 }] }) // a beat is a quarter second
    const r = rig({ t })
    r.clock.at(8, r.mark('a')) // 2 s at 240
    r.begin()
    r.at(1.9)
    expect(r.fired).toEqual([])
    r.at(2.1)
    expect(r.fired).toHaveLength(1)
  })

  it('can be cancelled', () => {
    const r = rig()
    const cancel = r.clock.at(4, r.mark('a'))
    r.begin()
    cancel()
    r.at(5)
    expect(r.fired).toEqual([])
  })
})

describe('every', () => {
  it('fires at the downbeat, then once for each period passed', () => {
    const r = rig()
    r.clock.every(4, r.mark('bar')) // a bar, 2 s
    r.begin()
    r.at(0.1)
    expect(r.fired.map(f => f[0])).toEqual(['bar'])
    r.at(1.9)
    expect(r.fired).toHaveLength(1)
    r.at(2.1)
    expect(r.fired).toHaveLength(2)
    r.at(4.1)
    expect(r.fired).toHaveLength(3)
  })

  it('fires once for a multiple that lands exactly on a tick boundary, not twice and not never', () => {
    const r = rig()
    r.clock.every(4, r.mark('bar'))
    r.begin()
    for (const s of [0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5]) r.at(s)
    // Bars at 0, 2 and 4 seconds, whichever window each fell on a boundary of.
    expect(r.fired).toHaveLength(3)
  })

  it('fires every beat at one beat, across many small ticks', () => {
    const r = rig()
    r.clock.every(1, r.mark('beat'))
    r.begin()
    for (let i = 1; i <= 100; i++) r.at(i * 0.013)
    // 1.3 s is beats at 0, 0.5 and 1.0 s.
    expect(r.fired).toHaveLength(3)
  })

  it('counts exactly across a long run of irregular ticks', () => {
    const r = rig()
    r.clock.every(1, r.mark('beat'))
    r.begin()
    let s = 0
    let seed = 7
    while (s < 20) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff
      s += 0.001 + (seed % 90) / 1000 // ticks 1 to 90 ms apart, never aligned to a beat
      r.at(s)
    }
    // Every beat in [0, s) fires, whether or not a tick found it at the time; each is one firing. A tick
    // that spans a beat fires once, and a tick spanning two beats is under 90 ms and cannot at 2 beats a second.
    expect(r.fired.length).toBe(Math.ceil(s * 2))
  })

  it('does not replay a stalled stretch as a burst: one firing for the whole of it', () => {
    const r = rig()
    r.clock.every(1, r.mark('beat'))
    r.begin()
    r.at(0.1)
    r.at(20) // forty beats in one tick
    expect(r.fired).toHaveLength(2)
    expect(r.fired[1][1]).toBe(20)
  })

  it('follows the tempo, a bar being sooner when it is faster', () => {
    const r = rig({ t: transport({ tempoPoints: [{ atBeat: 0, bpm: 240 }] }) })
    r.clock.every(4, r.mark('bar')) // a bar is one second
    r.begin()
    for (const s of [0.4, 0.9, 1.1, 1.9, 2.1]) r.at(s)
    expect(r.fired).toHaveLength(3)
  })

  it('refuses a period of nothing, and can be cancelled', () => {
    const r = rig()
    expect(() => r.clock.every(0, () => {})).toThrow(/above zero/)
    const cancel = r.clock.every(1, r.mark('beat'))
    r.begin()
    r.at(0.1)
    cancel()
    r.at(3)
    expect(r.fired).toHaveLength(1)
  })
})

describe('counting from an earlier time', () => {
  it('covers a downbeat the tick before it found, for a job registered a moment later', () => {
    const r = rig()
    r.begin()
    r.at(2.05) // the bar line at 2.0 s has just passed, and a script takes over
    r.clock.every(4, r.mark('new'), { since: 2.0 })
    r.at(2.1)
    expect(r.fired).toEqual([['new', 2.1]])
  })

  it('does not, without it, which is what lost the downbeat in the browser', () => {
    const r = rig()
    r.begin()
    r.at(2.05)
    r.clock.every(4, r.mark('new'))
    r.at(2.1)
    expect(r.fired).toEqual([])
    r.at(4.1)
    expect(r.fired).toHaveLength(1)
  })

  it('counts from the earlier time once, and then as any job does', () => {
    const r = rig()
    r.begin()
    r.at(2.05)
    r.clock.every(1, r.mark('beat'), { since: 2.0 })
    r.at(2.1) // the downbeat at 2.0
    r.at(2.3)
    expect(r.fired).toHaveLength(1)
    r.at(2.6) // the next beat, 2.5
    expect(r.fired).toHaveLength(2)
  })

  it('does not fire twice for the same position when a job counts from before a tick that already fired it', () => {
    const r = rig()
    r.clock.every(4, r.mark('old'))
    r.begin()
    r.at(2.05) // the old job fires for the bar line at 2.0
    r.clock.every(4, r.mark('new'), { since: 2.0 })
    r.at(2.1)
    // The old job fired once for the bar line, in the earlier tick; the new one fires once for it, in this one.
    expect(r.fired.map(f => f[0])).toEqual(['old', 'new'])
  })

  it('applies to at as well', () => {
    const r = rig()
    r.begin()
    r.at(2.05)
    r.clock.at(4, r.mark('downbeat'), { since: 2.0 }) // beat 4 is 2.0 s
    r.at(2.1)
    expect(r.fired).toEqual([['downbeat', 2.1]])
  })

  it('tells a firing when its position was, in elapsed time', () => {
    const r = rig()
    const seen = []
    r.clock.every(4, arg => seen.push(arg.at))
    r.begin()
    r.at(0.1)
    r.at(2.3)
    expect(seen).toEqual([0, 2])
  })

  it('treats a since before the start as the start', () => {
    const r = rig()
    r.begin()
    r.clock.every(4, r.mark('x'), { since: -5 })
    r.at(0.1)
    expect(r.fired).toHaveLength(1)
  })
})

describe('a loop', () => {
  // Beats 0 to 4 loop: two seconds, repeated.
  const looped = () => transport({ loopStart: 0, loopEnd: 4, loopEnabled: true })

  it('fires an at on every pass', () => {
    const r = rig({ t: looped() })
    r.clock.at(2, r.mark('a')) // 1 s into the loop
    r.begin()
    for (const s of [0.5, 1.5, 2.5, 3.5, 4.5, 5.5]) r.at(s)
    // Reached at 1, 3 and 5 s.
    expect(r.fired).toHaveLength(3)
  })

  it('fires an every on every pass, once for each beat of each', () => {
    const r = rig({ t: looped() })
    r.clock.every(1, r.mark('beat'))
    r.begin()
    for (let s = 0.25; s <= 6; s += 0.25) r.at(s)
    // Four beats a pass, three passes in 6 s, the downbeat of the fourth at 6 s excluded: 12.
    expect(r.fired).toHaveLength(12)
  })

  it('does not fire a position outside the loop once it is looping', () => {
    const r = rig({ t: looped() })
    r.clock.at(6, r.mark('outside')) // beat 6 is past the loop end
    r.begin()
    for (let s = 0.5; s <= 8; s += 0.5) r.at(s)
    expect(r.fired).toEqual([])
  })
})

describe('the firing itself', () => {
  it('does not stop the clock when a firing throws or rejects', () => {
    const r = rig()
    const seen = []
    r.clock.every(1, () => { throw new Error('boom') })
    r.clock.every(1, async () => { throw new Error('rejected') })
    r.clock.every(1, () => seen.push('ok'))
    r.begin()
    r.at(0.1)
    r.at(0.6)
    expect(seen).toEqual(['ok', 'ok'])
  })

  it('fires in time order, and in the order registered at the same time', () => {
    const r = rig()
    r.clock.at(2, r.mark('second')) // 1 s
    r.clock.at(1, r.mark('first')) // 0.5 s
    r.clock.at(1, r.mark('third'))
    r.begin()
    r.at(2)
    expect(r.fired.map(f => f[0])).toEqual(['first', 'third', 'second'])
  })

  it('lets a firing cancel another that is due in the same tick', () => {
    const r = rig()
    let cancelB
    r.clock.at(1, () => cancelB())
    cancelB = r.clock.at(1, r.mark('b'))
    r.begin()
    r.at(1)
    expect(r.fired).toEqual([])
  })

  it('starts again from the beginning on a second start, as a transport restart', () => {
    const r = rig()
    r.clock.every(4, r.mark('bar'))
    r.begin()
    r.at(0.1)
    r.clock.stop()
    r.begin()
    r.at(0.1)
    expect(r.fired).toHaveLength(2)
  })

  it('needs a clock and a transport', () => {
    expect(() => new ReelClock({})).toThrow(/needs now and transport/)
  })
})
