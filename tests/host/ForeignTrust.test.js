// tests/host/ForeignTrust.test.js
//
// Contract section 12.4. This is the only thing between a person and third
// party JavaScript running in their page with their page's privileges, so every
// rule in that section has an assertion here and each one is written as the
// failure it prevents rather than as the behaviour it describes.
import { describe, it, expect } from 'vitest'
import { ForeignTrust, ConsentRequired, foreignPluginsIn } from '../../src/host/ForeignTrust.js'

const PLUGIN = 'https://example.org/wam/pingpong/'
const OTHER = 'https://example.org/wam/other/'
const DIGEST = 'sha384-AAAA'
const CHANGED = 'sha384-BBBB'

describe('consent for a foreign plugin', () => {
  it('is refused by default', () => {
    const trust = new ForeignTrust()
    expect(trust.isConsented(PLUGIN, DIGEST)).toBe(false)
    expect(() => trust.require({ iri: PLUGIN, digest: DIGEST })).toThrow(ConsentRequired)
  })

  it('is bound to the container, not to the plugin', () => {
    // The rule that makes consent mean anything. An IRI serves whatever is at
    // it today, so consenting to a plugin rather than to a body of code would
    // consent once to everything its author ever publishes there.
    const trust = new ForeignTrust()
    trust.consent(PLUGIN, DIGEST)
    expect(trust.isConsented(PLUGIN, DIGEST)).toBe(true)
    expect(trust.isConsented(PLUGIN, CHANGED)).toBe(false)
    expect(() => trust.require({ iri: PLUGIN, digest: CHANGED })).toThrow(ConsentRequired)
  })

  it('does not spread from one plugin to another', () => {
    const trust = new ForeignTrust()
    trust.consent(PLUGIN, DIGEST)
    expect(trust.isConsented(OTHER, DIGEST)).toBe(false)
  })

  it('cannot be given without both halves', () => {
    const trust = new ForeignTrust()
    expect(() => trust.consent(PLUGIN, null)).toThrow(/digest/)
    expect(() => trust.consent(null, DIGEST)).toThrow(/IRI/)
  })

  it('offers no way to consent to everything', () => {
    // Section 12.4 forbids a blanket setting. Asserted against the surface,
    // because the way this gets added later is somebody wanting one method.
    const surface = Object.getOwnPropertyNames(ForeignTrust.prototype)
    expect(surface.sort()).toEqual(['constructor', 'consent', 'isConsented', 'require', 'revoke'].sort())
  })

  it('can be withdrawn', () => {
    const trust = new ForeignTrust()
    trust.consent(PLUGIN, DIGEST)
    trust.revoke(PLUGIN, DIGEST)
    expect(trust.isConsented(PLUGIN, DIGEST)).toBe(false)
  })

  it('forgets when the page does, unless a host says otherwise', () => {
    const store = new Map()
    const remembering = new ForeignTrust({ store })
    remembering.consent(PLUGIN, DIGEST)
    expect(new ForeignTrust({ store }).isConsented(PLUGIN, DIGEST)).toBe(true)
    // A fresh default forgets, which is the safer way round.
    expect(new ForeignTrust().isConsented(PLUGIN, DIGEST)).toBe(false)
  })
})

describe('what a person is asked', () => {
  const request = ForeignTrust.request({
    iri: PLUGIN, label: 'Ping Pong Delay',
    format: 'http://purl.org/stuff/jigdaw/WebAudioModule', digest: 'sha384-abcdefghijklmnop'
  })

  it('names the plugin, its format, and the privilege it gets', () => {
    // The three things section 12.4 requires. A dialog that omits the third is
    // asking a question the person cannot answer.
    const all = request.statements.join(' ')
    expect(all).toContain('Ping Pong Delay')
    expect(all).toMatch(/privileges/)
    expect(all).toMatch(/not sandboxed/)
  })

  it('says the agreement covers only this copy', () => {
    expect(request.statements.join(' ')).toMatch(/asked again/)
    expect(request.statements.join(' ')).toContain('sha384-abcdefghi')
  })

  it('is data, so a host renders it and cannot quietly reword it away', () => {
    expect(Object.isFrozen(request)).toBe(true)
    expect(Object.isFrozen(request.statements)).toBe(true)
  })

  it('travels on the error, so a caller that forgot to ask can still ask', () => {
    const trust = new ForeignTrust()
    try {
      trust.require({ iri: PLUGIN, label: 'Ping Pong Delay', format: 'wam', digest: DIGEST })
      expect.unreachable('require should have thrown')
    } catch (error) {
      expect(error).toBeInstanceOf(ConsentRequired)
      expect(error.request.statements.length).toBeGreaterThan(2)
    }
  })
})

describe('a project that refers to foreign plugins', () => {
  // Section 12.4: a stored project is data from wherever it came from, and must
  // not be authority to run code. A host asks about these before opening.
  const project = { nodes: [{ id: 'n1', plugin: PLUGIN }, { id: 'n2', plugin: 'https://native.example/p/' }] }
  const resolve = iri => iri === PLUGIN
    ? { kind: 'foreign', label: 'Ping Pong Delay', container: { integrity: DIGEST } }
    : { kind: 'native' }

  it('lists them before anything is loaded', () => {
    const found = foreignPluginsIn(project, resolve)
    expect(found).toHaveLength(1)
    expect(found[0]).toMatchObject({ nodeId: 'n1', iri: PLUGIN, digest: DIGEST })
  })

  it('finds none in a project of native plugins', () => {
    expect(foreignPluginsIn({ nodes: [{ id: 'n2', plugin: 'x' }] }, () => ({ kind: 'native' }))).toEqual([])
  })
})
