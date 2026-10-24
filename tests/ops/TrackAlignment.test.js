// tests/ops/TrackAlignment.test.js
//
// Lining tracks up: the slowest track at a place sets the delay of the others, a bus passes its own latency on, and with alignment off
// nothing is delayed. Pure, so no engine.
import { describe, it, expect } from 'vitest'
import { trackDelays } from '../../src/ops/TrackAlignment.js'

const track = (id, output = null) => ({ id, output })
const own = pairs => new Map(Object.entries(pairs))

describe('trackDelays', () => {
  it('delays each track by what the slowest arriving at the master has more than it', () => {
    const delays = trackDelays([track('a'), track('b'), track('c')], own({ a: 0, b: 128, c: 64 }), true)
    expect([...delays]).toEqual([['a', 128], ['b', 0], ['c', 64]])
  })

  it('gives nothing when alignment is off', () => {
    const delays = trackDelays([track('a'), track('b')], own({ a: 0, b: 128 }), false)
    expect([...delays.values()]).toEqual([0, 0])
  })

  it('counts a bus\'s own latency in what arrives through it', () => {
    // a and b feed bus; bus feeds the master with 100 frames of its own. c goes straight to the master.
    const tracks = [track('a', 'bus'), track('b', 'bus'), track('bus'), track('c')]
    const delays = trackDelays(tracks, own({ a: 10, b: 30, bus: 100, c: 0 }), true)
    // At the bus: b is slowest (30), so a waits 20. At the master: through the bus arrives at 130, c at 0, so c waits 130.
    expect(delays.get('a')).toBe(20)
    expect(delays.get('b')).toBe(0)
    expect(delays.get('bus')).toBe(0)
    expect(delays.get('c')).toBe(130)
  })

  it('treats a track with no recorded latency as having none, and an empty list as nothing to do', () => {
    expect(trackDelays([track('a')], new Map(), true).get('a')).toBe(0)
    expect(trackDelays([], new Map(), true).size).toBe(0)
  })
})
