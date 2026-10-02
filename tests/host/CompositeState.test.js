// tests/host/CompositeState.test.js
import { describe, it, expect } from 'vitest'
import { collectState, restoreState } from '../../src/host/CompositeState.js'
import { encodeState, decodeState } from '../../src/host/StateCodec.js'

const leaf = (iri, stateless = false) => ({ kind: 'plugin', iri, profile: { stateless }, granted: [] })
const comp = (...members) => ({ kind: 'composite', members: members.map(([id, tree]) => ({ id, tree })) })

describe('collectState', () => {
  it('keys each stateful member by its IRI and does not ask a stateless one', async () => {
    const asked = []
    const tree = comp(['#a', leaf('p/a')], ['#b', leaf('p/b', true)], ['#c', leaf('p/c')])
    const state = await collectState(tree, async path => { asked.push(path.join('/')); return { path: path.join('/') } })
    expect(asked).toEqual(['#a', '#c'])
    expect(state).toEqual({ members: { '#a': { path: '#a' }, '#c': { path: '#c' } } })
  })

  it('has nothing to save for a rack of stateless pedals, and for members that answer nothing', async () => {
    expect(await collectState(comp(['#a', leaf('p/a', true)]), async () => 'unused')).toBeUndefined()
    expect(await collectState(comp(['#a', leaf('p/a')]), async () => undefined)).toBeUndefined()
  })

  it('nests: a composite member contributes its own members, addressed by the whole path', async () => {
    const tree = comp(['#in', comp(['#x', leaf('p/x')])], ['#y', leaf('p/y')])
    const state = await collectState(tree, async path => path.join('/'))
    expect(state).toEqual({ members: { '#in': { members: { '#x': '#in/#x' } }, '#y': '#y' } })
  })

  it('survives the same encoding a session uses, binary state included', async () => {
    const tree = comp(['#a', leaf('p/a')])
    const state = await collectState(tree, async () => ({ sample: new Uint8Array([1, 2, 3]).buffer, name: 'x' }))
    const back = decodeState(encodeState(state))
    expect(new Uint8Array(back.members['#a'].sample)).toEqual(new Uint8Array([1, 2, 3]))
    expect(back.members['#a'].name).toBe('x')
  })
})

describe('restoreState', () => {
  const collect = (tree, saved) => {
    const given = []
    restoreState(tree, saved, (path, state) => given.push([path.join('/'), state]))
    return given
  }

  it('gives each member its own state', () => {
    const tree = comp(['#a', leaf('p/a')], ['#b', leaf('p/b')])
    expect(collect(tree, { members: { '#a': 1, '#b': 2 } })).toEqual([['#a', 1], ['#b', 2]])
  })

  it('ignores a key that names no member, and leaves a member with no key alone', () => {
    // A rack saved before "#b" was added, and one saved after "#gone" was removed.
    const tree = comp(['#a', leaf('p/a')], ['#b', leaf('p/b')])
    expect(collect(tree, { members: { '#a': 1, '#gone': 9 } })).toEqual([['#a', 1]])
  })

  it('restores into nested composites by path', () => {
    const tree = comp(['#in', comp(['#x', leaf('p/x')])])
    expect(collect(tree, { members: { '#in': { members: { '#x': 'deep' } } } })).toEqual([['#in/#x', 'deep']])
  })

  it('accepts what is not a state at all, as an empty one', () => {
    const tree = comp(['#a', leaf('p/a')])
    for (const bad of [undefined, null, 'text', 3, { members: 'no' }, {}]) expect(collect(tree, bad)).toEqual([])
  })

  it('does not take a key from the prototype', () => {
    expect(collect(comp(['toString', leaf('p/a')]), { members: {} })).toEqual([])
  })
})
