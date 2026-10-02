// tests/host/compositeBundle.test.js
//
// docs/plugin-bundles.md section 9, against real plugins and the real verifier. What is
// worth asserting is each way the bundle can lie: an unpinned member, a pin that is wrong, a
// member changed inside the archive, and a flattened file whose member was swapped. A signature
// that survived any of those would be the failure the pins exist to prevent.
import { describe, it, expect, beforeAll } from 'vitest'
import { resolve, join } from 'node:path'
import { readFile, writeFile, mkdtemp, mkdir, cp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { bundle, unzip } from '../../bin/bundle.js'
import { memberDirectoryUnder } from '../../bin/bundle-composite.js'
import { inspect } from '../../bin/verify.js'
import { parseText } from '../../src/rdf/parse.js'
import { pluginForm } from '../../src/rdf/Canonical.js'
import { digestOf } from '../../src/host/Integrity.js'
import { generateKeyPair } from '../../src/host/Signature.js'
import { pinnedRack as pinnedRackAt } from '../../src/testing/CompositeFixtures.js'
import { resolveComposite, bundledFromGraph } from '../../src/host/CompositeResolver.js'
import { PluginLoader } from '../../src/host/PluginLoader.js'
import { shapeValidatorFromFile } from '../../src/validate/files.js'

const root = resolve(import.meta.dirname, '../..')
const PLUGINS = resolve(root, 'plugins')
const RACK = 'https://example.org/racks/stomp/'
const WHEN = new Date('2026-10-02T09:00:00Z')
const PLACEHOLDER = `sha384-${'A'.repeat(64)}`
const MEMBERS = ['boost', 'tremolo', 'cascade']

const pinnedRack = () => pinnedRackAt(root)

async function rackDirectory (text) {
  const dir = await mkdtemp(join(tmpdir(), 'jigdaw-rack-'))
  await writeFile(join(dir, 'profile.ttl'), text)
  return dir
}

describe('bundling a composite', () => {
  let made
  let signer
  let dir
  beforeAll(async () => {
    const pair = await generateKeyPair()
    signer = { verificationMethod: 'https://example.org/keys/test#ed25519', publicKeyMultibase: pair.publicKeyMultibase, privateKey: pair.privateKey }
    dir = await rackDirectory(await pinnedRack())
    made = await bundle(dir, { now: WHEN, signer, attributedTo: 'https://example.org/people/test', resolveMember: memberDirectoryUnder(PLUGINS) })
  }, 60000)

  const write = async (name, bytes) => {
    const out = join(await mkdtemp(join(tmpdir(), 'jigdaw-out-')), name)
    await writeFile(out, bytes)
    return out
  }

  it('holds every member, with the files each declares, under members/', () => {
    const entries = unzip(made.archive).map(f => f.name)
    expect(entries).toContain('profile.ttl')
    expect(entries).toContain('provenance.ttl')
    for (const name of MEMBERS) expect(entries).toContain(`members/${name}/profile.ttl`)
    expect(entries).toContain('members/boost/boost.wasm')
    expect(entries).toContain('members/cascade/cascade-processor.js')
    // Nothing a profile does not name, and no provenance of a member's own.
    expect(entries.filter(n => n.endsWith('provenance.ttl'))).toEqual(['provenance.ttl'])
  })

  it('keeps the composite as the plugin the bundle is of', () => {
    expect(made.iri).toBe(RACK)
    expect(made.members.map(m => m.directory).sort()).toEqual([...MEMBERS].sort())
  })

  it('verifies in both forms: every pin, every file, the digest and the signature', async () => {
    for (const [name, bytes, kind] of [['rack.jig', made.archive, 'archive'], ['rack.ttl', made.flat, 'profile']]) {
      const found = await inspect(await write(name, bytes))
      expect(found.kind).toBe(kind)
      expect(found.profile.iri).toBe(RACK)
      const bad = found.resources.filter(r => r.state !== 'verified')
      expect(bad, JSON.stringify(bad)).toEqual([])
      expect(found.resources.filter(r => r.what === 'pin')).toHaveLength(3)
      expect(found.signature.digestMatches).toBe(true)
      expect(found.signature.proofs.map(p => p.valid)).toEqual([true])
    }
  })

  it('states one canonical digest for both forms', async () => {
    const archive = await inspect(await write('rack.jig', made.archive))
    const flat = await inspect(await write('rack.ttl', made.flat))
    expect(archive.signature.digest).toBe(made.digest)
    expect(flat.signature.digest).toBe(made.digest)
  })

  it('is refused when a member file inside the archive is changed', async () => {
    const entries = unzip(made.archive)
    const target = entries.find(f => f.name === 'members/boost/boost.wasm')
    target.bytes = Buffer.concat([target.bytes, Buffer.from([0])])
    const { zip } = await import('../../bin/bundle.js')
    const found = await inspect(await write('tampered.jig', zip(entries)))
    expect(found.resources.find(r => r.state === 'failed')?.what).toMatch(/Boost jig:module/)
  })

  it('is refused when a member profile inside the archive is swapped, because the pin no longer matches', async () => {
    const entries = unzip(made.archive)
    const target = entries.find(f => f.name === 'members/tremolo/profile.ttl')
    // The same plugin with one statement changed: its files still verify against it, only the pin notices.
    target.bytes = Buffer.from(target.bytes.toString('utf8').replace('rdfs:label "Tremolo"', 'rdfs:label "Tremolo, altered"'))
    const { zip } = await import('../../bin/bundle.js')
    const found = await inspect(await write('swapped.jig', zip(entries)))
    const failed = found.resources.filter(r => r.state === 'failed')
    expect(failed.map(r => r.what)).toEqual(['pin'])
    expect(failed[0].name).toBe('https://strandz.it/jigdaw/plugins/tremolo/')
  })

  it('is refused when a member profile in the flattened file is changed, by the pin and by the signature', async () => {
    expect(made.flat).toContain('rdfs:label "Tremolo"')
    const altered = made.flat.replace('rdfs:label "Tremolo"', 'rdfs:label "Tremolo, altered"')
    const found = await inspect(await write('altered.ttl', altered))
    expect(found.resources.some(r => r.what === 'pin' && r.state === 'failed')).toBe(true)
    // The signature covers every member in this form, not only the composite.
    expect(found.signature.proofs.map(p => p.valid)).toEqual([false])
  })

  it('opens through the resolver from the flattened file alone, with no network', async () => {
    const validator = await shapeValidatorFromFile(resolve(root, 'vocabs/shapes.ttl'))
    const graph = await parseText(made.flat, 'urn:jigdaw:bundle')
    const loader = new PluginLoader({
      fetch: async () => { throw new TypeError('the network must not be reached') },
      parse: parseText, validator, capabilities: new Set()
    })
    const tree = await resolveComposite(RACK, { loader, bundled: bundledFromGraph(graph) })
    expect(tree.members.map(m => m.tree.profile.label).sort()).toEqual(['Boost', 'Cascade', 'Tremolo'])
  })

  it('is reproducible: the same time gives the same bytes', async () => {
    const again = await bundle(dir, { now: WHEN, signer, attributedTo: 'https://example.org/people/test', resolveMember: memberDirectoryUnder(PLUGINS) })
    expect(again.archive.equals(made.archive)).toBe(true)
    expect(again.flat).toBe(made.flat)
  })
})

describe('what bundling a composite refuses', () => {
  it('a member with no pin, naming it, because a signature would not reach it', async () => {
    const text = (await pinnedRack()).replace(/\s*jig:pinnedDigest "sha384-[^"]+" ;\s*\n\s*jig:setting <#trem-rate> \./, '\n    jig:setting <#trem-rate> .')
    expect(text).not.toBe(await pinnedRack())
    const dir = await rackDirectory(text)
    await expect(bundle(dir, { now: WHEN, resolveMember: memberDirectoryUnder(PLUGINS) })).rejects.toThrow(/tremolo.*no jig:pinnedDigest/s)
  })

  it('a pin that does not match the member on disk', async () => {
    const dir = await rackDirectory(await readFile(resolve(root, 'examples/reference-composite.ttl'), 'utf8'))
    await expect(bundle(dir, { now: WHEN, resolveMember: memberDirectoryUnder(PLUGINS) })).rejects.toThrow(/is pinned as .* and the profile on disk is/s)
  })

  it('a member that is not on disk', async () => {
    const dir = await rackDirectory(await pinnedRack())
    const empty = await mkdtemp(join(tmpdir(), 'jigdaw-empty-'))
    await expect(bundle(dir, { now: WHEN, resolveMember: memberDirectoryUnder(empty) })).rejects.toThrow(/was not found/)
  })

  it('a composite when nobody says where its members are', async () => {
    const dir = await rackDirectory(await pinnedRack())
    await expect(bundle(dir, { now: WHEN })).rejects.toThrow(/resolveMember|--members/)
  })
})
