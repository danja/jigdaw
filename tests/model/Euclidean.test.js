// tests/model/Euclidean.test.js
//
// Euclidean rhythms: the known patterns, even spacing, rotation, and the one edit that lays them into a clip.
import { describe, it, expect, beforeEach } from 'vitest'
import { Project } from '../../src/model/Project.js'
import { euclid, describeEuclidean, MAX_STEPS } from '../../src/model/Euclidean.js'

const show = pattern => pattern.map(on => (on ? 'x' : '.')).join('')

describe('euclid', () => {
  it('gives the well known patterns, up to a rotation', () => {
    expect(show(euclid(3, 8))).toBe('x..x..x.')
    expect(show(euclid(4, 16))).toBe('x...x...x...x...')
    expect(show(euclid(1, 4))).toBe('x...')
    expect(show(euclid(4, 4))).toBe('xxxx')
    expect(show(euclid(0, 4))).toBe('....')
  })

  it('spreads the onsets so that no gap is more than one step longer than another', () => {
    for (let steps = 1; steps <= 24; steps++) {
      for (let pulses = 1; pulses <= steps; pulses++) {
        const at = euclid(pulses, steps).flatMap((on, i) => (on ? [i] : []))
        expect(at.length).toBe(pulses)
        const gaps = at.map((p, i) => (at[(i + 1) % at.length] - p + steps) % steps || steps)
        expect(Math.max(...gaps) - Math.min(...gaps), `${pulses} in ${steps}`).toBeLessThanOrEqual(1)
      }
    }
  })

  it('rotates later by whole steps, wrapping, and a negative rotation goes earlier', () => {
    expect(show(euclid(3, 8, 1))).toBe('.x..x..x')
    expect(show(euclid(3, 8, 8))).toBe(show(euclid(3, 8)))
    expect(show(euclid(3, 8, -1))).toBe(show(euclid(3, 8, 7)))
  })

  it('refuses steps and pulses that mean nothing', () => {
    expect(() => euclid(3, 0)).toThrow(/steps/)
    expect(() => euclid(3, MAX_STEPS + 1)).toThrow(/steps/)
    expect(() => euclid(9, 8)).toThrow(/pulses/)
    expect(() => euclid(-1, 8)).toThrow(/pulses/)
    expect(() => euclid(2.5, 8)).toThrow(/pulses/)
    expect(() => euclid(3, 8, 0.5)).toThrow(/rotation/)
  })
})

describe('describeEuclidean', () => {
  let project
  beforeEach(() => {
    project = new Project()
    project.apply([{ op: 'addTrack', id: 't' }, { op: 'addClip', id: 'c', track: 't', kind: 'midi', startBeat: 0, lengthBeats: 4, notes: [
      { startBeat: 0, lengthBeats: 1, pitch: 36, velocity: 90 }, { startBeat: 1, lengthBeats: 1, pitch: 42, velocity: 70 }
    ] }])
  })
  const apply = options => { const changes = describeEuclidean(project, 'c', options); expect(changes).toHaveLength(1); return project.apply(changes) && project.clip('c').notes }

  it('lays the pattern across the whole clip, a note at each onset, one setClipNotes', () => {
    const notes = apply({ pitch: 38, pulses: 3, steps: 8, stepBeats: 0.5 })
    // 8 steps of half a beat fill the 4 beat clip once: onsets at steps 0, 3 and 6.
    expect(notes.filter(n => n.pitch === 38).map(n => n.startBeat)).toEqual([0, 1.5, 3])
  })

  it('repeats a short pattern to fill the clip, and cuts nothing off at the end', () => {
    const notes = apply({ pitch: 38, pulses: 1, steps: 4, stepBeats: 0.5, lengthBeats: 3 })
    const snares = notes.filter(n => n.pitch === 38)
    expect(snares.map(n => n.startBeat)).toEqual([0, 2])
    expect(snares.map(n => n.lengthBeats)).toEqual([3, 2])
  })

  it('replaces the notes at that pitch and keeps every other', () => {
    apply({ pitch: 36, pulses: 2, steps: 4, stepBeats: 1 })
    expect(project.clip('c').notes.filter(n => n.pitch === 42)).toHaveLength(1)
    expect(project.clip('c').notes.filter(n => n.pitch === 36).map(n => n.startBeat)).toEqual([0, 2])
  })

  it('takes the rotation and the velocity', () => {
    const notes = apply({ pitch: 38, pulses: 1, steps: 4, stepBeats: 1, rotation: 1, velocity: 64 })
    expect(notes.filter(n => n.pitch === 38).map(n => [n.startBeat, n.velocity])).toEqual([[1, 64]])
  })

  it('refuses what it cannot do, saying why', () => {
    expect(() => describeEuclidean(project, 'nope', { pitch: 38, pulses: 1, steps: 4 })).toThrow(/no such clip/)
    expect(() => describeEuclidean(project, 'c', { pitch: 200, pulses: 1, steps: 4 })).toThrow(/pitch/)
    expect(() => describeEuclidean(project, 'c', { pitch: 38, pulses: 1, steps: 4, velocity: 0 })).toThrow(/velocity/)
    expect(() => describeEuclidean(project, 'c', { pitch: 38, pulses: 1, steps: 4, stepBeats: 0 })).toThrow(/stepBeats/)
    expect(() => describeEuclidean(project, 'c', { pitch: 38, pulses: 9, steps: 4 })).toThrow(/pulses/)
  })
})
