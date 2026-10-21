// tests/model/TrackBus.test.js
import { describe, it, expect } from 'vitest'
import { Project } from '../../src/model/Project.js'
import { describeBus } from '../../src/model/TrackBus.js'

function build () {
  const project = new Project()
  project.apply([{ op: 'addTrack' }, { op: 'addTrack' }, { op: 'addTrack' }])
  return project
}

describe('describeBus', () => {
  it('adds one track and points each chosen track at it, applying as one change', () => {
    const project = build()
    const changes = describeBus(project, ['track-1', 'track-2'])
    expect(changes[0]).toMatchObject({ op: 'addTrack', label: 'Bus' })
    project.apply(changes)
    const bus = changes[0].id
    expect(project.track('track-1').output).toBe(bus)
    expect(project.track('track-2').output).toBe(bus)
    expect(project.track('track-3').output).toBeNull()
    expect(project.track(bus).output).toBeNull()
  })

  it('moves a track that was already on another bus', () => {
    const project = build()
    project.apply([{ op: 'setTrack', id: 'track-1', output: 'track-3' }])
    project.apply(describeBus(project, ['track-1', 'track-2']))
    expect(project.track('track-1').output).not.toBe('track-3')
  })

  it('refuses fewer than two distinct tracks and a track that is not there, changing nothing', () => {
    const project = build()
    expect(() => describeBus(project, ['track-1'])).toThrow(/two or more/)
    expect(() => describeBus(project, ['track-1', 'track-1'])).toThrow(/two or more/)
    expect(() => describeBus(project, ['track-1', 'ghost'])).toThrow(/no such track: ghost/)
    expect(project.tracks).toHaveLength(3)
  })

  it('is a bus as far as TrackKind is concerned', async () => {
    const { trackKind } = await import('../../src/model/TrackKind.js')
    const project = build()
    const changes = describeBus(project, ['track-1', 'track-2'])
    project.apply(changes)
    expect(trackKind(project, project.track(changes[0].id), () => undefined)).toBe('bus')
  })
})
