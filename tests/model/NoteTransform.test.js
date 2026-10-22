// tests/model/NoteTransform.test.js
import { describe, it, expect } from 'vitest'
import { Project } from '../../src/model/Project.js'
import { quantize, transpose, scaleVelocity, reverse, describeNoteTransform } from '../../src/model/NoteTransform.js'

const note = (startBeat, pitch = 60, lengthBeats = 0.5, velocity = 100) => ({ startBeat, lengthBeats, pitch, velocity })

function build (notes) {
  const project = new Project()
  project.apply([{ op: 'addTrack' }])
  project.apply([{ op: 'addClip', id: 'clip-1', track: 'track-1', kind: 'midi', startBeat: 0, lengthBeats: 4, notes }])
  return project
}

describe('quantize', () => {
  it('lands on the nearest grid line at full strength', () => {
    expect(quantize([note(0.9), note(1.3)], { grid: 1 }).map(n => n.startBeat)).toEqual([1, 1])
  })
  it('moves part of the way at partial strength, and not at all at zero', () => {
    expect(quantize([note(0.8)], { grid: 1, strength: 0.5 })[0].startBeat).toBeCloseTo(0.9)
    expect(quantize([note(0.8)], { grid: 1, strength: 0 })[0].startBeat).toBe(0.8)
  })
  it('refuses a bad grid or strength', () => {
    expect(() => quantize([note(0)], { grid: 0 })).toThrow('grid')
    expect(() => quantize([note(0)], { grid: 1, strength: 2 })).toThrow('strength')
  })
})

describe('transpose', () => {
  it('shifts pitch', () => { expect(transpose([note(0, 60)], 12)[0].pitch).toBe(72) })
  it('refuses to leave the MIDI range, and a fraction', () => {
    expect(() => transpose([note(0, 120)], 12)).toThrow('outside 0 to 127')
    expect(() => transpose([note(0, 60)], 0.5)).toThrow('whole number')
  })
})

describe('scaleVelocity', () => {
  it('scales and keeps velocity from 1 to 127', () => {
    expect(scaleVelocity([note(0, 60, 1, 100)], 2)[0].velocity).toBe(127)
    expect(scaleVelocity([note(0, 60, 1, 10)], 0.01)[0].velocity).toBe(1)
  })
})

describe('reverse', () => {
  it('mirrors notes inside the clip', () => {
    expect(reverse([note(0, 60, 1), note(3, 62, 1)], 4).map(n => [n.startBeat, n.pitch])).toEqual([[3, 60], [0, 62]])
  })
  it('refuses a note that runs past the clip end', () => {
    expect(() => reverse([note(3.8, 60, 1)], 4)).toThrow('ends after the clip')
  })
})

describe('describeNoteTransform', () => {
  it('returns one setClipNotes change that applies', () => {
    const project = build([note(0.9), note(2.1, 64)])
    const changes = describeNoteTransform(project, 'clip-1', 'quantize', { grid: 1 })
    expect(changes).toHaveLength(1)
    project.apply(changes)
    expect(project.clip('clip-1').notes.map(n => n.startBeat)).toEqual([1, 2])
  })
  it('touches only the chosen indices', () => {
    const project = build([note(0, 60), note(1, 64)])
    project.apply(describeNoteTransform(project, 'clip-1', 'transpose', { semitones: 1 }, { indices: [1] }))
    expect(project.clip('clip-1').notes.map(n => n.pitch)).toEqual([60, 65])
  })
  it('refuses an unknown clip, an audio clip, an unknown transform and a bad index', () => {
    const project = build([note(0)])
    expect(() => describeNoteTransform(project, 'nope', 'quantize')).toThrow('no such clip')
    expect(() => describeNoteTransform(project, 'clip-1', 'wobble')).toThrow('no such transform')
    expect(() => describeNoteTransform(project, 'clip-1', 'transpose', { semitones: 1 }, { indices: [5] })).toThrow('no note at index 5')
  })
  it('refuses an audio clip', () => {
    const project = build([note(0)])
    project.clip = id => ({ id, kind: 'audio', notes: [] })
    expect(() => describeNoteTransform(project, 'clip-1', 'reverse')).toThrow('not a MIDI clip')
  })
})
