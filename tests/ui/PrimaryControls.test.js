// tests/ui/PrimaryControls.test.js
//
// Which ports come first: the ones the author gave a priority, highest first, and the rest kept back, unless there is nothing to keep back.
import { describe, it, expect } from 'vitest'
import { splitPrimary } from '../../src/ui/PrimaryControls.js'

const port = (symbol, displayPriority = null) => ({ symbol, displayPriority })
const symbols = ports => ports.map(p => p.symbol)

describe('splitPrimary', () => {
  it('shows the ports with a priority first, highest first, and keeps the rest back in their own order', () => {
    const { primary, rest } = splitPrimary([port('a'), port('b', 10), port('c'), port('d', 90), port('e', 50)])
    expect(symbols(primary)).toEqual(['d', 'e', 'b'])
    expect(symbols(rest)).toEqual(['a', 'c'])
  })

  it('keeps the profile order among ports of equal priority', () => {
    const { primary } = splitPrimary([port('z', 5), port('y', 5), port('x', 9), port('w', 5), port('v')])
    expect(symbols(primary)).toEqual(['x', 'z', 'y', 'w'])
  })

  it('treats a priority of zero as a priority, not as none: zero is the least important, but it is said', () => {
    const { primary, rest } = splitPrimary([port('a', 0), port('b')])
    expect(symbols(primary)).toEqual(['a'])
    expect(symbols(rest)).toEqual(['b'])
  })

  it('shows a profile whole when no port has a priority, as every profile was shown before there were any', () => {
    const ports = [port('a'), port('b'), port('c')]
    expect(splitPrimary(ports)).toEqual({ primary: ports, rest: [] })
  })

  it('shows a profile whole, in its own order, when every port has one, since nothing is kept back', () => {
    const ports = [port('a', 1), port('b', 9), port('c', 5)]
    const { primary, rest } = splitPrimary(ports)
    expect(primary).toBe(ports)
    expect(rest).toEqual([])
  })

  it('is empty for a plugin with no ports, and not an error', () => {
    expect(splitPrimary([])).toEqual({ primary: [], rest: [] })
  })

  it('reads an absent priority, not only a null one, as none', () => {
    const { primary, rest } = splitPrimary([{ symbol: 'a' }, { symbol: 'b', displayPriority: 3 }])
    expect(symbols(primary)).toEqual(['b'])
    expect(symbols(rest)).toEqual(['a'])
  })

  it('never loses or repeats a port', () => {
    const ports = Array.from({ length: 40 }, (_, i) => port(`p${i}`, i % 3 === 0 ? i : null))
    const { primary, rest } = splitPrimary(ports)
    expect([...symbols(primary), ...symbols(rest)].sort()).toEqual(symbols(ports).sort())
  })
})
