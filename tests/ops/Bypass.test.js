// tests/ops/Bypass.test.js
import { describe, it, expect } from 'vitest'
import { effectiveConnections } from '../../src/ops/Bypass.js'

const AUDIO = 'http://purl.org/stuff/transmissions/Audio'
const MIDI = 'http://purl.org/stuff/transmissions/Midi'
const link = (id, from, to, signalKind = AUDIO, toPort = 0) => ({ id, from: { node: from, portIndex: 0 }, to: { node: to, portIndex: toPort }, signalKind })
const summarise = list => list.map(c => `${c.from.node}>${c.to.node}${c.signalKind === MIDI ? ' midi' : ''}`).sort()

// Effects pass audio, MIDI processors pass MIDI, instruments and generators make a signal from nothing.
const kinds = { fx1: ['audio'], fx2: ['audio'], filter: ['midi'], synth: [], gen: [], src: [] }
const passes = (id, kind) => (kinds[id] ?? []).includes(kind)
const only = (...ids) => ({ bypassed: id => ids.includes(id), passes })

describe('what bypass does to the connections', () => {
  it('changes nothing when nothing is bypassed', () => {
    const list = [link('a', 'synth', 'fx1'), link('b', 'fx1', 'fx2')]
    expect(effectiveConnections(list, only())).toEqual(list)
  })

  it('steps over a bypassed effect, joining what feeds it to what it feeds', () => {
    const out = effectiveConnections([link('a', 'synth', 'fx1'), link('b', 'fx1', 'fx2')], only('fx1'))
    expect(summarise(out)).toEqual(['synth>fx2'])
    expect(out[0].id).toBe('a~b')
  })

  it('steps over a chain of bypassed effects', () => {
    const out = effectiveConnections([link('a', 'synth', 'fx1'), link('b', 'fx1', 'fx2'), link('c', 'fx2', 'end')], only('fx1', 'fx2'))
    expect(summarise(out)).toEqual(['synth>end'])
  })

  it('joins every input to every output of a bypassed effect', () => {
    const out = effectiveConnections([link('a', 'src', 'fx1'), link('x', 'synth', 'fx1'), link('b', 'fx1', 'one'), link('c', 'fx1', 'two')], only('fx1'))
    expect(summarise(out)).toEqual(['src>one', 'src>two', 'synth>one', 'synth>two'])
  })

  it('leaves what fed a bypassed last effect to end where it is, to be heard', () => {
    const out = effectiveConnections([link('a', 'synth', 'fx1')], only('fx1'))
    expect(out).toEqual([])
  })

  it('silences a bypassed instrument or generator by dropping what it sends', () => {
    const out = effectiveConnections([link('a', 'synth', 'fx1'), link('m', 'gen', 'synth', MIDI)], only('synth'))
    expect(summarise(out)).toEqual(['gen>synth midi'])
  })

  it('passes MIDI through a bypassed MIDI processor, and audio is not touched by it', () => {
    const out = effectiveConnections([link('m1', 'gen', 'filter', MIDI), link('m2', 'filter', 'synth', MIDI)], only('filter'))
    expect(summarise(out)).toEqual(['gen>synth midi'])
  })

  it('leaves a sidechain key and a modulation target where they are', () => {
    const key = link('k', 'kick', 'fx1', AUDIO, 1)
    const out = effectiveConnections([link('a', 'synth', 'fx1'), link('b', 'fx1', 'fx2'), key], only('fx1'))
    expect(summarise(out).sort()).toEqual(['kick>fx1', 'synth>fx2'])
  })

  it('does not loop on a cycle of bypassed effects, or join a node to itself', () => {
    const out = effectiveConnections([link('a', 'fx1', 'fx2'), link('b', 'fx2', 'fx1')], only('fx1', 'fx2'))
    expect(Array.isArray(out)).toBe(true)
    expect(out.every(c => c.from.node !== c.to.node)).toBe(true)
  })

  it('does not change the list it was given', () => {
    const list = [link('a', 'synth', 'fx1'), link('b', 'fx1', 'fx2')]
    const copy = JSON.stringify(list)
    effectiveConnections(list, only('fx1'))
    expect(JSON.stringify(list)).toBe(copy)
  })
})
