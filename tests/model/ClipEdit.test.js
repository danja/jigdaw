// tests/model/ClipEdit.test.js
import { describe, it, expect } from 'vitest'
import { Project } from '../../src/model/Project.js'
import { splitClip, duplicateClip } from '../../src/model/ClipEdit.js'

const note = (startBeat, lengthBeats, pitch = 60) => ({ startBeat, lengthBeats, pitch, velocity: 90 })
const SRC = 'https://example.org/media/a.wav'
const twoPerSecond = { secondsAtBeat: beat => beat / 2 }

function build () {
  const p = new Project()
  p.apply([
    { op: 'addTrack', id: 't' }, { op: 'addTrack', id: 'u' },
    { op: 'addClip', id: 'm', track: 't', kind: 'midi', startBeat: 4, lengthBeats: 4, notes: [note(0, 1), note(1.5, 2), note(3, 1, 64)] },
    { op: 'addClip', id: 'a', track: 't', kind: 'audio', startBeat: 8, lengthBeats: 4, source: SRC, offsetSeconds: 1 }
  ])
  return p
}

describe('splitClip', () => {
  it('cuts a MIDI clip, keeps its id on the first half, moves later notes, and splits one across the cut', () => {
    const p = build()
    p.apply(splitClip(p, 'm', 6))
    const first = p.clip('m')
    const second = p.clips.find(c => c.id !== 'm' && c.kind === 'midi')
    expect([first.startBeat, first.lengthBeats]).toEqual([4, 2])
    expect([second.startBeat, second.lengthBeats]).toEqual([6, 2])
    expect(first.notes.map(n => [n.startBeat, n.lengthBeats])).toEqual([[0, 1], [1.5, 0.5]])
    expect(second.notes.map(n => [n.startBeat, n.lengthBeats, n.pitch])).toEqual([[0, 1.5, 60], [1, 1, 64]])
  })

  it('cuts an audio clip so the second half starts further into the file', () => {
    const p = build()
    p.apply(splitClip(p, 'a', 10, { transport: twoPerSecond }))
    const second = p.clips.find(c => c.kind === 'audio' && c.id !== 'a')
    expect(p.clip('a').lengthBeats).toBe(2)
    expect([second.startBeat, second.lengthBeats, second.offsetSeconds, second.source]).toEqual([10, 2, 2, SRC])
  })

  it('refuses a cut at or outside the edges, an unknown clip, and audio without a transport', () => {
    const p = build()
    expect(() => splitClip(p, 'm', 4)).toThrow(/inside the clip/)
    expect(() => splitClip(p, 'm', 8)).toThrow(/inside the clip/)
    expect(() => splitClip(p, 'nope', 5)).toThrow(/no such clip/)
    expect(() => splitClip(p, 'a', 10)).toThrow(/needs the transport/)
  })

  it('is one changeset, so the pair is placed or refused together', () => {
    const p = build()
    const before = p.clips.length
    expect(() => p.apply([...splitClip(p, 'm', 6), { op: 'removeClip', id: 'ghost' }])).toThrow()
    expect(p.clips).toHaveLength(before)
    expect(p.clip('m').lengthBeats).toBe(4)
  })
})

describe('duplicateClip', () => {
  it('places a copy after the original, or where asked, with its own notes', () => {
    const p = build()
    p.apply(duplicateClip(p, 'm'))
    const copy = p.clips.find(c => c.startBeat === 8 && c.kind === 'midi')
    expect(copy.notes).toEqual(p.clip('m').notes)
    expect(copy.notes[0]).not.toBe(p.clip('m').notes[0])
    p.apply(duplicateClip(p, 'a', { track: 'u', startBeat: 0 }))
    expect(p.clips.find(c => c.track === 'u')).toMatchObject({ kind: 'audio', source: SRC, offsetSeconds: 1, startBeat: 0 })
  })

  it('refuses an unknown clip', () => {
    expect(() => duplicateClip(build(), 'nope')).toThrow(/no such clip/)
  })
})
