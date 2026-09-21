// tests/host/Inspections.test.js
import { describe, it, expect } from 'vitest'
import { Inspections } from '../../src/host/Inspections.js'

/** A minimal Storage stand-in: get/setItem over a Map, nothing else. */
function fakeStorage () {
  const map = new Map()
  return {
    getItem: key => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => { map.set(key, value) },
    map
  }
}

describe('Inspections', () => {
  it('records a load and reads it back, shaped like the vocabulary', () => {
    const storage = fakeStorage()
    const inspections = new Inspections({ storage })
    inspections.record({ iri: 'https://example.org/plugins/pulse/', outcome: 'loaded' })

    const [record] = inspections.all()
    expect(record.inspectionOf).toBe('https://example.org/plugins/pulse/')
    expect(record.loadOutcome).toBe('loaded')
    expect(record.hostVersion).toBe('jigdaw-host/0.1.0')
    expect(new Date(record.inspectedAt).toString()).not.toBe('Invalid Date')
  })

  it('records a failure with its reason', () => {
    const storage = fakeStorage()
    const inspections = new Inspections({ storage })
    inspections.record({ iri: 'https://example.org/plugins/broken/', outcome: 'failed: integrity mismatch' })

    expect(inspections.all()[0].loadOutcome).toBe('failed: integrity mismatch')
  })

  it('filters by plugin, keeping order', () => {
    const inspections = new Inspections({ storage: fakeStorage() })
    inspections.record({ iri: 'a', outcome: 'loaded' })
    inspections.record({ iri: 'b', outcome: 'loaded' })
    inspections.record({ iri: 'a', outcome: 'failed: timeout' })

    const forA = inspections.forPlugin('a')
    expect(forA).toHaveLength(2)
    expect(forA.map(r => r.loadOutcome)).toEqual(['loaded', 'failed: timeout'])
  })

  it('is bounded, dropping the oldest rather than growing forever', () => {
    const inspections = new Inspections({ storage: fakeStorage() })
    for (let i = 0; i < 250; i++) inspections.record({ iri: `plugin-${i}`, outcome: 'loaded' })

    const all = inspections.all()
    expect(all).toHaveLength(200)
    // The oldest 50 were dropped; the record for plugin-0 is gone and the
    // most recent, plugin-249, survived.
    expect(all.some(r => r.inspectionOf === 'plugin-0')).toBe(false)
    expect(all.at(-1).inspectionOf).toBe('plugin-249')
  })

  it('does not throw with no storage, and reads back nothing', () => {
    const inspections = new Inspections({ storage: null })
    expect(() => inspections.record({ iri: 'x', outcome: 'loaded' })).not.toThrow()
    expect(inspections.all()).toEqual([])
  })

  it('treats corrupt stored data as no data, rather than throwing', () => {
    const storage = fakeStorage()
    storage.setItem('jigdaw:inspections', 'not json at all')
    const inspections = new Inspections({ storage })
    expect(inspections.all()).toEqual([])
  })

  it('treats a storage that throws on access as no data, rather than throwing', () => {
    // Some browsers throw merely reading a storage method under a locked-down
    // policy, rather than the property being undefined.
    const inspections = new Inspections({
      storage: {
        get getItem () { throw new Error('SecurityError') }
      }
    })
    expect(() => inspections.all()).not.toThrow()
    expect(inspections.all()).toEqual([])
  })
})
