// tests/model/ClipEdit.test.js
import { describe, it, expect } from 'vitest'
import { Project } from '../../src/model/Project.js'
import { splitClip, duplicateClip, trimClip, copyClips, pasteClips } from '../../src/model/ClipEdit.js'

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

describe('muted clips', () => {
  it('a cut or a copy of a muted clip is muted too', () => {
    const p = build()
    p.apply([{ op: 'setClip', id: 'm', muted: true }])
    p.apply(splitClip(p, 'm', 6))
    p.apply(duplicateClip(p, 'm'))
    expect(p.clips.filter(c => c.kind === 'midi').every(c => c.muted)).toBe(true)
    expect(p.clips.filter(c => c.kind === 'midi')).toHaveLength(3)
  })
})

describe('trimClip', () => {
  it('trims the back of a clip without touching its notes', () => {
    const p = build()
    p.apply(trimClip(p, 'm', { to: 6 }))
    expect([p.clip('m').startBeat, p.clip('m').lengthBeats]).toEqual([4, 2])
    expect(p.clip('m').notes).toHaveLength(3)
  })

  it('trims the front of a MIDI clip so the notes that remain sound where they did', () => {
    const p = build()
    p.apply(trimClip(p, 'm', { from: 6 }))
    const clip = p.clip('m')
    expect([clip.startBeat, clip.lengthBeats]).toEqual([6, 2])
    // Was note(1.5, 2) starting at beat 5.5 and note(3, 1) at beat 7.
    expect(clip.notes.map(n => [n.startBeat, n.lengthBeats, n.pitch])).toEqual([[0, 1.5, 60], [1, 1, 64]])
  })

  it('trims the front of an audio clip by starting further into the file', () => {
    const p = build()
    p.apply(trimClip(p, 'a', { from: 10 }, { transport: twoPerSecond }))
    expect(p.clip('a')).toMatchObject({ startBeat: 10, lengthBeats: 2, offsetSeconds: 2 })
  })

  it('refuses to grow a clip, to leave nothing, or to trim audio without a transport', () => {
    const p = build()
    expect(() => trimClip(p, 'm', { from: 3 })).toThrow(/leave some/)
    expect(() => trimClip(p, 'm', { to: 9 })).toThrow(/leave some/)
    expect(() => trimClip(p, 'm', { from: 6, to: 6 })).toThrow(/leave some/)
    expect(() => trimClip(p, 'a', { from: 10 })).toThrow(/needs the transport/)
    expect(() => trimClip(p, 'nope', { to: 6 })).toThrow(/no such clip/)
  })
})

describe('copy and paste', () => {
  it('pastes a group with its spacing kept, back on the tracks it came from', () => {
    const p = build()
    const copied = copyClips(p, ['a', 'm'])
    expect(copied.map(c => c.offset).sort()).toEqual([0, 4])
    p.apply(pasteClips(p, copied, { startBeat: 20 }))
    const pasted = p.clips.filter(c => c.startBeat >= 20)
    expect(pasted.map(c => [c.kind, c.startBeat, c.track]).sort()).toEqual([['audio', 24, 't'], ['midi', 20, 't']])
    expect(pasted.find(c => c.kind === 'midi').notes).toHaveLength(3)
  })

  it('puts every clip on one track when told to, and keeps mute', () => {
    const p = build()
    p.apply([{ op: 'setClip', id: 'm', muted: true }])
    p.apply(pasteClips(p, copyClips(p, ['m']), { startBeat: 0, track: 'u' }))
    expect(p.clips.find(c => c.track === 'u')).toMatchObject({ kind: 'midi', muted: true, startBeat: 0 })
  })

  it('pastes twice into two separate sets, and after the source is gone', () => {
    const p = build()
    const copied = copyClips(p, ['m'])
    p.apply([{ op: 'removeClip', id: 'm' }])
    p.apply(pasteClips(p, copied, { startBeat: 0 }))
    p.apply(pasteClips(p, copied, { startBeat: 8 }))
    expect(p.clips.filter(c => c.kind === 'midi')).toHaveLength(2)
    expect(new Set(p.clips.map(c => c.id)).size).toBe(p.clips.length)
  })

  it('refuses an empty copy, an unknown clip, an empty paste, and a track that is gone', () => {
    const p = build()
    expect(() => copyClips(p, [])).toThrow(/nothing selected/)
    expect(() => copyClips(p, ['nope'])).toThrow(/no such clip/)
    expect(() => pasteClips(p, [], { startBeat: 0 })).toThrow(/nothing copied/)
    const copied = copyClips(p, ['m'])
    p.apply([{ op: 'removeClip', id: 'm' }, { op: 'removeClip', id: 'a' }, { op: 'removeTrack', id: 't' }])
    expect(() => pasteClips(p, copied, { startBeat: 0 })).toThrow(/is gone/)
  })
})

describe('fades', () => {
  const faded = () => {
    const p = build()
    p.apply([{ op: 'setClip', id: 'a', fadeInBeats: 1, fadeOutBeats: 0.5 }])
    return p
  }

  it('a cut leaves the fade in on the first half and the fade out on the second', () => {
    const p = faded()
    p.apply(splitClip(p, 'a', 10, { transport: twoPerSecond }))
    const second = p.clips.find(c => c.kind === 'audio' && c.id !== 'a')
    expect([p.clip('a').fadeInBeats, p.clip('a').fadeOutBeats]).toEqual([1, 0])
    expect([second.fadeInBeats, second.fadeOutBeats]).toEqual([0, 0.5])
  })

  it('trimming an edge takes its fade with it and keeps the other', () => {
    const p = faded()
    p.apply(trimClip(p, 'a', { from: 10 }, { transport: twoPerSecond }))
    expect([p.clip('a').fadeInBeats, p.clip('a').fadeOutBeats]).toEqual([0, 0.5])
    const q = faded()
    q.apply(trimClip(q, 'a', { to: 10 }))
    expect([q.clip('a').fadeInBeats, q.clip('a').fadeOutBeats]).toEqual([1, 0])
  })

  it('a copy, a duplicate and a paste keep both fades', () => {
    const p = faded()
    p.apply(duplicateClip(p, 'a'))
    p.apply(pasteClips(p, copyClips(p, ['a']), { startBeat: 30 }))
    const audio = p.clips.filter(c => c.kind === 'audio')
    expect(audio).toHaveLength(3)
    expect(audio.every(c => c.fadeInBeats === 1 && c.fadeOutBeats === 0.5)).toBe(true)
  })

  it('refuses a fade that is not a length, and a fade on a MIDI clip', () => {
    const p = build()
    expect(() => p.apply([{ op: 'setClip', id: 'a', fadeInBeats: -1 }])).toThrow(/zero or more/)
    expect(() => p.apply([{ op: 'setClip', id: 'a', fadeOutBeats: 'long' }])).toThrow(/zero or more/)
    expect(() => p.apply([{ op: 'setClip', id: 'm', fadeInBeats: 1 }])).toThrow(/only an audio clip/)
  })
})
