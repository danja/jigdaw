// tests/model/ClipLauncher.test.js
//
// A clip with a scene is a clip launcher clip: kept off the timeline, one to a track in each scene (docs/clip-launcher.md).
import { describe, it, expect, beforeEach } from 'vitest'
import { Project, changesFor } from '../../src/model/Project.js'
import { clipNotes, clipControllers, clipAudio } from '../../src/engine/Scheduler.js'
import { trackHasMidi } from '../../src/model/MidiFile.js'

const note = { startBeat: 0, lengthBeats: 1, pitch: 60, velocity: 100 }
let project
beforeEach(() => {
  project = new Project()
  project.apply([{ op: 'addTrack', id: 't1' }, { op: 'addTrack', id: 't2' }, { op: 'addNode', id: 'n1', track: 't1', pluginIri: 'https://example.org/p/' }, { op: 'setTrack', id: 't1', midiInput: 'n1' }])
})
const add = (extra = {}) => project.apply([{ op: 'addClip', id: 'c1', track: 't1', kind: 'midi', startBeat: 0, lengthBeats: 4, notes: [note], ...extra }])

describe('a launcher clip', () => {
  it('is a MIDI clip with a scene, listed apart from the clips on the timeline', () => {
    add({ scene: 0 })
    project.apply([{ op: 'addClip', id: 'c2', track: 't1', kind: 'midi', startBeat: 8, lengthBeats: 4 }])
    expect(project.clip('c1').scene).toBe(0)
    expect(project.launcherClips.map(c => c.id)).toEqual(['c1'])
    expect(project.arrangementClips.map(c => c.id)).toEqual(['c2'])
    expect(project.clips).toHaveLength(2)
  })

  it('is refused for an audio clip, a start other than 0, a bad scene and a scene already taken on the track', () => {
    expect(() => project.apply([{ op: 'addClip', track: 't1', kind: 'audio', startBeat: 0, lengthBeats: 4, source: 'https://example.org/a.wav', scene: 0 }])).toThrow(/only a MIDI clip/)
    expect(() => add({ scene: 0, startBeat: 2 })).toThrow(/start is 0/)
    expect(() => add({ scene: -1 })).toThrow(/whole number from zero/)
    expect(() => add({ scene: 1.5 })).toThrow(/whole number from zero/)
    add({ scene: 0 })
    expect(() => project.apply([{ op: 'addClip', id: 'c2', track: 't1', kind: 'midi', startBeat: 0, lengthBeats: 4, scene: 0 }])).toThrow(/scene 0 on t1 already holds c1/)
    // The same scene on another track is the row of the grid.
    project.apply([{ op: 'addClip', id: 'c3', track: 't2', kind: 'midi', startBeat: 0, lengthBeats: 4, scene: 0 }])
    expect(project.launcherClips.map(c => c.id)).toEqual(['c1', 'c3'])
  })

  it('is not played by the arrangement, not exported to a MIDI file, and not counted as something to hear on the timeline', () => {
    add({ scene: 0 })
    expect(clipNotes(project).size).toBe(0)
    expect(clipControllers(project).size).toBe(0)
    expect(clipAudio(project)).toEqual([])
    expect(trackHasMidi(project, 't1')).toBe(false)
    project.apply([{ op: 'setClip', id: 'c1', scene: null }])
    expect(clipNotes(project).get('n1')).toHaveLength(1)
    expect(trackHasMidi(project, 't1')).toBe(true)
  })
})

describe('moving a clip into and out of the launcher', () => {
  it('puts a timeline clip into a scene at start 0, and back onto the timeline at 0 or at a given start', () => {
    add({ startBeat: 6 })
    project.apply([{ op: 'setClip', id: 'c1', scene: 2 }])
    expect(project.clip('c1')).toMatchObject({ scene: 2, startBeat: 0 })
    project.apply([{ op: 'setClip', id: 'c1', scene: null, startBeat: 8 }])
    expect(project.clip('c1').scene).toBeUndefined()
    expect(project.clip('c1').startBeat).toBe(8)
  })

  it('moves to another scene, refuses a taken one, and refuses a start while in the launcher', () => {
    add({ scene: 0 })
    project.apply([{ op: 'addClip', id: 'c2', track: 't1', kind: 'midi', startBeat: 0, lengthBeats: 4, scene: 1 }])
    expect(() => project.apply([{ op: 'setClip', id: 'c1', scene: 1 }])).toThrow(/already holds c2/)
    project.apply([{ op: 'setClip', id: 'c1', scene: 5 }])
    expect(project.clip('c1').scene).toBe(5)
    expect(() => project.apply([{ op: 'setClip', id: 'c1', startBeat: 3 }])).toThrow(/start is 0/)
  })

  it('refuses leaving the launcher for a clip that is not in it, an audio clip going in, and a locked clip moving', () => {
    add()
    expect(() => project.apply([{ op: 'setClip', id: 'c1', scene: null }])).toThrow(/not in the clip launcher/)
    project.apply([{ op: 'addClip', id: 'a1', track: 't1', kind: 'audio', startBeat: 0, lengthBeats: 4, source: 'https://example.org/a.wav' }])
    expect(() => project.apply([{ op: 'setClip', id: 'a1', scene: 0 }])).toThrow(/only a MIDI clip/)
    project.apply([{ op: 'setClip', id: 'c1', locked: true }])
    expect(() => project.apply([{ op: 'setClip', id: 'c1', scene: 0 }])).toThrow(/locked/)
  })

  it('refuses moving a launcher clip to a track that already has that scene, and moving a track\'s clips onto one that does', () => {
    add({ scene: 0 })
    project.apply([{ op: 'addClip', id: 'c3', track: 't2', kind: 'midi', startBeat: 0, lengthBeats: 4, scene: 0 }])
    expect(() => project.apply([{ op: 'setClip', id: 'c1', track: 't2' }])).toThrow(/already holds c3/)
    expect(() => project.apply([{ op: 'removeTrack', id: 't2', moveNodesTo: 't1' }])).toThrow(/already holds c1/)
  })
})

describe('copies of a project', () => {
  it('keep the scene through a snapshot and the changeset that rebuilds it', () => {
    add({ scene: 3 })
    const rebuilt = new Project()
    rebuilt.apply(changesFor(project.snapshot()))
    expect(rebuilt.clip('c1').scene).toBe(3)
    expect(rebuilt.launcherClips).toHaveLength(1)
  })
})
