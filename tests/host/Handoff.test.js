// tests/host/Handoff.test.js
//
// The IndexedDB stand-in is tests/host/fakeIndexedDB.js, shared with the template store.
import { describe, it, expect } from 'vitest'
import { createHandoff } from '../../src/host/Handoff.js'
import { fakeIndexedDB } from './fakeIndexedDB.js'

const bytes = text => new TextEncoder().encode(text)
const piece = over => ({ from: 'simple', kind: 'turtle', bytes: bytes('<> a jig:Project .'), ...over })

function setup ({ minutes = 30 } = {}) {
  const indexedDB = fakeIndexedDB()
  let time = 1_000_000
  const handoff = createHandoff({ indexedDB, now: () => time, maxAgeMs: minutes * 60000 })
  return { handoff, indexedDB, advance: ms => { time += ms } }
}

describe('carrying a piece between pages', () => {
  it('keeps a piece and gives it back once, as it was, and then there is nothing', async () => {
    const { handoff } = setup()
    await handoff.put(piece({ kind: 'zip', bytes: Uint8Array.from([80, 75, 1, 2, 3]) }))
    expect(await handoff.peek()).toEqual({ from: 'simple', savedAt: 1_000_000 })
    const taken = await handoff.take()
    expect(taken.kind).toBe('zip')
    expect([...taken.bytes]).toEqual([80, 75, 1, 2, 3])
    expect(taken.from).toBe('simple')
    expect(await handoff.take()).toBeNull()
    expect(await handoff.peek()).toBeNull()
  })

  it('peeking leaves it there, and a newer piece replaces one nobody took', async () => {
    const { handoff } = setup()
    await handoff.put(piece({ from: 'simple', bytes: bytes('one') }))
    await handoff.peek()
    await handoff.peek()
    await handoff.put(piece({ from: 'studio', bytes: bytes('two') }))
    const taken = await handoff.take()
    expect(taken.from).toBe('studio')
    expect(new TextDecoder().decode(taken.bytes)).toBe('two')
  })

  it('offers nothing once it is older than the time it is kept for, and does not offer it later either', async () => {
    const { handoff, advance } = setup({ minutes: 30 })
    await handoff.put(piece())
    advance(29 * 60000)
    expect(await handoff.peek()).not.toBeNull()
    advance(2 * 60000)
    expect(await handoff.peek()).toBeNull()
    expect(await handoff.take()).toBeNull()
  })

  it('forgets a waiting piece when asked', async () => {
    const { handoff } = setup()
    await handoff.put(piece())
    await handoff.clear()
    expect(await handoff.peek()).toBeNull()
  })

  it('refuses a piece that is not bytes, has no origin, or is of a kind it does not know', async () => {
    const { handoff } = setup()
    await expect(handoff.put(piece({ bytes: 'text' }))).rejects.toThrow(/needs from, kind and bytes/)
    await expect(handoff.put(piece({ from: '' }))).rejects.toThrow(/needs from/)
    await expect(handoff.put(piece({ kind: 'json' }))).rejects.toThrow(/needs from/)
  })

  it('refuses to be built with no IndexedDB, or with no time to keep a piece for', () => {
    expect(() => createHandoff({ indexedDB: null, maxAgeMs: 1000 })).toThrow(/no IndexedDB/)
    expect(() => createHandoff({ indexedDB: fakeIndexedDB() })).toThrow(/maxAgeMs/)
    expect(() => createHandoff({ indexedDB: fakeIndexedDB(), maxAgeMs: 0 })).toThrow(/maxAgeMs/)
  })

  it('keeps big audio intact, and closes its connection each time', async () => {
    const { handoff, indexedDB } = setup()
    const big = new Uint8Array(3_000_000).map((_, i) => i % 251)
    await handoff.put(piece({ kind: 'zip', bytes: big }))
    const taken = await handoff.take()
    expect(taken.bytes.length).toBe(big.length)
    expect(taken.bytes[250_000]).toBe(big[250_000])
    expect(indexedDB.databases.get('jigdaw-handoff').stores.get('handoff').size).toBe(0)
  })
})
