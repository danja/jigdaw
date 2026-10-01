// tests/host/SessionArchive.test.js
import { describe, it, expect } from 'vitest'
import { packSession, unpackSession } from '../../src/host/SessionArchive.js'
import { readZip } from '../../src/host/Zip.js'

describe('packSession', () => {
  it('is one Turtle file when there is nothing else to carry', () => {
    expect(packSession({ turtle: 'a' })).toEqual({ kind: 'turtle', text: 'a' })
  })

  it('is a zip with editor.ttl beside session.ttl when the editor has something to say', async () => {
    const packed = packSession({ turtle: 'a', editor: 'b' })
    expect(packed.kind).toBe('zip')
    const files = await readZip(packed.bytes)
    expect([...files.keys()]).toEqual(['session.ttl', 'editor.ttl'])
  })

  it('carries media in the same zip and returns it apart from the two documents', async () => {
    const packed = packSession({ turtle: 'a', editor: 'b', media: [{ name: 'kick.wav', bytes: new Uint8Array([1, 2]) }] })
    const out = unpackSession(await readZip(packed.bytes))
    expect(out.turtle).toBe('a')
    expect(out.editor).toBe('b')
    expect([...out.media.keys()]).toEqual(['kick.wav'])
  })
})

describe('unpackSession', () => {
  it('reads a zip saved before editor.ttl existed as one with no editor layout', async () => {
    const packed = packSession({ turtle: 'a', media: [{ name: 'x.wav', bytes: new Uint8Array([9]) }] })
    expect(unpackSession(await readZip(packed.bytes)).editor).toBeNull()
  })

  it('refuses an archive with no session.ttl', () => {
    expect(() => unpackSession(new Map([['editor.ttl', new Uint8Array()]]))).toThrow(/session\.ttl/)
  })
})

describe('scripts in a session', () => {
  it('make a zip even with no editor layout and no audio, with scripts.ttl beside session.ttl', async () => {
    const packed = packSession({ turtle: 'a', scripts: 'b' })
    expect(packed.kind).toBe('zip')
    expect([...(await readZip(packed.bytes)).keys()]).toEqual(['session.ttl', 'scripts.ttl'])
  })

  it('come back apart from the other documents and the media', async () => {
    const packed = packSession({ turtle: 'a', editor: 'e', scripts: 's', media: [{ name: 'kick.wav', bytes: new Uint8Array([1]) }] })
    const out = unpackSession(await readZip(packed.bytes))
    expect(out).toMatchObject({ turtle: 'a', editor: 'e', scripts: 's' })
    expect([...out.media.keys()]).toEqual(['kick.wav'])
  })

  it('are absent from a session saved without one, whether older or newer', async () => {
    const packed = packSession({ turtle: 'a', editor: 'e' })
    expect(unpackSession(await readZip(packed.bytes)).scripts).toBeNull()
  })

  it('are kept as text exactly, whatever the characters', async () => {
    const text = 'a.mix = 1 # \u00e9\u2028 "quoted" \\ \t\n'
    const out = unpackSession(await readZip(packSession({ turtle: 'a', scripts: text }).bytes))
    expect(out.scripts).toBe(text)
  })
})
