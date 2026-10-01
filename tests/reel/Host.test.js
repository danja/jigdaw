// tests/reel/Host.test.js
//
// Reel's meeting with the host: the validator the planner calls for a `load`, run against the real
// PluginLoader and Keyframe's real files, then a tampered copy. A script naming a plugin must be refused
// for the reasons a person loading it by hand would be.
import { describe, it, expect, beforeAll } from 'vitest'
import { resolve, join } from 'node:path'
import { mkdtempSync, cpSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { pathToFileURL } from 'node:url'
import { PluginLoader } from '../../src/host/PluginLoader.js'
import { LoadError, STEPS } from '../../src/host/LoadError.js'
import { shapeValidatorFromFile } from '../../src/validate/files.js'
import { parseText } from '../../src/rdf/parse.js'
import { detectCapabilities } from '../../src/host/Capabilities.js'
import { directoryFetch } from '../../src/testing/OfflineHost.js'
import { createPluginValidator, existingPlugins, slug } from '../../src/reel/Host.js'
import { parse } from '../../src/reel/Parser.js'
import { plan } from '../../src/reel/Planner.js'

const root = resolve(import.meta.dirname, '../..')
const CANONICAL = 'https://strandz.it/jigdaw/plugins/keyframe/'

let validator
beforeAll(async () => { validator = await shapeValidatorFromFile(resolve(root, 'vocabs/shapes.ttl')) })

/** A real loader over a plugin directory, counting every fetch it makes. */
function realLoader (dir) {
  const fetches = []
  const inner = directoryFetch({ [CANONICAL]: dir })
  const loader = new PluginLoader({
    fetch: async (url, options) => { fetches.push(String(url)); return inner(url, options) },
    parse: parseText,
    validator,
    capabilities: detectCapabilities({ WebAssembly }),
    processorUrl: () => pathToFileURL(resolve(dir, 'keyframe-processor.js')).href
  })
  return { loader, fetches }
}

describe('the plugin validator, against the real loader', () => {
  it('passes a good plugin and hands the planner its ports with their units and ranges', async () => {
    const { loader } = realLoader(resolve(root, 'plugins/keyframe'))
    const result = await createPluginValidator(loader)(CANONICAL)
    expect(result.ok).toBe(true)
    const pitch = result.ports.find(p => p.symbol === 'pitch_shift')
    expect(pitch).toMatchObject({ minimum: -24, maximum: 24 })
    expect(pitch.unit).toMatch(/semitone12TET$/)
    expect(result.ports.map(p => p.symbol)).toContain('time_rate')
  })

  it('verifies the processor and the module by their digests, which is what first run means', async () => {
    const { loader, fetches } = realLoader(resolve(root, 'plugins/keyframe'))
    await createPluginValidator(loader)(CANONICAL)
    expect(fetches.some(f => f.endsWith('keyframe-processor.js'))).toBe(true)
    expect(fetches.some(f => f.endsWith('keyframe.wasm'))).toBe(true)
  })

  it('refuses a plugin whose module does not match its declared digest, naming the step', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'jigdaw-tamper-'))
    cpSync(resolve(root, 'plugins/keyframe'), dir, { recursive: true, filter: s => !s.includes('/target') })
    const wasm = readFileSync(join(dir, 'keyframe.wasm'))
    wasm[wasm.length - 1] ^= 0xff
    writeFileSync(join(dir, 'keyframe.wasm'), wasm)
    const { loader } = realLoader(dir)
    const result = await createPluginValidator(loader)(CANONICAL)
    expect(result.ok).toBe(false)
    expect(result.step).toBe(STEPS.integrity)
    expect(result.message).toMatch(/failed verification/)
  })

  it('refuses an address that serves nothing, at the fetch step', async () => {
    const { loader } = realLoader(resolve(root, 'plugins/keyframe'))
    const result = await createPluginValidator(loader)('https://nowhere.example/plugins/none/')
    expect(result.ok).toBe(false)
    expect(result.step).toBe(STEPS.fetchProfile)
  })

  it('does not fetch the code again for a plugin it has verified, but does fetch the profile again', async () => {
    const { loader, fetches } = realLoader(resolve(root, 'plugins/keyframe'))
    const resolvePlugin = createPluginValidator(loader)
    await resolvePlugin(CANONICAL)
    const first = fetches.length
    await resolvePlugin(CANONICAL)
    const second = fetches.slice(first)
    expect(second.some(f => f.endsWith('keyframe.wasm') || f.endsWith('.js'))).toBe(false)
    expect(second.some(f => f.endsWith('/keyframe/') || f.endsWith('profile.ttl'))).toBe(true)
  })
})

describe('the plugin validator, with a stand-in loader', () => {
  const profile = (integrity = 'sha384-a') => ({
    processor: { location: 'p.js', integrity }, module: { location: 'm.wasm', integrity },
    assets: [{ iri: 'https://x/#weights', location: 'w.bin', integrity }],
    ports: [{ symbol: 'a', name: 'A', unit: null, minimum: 0, maximum: 1, defaultValue: 0 }]
  })
  const loaderOf = (get, seen = []) => ({
    loadProfile: async () => ({ profile: get() }),
    fetchVerified: async (resource, { kind }) => { seen.push(kind); return new Uint8Array() }
  })

  it('verifies the assets too, by the name their fragment gives them', async () => {
    const seen = []
    await createPluginValidator(loaderOf(() => profile(), seen))('https://x/')
    expect(seen).toEqual(['processor', 'module', 'asset "weights"'])
  })

  it('verifies again when a declared digest changes, because that is a different plugin', async () => {
    const seen = []
    let digest = 'sha384-a'
    const resolvePlugin = createPluginValidator(loaderOf(() => profile(digest), seen))
    await resolvePlugin('https://x/')
    await resolvePlugin('https://x/')
    expect(seen).toHaveLength(3)
    digest = 'sha384-b'
    await resolvePlugin('https://x/')
    expect(seen).toHaveLength(6)
  })

  it('does not remember a plugin that failed', async () => {
    let fail = true
    const loader = {
      loadProfile: async () => ({ profile: profile() }),
      fetchVerified: async () => { if (fail) throw new LoadError(STEPS.integrity, 'digest mismatch'); return new Uint8Array() }
    }
    const resolvePlugin = createPluginValidator(loader)
    expect((await resolvePlugin('https://x/')).ok).toBe(false)
    fail = false
    expect((await resolvePlugin('https://x/')).ok).toBe(true)
  })

  it('reports a missing capability with its step, and a plain error without one', async () => {
    const missing = createPluginValidator({ loadProfile: async () => { throw new LoadError(STEPS.capabilities, 'needs jig:Simd128') } })
    expect(await missing('https://x/')).toMatchObject({ ok: false, step: STEPS.capabilities, message: 'needs jig:Simd128' })
    const broken = createPluginValidator({ loadProfile: async () => { throw new Error('boom') } })
    expect(await broken('https://x/')).toEqual({ ok: false, message: 'boom', step: null })
  })
})

describe('the planner with a real profile', () => {
  const plugin = async source => {
    const { loader } = realLoader(resolve(root, 'plugins/keyframe'))
    const parsed = parse(`load k = ${CANONICAL}\n${source}`)
    expect(parsed.errors).toEqual([])
    return plan(parsed.statements, { beatsPerBar: 4, existing: new Map(), resolvePlugin: createPluginValidator(loader) })
  }

  it('plans a script in the units Keyframe declares', async () => {
    const r = await plugin('k.time_rate = 50%\nk.pitch_shift = 7st\nk.threshold = -60dB\nk.max_splice = 0.2s')
    expect(r.errors ?? []).toEqual([])
    expect(r.ok).toBe(true)
  })

  it('refuses a pitch shift past Keyframe\'s range, and a unit it is not in', async () => {
    const range = await plugin('k.pitch_shift = 40st')
    expect(range.errors[0].message).toMatch(/outside its range -24 to 24/)
    const unit = await plugin('k.threshold = 5kHz')
    expect(unit.errors[0].message).toMatch(/is in db, and this value is hz/)
  })

  it('refuses a random pitch that could leave the range', async () => {
    const r = await plugin('every 1 bar: k.pitch_shift = pick(-12st, 0st, 30st)')
    expect(r.errors[0].message).toMatch(/outside its range/)
  })

  it('suggests the parameter that was meant', async () => {
    const r = await plugin('k.pitch_shif = 3st')
    expect(r.errors[0].message).toMatch(/nearest: pitch_shift/)
  })
})

describe('the names a script can use', () => {
  const dispatcher = (nodes, profiles) => ({
    project: { nodes },
    engineNode: id => (profiles[id] ? { profile: profiles[id] } : null)
  })
  const ports = [{ symbol: 'mix', minimum: 0, maximum: 1 }]

  it('makes a Reel name of a label, in lower case with underscores', () => {
    expect(slug('Frozen hall')).toBe('frozen_hall')
    expect(slug('Keyframe, a fifth up')).toBe('keyframe_a_fifth_up')
    expect(slug('8-Bit 8asterd')).toBe('_8_bit_8asterd')
    expect(slug('???')).toBe('')
  })

  it('knows plugins this session loaded, by the name the script gave them', () => {
    const d = dispatcher([{ id: 'n1' }], { n1: { label: 'Cascade', ports } })
    const { existing, ids } = existingPlugins(d, { names: new Map([['reverb', 'n1']]) })
    expect(existing.get('reverb').ports).toBe(ports)
    expect(ids.get('reverb')).toBe('n1')
  })

  it('knows the project\'s other plugins by the slug of their label', () => {
    const d = dispatcher([{ id: 'n1', label: 'Frozen hall' }], { n1: { label: 'Cascade', ports } })
    expect([...existingPlugins(d, { names: new Map() }).existing.keys()]).toEqual(['frozen_hall'])
  })

  it('does not guess between two plugins that share a name', () => {
    const d = dispatcher([{ id: 'n1', label: 'Plate' }, { id: 'n2', label: 'Plate' }], { n1: { ports }, n2: { ports } })
    expect(existingPlugins(d, { names: new Map() }).existing.size).toBe(0)
  })

  it('forgets a plugin that is no longer in the project, and one with no profile loaded', () => {
    const d = dispatcher([{ id: 'n2', label: 'Ghost' }], { n2: null })
    const { existing } = existingPlugins(d, { names: new Map([['gone', 'n1']]) })
    expect(existing.size).toBe(0)
  })

  it('lets a name the script gave win over a label that slugs to the same', () => {
    const d = dispatcher([{ id: 'n1', label: 'Plate' }, { id: 'n2', label: 'Other' }], { n1: { ports }, n2: { ports } })
    const { ids } = existingPlugins(d, { names: new Map([['plate', 'n2']]) })
    expect(ids.get('plate')).toBe('n2')
  })
})
