// tests/ui/Routing.test.js
//
// The rack drew nodes in array order with a wire between every pair, so a
// branch, a parallel path and two unconnected plugins all looked like a chain.
// The model has been an arbitrary directed graph since it was written; only the
// interface insisted otherwise.
//
// These check the two things that make the interface honest: that the ports
// offered come from the profile rather than from an assumption, and that what
// cannot be connected says so rather than failing when tried.
import { describe, it, expect, beforeEach } from 'vitest'
import { parseHTML } from 'linkedom'
import {
  outputsOf, inputsOf, compatible, createPortBar, createConnectionList
} from '../../src/ui/Routing.js'

const AUDIO = 'http://purl.org/stuff/transmissions/Audio'
const MIDI = 'http://purl.org/stuff/transmissions/Midi'

let document
beforeEach(() => { document = parseHTML('<!doctype html><html><body></body></html>').document })

const synth = {
  label: 'Pulse',
  audioInputs: 0, audioOutputs: 1,
  accepts: [MIDI], produces: [AUDIO],
  ports: [{ symbol: 'cutoff', name: 'Cutoff' }]
}
const effect = {
  label: 'Cascade',
  audioInputs: 1, audioOutputs: 1,
  accepts: [AUDIO], produces: [AUDIO],
  ports: [{ symbol: 'mix', name: 'Mix' }]
}
const generator = {
  label: 'BassGen',
  audioInputs: 0, audioOutputs: 0,
  accepts: [MIDI], produces: [MIDI, `${MIDI}Bass`],
  ports: []
}

describe('what a plugin offers, read from its profile', () => {
  it('gives an instrument an audio output and no audio input', () => {
    expect(outputsOf(synth).map(p => p.name)).toEqual(['Audio out 1'])
    expect(inputsOf(synth).map(p => p.name)).toEqual(['MIDI in', 'Cutoff (modulate)'])
  })

  it('gives a MIDI generator a MIDI output and no audio at all', () => {
    // It declares jig:audioOutputs 0, and offering it an audio port would offer
    // a connection that throws.
    expect(outputsOf(generator).map(p => p.name)).toEqual(['MIDI out'])
    expect(inputsOf(generator).map(p => p.name)).toEqual(['MIDI in'])
  })

  it('offers every parameter as a modulation target', () => {
    // An endpoint carries a portIndex or a portSymbol, and the symbol form is
    // modulation. It was expressible and undelivered for as long as the format
    // existed, so it is offered now that it works.
    expect(inputsOf(effect).some(p => p.portSymbol === 'mix')).toBe(true)
  })

  it('says nothing about a plugin with no ports rather than inventing some', () => {
    expect(outputsOf({}).length).toBe(0)
    expect(inputsOf({}).length).toBe(0)
  })
})

describe('what may be joined to what', () => {
  it('joins audio to audio and MIDI to MIDI', () => {
    expect(compatible({ kind: AUDIO }, { kind: AUDIO, portIndex: 0 })).toBe(true)
    expect(compatible({ kind: MIDI }, { kind: MIDI, portIndex: 0 })).toBe(true)
  })

  it('refuses MIDI into an audio input, which is different machinery', () => {
    expect(compatible({ kind: MIDI }, { kind: AUDIO, portIndex: 0 })).toBe(false)
    expect(compatible({ kind: AUDIO }, { kind: MIDI, portIndex: 0 })).toBe(false)
  })

  it('refuses MIDI into a parameter, which takes a signal and not a message', () => {
    expect(compatible({ kind: AUDIO }, { portSymbol: 'mix' })).toBe(true)
    expect(compatible({ kind: MIDI }, { portSymbol: 'mix' })).toBe(false)
  })
})

describe('the port bar', () => {
  const bar = (profile, pending = null, handlers = {}) => createPortBar(document, {
    node: { id: 'n1', label: profile.label },
    profile,
    pending,
    onPick: handlers.onPick ?? (() => {}),
    onCancel: handlers.onCancel ?? (() => {})
  })

  it('is a named group, so the buttons are not loose in the slot', () => {
    const element = bar(effect)
    expect(element.getAttribute('role')).toBe('group')
    expect(element.getAttribute('aria-label')).toBe('Cascade connections')
  })

  it('disables every input until an output is chosen, and says why', () => {
    const element = bar(effect)
    const input = element.querySelector('.port-in')
    expect(input.disabled).toBe(true)
    expect(input.getAttribute('aria-label')).toMatch(/Choose an output first/)
  })

  it('enables only the inputs that can take the chosen output', () => {
    // Disabled rather than hidden, so the shape of what is possible does not
    // change under the pointer.
    const element = bar(effect, { node: 'other', kind: MIDI, portIndex: 0 })
    const names = [...element.querySelectorAll('.port-in')]
      .filter(b => !b.disabled).map(b => b.textContent)
    // Cascade takes audio and modulation, neither of which is MIDI.
    expect(names).toEqual([])
  })

  it('will not connect a node to itself', () => {
    const element = bar(effect, { node: 'n1', kind: AUDIO, portIndex: 0 })
    expect([...element.querySelectorAll('.port-in')].every(b => b.disabled)).toBe(true)
  })

  it('shows the chosen output as pressed, and cancels on a second press', () => {
    let cancelled = false
    const element = bar(effect, { node: 'n1', kind: AUDIO, portIndex: 0 },
      { onCancel: () => { cancelled = true } })
    const output = element.querySelector('.port-out')
    expect(output.getAttribute('aria-pressed')).toBe('true')
    output.click()
    expect(cancelled).toBe(true)
  })

  it('reports the output that was chosen', () => {
    const picked = []
    const element = bar(effect, null, { onPick: (from, to) => picked.push({ from, to }) })
    element.querySelector('.port-out').click()
    expect(picked[0].from).toEqual({ node: 'n1', kind: AUDIO, portIndex: 0 })
  })

  it('says so when a plugin has nothing to connect', () => {
    const element = bar({ label: 'Nothing', audioInputs: 0, audioOutputs: 0, accepts: [], produces: [], ports: [] })
    expect(element.querySelector('.port-none')).not.toBeNull()
  })
})

describe('the connection list', () => {
  const labelFor = id => ({ a: 'Pulse', b: 'Cascade' })[id] ?? id
  const list = connections => createConnectionList(document, {
    connections, labelFor, onRemove: () => {}
  })

  it('says nothing is connected rather than showing an empty box', () => {
    expect(list([]).querySelector('.empty').textContent).toMatch(/Nothing is connected/)
  })

  it('reads an audio edge in the direction it runs', () => {
    const element = list([{
      id: 'c1', from: { node: 'a', portIndex: 0 }, to: { node: 'b', portIndex: 0 }, signalKind: AUDIO
    }])
    expect(element.querySelector('.connection-text').textContent)
      .toBe('Pulse out 1 to Cascade in 1')
  })

  it('names a modulation target by its symbol, not by an index it has not got', () => {
    const element = list([{
      id: 'c2', from: { node: 'a', portIndex: 0 }, to: { node: 'b', portSymbol: 'mix' }, signalKind: AUDIO
    }])
    expect(element.querySelector('.connection-text').textContent)
      .toBe('Pulse out 1 to Cascade · mix')
  })

  it('names the kind rather than only colouring it', () => {
    const element = list([
      { id: 'c1', from: { node: 'a', portIndex: 0 }, to: { node: 'b', portIndex: 0 }, signalKind: AUDIO },
      { id: 'c2', from: { node: 'a', portIndex: 0 }, to: { node: 'b', portIndex: 0 }, signalKind: MIDI }
    ])
    expect([...element.querySelectorAll('.connection-kind')].map(b => b.textContent))
      .toEqual(['audio', 'MIDI'])
  })

  it('gives every disconnect button its own name', () => {
    // "Disconnect" five times is five buttons a screen reader cannot tell apart.
    const element = list([
      { id: 'c1', from: { node: 'a', portIndex: 0 }, to: { node: 'b', portIndex: 0 }, signalKind: AUDIO },
      { id: 'c2', from: { node: 'b', portIndex: 0 }, to: { node: 'a', portSymbol: 'mix' }, signalKind: AUDIO }
    ])
    const labels = [...element.querySelectorAll('.connection-remove')]
      .map(b => b.getAttribute('aria-label'))
    expect(new Set(labels).size).toBe(2)
    expect(labels[0]).toMatch(/^Disconnect Pulse out 1 to Cascade in 1$/)
  })

  it('removes by id, not by position', () => {
    const removed = []
    const element = createConnectionList(document, {
      connections: [
        { id: 'c1', from: { node: 'a', portIndex: 0 }, to: { node: 'b', portIndex: 0 }, signalKind: AUDIO },
        { id: 'c9', from: { node: 'b', portIndex: 0 }, to: { node: 'a', portIndex: 0 }, signalKind: AUDIO }
      ],
      labelFor,
      onRemove: id => removed.push(id)
    })
    element.querySelectorAll('.connection-remove')[1].click()
    expect(removed).toEqual(['c9'])
  })
})

describe('telling two instances of one plugin apart', () => {
  // Two instances of one plugin are two nodes with the same label, which is
  // ordinary: the project format says so in as many words. The connection list
  // read "Pulse out 1 to Cascade in 1" twice for two different edges, and the
  // disconnect buttons were announced identically. Found in a browser by making
  // a branch, which is the case the rack could never draw.
  //
  // The naming lives in the page, because it is a property of the whole set of
  // nodes rather than of any one of them. This checks the contract the list
  // depends on: distinct names in, distinct rows out.
  it('gives two edges to different nodes different text', () => {
    const labelFor = id => ({ a: 'Pulse', b: 'Cascade 1', c: 'Cascade 2' })[id] ?? id
    const element = createConnectionList(document, {
      labelFor,
      onRemove: () => {},
      connections: [
        { id: 'c1', from: { node: 'a', portIndex: 0 }, to: { node: 'b', portIndex: 0 }, signalKind: AUDIO },
        { id: 'c2', from: { node: 'a', portIndex: 0 }, to: { node: 'c', portIndex: 0 }, signalKind: AUDIO }
      ]
    })
    const rows = [...element.querySelectorAll('.connection-text')].map(t => t.textContent)
    expect(new Set(rows).size, `two edges read the same: ${rows.join(' | ')}`).toBe(2)
    const labels = [...element.querySelectorAll('.connection-remove')].map(b => b.getAttribute('aria-label'))
    expect(new Set(labels).size).toBe(2)
  })
})
