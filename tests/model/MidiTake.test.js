// tests/model/MidiTake.test.js
import { describe, it, expect } from 'vitest'
import { Project } from '../../src/model/Project.js'
import { readTake, describeMidiTake } from '../../src/model/MidiTake.js'

const on = (beat, pitch, velocity = 100) => ({ beat, bytes: [0x90, pitch, velocity] })
const off = (beat, pitch) => ({ beat, bytes: [0x80, pitch, 0] })
const cc = (beat, controller, value) => ({ beat, bytes: [0xb0, controller, value] })
const bend = (beat, value) => ({ beat, bytes: [0xe0, (value + 8192) & 0x7f, (value + 8192) >> 7] })

describe('readTake', () => {
  it('pairs a note on with its note off, with the velocity struck, in start order', () => {
    const { notes } = readTake([on(1, 64, 80), on(0, 60), off(0.5, 60), off(2, 64)], { endBeat: 4 })
    expect(notes).toEqual([
      { startBeat: 0, lengthBeats: 0.5, pitch: 60, velocity: 100 },
      { startBeat: 1, lengthBeats: 1, pitch: 64, velocity: 80 }
    ])
  })

  it('takes a note on of velocity zero as a note off, and ignores the channel', () => {
    const { notes } = readTake([{ beat: 0, bytes: [0x93, 60, 90] }, { beat: 1, bytes: [0x93, 60, 0] }], { endBeat: 4 })
    expect(notes).toEqual([{ startBeat: 0, lengthBeats: 1, pitch: 60, velocity: 90 }])
  })

  it('ends a note still held at the end of the take there, and pairs overlapping notes of one pitch in order', () => {
    const { notes } = readTake([on(0, 60, 90), on(1, 60, 70), off(2, 60)], { endBeat: 5 })
    expect(notes.map(n => [n.startBeat, n.lengthBeats, n.velocity])).toEqual([[0, 2, 90], [1, 4, 70]])
  })

  it('keeps a note struck and released at once, as a short note, not none', () => {
    const { notes } = readTake([on(1, 60), off(1, 60)], { endBeat: 4 })
    expect(notes).toEqual([{ startBeat: 1, lengthBeats: 0.05, pitch: 60, velocity: 100 }])
  })

  it('ignores a note off with no note on before it', () => {
    expect(readTake([off(1, 60)], { endBeat: 4 }).notes).toEqual([])
  })

  it('turns controllers and the pitch bend wheel into events, with the bend centred on zero', () => {
    const { controllers } = readTake([cc(0, 7, 100), bend(1, -4096), bend(2, 8191), bend(3, -8192)], { endBeat: 4 })
    expect(controllers).toEqual([
      { atBeat: 0, controller: 7, value: 100 },
      { atBeat: 1, controller: 'pitchBend', value: -4096 },
      { atBeat: 2, controller: 'pitchBend', value: 8191 },
      { atBeat: 3, controller: 'pitchBend', value: -8192 }
    ])
  })

  it('thins a sweep: the last value on each point of a 96th of a beat, and not a value that only repeats', () => {
    const sweep = [cc(0, 1, 10), cc(0.001, 1, 11), cc(0.002, 1, 12), cc(0.5, 1, 12), cc(1, 1, 30), cc(1, 7, 30)]
    const { controllers } = readTake(sweep, { endBeat: 4 })
    // 0, 0.001 and 0.002 are one point (the 12 is the last there), 0.5 repeats 12, then 30 on each of two controllers at beat 1.
    expect(controllers).toEqual([
      { atBeat: 0, controller: 1, value: 12 },
      { atBeat: 1, controller: 1, value: 30 },
      { atBeat: 1, controller: 7, value: 30 }
    ])
  })

  it('leaves out the channel messages: all notes off and the rest from controller 120', () => {
    expect(readTake([cc(0, 123, 0), cc(0, 120, 0), cc(0, 119, 5)], { endBeat: 4 }).controllers).toEqual([{ atBeat: 0, controller: 119, value: 5 }])
  })

  it('ignores messages that are not music', () => {
    expect(readTake([{ beat: 0, bytes: [0xc0, 5] }, { beat: 0, bytes: [0xfe] }], { endBeat: 4 })).toEqual({ notes: [], controllers: [] })
  })
})

describe('describeMidiTake', () => {
  const project = () => {
    const p = new Project()
    p.apply([{ op: 'addTrack', label: 'Keys' }, { op: 'addTrack', label: 'Bass' }])
    return p
  }

  it('makes a clip a track from where the take began, with notes relative to it, in whole bars', () => {
    const p = project()
    const captured = new Map([['track-1', [on(4.5, 60), off(5.5, 60), cc(6, 1, 64)]], ['track-2', [on(5, 36), off(9.5, 36)]]])
    const result = describeMidiTake(p, captured, { startBeat: 4, endBeat: 8 })
    expect([result.tracks, result.notes, result.controllers]).toEqual([2, 2, 1])
    p.apply(result.changes)
    const [keys, bass] = p.clips
    expect([keys.track, keys.startBeat, keys.lengthBeats]).toEqual(['track-1', 4, 4])
    expect(keys.notes).toEqual([{ startBeat: 0.5, lengthBeats: 1, pitch: 60, velocity: 100 }])
    expect(keys.controllers).toEqual([{ atBeat: 2, controller: 1, value: 64 }])
    // The bass note ran to beat 9.5, past the end of the take, so its clip is two bars.
    expect([bass.track, bass.lengthBeats]).toEqual(['track-2', 8])
  })

  it('leaves out a track that heard nothing, and one that is gone, and says why when nothing was played', () => {
    const p = project()
    const result = describeMidiTake(p, new Map([['track-1', [on(0, 60), off(1, 60)]], ['track-2', []], ['track-9', [on(0, 60)]]]), { startBeat: 0, endBeat: 4 })
    expect(result.changes.map(c => c.track)).toEqual(['track-1'])
    expect(() => describeMidiTake(p, new Map([['track-2', []]]), { startBeat: 0, endBeat: 4 })).toThrow(/nothing was played/)
    expect(() => describeMidiTake(p, new Map(), { startBeat: 0, endBeat: 4 })).toThrow(/nothing was played/)
  })

  it('keeps a take that has only controller moves', () => {
    const p = project()
    const result = describeMidiTake(p, new Map([['track-1', [bend(1, 100)]]]), { startBeat: 0, endBeat: 4 })
    expect([result.notes, result.controllers]).toEqual([0, 1])
    expect(() => p.apply(result.changes)).not.toThrow()
  })

  it('counts a bar by the project\'s time signature', () => {
    const p = project()
    p.apply([{ op: 'setTransport', beatsPerBar: 3 }])
    const result = describeMidiTake(p, new Map([['track-1', [on(0, 60), off(3.5, 60)]]]), { startBeat: 0, endBeat: 1 })
    expect(result.changes[0].lengthBeats).toBe(6)
  })
})
