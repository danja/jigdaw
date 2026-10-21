// tests/model/TrackDuplicate.test.js
import { describe, it, expect } from 'vitest'
import { Project } from '../../src/model/Project.js'
import { describeTrackCopy, finishTrackCopy } from '../../src/model/TrackDuplicate.js'

const IRI = 'https://strandz.it/jigdaw/plugins/cascade/'
const src = 'https://example.org/media/a.wav'

function build () {
  const p = new Project()
  p.apply([
    { op: 'addTrack', id: 't', label: 'Keys', channel: { gain: 0.5, pan: -0.25 } },
    { op: 'addTrack', id: 'u', label: 'Other' },
    { op: 'addNode', id: 'a', track: 't', pluginIri: IRI, label: 'Synth', settings: { mix: 0.3 }, state: '{"k":1}' },
    { op: 'addNode', id: 'b', track: 't', pluginIri: IRI, label: 'Verb', bypassed: true },
    { op: 'addNode', id: 'x', track: 'u', pluginIri: IRI },
    { op: 'addConnection', id: 'inner', from: { node: 'a', portIndex: 0 }, to: { node: 'b', portIndex: 0 }, signalKind: 'http://purl.org/stuff/transmissions/Audio' },
    { op: 'addConnection', id: 'across', from: { node: 'b', portIndex: 0 }, to: { node: 'x', portIndex: 0 }, signalKind: 'http://purl.org/stuff/transmissions/Audio' },
    { op: 'setTrack', id: 't', midiInput: 'a', audioInput: 'b' },
    { op: 'addClip', id: 'c', track: 't', kind: 'midi', startBeat: 0, lengthBeats: 4, notes: [{ startBeat: 0, lengthBeats: 1, pitch: 60, velocity: 90 }] },
    { op: 'addClip', id: 'd', track: 'u', kind: 'audio', startBeat: 0, lengthBeats: 4, source: src },
    { op: 'addEnvelope', target: { node: 'a', symbol: 'mix' }, points: [{ atBeat: 0, value: 0.1 }, { atBeat: 4, value: 0.9 }] },
    { op: 'addSend', from: 't', to: 'u', level: 0.4 },
    { op: 'addTrack', id: 'v' },
    { op: 'addSend', from: 'v', to: 't', level: 0.2 }
  ])
  return p
}

describe('describeTrackCopy', () => {
  it('names the new track after the old, keeps its channel strip, and lists each plugin with its settings, state and bypass', () => {
    const plan = describeTrackCopy(build(), 't')
    expect(plan.track).toEqual({ op: 'addTrack', id: 'track-1', label: 'Keys copy', channel: expect.objectContaining({ gain: 0.5, pan: -0.25 }) })
    expect(plan.nodes.map(n => [n.from, n.label, n.settings, n.state, n.bypassed])).toEqual([
      ['a', 'Synth', { mix: 0.3 }, '{"k":1}', false],
      ['b', 'Verb', {}, null, true]
    ])
  })

  it('says which connections it will not copy, because they leave the track', () => {
    expect(describeTrackCopy(build(), 't').skipped).toEqual(['connection across joins this track to another, and is not copied'])
  })

  it('refuses a track that is not there', () => {
    expect(() => describeTrackCopy(build(), 'nope')).toThrow(/no such track: nope/)
  })

  it('copies a track with nothing on it', () => {
    const plan = describeTrackCopy(build(), 'u')
    expect(plan.nodes.map(n => n.from)).toEqual(['x'])
    const p = new Project()
    p.apply([{ op: 'addTrack', id: 'e' }])
    expect(describeTrackCopy(p, 'e').nodes).toEqual([])
  })
})

describe('finishTrackCopy', () => {
  const ids = new Map([['a', 'a2'], ['b', 'b2']])

  it('is applied by the project once the copied nodes exist, and gives the copy the same inputs, wiring, automation, clips and sends', () => {
    const p = build()
    const plan = describeTrackCopy(p, 't')
    p.apply([plan.track, { op: 'addNode', id: 'a2', track: 'track-1', pluginIri: IRI }, { op: 'addNode', id: 'b2', track: 'track-1', pluginIri: IRI }])
    p.apply(finishTrackCopy(p, 't', 'track-1', ids))
    const copy = p.track('track-1')
    expect([copy.midiInput, copy.audioInput]).toEqual(['a2', 'b2'])
    const wired = p.connections.filter(c => c.from.node === 'a2')
    expect(wired.map(c => c.to.node)).toEqual(['b2'])
    expect(p.connections.filter(c => c.from.node === 'b2' || c.to.node === 'b2').map(c => c.id)).toHaveLength(1)
    expect(p.envelopes.filter(e => e.target.node === 'a2')).toHaveLength(1)
    expect(p.clips.filter(c => c.track === 'track-1').map(c => [c.kind, c.notes.length])).toEqual([['midi', 1]])
    expect(p.sends.filter(s => s.from === 'track-1').map(s => [s.to, s.level])).toEqual([['u', 0.4]])
    expect(p.sends.filter(s => s.to === 'track-1')).toEqual([])
  })

  it('leaves out whatever names a node that did not load, rather than failing a second time', () => {
    const p = build()
    const changes = finishTrackCopy(p, 't', 'track-1', new Map([['a', 'a2']]))
    expect(changes.some(c => c.op === 'addConnection')).toBe(false)
    expect(changes.find(c => c.op === 'setTrack')).toMatchObject({ midiInput: 'a2', audioInput: null })
  })

  it('leaves the copies of the original untouched: clips and notes are copied, not shared', () => {
    const p = build()
    const [clip] = finishTrackCopy(p, 't', 'track-1', ids).filter(c => c.op === 'addClip')
    clip.notes[0].pitch = 99
    expect(p.clip('c').notes[0].pitch).toBe(60)
  })
})
