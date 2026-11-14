// tests/host/PluginAnalysis.test.js
//
// These checks prove the generic response helpers are actually measuring a
// plugin, not only computing formulas from a fixture. The pass-through EQ is a
// good demonstration because it should not change a tone's level in its default
// state.
import { describe, it, expect } from 'vitest'
import { resolve } from 'node:path'
import { existsSync } from 'node:fs'
import { measureToneGain, measureFrequencyResponse } from '../../src/host/PluginAnalysis.js'

const root = resolve(import.meta.dirname, '../..')
const OCTET = 'https://strandz.it/jigdaw/plugins/octet/'
const octetDir = resolve(root, 'plugins/octet')

const built = existsSync(resolve(octetDir, 'octet.wasm'))
const suite = built ? describe : describe.skip
if (!built) console.warn('run plugins/octet/build.sh first')

const roots = { [OCTET]: octetDir }

suite('measureToneGain', () => {
  it('reads a flat gain for a pass-through equalizer at a mid-band frequency', async () => {
    const result = await measureToneGain({
      iri: OCTET,
      roots,
      frequency: 1000,
      seconds: 0.2,
      sampleRate: 48000,
      amplitude: 0.5
    })
    expect(result.inputRms).toBeGreaterThan(0)
    expect(result.outputRms).toBeGreaterThan(0)
    expect(result.gainDb).toBeCloseTo(0, 1)
  })

  it('sweeps a list of frequencies and keeps the request order', async () => {
    const response = await measureFrequencyResponse({
      iri: OCTET,
      roots,
      frequencies: [50, 200, 1000, 8000],
      seconds: 0.2,
      sampleRate: 48000,
      amplitude: 0.5
    })
    expect(response.map(r => r.frequency)).toEqual([50, 200, 1000, 8000])
    for (const point of response) {
      expect(Number.isFinite(point.gainDb)).toBe(true)
    }
  })
})
