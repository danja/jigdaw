// tests/model/GroupChannel.test.js
import { describe, it, expect } from 'vitest'
import { Project } from '../../src/model/Project.js'
import { describeLevelShift, describePanShift, groupMembers } from '../../src/model/GroupChannel.js'

function build (channels) {
  const project = new Project()
  project.apply(channels.map(() => ({ op: 'addTrack' })))
  project.apply(channels.map((c, i) => ({ op: 'setTrackChannel', track: `track-${i + 1}`, ...c })))
  return project
}

describe('describeLevelShift', () => {
  it('multiplies every gain by the same ratio, keeping the tracks the same decibels apart', () => {
    const project = build([{ gain: 1 }, { gain: 0.5 }])
    const changes = describeLevelShift(project, ['track-1', 'track-2'], 6)
    project.apply(changes)
    const [a, b] = ['track-1', 'track-2'].map(id => project.track(id).channel.gain)
    expect(a).toBeCloseTo(10 ** (6 / 20))
    expect(a / b).toBeCloseTo(2)
  })

  it('leaves a track at zero at zero', () => {
    const project = build([{ gain: 0 }, { gain: 1 }])
    project.apply(describeLevelShift(project, ['track-1', 'track-2'], 3))
    expect(project.track('track-1').channel.gain).toBe(0)
  })

  it('refuses no tracks, an unknown track and a non-number, and changes nothing', () => {
    const project = build([{ gain: 1 }])
    expect(() => describeLevelShift(project, [], 1)).toThrow('no tracks')
    expect(() => describeLevelShift(project, ['nope'], 1)).toThrow('no such track: nope')
    expect(() => describeLevelShift(project, ['track-1'], NaN)).toThrow('decibels must be a number')
    expect(project.track('track-1').channel.gain).toBe(1)
  })
})

describe('describePanShift', () => {
  it('moves every pan by the same amount', () => {
    const project = build([{ pan: -0.5 }, { pan: 0.25 }])
    project.apply(describePanShift(project, ['track-1', 'track-2'], 0.5))
    expect(project.track('track-1').channel.pan).toBeCloseTo(0)
    expect(project.track('track-2').channel.pan).toBeCloseTo(0.75)
  })

  it('stops when the track nearest the edge arrives, so none are squashed together', () => {
    const project = build([{ pan: 0.5 }, { pan: -0.5 }])
    project.apply(describePanShift(project, ['track-1', 'track-2'], 0.8))
    expect(project.track('track-1').channel.pan).toBeCloseTo(1)
    expect(project.track('track-2').channel.pan).toBeCloseTo(0)
  })

  it('stops at the left edge too, and does nothing past it', () => {
    const project = build([{ pan: -1 }, { pan: 0 }])
    const changes = describePanShift(project, ['track-1', 'track-2'], -0.3)
    project.apply(changes)
    expect(project.track('track-1').channel.pan).toBeCloseTo(-1)
    expect(project.track('track-2').channel.pan).toBeCloseTo(0)
  })

  it('refuses a non-number', () => {
    const project = build([{ pan: 0 }])
    expect(() => describePanShift(project, ['track-1'], Infinity)).toThrow('pan shift must be a number')
  })
})

describe('describePanShift rounding', () => {
  it('never produces a pan the model refuses', () => {
    const project = build([{ pan: 0.1 }, { pan: 0.7 }, { pan: 0.3 }])
    expect(() => project.apply(describePanShift(project, ['track-1', 'track-2', 'track-3'], 0.9))).not.toThrow()
    expect(project.track('track-2').channel.pan).toBeLessThanOrEqual(1)
  })
})

describe('groupMembers', () => {
  it('finds the tracks that send to a bus and those sharing its folder, never the track itself', () => {
    const project = build([{}, {}, {}, {}])
    project.apply([{ op: 'setTrack', id: 'track-1', output: 'track-4' }])
    project.setTrackLayout('track-2', { folder: 'Drums' })
    project.setTrackLayout('track-4', { folder: 'Drums' })
    expect(groupMembers(project, 'track-4')).toEqual(['track-1', 'track-2'])
    expect(groupMembers(project, 'track-3')).toEqual([])
  })
})
