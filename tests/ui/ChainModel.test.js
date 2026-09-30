// tests/ui/ChainModel.test.js
import { describe, it, expect, beforeEach } from 'vitest'
import { Project } from '../../src/model/Project.js'
import { describeChain, say, kindOf } from '../../src/ui/ChainModel.js'

const IRI = 'https://example.org/p/'
const AUDIO = 'http://purl.org/stuff/transmissions/Audio'
const MIDI = 'http://purl.org/stuff/transmissions/Midi'

const profiles = {
  gen: { audioInputs: 0, audioOutputs: 0, accepts: [], produces: [MIDI], ports: [] },
  synth: { audioInputs: 0, audioOutputs: 1, accepts: [MIDI], produces: [], ports: [{ symbol: 'cutoff' }] },
  fx: { audioInputs: 1, audioOutputs: 1, accepts: [], produces: [], ports: [] }
}
let project
let helpers
beforeEach(() => {
  project = new Project()
  project.apply([
    { op: 'addTrack', id: 't1', label: 'Lead' }, { op: 'addTrack', id: 't2', label: 'Drums' },
    { op: 'addNode', id: 'fx', pluginIri: IRI, label: 'Reverb', track: 't1' },
    { op: 'addNode', id: 'synth', pluginIri: IRI, label: 'Synth', track: 't1' },
    { op: 'addNode', id: 'gen', pluginIri: IRI, label: 'Gen', track: 't2' },
    { op: 'addConnection', id: 'c1', from: { node: 'synth', portIndex: 0 }, to: { node: 'fx', portIndex: 0 }, signalKind: AUDIO },
    { op: 'addConnection', id: 'c2', from: { node: 'gen', portIndex: 0 }, to: { node: 'synth', portIndex: 0 }, signalKind: MIDI },
    { op: 'setTrack', id: 't1', midiInput: 'synth' }
  ])
  helpers = {
    profileOf: id => profiles[id],
    labelOf: id => project.node(id)?.label ?? id,
    failedOf: () => null,
    trackLabelOf: id => project.track(id)?.label ?? id
  }
})

describe('describeChain', () => {
  it('orders the plugins as the signal flows, whatever order they were added in', () => {
    const chain = describeChain(project, 't1', helpers)
    expect(chain.nodes.map(n => n.id)).toEqual(['synth', 'fx'])
  })

  it('says what each takes and gives, from its profile', () => {
    const [synth, fx] = describeChain(project, 't1', helpers).nodes
    expect([synth.takes, synth.gives]).toEqual([['MIDI'], ['audio']])
    expect([fx.takes, fx.gives]).toEqual([['audio'], ['audio']])
  })

  it('lists where each sends, and marks a send that reaches another track', () => {
    const drums = describeChain(project, 't2', helpers).nodes[0]
    expect(drums.sends).toEqual([expect.objectContaining({ kind: 'MIDI', toLabel: 'Synth', toTrackLabel: 'Lead', other: true })])
    const [synth] = describeChain(project, 't1', helpers).nodes
    expect(synth.sends).toEqual([expect.objectContaining({ kind: 'audio', toLabel: 'Reverb', other: false })])
  })

  it('lists what a plugin receives from another track, and not from its own', () => {
    const [synth, fx] = describeChain(project, 't1', helpers).nodes
    expect(synth.receives).toEqual([expect.objectContaining({ kind: 'MIDI', fromLabel: 'Gen', fromTrackLabel: 'Drums' })])
    expect(fx.receives).toEqual([])
  })

  it('says which plugin the track feeds its clips into', () => {
    const [synth, fx] = describeChain(project, 't1', helpers).nodes
    expect(synth.takesMidiFromTrack).toBe(true)
    expect(fx.takesMidiFromTrack).toBe(false)
  })

  it('carries a failure, and a plugin that has not loaded, without guessing at its ports', () => {
    const chain = describeChain(project, 't1', { ...helpers, profileOf: id => (id === 'fx' ? undefined : profiles[id]), failedOf: id => (id === 'synth' ? 'the processor threw' : null) })
    const [synth, fx] = chain.nodes
    expect(synth.failed).toBe('the processor threw')
    expect(fx.loaded).toBe(false)
    expect([fx.takes, fx.gives]).toEqual([[], []])
  })

  it('a track with nothing on it has an empty chain', () => {
    project.apply([{ op: 'addTrack', id: 't3' }])
    expect(describeChain(project, 't3', helpers).nodes).toEqual([])
  })
})

describe('kindOf', () => {
  it('names a parameter connection modulation, and an audio one audio', () => {
    expect(kindOf({ signalKind: AUDIO, to: { portSymbol: 'cutoff' } })).toBe('modulation')
    expect(kindOf({ signalKind: AUDIO, to: { portIndex: 0 } })).toBe('audio')
    expect(kindOf({ signalKind: MIDI, to: { portIndex: 0 } })).toBe('MIDI')
  })
})

describe('say', () => {
  it('speaks a plugin with its ports, its sends and what reaches it from another track', () => {
    const [synth] = describeChain(project, 't1', helpers).nodes
    expect(say(synth)).toBe(
      "Synth; takes MIDI; gives audio; the track's MIDI clips play into it; sends audio to Reverb; receives MIDI from Gen on Drums")
  })

  it('names the track a send reaches, and says a failure and a plugin not yet loaded plainly', () => {
    const [gen] = describeChain(project, 't2', helpers).nodes
    expect(say(gen)).toContain('sends MIDI to Synth on Lead')
    expect(say({ label: 'X', failed: 'boom', loaded: false, takes: [], gives: [], sends: [], receives: [] })).toBe('X; failed to load: boom')
    expect(say({ label: 'Y', failed: null, loaded: false, takes: [], gives: [], sends: [], receives: [] })).toBe('Y; not loaded yet')
  })
})
