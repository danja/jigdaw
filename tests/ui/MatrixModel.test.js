// tests/ui/MatrixModel.test.js
import { describe, it, expect, beforeEach } from 'vitest'
import { Project } from '../../src/model/Project.js'
import { buildMatrix } from '../../src/ui/MatrixModel.js'

const IRI = 'https://example.org/p/'
const AUDIO = 'http://purl.org/stuff/transmissions/Audio'
const MIDI = 'http://purl.org/stuff/transmissions/Midi'
const profiles = {
  gen: { audioInputs: 0, audioOutputs: 0, accepts: [], produces: [MIDI], ports: [] },
  synth: { audioInputs: 0, audioOutputs: 1, accepts: [MIDI], produces: [], ports: [{ symbol: 'cutoff', name: 'Cutoff' }] },
  fx: { audioInputs: 1, audioOutputs: 1, accepts: [], produces: [], ports: [] }
}
let project
const helpers = () => ({
  profileOf: id => profiles[id],
  labelOf: id => project.node(id).label,
  trackLabelOf: id => project.track(id).label
})

beforeEach(() => {
  project = new Project()
  project.apply([
    { op: 'addTrack', id: 't1', label: 'Lead' }, { op: 'addTrack', id: 't2', label: 'Drums' },
    { op: 'addNode', id: 'gen', pluginIri: IRI, label: 'Gen', track: 't2' },
    { op: 'addNode', id: 'synth', pluginIri: IRI, label: 'Synth', track: 't1' },
    { op: 'addNode', id: 'fx', pluginIri: IRI, label: 'Reverb', track: 't1' },
    { op: 'addConnection', id: 'c1', from: { node: 'synth', portIndex: 0 }, to: { node: 'fx', portIndex: 0 }, signalKind: AUDIO }
  ])
})

describe('buildMatrix', () => {
  it('lists outputs as rows and inputs as columns, in the order the tracks are shown, without parameters', () => {
    const m = buildMatrix(project, helpers())
    expect(m.rows.map(r => r.text)).toEqual(['Synth Audio out 1', 'Gen MIDI out'])
    expect(m.cols.map(c => c.text)).toEqual(['Synth MIDI in', 'Reverb Audio in 1'])
  })

  it('leaves out an output nothing can take and an input nothing can feed', () => {
    const m = buildMatrix(project, helpers())
    // Reverb's audio out has no other audio input to go to.
    expect(m.rows.map(r => r.text)).not.toContain('Reverb Audio out 1')
    // With only a MIDI generator and an audio effect and no synth, no MIDI input remains.
    project.apply([{ op: 'removeNode', id: 'synth' }])
    const alone = buildMatrix(project, helpers())
    expect(alone.cols.map(c => c.text)).toEqual([])
    expect(alone.rows).toEqual([])
  })

  it('follows a moved track', () => {
    project.moveTrack('t2', -1)
    expect(buildMatrix(project, helpers()).rows[0].text).toBe('Gen MIDI out')
  })

  it('offers a cell only where the pair can be joined: same kind, and not a plugin to itself', () => {
    const m = buildMatrix(project, helpers())
    const row = text => m.rows.find(r => r.text === text)
    const col = text => m.cols.find(c => c.text === text)
    expect(m.possible(row('Gen MIDI out'), col('Synth MIDI in'))).toBe(true)
    expect(m.possible(row('Gen MIDI out'), col('Reverb Audio in 1'))).toBe(false)
    expect(m.possible(row('Synth Audio out 1'), col('Reverb Audio in 1'))).toBe(true)
    expect(m.possible(row('Synth Audio out 1'), col('Synth MIDI in'))).toBe(false)
  })

  it('says which pairs are joined, and finds the connection to remove', () => {
    const m = buildMatrix(project, helpers())
    const row = m.rows.find(r => r.text === 'Synth Audio out 1')
    expect(m.connectionAt(row, m.cols.find(c => c.text === 'Reverb Audio in 1')).id).toBe('c1')
    expect(m.connectionAt(m.rows.find(r => r.text === 'Gen MIDI out'), m.cols.find(c => c.text === 'Synth MIDI in'))).toBeNull()
  })

  it('does not mistake a MIDI connection for an audio one between the same ports', () => {
    project.apply([{ op: 'addConnection', id: 'c2', from: { node: 'gen', portIndex: 0 }, to: { node: 'synth', portIndex: 0 }, signalKind: MIDI }])
    const m = buildMatrix(project, helpers())
    expect(m.connectionAt(m.rows.find(r => r.text === 'Gen MIDI out'), m.cols.find(c => c.text === 'Synth MIDI in')).id).toBe('c2')
  })

  it('has nothing for a plugin whose profile has not loaded', () => {
    const m = buildMatrix(project, { ...helpers(), profileOf: id => (id === 'fx' ? undefined : profiles[id]) })
    expect(m.rows.map(r => r.node)).not.toContain('fx')
    expect(m.cols.map(c => c.node)).not.toContain('fx')
  })
})
