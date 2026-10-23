// tests/model/Controllers.test.js
//
// Controller and pitch bend events held by a MIDI clip: what the model accepts, and how a clip edit treats them.
import { describe, it, expect } from 'vitest'
import { Project } from '../../src/model/Project.js'
import { splitClip, duplicateClip, trimClip, copyClips, pasteClips } from '../../src/model/ClipEdit.js'

const cc = (atBeat, controller, value) => ({ atBeat, controller, value })

function build (controllers = [], extra = {}) {
  const project = new Project()
  project.apply([{ op: 'addTrack' }, { op: 'addClip', track: 'track-1', kind: 'midi', startBeat: 4, lengthBeats: 8, notes: [], controllers, ...extra }])
  return project
}
const events = project => project.clip('clip-1').controllers

describe('a clip with controller events', () => {
  it('holds them sorted by beat then controller, with pitch bend after the controllers', () => {
    const project = build([cc(2, 'pitchBend', -100), cc(2, 7, 90), cc(0, 64, 127), cc(1, 1, 5)])
    expect(events(project)).toEqual([cc(0, 64, 127), cc(1, 1, 5), cc(2, 7, 90), cc(2, 'pitchBend', -100)])
  })

  it('has none to start, and an audio clip has none', () => {
    const project = build()
    expect(events(project)).toEqual([])
    project.apply([{ op: 'addClip', track: 'track-1', kind: 'audio', startBeat: 0, lengthBeats: 4, source: 'https://example.org/a.wav' }])
    expect(project.clip('clip-2').controllers).toEqual([])
  })

  it('takes the edges of each range and refuses what is outside it, saying which event', () => {
    const ok = build([cc(0, 0, 0), cc(0, 127, 127), cc(0, 'pitchBend', -8192), cc(1, 'pitchBend', 8191)])
    expect(events(ok)).toHaveLength(4)
    const bad = (e, text) => expect(() => build([cc(0, 1, 1), e])).toThrow(text)
    bad(cc(-1, 1, 1), /event 1 needs an atBeat/)
    bad(cc(NaN, 1, 1), /event 1 needs an atBeat/)
    bad(cc(0, 128, 1), /controller from 0 to 127, or pitchBend/)
    bad(cc(0, 1.5, 1), /controller from 0 to 127/)
    bad(cc(0, 'volume', 1), /controller from 0 to 127/)
    bad(cc(0, 1, 128), /value from 0 to 127/)
    bad(cc(0, 1, -1), /value from 0 to 127/)
    bad(cc(0, 1, 0.5), /whole value/)
    bad(cc(0, 'pitchBend', 8192), /value from -8192 to 8191/)
    bad(cc(0, 'pitchBend', -8193), /value from -8192 to 8191/)
    expect(() => build('no')).toThrow(/array/)
  })

  it('refuses two events for one controller at one beat, but takes two controllers at one beat', () => {
    expect(() => build([cc(1, 7, 10), cc(1, 7, 20)])).toThrow(/repeats controller 7 at beat 1/)
    expect(() => build([cc(1, 'pitchBend', 1), cc(1, 'pitchBend', 2)])).toThrow(/repeats pitch bend at beat 1/)
    expect(events(build([cc(1, 7, 10), cc(1, 10, 20)]))).toHaveLength(2)
  })
})

describe('setClipControllers', () => {
  it('replaces the whole list, leaving an earlier snapshot with its own copy', () => {
    const project = build([cc(0, 7, 100)])
    const before = project.snapshot()
    project.apply([{ op: 'setClipControllers', id: 'clip-1', controllers: [cc(2, 1, 64)] }])
    expect(events(project)).toEqual([cc(2, 1, 64)])
    // The snapshot is its own copy: an edit made after it did not reach into it.
    expect(before.clips[0].controllers).toEqual([cc(0, 7, 100)])
    // And the other way: changing the snapshot's list does not reach the project's.
    const after = project.snapshot()
    after.clips[0].controllers.push(cc(9, 1, 1))
    expect(events(project)).toEqual([cc(2, 1, 64)])
  })

  it('refuses a missing clip, an audio clip, a locked clip, and bad events, changing nothing', () => {
    const project = build([cc(0, 7, 100)])
    project.apply([{ op: 'addClip', track: 'track-1', kind: 'audio', startBeat: 0, lengthBeats: 4, source: 'https://example.org/a.wav' }])
    expect(() => project.apply([{ op: 'setClipControllers', id: 'nope', controllers: [] }])).toThrow(/no such clip/)
    expect(() => project.apply([{ op: 'setClipControllers', id: 'clip-2', controllers: [] }])).toThrow(/audio/)
    expect(() => project.apply([{ op: 'setClipControllers', id: 'clip-1', controllers: [cc(0, 1, 999)] }])).toThrow(/value/)
    project.apply([{ op: 'setClip', id: 'clip-1', locked: true }])
    expect(() => project.apply([{ op: 'setClipControllers', id: 'clip-1', controllers: [] }])).toThrow(/locked/)
    expect(events(project)).toEqual([cc(0, 7, 100)])
  })
})

describe('editing a clip that holds them', () => {
  const held = () => build([cc(0, 'pitchBend', 4000), cc(2, 7, 80), cc(5, 7, 40), cc(6, 'pitchBend', 0)])

  it('splits them at the cut, and starts the second half with the value each controller held there', () => {
    const project = held()
    const changes = splitClip(project, 'clip-1', 8)
    project.apply(changes)
    expect(events(project)).toEqual([cc(0, 'pitchBend', 4000), cc(2, 7, 80)])
    // The cut is four beats in: bend 4000 and volume 80 hold across it, then volume 40 at beat 1 and bend 0 at beat 2.
    expect(project.clip('clip-2').controllers).toEqual([cc(0, 7, 80), cc(0, 'pitchBend', 4000), cc(1, 7, 40), cc(2, 'pitchBend', 0)])
  })

  it('does not add a held value where the second half has an event of its own at its start', () => {
    const project = build([cc(0, 7, 10), cc(4, 7, 99)])
    project.apply(splitClip(project, 'clip-1', 8))
    expect(project.clip('clip-2').controllers).toEqual([cc(0, 7, 99)])
  })

  it('leaves a clip with none exactly as it was, with no controller change in the split', () => {
    const project = build()
    expect(splitClip(project, 'clip-1', 8).map(c => c.op)).toEqual(['setClip', 'setClipNotes', 'addClip'])
  })

  it('copies them to a duplicate, as their own list', () => {
    const project = held()
    project.apply(duplicateClip(project, 'clip-1'))
    expect(project.clip('clip-2').controllers).toEqual(events(project))
    project.apply([{ op: 'setClipControllers', id: 'clip-2', controllers: [] }])
    expect(events(project)).toHaveLength(4)
  })

  it('cuts the front off in a trim and keeps what was held', () => {
    const project = held()
    project.apply(trimClip(project, 'clip-1', { from: 8 }))
    expect(events(project)).toEqual([cc(0, 7, 80), cc(0, 'pitchBend', 4000), cc(1, 7, 40), cc(2, 'pitchBend', 0)])
  })

  it('goes through copy and paste', () => {
    const project = held()
    const copied = copyClips(project, ['clip-1'])
    project.apply(pasteClips(project, copied, { startBeat: 20 }))
    expect(project.clip('clip-2').controllers).toEqual(events(project))
    expect(project.clip('clip-2').controllers).not.toBe(events(project))
  })
})
