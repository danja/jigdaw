// tests/model/TrackBus.test.js
import { describe, it, expect } from 'vitest'
import { Project } from '../../src/model/Project.js'
import { describeBus, placeBus } from '../../src/model/TrackBus.js'

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

describe('placeBus', () => {
  const made = (count, members, layout = {}) => {
    const project = new Project()
    project.apply(Array.from({ length: count }, () => ({ op: 'addTrack' })))
    for (const [id, patch] of Object.entries(layout)) project.setTrackLayout(id, patch)
    const changes = describeBus(project, members)
    project.apply(changes)
    return { project, bus: changes[0].id }
  }
  const order = project => project.orderedTracks.map(t => t.id)

  it('puts a bus straight after the last track that feeds it, not at the end of everything', () => {
    const { project, bus } = made(5, ['track-1', 'track-3'])
    expect(order(project)).toEqual(['track-1', 'track-2', 'track-3', 'track-4', 'track-5', bus])
    expect(placeBus(project, bus, ['track-1', 'track-3'])).toBe(true)
    expect(order(project)).toEqual(['track-1', 'track-2', 'track-3', bus, 'track-4', 'track-5'])
  })

  it('goes by the order on screen, which the members need not be listed in', () => {
    const { project, bus } = made(4, ['track-4', 'track-2'])
    project.moveTrack('track-4', -3)
    placeBus(project, bus, ['track-4', 'track-2'])
    expect(order(project)).toEqual(['track-4', 'track-1', 'track-2', bus, 'track-3'])
  })

  it('does nothing when the bus is already there', () => {
    const { project, bus } = made(3, ['track-2', 'track-3'])
    expect(placeBus(project, bus, ['track-2', 'track-3'])).toBe(false)
    expect(order(project)).toEqual(['track-1', 'track-2', 'track-3', bus])
  })

  it('goes after a folder, not between two of its tracks, so the folder keeps one bar', () => {
    const layout = { 'track-2': { folder: 'F' }, 'track-3': { folder: 'F' }, 'track-4': { folder: 'F' } }
    const { project, bus } = made(5, ['track-1', 'track-2'], layout)
    placeBus(project, bus, ['track-1', 'track-2'])
    expect(order(project)).toEqual(['track-1', 'track-2', 'track-3', 'track-4', bus, 'track-5'])
  })

  it('changes only the order: no revision, so there is nothing more to undo', () => {
    const { project, bus } = made(4, ['track-1', 'track-2'])
    const revision = project.revision
    placeBus(project, bus, ['track-1', 'track-2'])
    expect(project.revision).toBe(revision)
  })
})
