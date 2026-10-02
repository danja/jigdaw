// tests/host/CompositeParameters.test.js
import { describe, it, expect } from 'vitest'
import { parameterTargets } from '../../src/host/CompositeParameters.js'

const plugin = () => ({ kind: 'plugin', profile: {} })
const port = (symbol, ...drives) => ({ symbol, drives: drives.map(([node, portSymbol]) => ({ node, portSymbol })) })
const composite = (ports, members) => ({
  kind: 'composite', composite: { ports },
  members: Object.entries(members).map(([id, tree]) => ({ id, tree }))
})

describe('parameterTargets', () => {
  it('names the member parameter a port drives', () => {
    const tree = composite([port('depth', ['#trem', 'depth'])], { '#trem': plugin() })
    expect(parameterTargets(tree, 'depth')).toEqual([{ path: ['#trem'], symbol: 'depth' }])
  })

  it('names every one when a port drives several', () => {
    const tree = composite([port('amount', ['#a', 'gain'], ['#b', 'mix'])], { '#a': plugin(), '#b': plugin() })
    expect(parameterTargets(tree, 'amount')).toEqual([{ path: ['#a'], symbol: 'gain' }, { path: ['#b'], symbol: 'mix' }])
  })

  it('follows a port through a composite member to the plugin that has the parameter', () => {
    const inner = composite([port('wet', ['#verb', 'mix'])], { '#verb': plugin() })
    const outer = composite([port('space', ['#room', 'wet'])], { '#room': inner })
    expect(parameterTargets(outer, 'space')).toEqual([{ path: ['#room', '#verb'], symbol: 'mix' }])
  })

  it('is empty for a port the composite does not expose, and for a drive naming no member', () => {
    const tree = composite([port('ghost', ['#gone', 'x'])], { '#a': plugin() })
    expect(parameterTargets(tree, 'nothing')).toEqual([])
    expect(parameterTargets(tree, 'ghost')).toEqual([])
  })
})

import { voicing } from '../../src/host/CompositeParameters.js'

describe('voicing', () => {
  const withSettings = (ports, members) => ({
    kind: 'composite',
    composite: { ports, members: members.map(([id, settings]) => ({ id, settings })) },
    members: members.map(([id, , tree]) => ({ id, tree: tree ?? plugin() }))
  })
  const port2 = (symbol, defaultValue, ...drives) => ({ symbol, defaultValue, drives: drives.map(([node, portSymbol]) => ({ node, portSymbol })) })

  it('writes each port default on what it drives, then each member setting', () => {
    const tree = withSettings([port2('depth', 0.5, ['#trem', 'depth'])], [['#trem', [{ symbol: 'rate', value: 4.5 }]]])
    expect(voicing(tree)).toEqual([
      { path: ['#trem'], symbol: 'depth', value: 0.5 },
      { path: ['#trem'], symbol: 'rate', value: 4.5 }
    ])
  })

  it('writes inner composites first, so the outer author has the last word', () => {
    const inner = withSettings([port2('wet', 0.2, ['#verb', 'mix'])], [['#verb', []]])
    const outer = withSettings([], [['#room', [{ symbol: 'wet', value: 0.9 }], inner]])
    expect(voicing(outer)).toEqual([
      { path: ['#room', '#verb'], symbol: 'mix', value: 0.2 },
      { path: ['#room', '#verb'], symbol: 'mix', value: 0.9 }
    ])
  })

  it('writes nothing for a port with no default or a setting with no value', () => {
    const tree = withSettings([port2('x', null, ['#a', 'x'])], [['#a', [{ symbol: 'y', value: null }]]])
    expect(voicing(tree)).toEqual([])
  })
})
