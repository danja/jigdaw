// tests/host/Templates.test.js
import { describe, it, expect } from 'vitest'
import { createTemplates, templateName, NAME_LIMIT } from '../../src/host/Templates.js'
import { fakeIndexedDB } from './fakeIndexedDB.js'

const bytes = (...n) => Uint8Array.from(n)
function setup () {
  const indexedDB = fakeIndexedDB()
  let time = 1000
  return { templates: createTemplates({ indexedDB, now: () => time++ }), indexedDB }
}

describe('the template store', () => {
  it('starts empty and lists templates by name, newest save time kept', async () => {
    const { templates } = setup()
    expect(await templates.list()).toEqual([])
    await templates.save('Zed', { kind: 'turtle', bytes: bytes(1) })
    await templates.save('Alpha', { kind: 'zip', bytes: bytes(80, 75) })
    expect(await templates.list()).toEqual([{ name: 'Alpha', savedAt: 1001 }, { name: 'Zed', savedAt: 1000 }])
  })
  it('gives back what was kept, intact, and null for what was not', async () => {
    const { templates } = setup()
    await templates.save('Band', { kind: 'zip', bytes: bytes(80, 75, 3, 4) })
    const got = await templates.get('Band')
    expect(got.kind).toBe('zip')
    expect([...got.bytes]).toEqual([80, 75, 3, 4])
    expect(await templates.get('Nothing')).toBeNull()
  })
  it('replaces a template of the same name once, not twice', async () => {
    const { templates } = setup()
    await templates.save('Band', { kind: 'turtle', bytes: bytes(1) })
    await templates.save('  Band ', { kind: 'turtle', bytes: bytes(2) })
    expect((await templates.list()).map(t => t.name)).toEqual(['Band'])
    expect([...(await templates.get('Band')).bytes]).toEqual([2])
  })
  it('removes one, leaves the others, and does not mind a second removal', async () => {
    const { templates } = setup()
    await templates.save('A', { kind: 'turtle', bytes: bytes(1) })
    await templates.save('B', { kind: 'turtle', bytes: bytes(2) })
    await templates.remove('A')
    await templates.remove('A')
    expect((await templates.list()).map(t => t.name)).toEqual(['B'])
    expect(await templates.get('A')).toBeNull()
  })
  it('keeps what is saved after a new store is opened on the same database', async () => {
    const { templates, indexedDB } = setup()
    await templates.save('Band', { kind: 'turtle', bytes: bytes(7) })
    expect((await createTemplates({ indexedDB }).list()).map(t => t.name)).toEqual(['Band'])
  })
  it('refuses a bad name, bad bytes and an unknown kind, saving nothing', async () => {
    const { templates } = setup()
    await expect(templates.save('', { kind: 'turtle', bytes: bytes(1) })).rejects.toThrow(/needs a name/)
    await expect(templates.save('x'.repeat(NAME_LIMIT + 1), { kind: 'turtle', bytes: bytes(1) })).rejects.toThrow(/at most 60/)
    await expect(templates.save('A', { kind: 'turtle', bytes: 'text' })).rejects.toThrow(/kind and bytes/)
    await expect(templates.save('A', { kind: 'rdf', bytes: bytes(1) })).rejects.toThrow(/kind and bytes/)
    expect(await templates.list()).toEqual([])
  })
  it('squeezes the spaces of a name and refuses a name that is not text', () => {
    expect(templateName('  a   b ')).toBe('a b')
    expect(() => templateName(4)).toThrow(/needs a name/)
  })
  it('refuses to be built with no IndexedDB', () => {
    expect(() => createTemplates({ indexedDB: null })).toThrow(/no IndexedDB/)
  })
})
