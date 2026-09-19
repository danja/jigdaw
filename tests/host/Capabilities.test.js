// tests/host/Capabilities.test.js
import { describe, it, expect } from 'vitest'
import { detectCapabilities, negotiate, explainMissing, compact } from '../../src/host/Capabilities.js'
import { vocabulary as v } from '../../src/rdf/Vocabulary.js'

const { jig, trn } = v
const profile = over => ({ iri: 'https://x/p/', label: 'P', requires: [], prefers: [], ...over })

describe('detectCapabilities', () => {
  it('always offers the capabilities the host itself provides', () => {
    const offered = detectCapabilities({})
    for (const c of [trn.HostTransport, jig.MidiEvents, jig.Persistence, jig.OfflineRender]) {
      expect(offered.has(c)).toBe(true)
    }
  })

  it('withholds shared memory without cross-origin isolation', () => {
    // Contract section 2.3. SharedArrayBuffer may exist and still be unusable
    // across threads, so isolation is the condition, not the constructor.
    const offered = detectCapabilities({ SharedArrayBuffer: function () {} })
    expect(offered.has(jig.SharedMemory)).toBe(false)
    expect(offered.has(jig.CrossOriginIsolation)).toBe(false)
  })

  it('offers shared memory only when isolated and present', () => {
    const offered = detectCapabilities({ crossOriginIsolated: true, SharedArrayBuffer: function () {} })
    expect(offered.has(jig.SharedMemory)).toBe(true)
    expect(offered.has(jig.CrossOriginIsolation)).toBe(true)
  })
})

describe('negotiate', () => {
  it('is satisfied when every requirement is offered', () => {
    const result = negotiate(profile({ requires: [jig.Persistence] }), detectCapabilities({}))
    expect(result.satisfied).toBe(true)
    expect(result.missing).toEqual([])
  })

  it('names what is missing rather than failing generically', () => {
    const result = negotiate(profile({ requires: [jig.SharedMemory] }), detectCapabilities({}))
    expect(result.satisfied).toBe(false)
    expect(result.missing).toEqual([jig.SharedMemory])
  })

  it('grants a preference only when it is available', () => {
    const p = profile({ prefers: [jig.SharedMemory] })
    expect(negotiate(p, detectCapabilities({})).granted).not.toContain(jig.SharedMemory)

    const isolated = detectCapabilities({ crossOriginIsolated: true, SharedArrayBuffer: function () {} })
    expect(negotiate(p, isolated).granted).toContain(jig.SharedMemory)
  })

  it('does not let an unmet preference block the load', () => {
    // The whole difference between requires and prefers.
    expect(negotiate(profile({ prefers: [jig.SharedMemory] }), detectCapabilities({})).satisfied).toBe(true)
  })

  it('accepts an array as well as a Set', () => {
    expect(negotiate(profile({ requires: [jig.Persistence] }), [jig.Persistence]).satisfied).toBe(true)
  })
})

describe('explainMissing', () => {
  it('compacts IRIs so the message is readable', () => {
    const message = explainMissing(profile(), [jig.SharedMemory, trn.HostTransport])
    expect(message).toContain('jig:SharedMemory')
    expect(message).toContain('trn:HostTransport')
    expect(message).not.toContain('http://')
  })

  it('leaves a foreign IRI alone', () => {
    expect(compact('https://other.example/Thing')).toBe('https://other.example/Thing')
  })
})

describe('the host offers what its own plugins ask for', () => {
  // The paired-file rule, applied to the thing it keeps catching. A capability
  // is minted in vocabs/jigdaw.ttl, required by a profile, and enforced by the
  // shapes, and none of that makes the host offer it. jig:MidiOut went through
  // all three and the host still refused BassGen, which was found by loading it
  // in a browser rather than by any of 341 tests.
  it('grants every capability the worked plugins require', async () => {
    const { readFile } = await import('node:fs/promises')
    const { resolve, join } = await import('node:path')
    const { parseTurtleFile } = await import('../../src/validate/files.js')
    const { readProfile } = await import('../../src/rdf/ProfileReader.js')
    const { pluginDirs } = await import('../../src/catalogue/PluginDirectories.js')

    const root = resolve(import.meta.dirname, '../..')
    const plugins = await pluginDirs(join(root, 'plugins'))
    expect(plugins.length, 'there should be plugins to check').toBeGreaterThan(0)

    const offered = detectCapabilities({})
    for (const name of plugins) {
      const file = join(root, 'plugins', name, 'profile.ttl')
      const iri = `https://strandz.it/jigdaw/plugins/${name}/`
      const profile = readProfile(await parseTurtleFile(file, iri), iri)
      for (const required of profile.requires ?? []) {
        expect(offered.has(required),
          `${profile.label} requires ${compact(required)}, which this host does not offer`)
          .toBe(true)
      }
    }
  })
})

describe('the transport message a processor receives', () => {
  // The shape is read by every plugin processor and written in one place. The
  // BassGen processor read timeSignature as a pair and got undefined, because
  // Transport.messageAt sends an object with named fields. Nothing failed: the
  // meter was simply wrong. Found in a browser, not by any test.
  it('carries timeSignature as named fields, not a pair', async () => {
    const { Transport } = await import('../../src/engine/Transport.js')
    const message = new Transport({ sampleRate: 48000 }).messageAt(0, { frame: 0 })
    expect(message.type).toBe('transport')
    expect(Array.isArray(message.timeSignature)).toBe(false)
    expect(typeof message.timeSignature.beatsPerBar).toBe('number')
    expect(typeof message.timeSignature.beatUnit).toBe('number')
  })

  it('is read that way by every processor that reads it', async () => {
    const { readFile } = await import('node:fs/promises')
    const { resolve, join } = await import('node:path')
    const { pluginDirs } = await import('../../src/catalogue/PluginDirectories.js')
    const root = resolve(import.meta.dirname, '../..')
    const plugins = await pluginDirs(join(root, 'plugins'))

    for (const name of plugins) {
      const file = join(root, 'plugins', name, `${name}-processor.js`)
      const source = await readFile(file, 'utf8').catch(() => '')
      if (!source.includes('timeSignature')) continue
      expect(source, `${name} should read timeSignature by name`)
        .toMatch(/timeSignature(\?)?\.(beatsPerBar|beatUnit)/)
      expect(source, `${name} indexes timeSignature as a pair`)
        .not.toMatch(/timeSignature(\?)?\[\d\]/)
    }
  })
})
