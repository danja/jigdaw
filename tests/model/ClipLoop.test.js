// tests/model/ClipLoop.test.js
//
// A looped MIDI clip: what it plays, how the model keeps the loop, and what each reader of a clip's content makes
// of it. The scheduler and the MIDI file read through playedContent, so the same expansion is tested once here and
// its use there.
import { describe, it, expect } from 'vitest'
import { Project, changesFor } from '../../src/model/Project.js'
import { playedContent, checkLoopBeats } from '../../src/model/ClipLoop.js'
import { splitClip, trimClip, duplicateClip, copyClips, pasteClips } from '../../src/model/ClipEdit.js'
import { clipNotes, clipControllers } from '../../src/engine/Scheduler.js'
import { writeMidiFile } from '../../src/model/MidiFile.js'

const note = (startBeat, lengthBeats, pitch = 60) => ({ startBeat, lengthBeats, pitch, velocity: 90 })
const cc = (atBeat, controller, value) => ({ atBeat, controller, value })

function build (over = {}) {
  const p = new Project()
  p.apply([
    { op: 'addTrack', id: 't' },
    { op: 'addNode', id: 'synth', track: 't', pluginIri: 'https://example.org/p/' },
    { op: 'setTrack', id: 't', midiInput: 'synth' },
    { op: 'addClip', id: 'c', track: 't', kind: 'midi', startBeat: 4, lengthBeats: 8, notes: [note(0, 1), note(1, 3, 64), note(3, 1, 67)], controllers: [cc(0, 1, 10), cc(2, 1, 90)], loopBeats: 4, ...over }
  ])
  return p
}

describe('what a looped clip plays', () => {
  it('repeats the pattern to fill the clip, in clip time', () => {
    const { notes, controllers } = playedContent(build().clip('c'))
    expect(notes.map(n => [n.startBeat, n.pitch])).toEqual([[0, 60], [1, 64], [3, 67], [4, 60], [5, 64], [7, 67]])
    expect(controllers.map(e => [e.atBeat, e.value])).toEqual([[0, 10], [2, 90], [4, 10], [6, 90]])
  })
  it('cuts a note that runs past the pattern end at it, so repeats do not overlap', () => {
    const p = build({ loopBeats: 2 })
    expect(playedContent(p.clip('c')).notes.map(n => [n.startBeat, n.lengthBeats, n.pitch]).slice(0, 3)).toEqual([[0, 1, 60], [1, 1, 64], [2, 1, 60]])
  })
  it('does not play what starts after the pattern end, and does not lose it', () => {
    const p = build({ loopBeats: 2 })
    expect(playedContent(p.clip('c')).notes.some(n => n.pitch === 67)).toBe(false)
    expect(p.clip('c').notes).toHaveLength(3)
  })
  it('stops at the clip end, with a partial last repeat', () => {
    const p = build({ lengthBeats: 6 })
    expect(playedContent(p.clip('c')).notes.map(n => n.startBeat)).toEqual([0, 1, 3, 4, 5])
  })
  it('returns the clip as it is with no loop, or a loop as long as the clip or longer', () => {
    const none = build({ loopBeats: undefined }).clip('c')
    expect(playedContent(none).notes).toBe(none.notes)
    const long = build({ loopBeats: 8 }).clip('c')
    expect(playedContent(long).notes).toBe(long.notes)
  })
})

describe('the model keeps the loop', () => {
  it('stores it only when set, sets and clears it with setClip, and refuses nonsense', () => {
    const p = build({ loopBeats: undefined })
    expect('loopBeats' in p.clip('c')).toBe(false)
    p.apply([{ op: 'setClip', id: 'c', loopBeats: 2 }])
    expect(p.clip('c').loopBeats).toBe(2)
    p.apply([{ op: 'setClip', id: 'c', loopBeats: null }])
    expect('loopBeats' in p.clip('c')).toBe(false)
    expect(() => p.apply([{ op: 'setClip', id: 'c', loopBeats: 0 }])).toThrow(/above zero/)
    expect(() => p.apply([{ op: 'setClip', id: 'c', loopBeats: '2' }])).toThrow(/above zero/)
    expect(() => checkLoopBeats(-1)).toThrow()
  })
  it('refuses a loop on an audio clip, and on a locked clip', () => {
    const p = build()
    p.apply([{ op: 'addClip', id: 'a', track: 't', kind: 'audio', startBeat: 0, lengthBeats: 4, source: 'https://example.org/a.wav' }])
    expect(() => p.apply([{ op: 'setClip', id: 'a', loopBeats: 2 }])).toThrow(/only a MIDI clip/)
    expect(() => p.apply([{ op: 'addClip', track: 't', kind: 'audio', startBeat: 0, lengthBeats: 4, source: 'https://example.org/a.wav', loopBeats: 2 }])).toThrow(/only a MIDI clip/)
    p.apply([{ op: 'setClip', id: 'c', locked: true }])
    expect(() => p.apply([{ op: 'setClip', id: 'c', loopBeats: 2 }])).toThrow(/locked/)
  })
  it('copies the loop wherever a project is copied from its snapshot', () => {
    const q = new Project()
    q.apply(changesFor(build().snapshot()))
    expect(q.clip('c').loopBeats).toBe(4)
    expect('loopBeats' in changesFor(build({ loopBeats: undefined }).snapshot()).find(c => c.op === 'addClip')).toBe(false)
  })
})

describe('what reads a looped clip', () => {
  it('has the scheduler play the repeats at absolute beats', () => {
    const p = build()
    expect(clipNotes(p).get('synth').map(n => n.on)).toEqual([4, 5, 7, 8, 9, 11])
    expect(clipControllers(p).get('synth').map(e => e.on)).toEqual([4, 6, 8, 10])
  })
  it('has the MIDI file carry the repeats', () => {
    const looped = writeMidiFile(build(), {})
    const flat = writeMidiFile(build({ loopBeats: undefined }), {})
    expect(looped.notes).toBe(6)
    expect(flat.notes).toBe(3)
    expect(looped.controllers).toBe(4)
  })
})

describe('editing a looped clip', () => {
  it('splits by what it plays: both halves hold repeats, and neither loops', () => {
    const p = build()
    p.apply(splitClip(p, 'c', 8))
    const second = p.clips.find(c => c.id !== 'c')
    expect('loopBeats' in p.clip('c')).toBe(false)
    expect(p.clip('c').notes.map(n => n.startBeat)).toEqual([0, 1, 3])
    expect(second.notes.map(n => n.startBeat)).toEqual([0, 1, 3])
    expect(second.controllers.map(e => e.atBeat)).toEqual([0, 2])
  })
  it('keeps the loop when only the end is trimmed, and writes the repeats when the start is', () => {
    const p = build()
    p.apply(trimClip(p, 'c', { to: 10 }))
    expect(p.clip('c').loopBeats).toBe(4)
    p.apply(trimClip(p, 'c', { from: 8 }))
    expect('loopBeats' in p.clip('c')).toBe(false)
    expect(p.clip('c').notes.map(n => [n.startBeat, n.pitch])).toEqual([[0, 60], [1, 64]])
  })
  it('carries the loop through duplicate, copy and paste', () => {
    const p = build()
    p.apply(duplicateClip(p, 'c'))
    expect(p.clips.find(c => c.id !== 'c').loopBeats).toBe(4)
    p.apply(pasteClips(p, copyClips(p, ['c']), { startBeat: 40 }))
    expect(p.clips.filter(c => c.loopBeats === 4)).toHaveLength(3)
  })
})
