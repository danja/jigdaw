// tests/ops/ChainReorder.test.js
import { describe, it, expect } from 'vitest'
import { Project } from '../../src/model/Project.js'
import { chainSwapChanges } from '../../src/ops/ChainReorder.js'

const AUDIO = 'http://purl.org/stuff/transmissions/Audio'
const MIDI = 'http://purl.org/stuff/transmissions/Midi'
const IRI = 'https://example.org/p/'
const passesAudio = id => id.startsWith('fx')

/** A track with nodes and audio edges between them, given as [from, to] pairs, every port 0. */
function build (ids, edges, extra = []) {
  const p = new Project()
  p.apply([
    { op: 'addTrack', id: 't' }, { op: 'addTrack', id: 'u' },
    ...ids.map(id => ({ op: 'addNode', id, track: 't', pluginIri: IRI, label: id })),
    ...edges.map(([from, to, kind = AUDIO, fromPort = 0, toPort = 0]) => ({
      op: 'addConnection', from: { node: from, portIndex: fromPort }, to: { node: to, portIndex: toPort }, signalKind: kind
    })),
    ...extra
  ])
  return p
}
const path = project => project.connections.filter(c => c.signalKind === AUDIO)
  .map(c => `${c.from.node}.${c.from.portIndex ?? 0}>${c.to.node}.${c.to.portIndex ?? 0}`).sort()

describe('swapping neighbours in an audio chain', () => {
  it('moves a plugin later, rewiring the three joins in the new order', () => {
    const p = build(['src', 'fx1', 'fx2', 'end'], [['src', 'fx1'], ['fx1', 'fx2'], ['fx2', 'end']])
    p.apply(chainSwapChanges(p, 'fx1', 1, { passesAudio }))
    expect(path(p)).toEqual(['fx1.0>end.0', 'fx2.0>fx1.0', 'src.0>fx2.0'])
  })

  it('moves a plugin earlier, which is the same swap seen from the other end', () => {
    const p = build(['src', 'fx1', 'fx2', 'end'], [['src', 'fx1'], ['fx1', 'fx2'], ['fx2', 'end']])
    p.apply(chainSwapChanges(p, 'fx2', -1, { passesAudio }))
    expect(path(p)).toEqual(['fx1.0>end.0', 'fx2.0>fx1.0', 'src.0>fx2.0'])
  })

  it('works at the start and the end of a chain, where a side is missing', () => {
    const p = build(['fx1', 'fx2'], [['fx1', 'fx2']])
    p.apply(chainSwapChanges(p, 'fx1', 1, { passesAudio }))
    expect(path(p)).toEqual(['fx2.0>fx1.0'])
  })

  it('keeps each plugin on the ports it was on', () => {
    const p = build(['src', 'fx1', 'fx2', 'end'], [['src', 'fx1', AUDIO, 0, 0], ['fx1', 'fx2', AUDIO, 2, 0], ['fx2', 'end', AUDIO, 3, 4]])
    p.apply(chainSwapChanges(p, 'fx1', 1, { passesAudio }))
    // fx2 keeps its output on 3 and fx1 its output on 2; the receiving port on the far end stays 4.
    expect(path(p)).toEqual(['fx1.2>end.4', 'fx2.3>fx1.0', 'src.0>fx2.0'])
  })

  it('is one changeset, so one undo takes the whole swap back', async () => {
    const p = build(['src', 'fx1', 'fx2', 'end'], [['src', 'fx1'], ['fx1', 'fx2'], ['fx2', 'end']])
    const before = path(p)
    const changes = chainSwapChanges(p, 'fx1', 1, { passesAudio })
    expect(changes.filter(c => c.op === 'removeConnection')).toHaveLength(3)
    expect(changes.filter(c => c.op === 'addConnection')).toHaveLength(3)
    p.apply(changes)
    expect(path(p)).not.toEqual(before)
  })

  it('refuses the ends of a chain, saying there is nothing to swap with', () => {
    const p = build(['fx1', 'fx2'], [['fx1', 'fx2']])
    expect(() => chainSwapChanges(p, 'fx1', -1, { passesAudio })).toThrow(/nothing before it/)
    expect(() => chainSwapChanges(p, 'fx2', 1, { passesAudio })).toThrow(/nothing after it/)
  })

  it('refuses when a plugin does not take and give audio, naming both', () => {
    const p = build(['synth', 'fx1'], [['synth', 'fx1']])
    expect(() => chainSwapChanges(p, 'fx1', -1, { passesAudio })).toThrow(/synth and fx1 cannot swap/)
  })

  it('refuses a branch, and a plugin joined to other things as well', () => {
    const branch = build(['src', 'fx1', 'fx2', 'a', 'b'], [['src', 'fx1'], ['fx1', 'fx2'], ['fx2', 'a'], ['fx2', 'b']])
    expect(() => chainSwapChanges(branch, 'fx1', 1, { passesAudio })).toThrow(/branches/)
    const side = build(['src', 'fx1', 'fx2', 'key'], [['src', 'fx1'], ['fx1', 'fx2'], ['key', 'fx2', AUDIO, 0, 1]])
    // A sidechain key on fx2's second input is not a join in the chain, so it does not stop the swap.
    expect(() => chainSwapChanges(side, 'fx1', 1, { passesAudio })).not.toThrow()
    const two = build(['x', 'y', 'fx1', 'fx2'], [['x', 'fx1'], ['y', 'fx1'], ['fx1', 'fx2']])
    expect(() => chainSwapChanges(two, 'fx1', 1, { passesAudio })).toThrow(/branches|several/)
  })

  it('ignores MIDI connections, and refuses a move that is not one place', () => {
    const p = build(['fx1', 'fx2', 'gen'], [['fx1', 'fx2'], ['gen', 'fx1', MIDI]])
    p.apply(chainSwapChanges(p, 'fx1', 1, { passesAudio }))
    expect(path(p)).toEqual(['fx2.0>fx1.0'])
    expect(p.connections.some(c => c.signalKind === MIDI)).toBe(true)
    expect(() => chainSwapChanges(p, 'fx1', 2, { passesAudio })).toThrow(/one place/)
    expect(() => chainSwapChanges(p, 'ghost', 1, { passesAudio })).toThrow(/no such node/)
  })

  it('refuses plugins on different tracks', () => {
    const p = build(['fx1', 'fx2'], [['fx1', 'fx2']], [{ op: 'moveNodeToTrack', id: 'fx2', track: 'u' }])
    expect(() => chainSwapChanges(p, 'fx1', 1, { passesAudio })).toThrow(/one track/)
  })
})
