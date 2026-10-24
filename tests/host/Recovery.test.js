// tests/host/Recovery.test.js
//
// The recovery store: one copy, as it was kept, until the next copy or until it is cleared. The IndexedDB stand-in is shared.
import { describe, it, expect } from 'vitest'
import { createRecovery } from '../../src/host/Recovery.js'
import { fakeIndexedDB } from './fakeIndexedDB.js'

const copy = over => ({ kind: 'turtle', bytes: new TextEncoder().encode('<> a jig:Project .'), nodes: 2, title: 'Tide', ...over })

describe('keeping a recovery copy', () => {
  it('keeps a copy and gives it back as it was, again and again, until it is cleared', async () => {
    let time = 5000
    const recovery = createRecovery({ indexedDB: fakeIndexedDB(), now: () => time })
    expect(await recovery.read()).toBeNull()
    await recovery.put(copy({ kind: 'zip', bytes: Uint8Array.from([80, 75, 3]) }))
    for (let i = 0; i < 2; i++) {
      const kept = await recovery.read()
      expect(kept).toMatchObject({ kind: 'zip', nodes: 2, title: 'Tide', savedAt: 5000 })
      expect([...kept.bytes]).toEqual([80, 75, 3])
    }
    await recovery.clear()
    expect(await recovery.read()).toBeNull()
  })

  it('replaces the last copy with the next, and records when', async () => {
    let time = 1
    const recovery = createRecovery({ indexedDB: fakeIndexedDB(), now: () => time })
    await recovery.put(copy({ title: 'one' }))
    time = 99
    await recovery.put(copy({ title: 'two' }))
    expect(await recovery.read()).toMatchObject({ title: 'two', savedAt: 99 })
  })

  it('refuses what is not a copy, and a browser with no IndexedDB', async () => {
    const recovery = createRecovery({ indexedDB: fakeIndexedDB() })
    await expect(recovery.put(copy({ kind: 'json' }))).rejects.toThrow(/needs kind, bytes/)
    await expect(recovery.put(copy({ bytes: 'text' }))).rejects.toThrow(/needs kind, bytes/)
    await expect(recovery.put(copy({ nodes: 1.5 }))).rejects.toThrow(/node count/)
    expect(() => createRecovery({ indexedDB: null })).toThrow(/no IndexedDB/)
  })
})
