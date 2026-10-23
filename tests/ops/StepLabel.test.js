// tests/ops/StepLabel.test.js
import { describe, it, expect } from 'vitest'
import { stepLabel } from '../../src/ops/StepLabel.js'

describe('stepLabel', () => {
  it('names a single change in words', () => {
    expect(stepLabel([{ op: 'addTrack' }])).toBe('Add a track')
    expect(stepLabel([{ op: 'setClipNotes', id: 'c', notes: [] }])).toBe('Edit notes')
    expect(stepLabel([{ op: 'setClipControllers', id: 'c', controllers: [] }])).toBe('Edit controller events')
  })

  it('gives one label for the same op repeated, since it is the same kind of edit', () => {
    expect(stepLabel([{ op: 'setTrackChannel' }, { op: 'setTrackChannel' }, { op: 'setTrackChannel' }])).toBe('Change level, pan, mute or solo')
  })

  it('names the first of several kinds of change, and counts the others', () => {
    expect(stepLabel([{ op: 'addTrack' }, { op: 'addNode' }])).toBe('Add a track and 1 other change')
    expect(stepLabel([{ op: 'addTrack' }, { op: 'addNode' }, { op: 'addConnection' }])).toBe('Add a track and 2 other changes')
  })

  it('says an op it does not know in its own words, so a new op has a label at once', () => {
    expect(stepLabel([{ op: 'setSomethingNew' }])).toBe('Set something new')
  })

  it('falls back to a plain word for nothing', () => {
    expect(stepLabel([])).toBe('Edit')
    expect(stepLabel(undefined)).toBe('Edit')
  })
})
