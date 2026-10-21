// tests/model/TrackKind.test.js
import { describe, it, expect } from 'vitest'
import { trackKind } from '../../src/model/TrackKind.js'

const MIDI = 'http://purl.org/stuff/transmissions/Midi'
const profiles = {
  synth: { accepts: [MIDI], audioOutputs: 1 },
  arp: { accepts: [MIDI], produces: [MIDI], audioOutputs: 0 },
  reverb: { audioInputs: 1, audioOutputs: 1 },
  meter: { audioInputs: 1, audioOutputs: 0 }
}
const make = (nodes, tracks = [{ id: 't', output: null }]) => ({
  tracks,
  nodes: nodes.map((p, i) => ({ id: `n${i}`, track: 't', p }))
})
const kind = (nodes, tracks) => {
  const project = make(nodes, tracks)
  const byId = new Map(project.nodes.map(n => [n.id, profiles[n.p]]))
  return trackKind(project, project.tracks[0], id => byId.get(id))
}

describe('trackKind', () => {
  it('calls a track with a synth an instrument', () => expect(kind(['synth'])).toBe('instrument'))
  it('calls a track whose only MIDI plugin makes no sound MIDI', () => expect(kind(['arp'])).toBe('midi'))
  it('keeps a MIDI plugin ahead of an effect on the same track', () => expect(kind(['arp', 'synth', 'reverb'])).toBe('instrument'))
  it('calls a track of effects audio', () => expect(kind(['reverb'])).toBe('audio'))
  it('says nothing for an empty track or an unloaded plugin', () => {
    expect(kind([])).toBeNull()
    expect(trackKind(make(['synth']), { id: 't' }, () => undefined)).toBeNull()
  })
  it('calls an audio input with no output audio', () => expect(kind(['meter'])).toBe('audio'))
  it('calls a track other tracks send to a bus, ahead of its plugins', () => {
    expect(kind(['reverb'], [{ id: 't', output: null }, { id: 'u', output: 't' }])).toBe('bus')
  })
  it('does not call a track a bus because of its own output', () => {
    expect(kind(['reverb'], [{ id: 't', output: 't' }])).toBe('audio')
  })
})
