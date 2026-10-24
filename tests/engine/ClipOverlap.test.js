// tests/engine/ClipOverlap.test.js
//
// The rule for clips that overlap on a lane: the model accepts them, nothing is cut, pushed or refused, and every one of them plays
// (docs/project-format.md, "Clips"). Pinned here so that moving, duplicating or pasting a clip over another cannot start to cut it
// without a test saying the rule changed.
import { describe, it, expect, beforeEach } from 'vitest'
import { Project } from '../../src/model/Project.js'
import { clipNotes, clipAudio } from '../../src/engine/Scheduler.js'
import { duplicateClip, pasteClips, copyClips } from '../../src/model/ClipEdit.js'

const note = (startBeat, pitch) => ({ startBeat, lengthBeats: 1, pitch, velocity: 100 })
let project
beforeEach(() => {
  project = new Project()
  project.apply([
    { op: 'addTrack', id: 't' },
    { op: 'addNode', id: 'synth', track: 't', pluginIri: 'https://example.org/p/' },
    { op: 'setTrack', id: 't', midiInput: 'synth' },
    { op: 'addClip', id: 'a', track: 't', kind: 'midi', startBeat: 0, lengthBeats: 8, notes: [note(0, 60), note(6, 62)] },
    { op: 'addClip', id: 'b', track: 't', kind: 'midi', startBeat: 4, lengthBeats: 8, notes: [note(0, 64), note(3, 65)] }
  ])
})

describe('clips that overlap on a lane', () => {
  it('are both kept, whole, where they were put', () => {
    expect(project.clip('a')).toMatchObject({ startBeat: 0, lengthBeats: 8 })
    expect(project.clip('b')).toMatchObject({ startBeat: 4, lengthBeats: 8 })
    expect(project.clip('a').notes).toHaveLength(2)
  })

  it('both play: every note of each is scheduled, the overlap included', () => {
    const played = clipNotes(project).get('synth').map(n => [n.on, n.pitch]).sort((x, y) => x[0] - y[0] || x[1] - y[1])
    expect(played).toEqual([[0, 60], [4, 64], [6, 62], [7, 65]])
  })

  it('stay whole when a clip is moved over another, and when it is lengthened into one', () => {
    project.apply([{ op: 'setClip', id: 'b', startBeat: 2 }])
    project.apply([{ op: 'setClip', id: 'a', lengthBeats: 12 }])
    expect(project.clip('a')).toMatchObject({ startBeat: 0, lengthBeats: 12 })
    expect(project.clip('b')).toMatchObject({ startBeat: 2, lengthBeats: 8 })
    expect(project.clips).toHaveLength(2)
  })

  it('stay whole when a copy is made or pasted over the original', () => {
    project.apply(duplicateClip(project, 'a'))
    expect(project.clips).toHaveLength(3)
    const clipboard = copyClips(project, ['a'])
    project.apply(pasteClips(project, clipboard, { startBeat: 2 }))
    expect(project.clips).toHaveLength(4)
    for (const id of ['a', 'b']) expect(project.clip(id).notes.length).toBeGreaterThan(0)
  })

  it('do not hide an audio clip under another: both are asked to play', () => {
    project.apply([
      { op: 'addClip', id: 'x', track: 't', kind: 'audio', startBeat: 0, lengthBeats: 4, source: 'https://example.org/x.wav', offsetSeconds: 0 },
      { op: 'addClip', id: 'y', track: 't', kind: 'audio', startBeat: 2, lengthBeats: 4, source: 'https://example.org/y.wav', offsetSeconds: 0 }
    ])
    expect(clipAudio(project).map(c => c.id).sort()).toEqual(['x', 'y'])
  })
})
