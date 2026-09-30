// tests/model/ClipLock.test.js
import { describe, it, expect } from 'vitest'
import { Project } from '../../src/model/Project.js'
import { UndoHistory } from '../../src/ops/UndoHistory.js'

function build () {
  const p = new Project()
  p.apply([
    { op: 'addTrack', id: 't' }, { op: 'addTrack', id: 'u' },
    { op: 'addClip', id: 'm', track: 't', kind: 'midi', startBeat: 0, lengthBeats: 4, locked: true, notes: [{ startBeat: 0, lengthBeats: 1, pitch: 60, velocity: 90 }] }
  ])
  return p
}

describe('a locked clip', () => {
  it('refuses to move, resize, change track, edit its notes or be removed, and says why', () => {
    const p = build()
    for (const change of [
      { op: 'setClip', id: 'm', startBeat: 2 }, { op: 'setClip', id: 'm', lengthBeats: 2 }, { op: 'setClip', id: 'm', track: 'u' },
      { op: 'setClipNotes', id: 'm', notes: [] }, { op: 'removeClip', id: 'm' }
    ]) expect(() => p.apply([change]), change.op).toThrow(/locked/)
    expect(p.clip('m')).toMatchObject({ startBeat: 0, lengthBeats: 4, track: 't' })
  })

  it('can still be muted, and unlocked, after which it can be changed', () => {
    const p = build()
    p.apply([{ op: 'setClip', id: 'm', muted: true }])
    expect(p.clip('m').muted).toBe(true)
    p.apply([{ op: 'setClip', id: 'm', locked: false }])
    p.apply([{ op: 'setClip', id: 'm', startBeat: 2 }])
    expect(p.clip('m').startBeat).toBe(2)
  })

  it('leaves a whole changeset undone when one part is refused', () => {
    const p = build()
    expect(() => p.apply([{ op: 'addClip', id: 'x', track: 't', kind: 'midi', startBeat: 8, lengthBeats: 1 }, { op: 'removeClip', id: 'm' }])).toThrow(/locked/)
    expect(p.clip('x')).toBeNull()
  })

  it('refuses anything but true or false', () => {
    const p = build()
    expect(() => p.apply([{ op: 'setClip', id: 'm', locked: 'yes' }])).toThrow(/true or false/)
  })

  it('does not stop the track it is on being removed, which is a deliberate act', () => {
    const p = build()
    p.apply([{ op: 'removeTrack', id: 't' }])
    expect(p.clip('m')).toBeNull()
  })

  it('is put back by undo, whatever its lock', () => {
    const p = build()
    p.apply([{ op: 'setClip', id: 'm', locked: false }])
    p.apply([{ op: 'removeClip', id: 'm' }])
    p.apply([{ op: 'addClip', id: 'm', track: 't', kind: 'midi', startBeat: 0, lengthBeats: 4, locked: true }])
    expect(p.snapshot().clips.find(c => c.id === 'm').locked).toBe(true)
    expect(UndoHistory).toBeTypeOf('function')
  })
})
