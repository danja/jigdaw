// tests/bin/juce-params-to-profile.test.js
//
// The mapping from a JUCE parameter dump to a port, a C++ switch and a JS
// processor snippet, checked directly: bin/juce-params-to-profile.js's own
// header explains why nothing here should disagree with the profile it
// writes, and that claim is only as good as this test.
import { describe, it, expect } from 'vitest'
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  toSymbol, toPort, toCppSwitch, toProcessorSnippet, mergeIntoProfile
} from '../../bin/juce-params-to-profile.js'

describe('toSymbol', () => {
  it('leaves an id that is already a legal lv2:symbol unchanged', () => {
    expect(toSymbol('gain')).toBe('gain')
    expect(toSymbol('cutoff_hz')).toBe('cutoff_hz')
  })

  it('replaces a character vocabs/shapes.ttl\'s pattern refuses', () => {
    // ^[a-zA-Z_][a-zA-Z0-9_]*$
    expect(toSymbol('drive-amount')).toBe('drive_amount')
    expect(toSymbol('mix%')).toBe('mix_')
  })

  it('prefixes an id starting with a digit, which the pattern also refuses', () => {
    expect(toSymbol('1oscillator')).toBe('_1oscillator')
  })
})

describe('toPort', () => {
  it('maps a float parameter straight through', () => {
    expect(toPort({ id: 'gain', name: 'Gain', type: 'float', minimum: 0, maximum: 2, default: 1 }, 0))
      .toEqual({ symbol: 'gain', name: 'Gain', paramIndex: 0, default: 1, minimum: 0, maximum: 2 })
  })

  it('maps an int parameter the same way a float is mapped', () => {
    expect(toPort({ id: 'voices', name: 'Voices', type: 'int', minimum: 1, maximum: 16, default: 4 }, 1))
      .toEqual({ symbol: 'voices', name: 'Voices', paramIndex: 1, default: 4, minimum: 1, maximum: 16 })
  })

  it('maps a bool parameter to a toggled 0..1 port', () => {
    expect(toPort({ id: 'bypass', name: 'Bypass', type: 'bool', default: true }, 2))
      .toEqual({ symbol: 'bypass', name: 'Bypass', paramIndex: 2, default: 1, minimum: 0, maximum: 1, toggled: true })
    expect(toPort({ id: 'bypass', name: 'Bypass', type: 'bool', default: false }, 2).default).toBe(0)
  })

  it('maps a choice parameter to an enumerated port with scale points', () => {
    const port = toPort({ id: 'mode', name: 'Mode', type: 'choice', default: 1, choices: ['Plate', 'Hall', 'Bloom'] }, 3)
    expect(port).toEqual({
      symbol: 'mode', name: 'Mode', paramIndex: 3, default: 1, minimum: 0, maximum: 2,
      scalePoints: [{ label: 'Plate', value: 0 }, { label: 'Hall', value: 1 }, { label: 'Bloom', value: 2 }]
    })
  })

  it('maps a parameter with no declared range to a plain 0..1 port', () => {
    expect(toPort({ id: 'custom', name: 'Custom', type: 'normalised', default: 0.5 }, 4))
      .toEqual({ symbol: 'custom', name: 'Custom', paramIndex: 4, default: 0.5, minimum: 0, maximum: 1 })
  })
})

describe('toCppSwitch', () => {
  it('generates one case per parameter, in order, typed by kind', () => {
    const params = [
      { id: 'gain', type: 'float' },
      { id: 'voices', type: 'int' },
      { id: 'bypass', type: 'bool' },
      { id: 'mode', type: 'choice' }
    ]
    const code = toCppSwitch(params)
    expect(code).toContain('case 0: gain = value; break;')
    expect(code).toContain('case 1: voices = static_cast<int>(value); break;')
    expect(code).toContain('case 2: bypass = value >= 0.5f; break;')
    expect(code).toContain('case 3: mode = static_cast<int>(value); break;')
  })
})

describe('toProcessorSnippet', () => {
  it('generates PARAM_INDEX and parameterDescriptors agreeing with each other\'s order', () => {
    const params = [
      { id: 'gain', name: 'Gain', type: 'float', minimum: 0, maximum: 2, default: 1 },
      { id: 'bypass', name: 'Bypass', type: 'bool', default: false }
    ]
    const snippet = toProcessorSnippet(params)
    expect(snippet).toContain('Object.freeze({ gain: 0, bypass: 1 })')
    expect(snippet).toContain("{ name: 'gain', defaultValue: 1, minValue: 0, maxValue: 2, automationRate: 'k-rate' }")
    expect(snippet).toContain("{ name: 'bypass', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate' }")
  })
})

describe('mergeIntoProfile', () => {
  it('replaces ports and keeps every other field untouched', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'jigdaw-juce-params-'))
    const path = join(dir, 'profile.json')
    await writeFile(path, JSON.stringify({ label: 'Test', ports: [{ symbol: 'old' }], vendor: 'someone' }))

    await mergeIntoProfile(path, [{ symbol: 'gain', name: 'Gain', paramIndex: 0, default: 1, minimum: 0, maximum: 2 }])

    const written = JSON.parse(await readFile(path, 'utf8'))
    expect(written.label).toBe('Test')
    expect(written.vendor).toBe('someone')
    expect(written.ports).toEqual([{ symbol: 'gain', name: 'Gain', paramIndex: 0, default: 1, minimum: 0, maximum: 2 }])

    await rm(dir, { recursive: true })
  })
})
