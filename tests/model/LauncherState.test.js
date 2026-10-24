// tests/model/LauncherState.test.js
//
// What the launcher is doing, outside the revision: boundaries, one slot a track, and the five states.
import { describe, it, expect } from 'vitest'
import { LauncherState, nextBoundary, stepBeats } from '../../src/model/LauncherState.js'

const clip = (id, track, scene = 0) => ({ id, track, kind: 'midi', scene })

describe('boundaries', () => {
  it('rounds up to the next step of the chosen size, and a beat on the boundary stays', () => {
    expect(nextBoundary(5.2, 'bar', 4)).toBe(8)
    expect(nextBoundary(8, 'bar', 4)).toBe(8)
    expect(nextBoundary(8.0000000001, 'bar', 4)).toBe(8)
    expect(nextBoundary(5.2, 'beat', 4)).toBe(6)
    expect(nextBoundary(5.2, 'none', 4)).toBe(5.2)
    expect(nextBoundary(5.2, '2bars', 3)).toBe(6)
    expect(nextBoundary(9, '4bars', 4)).toBe(16)
  })

  it('refuses a name it does not know, in the step and in the setting', () => {
    expect(() => stepBeats('eight', 4)).toThrow(/launch quantisation/)
    expect(() => { new LauncherState().quantise = 'eight' }).toThrow(/launch quantisation/)
  })
})

describe('launching and stopping', () => {
  it('queues a slot to the next bar, then plays it', () => {
    const state = new LauncherState()
    expect(state.launch(clip('a', 't'), 5.2, 4)).toBe(8)
    expect(state.stateOf('a', 6)).toBe('queued')
    expect(state.stateOf('a', 8)).toBe('playing')
    expect(state.stateOf('b', 8)).toBe('stopped')
  })

  it('has one slot a track: the second starts where the first stops', () => {
    const state = new LauncherState()
    state.launch(clip('a', 't'), 0, 4)
    state.launch(clip('b', 't', 1), 5, 4)
    expect(state.stateOf('a', 6)).toBe('stopping')
    expect(state.stateOf('b', 6)).toBe('queued')
    expect(state.stateOf('a', 8)).toBe('stopped')
    expect(state.stateOf('b', 8)).toBe('playing')
  })

  it('leaves other tracks alone', () => {
    const state = new LauncherState()
    state.launch(clip('a', 't1'), 0, 4)
    state.launch(clip('b', 't2'), 5, 4)
    expect(state.stateOf('a', 6)).toBe('playing')
  })

  it('stops a track at the boundary, and calls off a slot still waiting', () => {
    const state = new LauncherState()
    state.launch(clip('a', 't'), 0, 4)
    expect(state.stopTrack('t', 5, 4)).toBe(8)
    expect(state.stateOf('a', 6)).toBe('stopping')
    expect(state.stateOf('a', 8)).toBe('stopped')
    state.launch(clip('b', 't', 1), 9, 4)
    state.stopTrack('t', 9.5, 4)
    expect(state.stateOf('b', 11)).toBe('stopped')
    expect(state.runs.filter(r => r.clipId === 'b')).toEqual([])
  })

  it('says nothing was there for a track with nothing launched', () => {
    expect(new LauncherState().stopTrack('t', 0, 4)).toBeNull()
  })

  it('stops every track, and clear forgets everything', () => {
    const state = new LauncherState()
    state.launch(clip('a', 't1'), 0, 4)
    state.launch(clip('b', 't2'), 0, 4)
    expect(state.stopAll(1, 4)).toBe(4)
    expect(state.stateOf('b', 5)).toBe('stopped')
    state.clear()
    expect(state.runs).toEqual([])
  })

  it('refuses a clip that is not a slot', () => {
    const state = new LauncherState()
    expect(() => state.launch({ id: 'x', track: 't', kind: 'midi' }, 0, 4)).toThrow(/in a scene/)
    expect(() => state.launch({ id: 'x', track: 't', kind: 'audio', scene: 0 }, 0, 4)).toThrow(/MIDI clip/)
  })

  it('tells a listener, prunes what has finished, and uses the setting', () => {
    const state = new LauncherState()
    let told = 0
    state.subscribe(() => { told += 1 })
    state.quantise = 'none'
    expect(state.launch(clip('a', 't'), 5.5, 4)).toBe(5.5)
    state.stopTrack('t', 6, 4)
    state.prune(10)
    expect(state.runs).toEqual([])
    expect(told).toBe(3)
  })
})
