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
