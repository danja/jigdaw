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
