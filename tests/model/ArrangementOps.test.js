// tests/model/ArrangementOps.test.js
import { describe, it, expect, beforeEach } from 'vitest'
import { Project, changesFor } from '../../src/model/Project.js'

const IRI = 'https://example.org/plugins/cascade/'
let project
beforeEach(() => {
  project = new Project()
  project.apply([
    { op: 'addTrack', id: 'a' }, { op: 'addTrack', id: 'b' }, { op: 'addTrack', id: 'c' },
    { op: 'addNode', id: 'n', track: 'a', pluginIri: IRI }
  ])
})
const refused = (changes, pattern) => expect(() => project.apply(changes)).toThrow(pattern)

describe('the master', () => {
  it('starts at unity and takes gain, pan and mute', () => {
    expect(project.master).toEqual({ gain: 1, pan: 0, muted: false, audioInput: null })
    project.apply([{ op: 'setMaster', gain: 0.5, muted: true }])
    expect(project.master).toEqual({ gain: 0.5, pan: 0, muted: true, audioInput: null })
  })
  it('refuses a negative gain and a pan off the edge', () => {
    refused([{ op: 'setMaster', gain: -1 }], /gain/)
    refused([{ op: 'setMaster', pan: 1.5 }], /pan/)
    expect(project.master.gain).toBe(1)
  })
})

describe('a chain on the master', () => {
  beforeEach(() => {
    project.apply([{ op: 'addNode', id: 'verb', track: 'master', pluginIri: IRI }])
  })

  it('takes a node, which is on the master and on no track', () => {
    expect(project.node('verb').track).toBe('master')
    expect(project.tracks.map(t => t.id)).toEqual(['a', 'b', 'c'])
  })

  it('reserves the master\'s id, so a node\'s track names a track or the master and never both', () => {
    refused([{ op: 'addTrack', id: 'master' }], /master/)
    refused([{ op: 'addNode', id: 'x', track: 'nowhere', pluginIri: IRI }], /no such track/)
  })

  it('moves a node onto the master and off it again', () => {
    project.apply([{ op: 'moveNodeToTrack', id: 'n', track: 'master' }])
    expect(project.node('n').track).toBe('master')
    project.apply([{ op: 'moveNodeToTrack', id: 'n', track: 'b' }])
    expect(project.node('n').track).toBe('b')
    refused([{ op: 'moveNodeToTrack', id: 'n', track: 'ghost' }], /no such track/)
  })

  it('names the node the mix arrives at, and only a node on the master', () => {
    project.apply([{ op: 'setMaster', audioInput: 'verb' }])
    expect(project.master.audioInput).toBe('verb')
    refused([{ op: 'setMaster', audioInput: 'n' }], /not on the master/)
    refused([{ op: 'setMaster', audioInput: 'ghost' }], /no such node/)
    expect(project.master.audioInput).toBe('verb')
    project.apply([{ op: 'setMaster', audioInput: null }])
    expect(project.master.audioInput).toBeNull()
  })

  it('forgets the input when its node is removed or moved away, as a track does', () => {
    project.apply([{ op: 'setMaster', audioInput: 'verb' }, { op: 'removeNode', id: 'verb' }])
    expect(project.master.audioInput).toBeNull()
    project.apply([{ op: 'addNode', id: 'verb', track: 'master', pluginIri: IRI }, { op: 'setMaster', audioInput: 'verb' }])
    project.apply([{ op: 'moveNodeToTrack', id: 'verb', track: 'a' }])
    expect(project.master.audioInput).toBeNull()
  })

  it('survives being copied through a snapshot, which is how the dispatcher tries a changeset', () => {
    project.apply([{ op: 'setMaster', audioInput: 'verb', gain: 0.8 }])
    const copy = new Project()
    copy.apply(changesFor(project.snapshot()))
    expect(copy.master).toEqual(project.master)
    expect(copy.node('verb').track).toBe('master')
  })
})

describe('sends and bus outputs', () => {
  it('adds a send with defaults: level 1, post-fader', () => {
    project.apply([{ op: 'addSend', from: 'a', to: 'b' }])
    expect(project.sends).toEqual([{ id: 'send-1', from: 'a', to: 'b', level: 1, tap: 'post' }])
  })
  it('refuses a send to itself, to nothing, a duplicate, and a bad tap or level', () => {
    refused([{ op: 'addSend', from: 'a', to: 'a' }], /feed itself/)
    refused([{ op: 'addSend', from: 'a', to: 'ghost' }], /no such track/)
    refused([{ op: 'addSend', from: 'a', to: 'b', tap: 'mid' }], /tap/)
    refused([{ op: 'addSend', from: 'a', to: 'b', level: -1 }], /level/)
    project.apply([{ op: 'addSend', from: 'a', to: 'b' }])
    refused([{ op: 'addSend', from: 'a', to: 'b' }], /already sends/)
  })
  it('refuses a loop of sends and outputs, however long', () => {
    project.apply([{ op: 'addSend', from: 'a', to: 'b' }, { op: 'setTrack', id: 'b', output: 'c' }])
    refused([{ op: 'addSend', from: 'c', to: 'a' }], /feed itself/)
    refused([{ op: 'setTrack', id: 'c', output: 'a' }], /feed itself/)
    project.apply([{ op: 'setTrack', id: 'c', output: null }])
  })
  it('drops what touches a track when it is removed', () => {
    project.apply([{ op: 'addSend', from: 'a', to: 'b' }, { op: 'setTrack', id: 'c', output: 'b' }])
    project.apply([{ op: 'removeTrack', id: 'b' }])
    expect(project.sends).toEqual([])
    expect(project.track('c').output).toBeNull()
  })
  it('changes a send in place, and removes it', () => {
    project.apply([{ op: 'addSend', id: 's', from: 'a', to: 'b' }, { op: 'setSend', id: 's', level: 0.3, tap: 'pre' }])
    expect(project.sends[0]).toMatchObject({ level: 0.3, tap: 'pre' })
    project.apply([{ op: 'removeSend', id: 's' }])
    expect(project.sends).toEqual([])
    refused([{ op: 'removeSend', id: 's' }], /no such send/)
  })
})

describe('markers and regions', () => {
  it('adds, moves and removes a marker; refuses one before the start', () => {
    project.apply([{ op: 'addMarker', atBeat: 8, label: 'Drop' }, { op: 'setMarker', id: 'marker-1', atBeat: 16 }])
    expect(project.markers).toEqual([{ id: 'marker-1', atBeat: 16, label: 'Drop' }])
    refused([{ op: 'addMarker', atBeat: -1 }], /atBeat/)
    project.apply([{ op: 'removeMarker', id: 'marker-1' }])
    expect(project.markers).toEqual([])
  })
  it('refuses a region that lasts no time or starts before zero', () => {
    refused([{ op: 'addRegion', startBeat: 0, lengthBeats: 0 }], /lengthBeats/)
    refused([{ op: 'addRegion', startBeat: -1, lengthBeats: 4 }], /startBeat/)
    project.apply([{ op: 'addRegion', startBeat: 4, lengthBeats: 8 }, { op: 'setRegion', id: 'region-1', lengthBeats: 4 }])
    expect(project.regions[0]).toMatchObject({ startBeat: 4, lengthBeats: 4 })
    refused([{ op: 'setRegion', id: 'region-1', lengthBeats: 0 }], /lengthBeats/)
  })
})

describe('envelopes', () => {
  it('holds points in beat order, and replaces them whole', () => {
    project.apply([{ op: 'addEnvelope', target: { node: 'n', symbol: 'mix' }, points: [{ atBeat: 4, value: 1 }, { atBeat: 0, value: 0 }] }])
    expect(project.envelopes[0].points).toEqual([{ atBeat: 0, value: 0, curve: 'linear' }, { atBeat: 4, value: 1, curve: 'linear' }])
    project.apply([{ op: 'setEnvelope', id: 'envelope-1', points: [{ atBeat: 2, value: 0.5, curve: 'step' }] }])
    expect(project.envelopes[0].points).toEqual([{ atBeat: 2, value: 0.5, curve: 'step' }])
  })
  it('refuses two points on one beat, an unknown curve, and a second envelope on one target', () => {
    refused([{ op: 'addEnvelope', target: { kind: 'tempo' }, points: [{ atBeat: 1, value: 100 }, { atBeat: 1, value: 110 }] }], /two envelope points/)
    refused([{ op: 'addEnvelope', target: { kind: 'tempo' }, points: [{ atBeat: 1, value: 100, curve: 'wobbly' }] }], /curve/)
    project.apply([{ op: 'addEnvelope', target: { kind: 'tempo' } }])
    refused([{ op: 'addEnvelope', target: { kind: 'tempo' } }], /already automates/)
  })
  it('refuses a value the project itself can judge out of range', () => {
    refused([{ op: 'addEnvelope', target: { kind: 'masterGain' }, points: [{ atBeat: 0, value: -1 }] }], /master gain/)
    refused([{ op: 'addEnvelope', target: { kind: 'masterPan' }, points: [{ atBeat: 0, value: 2 }] }], /master pan/)
    refused([{ op: 'addEnvelope', target: { kind: 'tempo' }, points: [{ atBeat: 0, value: 0 }] }], /tempo/)
  })
  it('refuses a target that names no node, no symbol or an unknown kind', () => {
    refused([{ op: 'addEnvelope', target: { node: 'ghost', symbol: 'x' } }], /no such node/)
    refused([{ op: 'addEnvelope', target: { node: 'n' } }], /symbol/)
    refused([{ op: 'addEnvelope', target: { kind: 'reverb' } }], /kind/)
  })
  it('goes when its node does', () => {
    project.apply([{ op: 'addEnvelope', target: { node: 'n', symbol: 'mix' } }, { op: 'addEnvelope', target: { kind: 'tempo' } }])
    project.apply([{ op: 'removeNode', id: 'n' }])
    expect(project.envelopes.map(e => e.id)).toEqual(['envelope-2'])
  })
})

describe('signature points', () => {
  it('accepts a change on a bar line and orders the points', () => {
    project.apply([{ op: 'setTransport', signaturePoints: [{ atBeat: 12, beatsPerBar: 3, beatUnit: 4 }, { atBeat: 8, beatsPerBar: 4, beatUnit: 4 }] }])
    expect(project.transport.signaturePoints.map(p => p.atBeat)).toEqual([8, 12])
  })
  it('refuses a change that is not on a bar line of the signature before it', () => {
    refused([{ op: 'setTransport', signaturePoints: [{ atBeat: 6, beatsPerBar: 3, beatUnit: 4 }] }], /bar line/)
    refused([{ op: 'setTransport', signaturePoints: [{ atBeat: 4, beatsPerBar: 3, beatUnit: 4 }, { atBeat: 6, beatsPerBar: 4, beatUnit: 4 }] }], /bar line/)
  })
  it('refuses a point at beat zero, a bar of no beats, and a beat unit that is not a note value', () => {
    refused([{ op: 'setTransport', signaturePoints: [{ atBeat: 0, beatsPerBar: 3, beatUnit: 4 }] }], /after beat zero/)
    refused([{ op: 'setTransport', signaturePoints: [{ atBeat: 4, beatsPerBar: 0, beatUnit: 4 }] }], /at least one beat/)
    refused([{ op: 'setTransport', signaturePoints: [{ atBeat: 4, beatsPerBar: 4, beatUnit: 0 }] }], /beat unit/)
  })
  it('refuses a new beatsPerBar that moves a bar line from under an existing point', () => {
    project.apply([{ op: 'setTransport', signaturePoints: [{ atBeat: 8, beatsPerBar: 3, beatUnit: 4 }] }])
    refused([{ op: 'setTransport', beatsPerBar: 3 }], /bar line/)
    expect(project.transport.beatsPerBar).toBe(4)
  })
})

describe('the dispatcher path', () => {
  it('is atomic: a bad change in a changeset leaves the earlier ones unapplied', () => {
    refused([{ op: 'addMarker', atBeat: 1 }, { op: 'addSend', from: 'a', to: 'a' }], /feed itself/)
    expect(project.markers).toEqual([])
  })
})
