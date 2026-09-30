// tests/engine/SchedulerMuted.test.js
import { describe, it, expect } from 'vitest'
import { Project } from '../../src/model/Project.js'
import { clipNotes, clipAudio } from '../../src/engine/Scheduler.js'

const SRC = 'https://example.org/media/a.wav'
const note = { startBeat: 0, lengthBeats: 1, pitch: 60, velocity: 90 }

function build () {
  const p = new Project()
  p.apply([
    { op: 'addTrack', id: 't' },
    { op: 'addNode', id: 'n', track: 't', pluginIri: 'https://example.org/p/' },
    { op: 'setTrack', id: 't', midiInput: 'n' },
    { op: 'addClip', id: 'm', track: 't', kind: 'midi', startBeat: 0, lengthBeats: 4, notes: [note] },
    { op: 'addClip', id: 'a', track: 't', kind: 'audio', startBeat: 4, lengthBeats: 4, source: SRC }
  ])
  return p
}

describe('a muted clip', () => {
  it('is not played, and is played again when unmuted', () => {
    const p = build()
    expect(clipNotes(p).get('n')).toHaveLength(1)
    expect(clipAudio(p)).toHaveLength(1)
    p.apply([{ op: 'setClip', id: 'm', muted: true }, { op: 'setClip', id: 'a', muted: true }])
    expect(clipNotes(p).size).toBe(0)
    expect(clipAudio(p)).toEqual([])
    p.apply([{ op: 'setClip', id: 'm', muted: false }])
    expect(clipNotes(p).get('n')).toHaveLength(1)
  })

  it('refuses anything but true or false', () => {
    const p = build()
    expect(() => p.apply([{ op: 'setClip', id: 'm', muted: 'yes' }])).toThrow(/true or false/)
    expect(() => p.apply([{ op: 'addClip', track: 't', kind: 'midi', startBeat: 0, lengthBeats: 1, muted: 1 }])).toThrow(/true or false/)
  })

  it('survives a snapshot rebuild, which is what undo does', () => {
    const p = build()
    p.apply([{ op: 'setClip', id: 'a', muted: true }])
    expect(p.snapshot().clips.find(c => c.id === 'a').muted).toBe(true)
  })
})
