// tests/ui/SendsModel.test.js
import { describe, it, expect, beforeEach } from 'vitest'
import { Project } from '../../src/model/Project.js'
import { wouldLoop, sendTargets, outputTargets, describeRouting } from '../../src/ui/SendsModel.js'

let project
const label = id => id.toUpperCase()
beforeEach(() => {
  project = new Project()
  project.apply(['a', 'b', 'c', 'd'].map(id => ({ op: 'addTrack', id })))
})

describe('wouldLoop', () => {
  it('is true for a track to itself, and for a route back along sends and outputs', () => {
    project.apply([{ op: 'addSend', from: 'a', to: 'b' }, { op: 'setTrack', id: 'b', output: 'c' }])
    expect(wouldLoop(project, 'a', 'a')).toBe(true)
    expect(wouldLoop(project, 'c', 'a')).toBe(true)
    expect(wouldLoop(project, 'a', 'c')).toBe(false)
    expect(wouldLoop(project, 'd', 'a')).toBe(false)
  })
})

describe('what a track may be routed to', () => {
  it('offers every other track that would not close a loop, in the arrangement order, without repeating a send', () => {
    project.apply([{ op: 'addSend', from: 'a', to: 'b' }])
    project.moveTrack('d', -3)
    expect(sendTargets(project, 'a').map(t => t.id)).toEqual(['d', 'c'])
    expect(sendTargets(project, 'b').map(t => t.id)).toEqual(['d', 'c'])
    expect(outputTargets(project, 'b').map(t => t.id)).toEqual(['d', 'c'])
  })

  it('does not offer what the model would refuse', () => {
    project.apply([{ op: 'addSend', from: 'a', to: 'b' }, { op: 'addSend', from: 'b', to: 'c' }])
    for (const target of sendTargets(project, 'c')) {
      expect(() => project.apply([{ op: 'addSend', from: 'c', to: target.id }])).not.toThrow()
      project.apply([{ op: 'removeSend', id: project.sends.at(-1).id }])
    }
    expect(sendTargets(project, 'c').map(t => t.id)).toEqual(['d'])
    expect(() => project.apply([{ op: 'addSend', from: 'c', to: 'a' }])).toThrow()
  })
})

describe('describeRouting', () => {
  it('says nothing for a plain track', () => {
    expect(describeRouting(project, 'a', label)).toBeNull()
  })

  it('says the output, the sends with their tap, and what feeds it', () => {
    project.apply([{ op: 'addSend', from: 'a', to: 'b', tap: 'pre' }, { op: 'setTrack', id: 'c', output: 'b' }, { op: 'setTrack', id: 'a', output: 'd' }])
    expect(describeRouting(project, 'a', label)).toBe('Output to D. Sends to B (pre).')
    expect(describeRouting(project, 'b', label)).toBe('Receives from C, A.')
    expect(describeRouting(project, 'c', label)).toBe('Output to B.')
  })
})
