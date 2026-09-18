// tests/wam/WamModule.test.js
//
// The claim this whole package makes is that a JigDAW plugin loads in a host
// that speaks WAM rather than this contract. A test that checked the generated
// files looked right would confirm nothing: the interesting failures are all at
// load time, which is exactly where a shape assertion stops.
//
// So this instantiates through the real path. `src/testing/OfflineHost.js`
// registers the plugin's actual processor and calls its actual `process()`, so
// when a note comes out here it came out of Pulse's WebAssembly, reached
// through the WAM interface, with the digests verified on the way.
//
// What it cannot check is a real WAM host, because none is installed. The
// interface is asserted against `@webaudiomodules/api`'s own type definitions
// where that package is present, and skips loudly where it is not.
import { describe, it, expect, beforeAll } from 'vitest'
import { resolve, join } from 'node:path'
import { existsSync } from 'node:fs'
import { readFile, mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { pathToFileURL } from 'node:url'
import { writeWamPackage, WAM_API_VERSION } from '../../bin/wam.js'
import { shapeValidatorFromFile } from '../../src/validate/files.js'
import { webAudioModule } from '../../src/wam/WamModule.js'
import { directoryFetch, OfflineContext, OfflineWorkletNode } from '../../src/testing/OfflineHost.js'

const root = resolve(import.meta.dirname, '../..')
const pluginDir = resolve(root, 'plugins/pulse')
const CANONICAL = 'https://strandz.it/jigdaw/plugins/pulse/'

const built = existsSync(resolve(pluginDir, 'pulse.wasm'))
const suite = built ? describe : describe.skip
if (!built) console.warn('run plugins/pulse/build.sh first')

suite('a JigDAW plugin packaged as a WAM', () => {
  let made
  let out
  beforeAll(async () => {
    const validator = await shapeValidatorFromFile(resolve(root, 'vocabs/shapes.ttl'))
    out = await mkdtemp(join(tmpdir(), 'jig-wam-'))
    made = await writeWamPackage(pluginDir, out, { validator })
  }, 30000)

  describe('the descriptor', () => {
    it('carries every field WamDescriptor requires', async () => {
      const descriptor = JSON.parse(await readFile(join(out, 'descriptor.json'), 'utf8'))
      // The required set, read off the interface in src/types.d.ts rather than
      // remembered. A missing one is a plugin a WAM host refuses to list.
      for (const field of [
        'identifier', 'name', 'vendor', 'version', 'apiVersion', 'thumbnail',
        'keywords', 'isInstrument', 'description', 'website'
      ]) {
        expect(descriptor[field], `descriptor.${field}`).toBeDefined()
      }
      for (const kind of ['Audio', 'Midi', 'Sysex', 'Osc', 'Mpe', 'Automation']) {
        for (const direction of ['Input', 'Output']) {
          expect(typeof descriptor[`has${kind}${direction}`], `has${kind}${direction}`).toBe('boolean')
        }
      }
      expect(descriptor.apiVersion).toBe(WAM_API_VERSION)
    })

    it('describes the plugin the profile describes', () => {
      const { descriptor } = made.data
      expect(descriptor.identifier).toBe(CANONICAL)
      expect(descriptor.name).toBe('Pulse')
      expect(descriptor.isInstrument).toBe(true)
      expect(descriptor.hasMidiInput).toBe(true)
      expect(descriptor.hasAudioOutput).toBe(true)
      expect(descriptor.hasAudioInput).toBe(false)
    })

    it('does not call a continuous parameter an integer', () => {
      // The defect the first version of wamType shipped: cutoff is declared
      // 100 to 18000 Hz, whole numbers both, and typing it `int` from that
      // would quantise it to 1 Hz steps in every WAM host.
      const cutoff = made.data.parameters.find(p => p.id === 'cutoff')
      expect(cutoff.type).toBe('float')
      expect(cutoff.units).toBe('Hz')
      const waveform = made.data.parameters.find(p => p.id === 'waveform')
      expect(waveform.type).toBe('choice')
      expect(waveform.choices).toEqual(['Saw', 'Square', 'Triangle'])
    })
  })

  describe('the package', () => {
    it('is a standalone ES module reaching no node builtin', async () => {
      // It is loaded into somebody else's page. The web bundle needs two shims
      // for `stream` and `util` because it reaches an RDF parser; this must not,
      // which is the whole reason the profile is resolved at build time.
      const source = await readFile(join(out, 'index.js'), 'utf8')
      expect(source).not.toMatch(/require\(["']node:|from ["'](stream|util|fs|path)["']/)
      expect(source).toContain('isWebAudioModuleConstructor')
    })

    it('carries the digests, which the WAM API has no way to express', async () => {
      const source = await readFile(join(out, 'index.js'), 'utf8')
      const profileText = await readFile(join(pluginDir, 'profile.ttl'), 'utf8')
      const digests = [...profileText.matchAll(/"(sha384-[^"]+)"/g)].map(m => m[1])
      expect(digests.length).toBeGreaterThan(1)
      for (const digest of digests) expect(source, digest).toContain(digest)
    })
  })

  describe('loading it', () => {
    const load = async (data = made.data) => {
      const context = new OfflineContext({ sampleRate: 48000 })
      const Module = webAudioModule(data, {
        fetch: directoryFetch({ [CANONICAL]: out }),
        AudioWorkletNode: OfflineWorkletNode,
        // node has Blob and URL.createObjectURL but cannot import a blob: URL,
        // so the harness is handed a file URL instead, exactly as
        // tests/host/integration.test.js does. It is the injection point
        // Instantiate.js already offers and it skips no verification: the bytes
        // have already passed it, and this file is those bytes.
        processorUrl: () => pathToFileURL(join(out, 'pulse-processor.js')).href
      })
      expect(Module.isWebAudioModuleConstructor).toBe(true)
      const wam = await Module.createInstance('test-group', context)
      return { wam, context }
    }

    it('instantiates through the WAM entry point and reports itself', async () => {
      const { wam } = await load()
      expect(wam.isWebAudioModule).toBe(true)
      expect(wam.initialized).toBe(true)
      expect(wam.name).toBe('Pulse')
      expect(wam.groupId).toBe('test-group')
      expect(wam.moduleId).toBe(CANONICAL)
      expect(wam.audioNode).toBeTruthy()
    }, 20000)

    it('answers getParameterInfo with usable conversions', async () => {
      const { wam } = await load()
      const info = await wam.audioNode.getParameterInfo()
      expect(Object.keys(info).sort()).toEqual(['attack', 'cutoff', 'gain', 'release', 'waveform'])
      const gain = info.gain
      expect(gain.normalize(gain.maxValue)).toBe(1)
      expect(gain.denormalize(0)).toBe(gain.minValue)
      expect(info.waveform.valueString(1)).toBe('Square')
      expect(info.cutoff.valueString(6000)).toBe('6000 Hz')
    }, 20000)

    it('sets a parameter through the WAM interface and reads it back', async () => {
      const { wam } = await load()
      await wam.audioNode.setParameterValues({ gain: { id: 'gain', value: 1, normalized: true } })
      await Promise.resolve()
      const values = await wam.audioNode.getParameterValues(false, 'gain')
      // Normalised 1 over a 0..1 range is 1. The round trip is what matters:
      // WAM speaks normalised, an AudioParam does not.
      expect(values.gain.value).toBe(1)
    }, 20000)

    it('makes a sound when a WAM host schedules a note', async () => {
      // The whole claim, end to end: a wam-midi event goes in through the WAM
      // interface and Pulse's WebAssembly produces audio. Nothing is stubbed
      // between scheduleEvents and process().
      const { wam, context } = await load()
      const node = wam.audioNode

      const silent = node.render()
      expect(Math.max(...silent[0].map(Math.abs))).toBe(0)

      node.scheduleEvents({ type: 'wam-midi', time: context.currentTime, data: { bytes: [0x90, 60, 100] } })
      // The harness delivers on a microtask, as a real MessagePort does, so
      // nothing can accidentally depend on synchronous delivery. A host that
      // rendered immediately would be testing its own impatience.
      await Promise.resolve()

      let peak = 0
      for (let block = 0; block < 40; block++) {
        for (const channel of node.render()) {
          for (const sample of channel) peak = Math.max(peak, Math.abs(sample))
        }
      }
      expect(peak, 'a note on through the WAM interface produced no audio').toBeGreaterThan(0.01)
    }, 20000)

    it('refuses a tampered module rather than instantiating it', async () => {
      // Integrity survives the translation. A WAM host cannot ask for this and
      // gets it anyway, which is the one thing this packaging adds rather than
      // preserves.
      const tampered = { ...made.data, profile: { ...made.data.profile,
        module: { ...made.data.profile.module, integrity: 'sha384-' + 'A'.repeat(64) } } }
      await expect(load(tampered)).rejects.toThrow(/verification|integrity|digest/i)
    }, 20000)
  })

  describe('what it refuses', () => {
    it('refuses a plugin with no version, because WAM requires one', async () => {
      const dir = await mkdtemp(join(tmpdir(), 'jig-noversion-'))
      const text = (await readFile(join(pluginDir, 'profile.ttl'), 'utf8'))
        .replace(/\n\s*doap:revision "[^"]*" ;/, '')
      const { writeFile } = await import('node:fs/promises')
      await writeFile(join(dir, 'profile.ttl'), text)
      await expect(writeWamPackage(dir, join(dir, 'wam'))).rejects.toThrow(/doap:revision/)
    })
  })
})

describe('the interface, against the WAM API package itself', () => {
  // Read off @webaudiomodules/api's own type definitions, rather than against
  // this file's memory of them, and checked on an instantiated node rather than
  // by grepping the source. The first version of this test grepped, and passed
  // for members that were only inherited from EventTarget, which the offline
  // node is not. Skips loudly where the checkout is absent, because a guard that
  // cannot run must say so rather than look like coverage.
  const api = resolve(process.env.HOME ?? '', 'github/api/src/types.d.ts')
  const present = existsSync(api) && built

  it('implements every WamNode member the API declares', async () => {
    if (!present) {
      expect(present, 'no @webaudiomodules/api at ~/github/api, or the plugin is unbuilt').toBe(false)
      return
    }
    const types = await readFile(api, 'utf8')
    const block = types.slice(types.indexOf('export interface WamNode'), types.indexOf('export const WamNode'))
    const declared = [...new Set([...block.matchAll(/^\s{4}(?:readonly )?(\w+)\s*[(:<]/gm)].map(m => m[1]))]
    expect(declared.length, 'read no members off the API, so this checked nothing').toBeGreaterThan(8)

    const validator = await shapeValidatorFromFile(resolve(root, 'vocabs/shapes.ttl'))
    const dir = await mkdtemp(join(tmpdir(), 'jig-wam-api-'))
    const { data } = await writeWamPackage(pluginDir, dir, { validator })
    const context = new OfflineContext({ sampleRate: 48000 })
    const wam = await webAudioModule(data, {
      fetch: directoryFetch({ [CANONICAL]: dir }),
      AudioWorkletNode: OfflineWorkletNode,
      processorUrl: () => pathToFileURL(join(dir, 'pulse-processor.js')).href
    }).createInstance('api-check', context)

    const missing = declared.filter(member => wam.audioNode[member] === undefined)
    expect(missing, `WamNode members absent from the node: ${missing.join(', ')}`).toEqual([])
  }, 30000)

  it('implements every WebAudioModule member the API declares', async () => {
    if (!present) {
      expect(present, 'no @webaudiomodules/api at ~/github/api, or the plugin is unbuilt').toBe(false)
      return
    }
    const types = await readFile(api, 'utf8')
    const block = types.slice(types.indexOf('export interface WebAudioModule'), types.indexOf('export const WebAudioModule'))
    const declared = [...new Set([...block.matchAll(/^\s{4}(?:readonly )?(\w+)\s*[(:<?]/gm)].map(m => m[1]))]
    expect(declared.length).toBeGreaterThan(8)

    const validator = await shapeValidatorFromFile(resolve(root, 'vocabs/shapes.ttl'))
    const dir = await mkdtemp(join(tmpdir(), 'jig-wam-api2-'))
    const { data } = await writeWamPackage(pluginDir, dir, { validator })
    const context = new OfflineContext({ sampleRate: 48000 })
    const wam = await webAudioModule(data, {
      fetch: directoryFetch({ [CANONICAL]: dir }),
      AudioWorkletNode: OfflineWorkletNode,
      processorUrl: () => pathToFileURL(join(dir, 'pulse-processor.js')).href
    }).createInstance('api-check', context)

    const missing = declared.filter(member => wam[member] === undefined)
    expect(missing, `WebAudioModule members absent: ${missing.join(', ')}`).toEqual([])
  }, 30000)
})
