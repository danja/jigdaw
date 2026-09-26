// tests/rdf/ProfileReader.test.js
import { describe, it, expect, beforeAll } from 'vitest'
import { resolve } from 'node:path'
import { parseTurtleFile as parseTurtle } from '../../src/validate/files.js'
import { readProfile, findSubject, widgetFor, resolveLocation } from '../../src/rdf/ProfileReader.js'

const root = resolve(import.meta.dirname, '../..')
const at = p => resolve(root, p)

describe('readProfile', () => {
  let profile
  beforeAll(async () => {
    profile = readProfile(await parseTurtle(at('examples/reference-profile.ttl'), 'urn:test'))
  })

  it('reads identity and musical semantics', () => {
    expect(profile.iri).toBe('https://example.org/plugins/reference/')
    expect(profile.label).toBe('Reference')
    expect(profile.vendor).toBe('example')
    expect(profile.roles).toEqual(['http://purl.org/stuff/transmissions/AudioEffect'])
    expect(profile.accepts).toEqual(['http://purl.org/stuff/transmissions/Audio'])
    expect(profile.produces).toEqual(['http://purl.org/stuff/transmissions/Audio'])
    expect(profile.genres).toContain('Ambient')
    expect(profile.cautions).toHaveLength(1)
  })

  it('reads the runtime shape', () => {
    expect(profile.audioInputs).toBe(1)
    expect(profile.audioOutputs).toBe(1)
    expect(profile.outputChannels).toBe(2)
    expect(profile.renderQuantum).toBe(128)
    expect(profile.latencyFrames).toBe(0)
    expect(profile.tailFrames).toBe(441000)
  })

  it('separates what is required from what is merely preferred', () => {
    // The host refuses a plugin whose requirement it cannot meet, and passes a
    // preference through so the plugin picks its own fallback.
    expect(profile.requires).toEqual(['http://purl.org/stuff/jigdaw/Persistence'])
    expect(profile.prefers).toEqual(['http://purl.org/stuff/jigdaw/SharedMemory'])
  })

  it('resolves resource locations against the profile IRI', () => {
    // Relative locations are what make a plugin directory portable.
    expect(profile.processor.location).toBe('https://example.org/plugins/reference/reference-processor.js')
    expect(profile.module.location).toBe('https://example.org/plugins/reference/reference.wasm')
    expect(profile.processor.registeredName).toBe('reference')
    expect(profile.module.wasmFeatures).toContain('http://purl.org/stuff/jigdaw/Simd128')
    expect(profile.assets).toHaveLength(1)
  })

  it('carries an integrity digest on every resource', () => {
    for (const r of [profile.module, profile.processor, profile.ui, ...profile.assets]) {
      expect(r.integrity, `${r.iri} has no digest`).toMatch(/^sha(256|384|512)-/)
    }
  })

  it('reads ports with their ranges and units', () => {
    const size = profile.ports.find(p => p.symbol === 'size')
    expect(size.name).toBe('Size')
    expect(size.defaultValue).toBe(24)
    expect(size.minimum).toBe(2)
    expect(size.maximum).toBe(60)
    expect(size.unit).toBe('http://lv2plug.in/ns/extensions/units#ms')
  })

  it('derives the automation rate, defaulting to k-rate', () => {
    expect(profile.ports.find(p => p.symbol === 'mix').automationRate).toBe('a-rate')
    expect(profile.ports.find(p => p.symbol === 'size').automationRate).toBe('k-rate')
  })

  it('reads no controller where the profile binds none', () => {
    // Absent means no claim: a port the profile does not bind answers to no
    // controller, and the reader must not invent one.
    for (const port of profile.ports) expect(port.controller, port.symbol).toBeNull()
  })

  it('reads a bound controller number off the port\'s binding', async () => {
    const { parseText } = await import('../../src/rdf/parse.js')
    const dataset = await parseText([
      '@prefix jig: <http://purl.org/stuff/jigdaw/> .',
      '@prefix lv2: <http://lv2plug.in/ns/lv2core#> .',
      '@prefix midi: <http://lv2plug.in/ns/ext/midi#> .',
      '<> a jig:WebPlugin ; lv2:port <#mix> .',
      '<#mix> a lv2:InputPort , lv2:ControlPort ;',
      '  lv2:symbol "mix" ; lv2:name "Mix" ;',
      '  lv2:default 1 ; lv2:minimum 0 ; lv2:maximum 1 ;',
      '  jig:controlGroup "Master" ;',
      '  midi:binding <#mix-cc> .',
      '<#mix-cc> a midi:Controller ; midi:controllerNumber 79 .'
    ].join('\n'), 'urn:test')
    const bound = readProfile(dataset).ports.find(p => p.symbol === 'mix')
    expect(bound.controller).toBe(79)
    expect(bound.group).toBe('Master')
  })
})

describe('widgetFor', () => {
  // Contract section 5.3. The shape of the declaration decides, never a name.
  const port = over => ({ toggled: false, enumeration: false, scalePoints: [], ...over })
  const points = n => Array.from({ length: n }, (_, i) => ({ label: `p${i}`, value: i }))

  it('makes a toggled port a switch', () => {
    expect(widgetFor(port({ toggled: true }))).toBe('switch')
  })

  it('makes a two-point enumeration a switch', () => {
    expect(widgetFor(port({ enumeration: true, scalePoints: points(2) }))).toBe('switch')
  })

  it('makes a larger enumeration a selector', () => {
    expect(widgetFor(port({ enumeration: true, scalePoints: points(3) }))).toBe('selector')
  })

  it('makes everything else a dial', () => {
    expect(widgetFor(port({}))).toBe('dial')
    // Scale points without lv2:enumeration are labels, not a closed choice.
    expect(widgetFor(port({ scalePoints: points(4) }))).toBe('dial')
  })
})

describe('findSubject', () => {
  it('refuses a document with no jig:WebPlugin', async () => {
    const ds = await parseTurtle(at('examples/counterexample-project.ttl'), 'urn:test')
    expect(() => findSubject(ds)).toThrow(/no jig:WebPlugin/)
  })
})

describe('resolveLocation', () => {
  it('resolves relative, absolute and cross-origin locations', () => {
    const base = 'https://example.org/plugins/reference/'
    expect(resolveLocation('p.js', base)).toBe('https://example.org/plugins/reference/p.js')
    expect(resolveLocation('ui/index.html', base)).toBe('https://example.org/plugins/reference/ui/index.html')
    expect(resolveLocation('/p.js', base)).toBe('https://example.org/p.js')
    expect(resolveLocation('https://cdn.example/p.js', base)).toBe('https://cdn.example/p.js')
  })
})

describe('rebaseLocation', () => {
  const canonical = 'https://jigdaw.example/plugins/cascade/'
  const mirror = 'http://127.0.0.1:8748/plugins/cascade/'

  it('follows the profile to where it was actually fetched from', async () => {
    const { rebaseLocation } = await import('../../src/rdf/ProfileReader.js')
    // Identity stays canonical; retrieval follows retrieval. Without this, only
    // the original origin could ever serve a plugin, and a local checkout, a
    // mirror or a staging host would all fetch from production.
    expect(rebaseLocation(`${canonical}cascade.wasm`, canonical, mirror))
      .toBe(`${mirror}cascade.wasm`)
  })

  it('leaves a location on another origin exactly as written', async () => {
    const { rebaseLocation } = await import('../../src/rdf/ProfileReader.js')
    // Not a relative reference. Its author meant that host.
    const cdn = 'https://cdn.example/shared/dsp.wasm'
    expect(rebaseLocation(cdn, canonical, mirror)).toBe(cdn)
  })

  it('does nothing when the profile is served from its own IRI', async () => {
    const { rebaseLocation } = await import('../../src/rdf/ProfileReader.js')
    expect(rebaseLocation(`${canonical}a.wasm`, canonical, canonical)).toBe(`${canonical}a.wasm`)
  })
})
