// tests/ops/ForeignPlugins.test.js
//
// Contract section 12, where it meets the dispatcher.
//
// The machinery for loading a foreign plugin was built, tested and verified in
// a browser, and nothing in src/ops, src/ui or web/app.js referred to any of
// it. So every requirement in section 12 that is about what a host does, rather
// than what it can do, was unimplemented: nobody was asked for consent, nothing
// was marked, and a project could name a foreign plugin and be opened.
//
// These are the assertions that make the difference between possible and done.
import { describe, it, expect, beforeEach } from 'vitest'
import { OpDispatcher } from '../../src/ops/OpDispatcher.js'
import { Project } from '../../src/model/Project.js'
import { ForeignTrust, ConsentRequired } from '../../src/host/ForeignTrust.js'

const IRI = 'https://example.org/wam/pingpong/'
const DIGEST = 'sha384-AAAA'

/** An engine that records what it was asked to adopt, and nothing else. */
function stubEngine () {
  const adopted = []
  let next = 0
  return {
    adopted,
    context: { sampleRate: 48000 },
    async addPlugin (iri) {
      const entry = { id: `e${++next}`, iri, profile: { label: 'Native', ports: [], audioOutputs: 1 } }
      adopted.push({ how: 'native', entry })
      return entry
    },
    adopt (given) {
      const entry = { id: `e${++next}`, ...given }
      adopted.push({ how: 'adopt', entry })
      return entry
    },
    // Every method OpDispatcher calls on an engine, which is the list
    // `grep -o '#engine\.\w*'` gives. A stub missing one fails with
    // "is not a function" at the point of use rather than at construction,
    // which is how the first version of this file failed.
    remove () {},
    get (id) { return adopted.find(a => a.entry.id === id)?.entry },
    clearLinks () {},
    link () {},
    clampParameter (_id, _symbol, value) { return value },
    setParameter () {},
    addTrack () {},
    removeTrack () {},
    trackIds () { return [] },
    linkToTrack () {},
    setTrackChannel () {},
    // EventRouter reaches these three, which the grep above does not show
    // because it calls them on its own reference rather than through
    // this.#engine.
    onMessage () { return () => {} },
    post () {},
    get nodes () { return new Map(adopted.map(a => [a.entry.id, a.entry])) }
  }
}

/** A foreign side that consents, loads and reports, without any of it real. */
function stubForeign ({ trust = new ForeignTrust(), label = 'Ping Pong Delay' } = {}) {
  const loaded = []
  return {
    trust,
    loaded,
    async add (iri) {
      const profile = { kind: 'foreign', iri, label, container: { integrity: DIGEST }, foreignFormat: 'wam' }
      trust.require({
        iri: profile.iri, label: profile.label, format: profile.foreignFormat, digest: DIGEST
      })
      loaded.push(profile.iri)
      return {
        profile: { ...profile, label, ports: [], audioOutputs: 1, audioInputs: 1 },
        node: { parameters: new Map(), port: { postMessage () {} }, connect () {}, disconnect () {} },
        ready: { latencyFrames: 0 }
      }
    }
  }
}

describe('adding a foreign plugin', () => {
  let engine
  let foreign
  let dispatcher

  beforeEach(() => {
    engine = stubEngine()
    foreign = stubForeign()
    dispatcher = new OpDispatcher({ project: new Project(), engine, foreign })
  })

  it('is refused without consent, and hands back what to ask', async () => {
    // Section 12.4. The dispatcher does not summon a dialog: it returns the
    // request so the asking happens where a person is.
    const result = await dispatcher.addPlugin(IRI, { foreign: true })
    expect(result.ok).toBe(false)
    expect(result.kind).toBe('consent')
    expect(result.request.statements.join(' ')).toMatch(/privileges/)
    expect(foreign.loaded, 'nothing should have been loaded').toEqual([])
  })

  it('loads once consent has been given for that container', async () => {
    foreign.trust.consent(IRI, DIGEST)
    const result = await dispatcher.addPlugin(IRI, { foreign: true })
    expect(result.ok).toBe(true)
    expect(foreign.loaded).toEqual([IRI])
    expect(engine.adopted.at(-1).how).toBe('adopt')
  })

  it("goes through the engine ordinary adoption, not a second path", async () => {
    // The one-dispatcher rule, applied to loading: everything after
    // instantiation is the same whoever made the node.
    foreign.trust.consent(IRI, DIGEST)
    await dispatcher.addPlugin(IRI, { foreign: true })
    const { entry } = engine.adopted.at(-1)
    expect(entry.profile.kind).toBe('foreign')
    expect(entry.node).toBeTruthy()
  })

  it('records it in the project like any other node', async () => {
    foreign.trust.consent(IRI, DIGEST)
    const result = await dispatcher.addPlugin(IRI, { foreign: true })
    const node = dispatcher.project.nodes.find(n => n.id === result.nodeId)
    expect(node.pluginIri).toBe(IRI)
    expect(node.label).toBe('Ping Pong Delay')
  })

  it('refuses when the host supports no foreign plugins at all', async () => {
    // Section 12: support is optional and refusing everything conforms, so a
    // dispatcher built without a foreign side must say so rather than crash.
    const plain = new OpDispatcher({ project: new Project(), engine: stubEngine() })
    const result = await plain.addPlugin(IRI, { foreign: true })
    expect(result.ok).toBe(false)
    expect(result.message).toMatch(/does not load foreign plugins/)
  })

  it('leaves the native path exactly as it was', async () => {
    const result = await dispatcher.addPlugin('https://strandz.it/jigdaw/plugins/pulse/')
    expect(result.ok).toBe(true)
    expect(engine.adopted.at(-1).how).toBe('native')
    expect(foreign.loaded).toEqual([])
  })
})
