// tests/model/NoteTransform.test.js
import { describe, it, expect } from 'vitest'
import { Project } from '../../src/model/Project.js'
import { quantize, transpose, scaleVelocity, reverse, invert, humanize, fitScale, legato, strum, describeNoteTransform } from '../../src/model/NoteTransform.js'

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

describe('quantize with ends', () => {
  it('moves the end to the grid too, so the length follows', () => {
    const [n] = quantize([note(0.9, 60, 0.7)], { grid: 1, ends: true })
    expect(n.startBeat).toBe(1)
    expect(n.lengthBeats).toBe(1)
  })
  it('leaves the length alone when ends is off, and gives a note that would shrink to nothing one grid step', () => {
    expect(quantize([note(0.9, 60, 0.7)], { grid: 1 })[0].lengthBeats).toBe(0.7)
    expect(quantize([note(0.9, 60, 0.1)], { grid: 1, ends: true })[0].lengthBeats).toBe(1)
  })
  it('moves the end part of the way at partial strength', () => {
    const [n] = quantize([note(0, 60, 0.8)], { grid: 1, strength: 0.5, ends: true })
    expect(n.startBeat + n.lengthBeats).toBeCloseTo(0.9)
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

describe('invert', () => {
  it('mirrors pitches about the first note by default, or about an axis', () => {
    expect(invert([note(0, 60), note(1, 64), note(2, 58)]).map(n => n.pitch)).toEqual([60, 56, 62])
    expect(invert([note(0, 60)], 62)[0].pitch).toBe(64)
  })
  it('refuses a result outside MIDI range, and a non-whole axis', () => {
    expect(() => invert([note(0, 10), note(1, 100)])).toThrow('outside 0 to 127')
    expect(() => invert([note(0, 60)], 60.5)).toThrow('axis')
  })
})

describe('fitScale', () => {
  const n = (pitch, startBeat = 0) => ({ startBeat, lengthBeats: 1, pitch, velocity: 100 })
  it('moves out-of-scale notes to the nearest scale pitch and keeps everything else', () => {
    const out = fitScale([n(60), n(61, 1), n(66, 2)], { root: 0, scale: 'major' })
    expect(out.map(x => x.pitch)).toEqual([60, 60, 65])
    expect(out.map(x => [x.startBeat, x.lengthBeats, x.velocity])).toEqual([[0, 1, 100], [1, 1, 100], [2, 1, 100]])
  })
  it('refuses a missing scale and a bad root', () => {
    expect(() => fitScale([n(60)], {})).toThrow(/root/)
    expect(() => fitScale([n(60)], { root: 0 })).toThrow(/no such scale/)
  })
  it('is one transform on a clip, for the chosen notes only', () => {
    const project = { clip: () => ({ id: 'c', kind: 'midi', lengthBeats: 4, notes: [n(61), n(61, 1)] }) }
    const [change] = describeNoteTransform(project, 'c', 'fitScale', { root: 0, scale: 'major' }, { indices: [1] })
    expect(change.notes.map(x => x.pitch)).toEqual([61, 60])
  })
})

describe('humanize', () => {
  const notes = [note(1, 60, 1, 100), note(2, 62, 1, 100)]
  it('is the same for the same seed and different for another', () => {
    expect(humanize(notes, { timing: 0.1, velocity: 10, seed: 3 })).toEqual(humanize(notes, { timing: 0.1, velocity: 10, seed: 3 }))
    expect(humanize(notes, { timing: 0.1, velocity: 10, seed: 3 })).not.toEqual(humanize(notes, { timing: 0.1, velocity: 10, seed: 4 }))
  })
  it('stays within the amounts, keeps start at zero or more and velocity from 1 to 127', () => {
    const out = humanize([note(0, 60, 1, 127), note(0, 61, 1, 1)], { timing: 0.5, velocity: 50, seed: 9 })
    for (const n of out) { expect(n.startBeat).toBeGreaterThanOrEqual(0); expect(n.velocity).toBeGreaterThanOrEqual(1); expect(n.velocity).toBeLessThanOrEqual(127) }
    for (const n of humanize(notes, { timing: 0.1, velocity: 10, seed: 5 })) {
      expect(Math.abs(n.startBeat - Math.round(n.startBeat))).toBeLessThanOrEqual(0.1)
      expect(Math.abs(n.velocity - 100)).toBeLessThanOrEqual(10)
    }
  })
  it('changes nothing at zero amounts, and refuses a missing seed or a negative amount', () => {
    expect(humanize(notes, { seed: 1 })).toEqual(notes)
    expect(() => humanize(notes, { timing: 0.1 })).toThrow('seed')
    expect(() => humanize(notes, { timing: -1, seed: 1 })).toThrow('timing')
  })
})

describe('legato', () => {
  it('holds each note until the next start, a chord stretching together, and leaves the last alone', () => {
    const out = legato([note(0, 60, 0.25), note(1, 62, 0.25), note(1, 65, 0.25), note(3, 67, 0.5)])
    expect(out.map(n => n.lengthBeats)).toEqual([1, 2, 2, 0.5])
  })
  it('does not change anything but lengths, and does not mutate its input', () => {
    const input = [note(0, 60, 0.25), note(2, 62, 0.25)]
    const out = legato(input)
    expect(out.map(n => [n.startBeat, n.pitch, n.velocity])).toEqual(input.map(n => [n.startBeat, n.pitch, n.velocity]))
    expect(input[0].lengthBeats).toBe(0.25)
  })
  it('takes the empty list', () => { expect(legato([])).toEqual([]) })
})

describe('strum', () => {
  const chord = [note(1, 67), note(1, 60), note(1, 64), note(3, 62)]
  it('rolls a chord upward from its lowest note, by the spread, and leaves a lone note where it is', () => {
    expect(strum(chord, { spread: 0.1 }).map(n => n.startBeat)).toEqual([1.2, 1, 1.1, 3])
  })
  it('rolls it downward from the highest with direction down', () => {
    expect(strum(chord, { spread: 0.1, direction: 'down' }).map(n => n.startBeat)).toEqual([1, 1.2, 1.1, 3])
  })
  it('refuses a missing or non-positive spread and a bad direction, saying which', () => {
    expect(() => strum(chord, {})).toThrow('spread')
    expect(() => strum(chord, { spread: 0 })).toThrow('spread')
    expect(() => strum(chord, { spread: 0.1, direction: 'sideways' })).toThrow('direction')
  })
  it('works through describeNoteTransform as one change', () => {
    const project = build([note(0, 60), note(0, 64)])
    const changes = describeNoteTransform(project, 'clip-1', 'strum', { spread: 0.25 })
    expect(changes).toHaveLength(1)
    project.apply(changes)
    expect(project.clip('clip-1').notes.map(n => n.startBeat)).toEqual([0, 0.25])
  })
})

describe('setChance', () => {
  const notes = [{ startBeat: 0, lengthBeats: 1, pitch: 60, velocity: 100 }, { startBeat: 1, lengthBeats: 1, pitch: 62, velocity: 100, chance: 0.5 }]

  it('gives every note the chance, and takes it away with 1', async () => {
    const { setChance } = await import('../../src/model/NoteTransform.js')
    expect(setChance(notes, 0.25).map(n => n.chance)).toEqual([0.25, 0.25])
    const cleared = setChance(notes, 1)
    expect(cleared.every(n => !('chance' in n))).toBe(true)
    expect(notes[1].chance).toBe(0.5)
  })

  it('refuses a chance that is not above 0 and at most 1', async () => {
    const { setChance } = await import('../../src/model/NoteTransform.js')
    for (const bad of [0, -0.1, 1.5, NaN, '0.5', undefined]) expect(() => setChance(notes, bad), String(bad)).toThrow(/chance/)
  })

  it('is one of the transforms the tool and the roll offer, applied to the chosen notes only', async () => {
    const { NOTE_TRANSFORMS, describeNoteTransform } = await import('../../src/model/NoteTransform.js')
    expect(NOTE_TRANSFORMS).toContain('setChance')
    const project = { clip: () => ({ id: 'c', kind: 'midi', lengthBeats: 4, notes }) }
    const [change] = describeNoteTransform(project, 'c', 'setChance', { chance: 0.75 }, { indices: [0] })
    expect(change.notes.map(n => n.chance)).toEqual([0.75, 0.5])
  })
})
