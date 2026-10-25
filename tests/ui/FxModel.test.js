// tests/ui/FxModel.test.js
//
// What a channel's FX list knows about each plugin comes from the chain strip's own description, so the two cannot disagree.
import { describe, it, expect, beforeEach } from 'vitest'
import { Project } from '../../src/model/Project.js'
import { fxPluginsOf } from '../../src/ui/FxModel.js'

const IRI = 'https://example.org/p/'
const AUDIO = 'http://purl.org/stuff/transmissions/Audio'
const MIDI = 'http://purl.org/stuff/transmissions/Midi'
const profiles = {
  synth: { audioInputs: 0, audioOutputs: 1, accepts: [MIDI], produces: [], ports: [] },
  eq: { audioInputs: 1, audioOutputs: 1, accepts: [], produces: [], ports: [] },
  verb: { audioInputs: 1, audioOutputs: 1, accepts: [], produces: [], ports: [] },
  comp: { audioInputs: 1, audioOutputs: 1, accepts: [], produces: [], ports: [] }
}
let project
let deps
beforeEach(() => {
  project = new Project()
  const link = (id, from, to) => ({ op: 'addConnection', id, from: { node: from, portIndex: 0 }, to: { node: to, portIndex: 0 }, signalKind: AUDIO })
  project.apply([
    { op: 'addTrack', id: 't1', label: 'Lead' },
    ...['synth', 'eq', 'verb', 'comp'].map(id => ({ op: 'addNode', id, pluginIri: IRI, label: id.toUpperCase(), track: 't1' })),
    link('c1', 'synth', 'eq'), link('c2', 'eq', 'verb'), link('c3', 'verb', 'comp')
  ])
  deps = { profileOf: id => profiles[id], labelOf: id => project.node(id).label, failedOf: () => null, trackLabelOf: id => id }
})

describe('the plugins of a channel', () => {
  it('are in signal order, and each can move only where its neighbour that way passes audio too', () => {
    const list = fxPluginsOf(project, 't1', deps)
    expect(list.map(p => p.id)).toEqual(['synth', 'eq', 'verb', 'comp'])
    // The synth takes no audio, so it is not swapped with, and nothing can go before it or after the last.
    expect(list.map(p => [p.id, p.canEarlier, p.canLater])).toEqual([
      ['synth', false, false],
      ['eq', false, true],
      ['verb', true, true],
      ['comp', true, false]
    ])
  })

  it('say whether each has loaded, failed or is bypassed', () => {
    project.apply([{ op: 'setNode', id: 'verb', bypassed: true }])
    const list = fxPluginsOf(project, 't1', { ...deps, profileOf: id => (id === 'comp' ? undefined : profiles[id]), failedOf: id => (id === 'eq' ? 'no wasm' : null) })
    const by = id => list.find(p => p.id === id)
    expect([by('verb').bypassed, by('verb').loaded, by('verb').failed]).toEqual([true, true, null])
    expect([by('comp').loaded, by('comp').canEarlier]).toEqual([false, false])
    expect(by('eq').failed).toBe('no wasm')
  })

  it('is empty for a track with no plugins', () => {
    project.apply([{ op: 'addTrack', id: 'empty' }])
    expect(fxPluginsOf(project, 'empty', deps)).toEqual([])
  })
})
