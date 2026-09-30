// tests/ui/NodeView.test.js
import { describe, it, expect, beforeEach } from 'vitest'
import { parseHTML } from 'linkedom'
import { createNodeView } from '../../src/ui/NodeView.js'

const AUDIO = 'http://purl.org/stuff/transmissions/Audio'
const MIDI = 'http://purl.org/stuff/transmissions/Midi'
let document
let window
beforeEach(() => { ({ document, window } = parseHTML('<!doctype html><body></body>')) })
const event = type => new window.Event(type, { bubbles: true, cancelable: true })

const synth = { audioInputs: 0, audioOutputs: 1, accepts: [MIDI], produces: [], ports: [] }
const gen = { audioInputs: 0, audioOutputs: 0, accepts: [], produces: [MIDI], ports: [] }
const fx = { audioInputs: 1, audioOutputs: 1, accepts: [], produces: [], ports: [{ symbol: 'mix', name: 'Mix' }] }

function build (over = {}) {
  const calls = []
  const view = createNodeView(document, {
    onDisconnect: id => calls.push(['disconnect', id]),
    onConnect: c => calls.push(['connect', c]),
    onShowPlugin: () => calls.push(['show'])
  })
  document.body.append(view.element)
  const state = {
    node: { id: 'gen' }, label: 'Gen', trackLabel: 'Drums', profile: gen, connections: [],
    others: [
      { node: { id: 'synth' }, profile: synth, label: 'Synth', trackLabel: 'Lead' },
      { node: { id: 'fx' }, profile: fx, label: 'Reverb', trackLabel: 'Lead' }
    ],
    labelFor: id => id, ...over
  }
  view.show(state)
  return { view, calls, state }
}

describe('the node view', () => {
  it('says what the plugin is, where it is, and its ports', () => {
    build()
    expect(document.querySelector('.node-heading').textContent).toBe('Gen, on Drums.')
    expect(document.querySelector('.node-ports').textContent).toBe('Takes: nothing. Gives: MIDI out.')
  })

  it('offers only the destinations that can take the chosen output, on any track', () => {
    build()
    expect([...document.querySelectorAll('#connect-to option')].map(o => o.textContent)).toEqual(['Synth on Lead: MIDI in'])
  })

  it('an audio output can go to an audio input or a parameter to modulate, not to a MIDI input', () => {
    build({ node: { id: 'synth' }, profile: synth, label: 'Synth', others: [
      { node: { id: 'fx' }, profile: fx, label: 'Reverb', trackLabel: 'Lead' },
      { node: { id: 'gen' }, profile: gen, label: 'Gen', trackLabel: 'Drums' }
    ] })
    expect([...document.querySelectorAll('#connect-to option')].map(o => o.textContent)).toEqual(['Reverb on Lead: Audio in 1', 'Reverb on Lead: Mix (modulate)'])
  })

  it('connects with the chosen output and destination, as the request the dispatcher takes', () => {
    const { calls } = build()
    document.getElementById('connect-go').closest('form').dispatchEvent(event('submit'))
    expect(calls).toEqual([['connect', {
      from: { node: 'gen', portIndex: 0, kind: MIDI, name: 'MIDI out' },
      to: { kind: MIDI, portIndex: 0, name: 'MIDI in', node: 'synth' },
      toNode: 'synth'
    }]])
  })

  it('says when nothing can take the output, and leaves the button out', () => {
    build({ others: [{ node: { id: 'fx' }, profile: fx, label: 'Reverb', trackLabel: 'Lead' }] })
    expect(document.getElementById('connect-go').hidden).toBe(true)
    expect(document.querySelector('.node-none').textContent).toBe('Nothing on any track can take MIDI out.')
  })

  it('follows what is chosen in each select, as the browser reports it', () => {
    const { calls } = build({ node: { id: 'synth' }, profile: synth, label: 'Synth', others: [
      { node: { id: 'fx' }, profile: fx, label: 'Reverb', trackLabel: 'Lead' }
    ] })
    const to = document.getElementById('connect-to')
    // linkedom's select has no value, which a browser's does.
    Object.defineProperty(to, 'value', { value: '1', configurable: true })
    to.dispatchEvent(event('change'))
    document.querySelector('.node-connect').dispatchEvent(event('submit'))
    expect(calls[0][1].to).toMatchObject({ node: 'fx', portSymbol: 'mix' })
  })

  it('leaves the whole form out for a plugin with no outputs', () => {
    build({ node: { id: 'fx' }, profile: { ...fx, audioOutputs: 0 }, label: 'Sink' })
    expect(document.querySelector('.node-connect').hidden).toBe(true)
  })

  it('lists the connections it is in and disconnects one', () => {
    const { calls } = build({ connections: [{ id: 'c1', signalKind: MIDI, from: { node: 'gen', portIndex: 0 }, to: { node: 'synth', portIndex: 0 } }], labelFor: id => id.toUpperCase() })
    expect(document.querySelector('.connection-text').textContent).toBe('Gen out 1 to SYNTH in 1')
    document.querySelector('.connection-remove').dispatchEvent(event('click'))
    expect(calls).toEqual([['disconnect', 'c1']])
  })

  it('does not guess at the ports of a plugin that has not loaded', () => {
    build({ profile: undefined })
    expect(document.querySelector('.node-ports').textContent).toBe('Not loaded, so its ports are not known.')
    expect(document.querySelector('.node-connect').hidden).toBe(true)
  })

  it('leads to the plugin panel', () => {
    const { calls } = build()
    document.querySelector('.node-view > button').dispatchEvent(event('click'))
    expect(calls).toEqual([['show']])
  })

  it('will not be built without its handlers', () => {
    expect(() => createNodeView(document, { onDisconnect () {}, onConnect () {} })).toThrow(/onShowPlugin/)
  })
})
