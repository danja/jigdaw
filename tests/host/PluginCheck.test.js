// tests/host/PluginCheck.test.js
//
// Same discipline as ReferenceHost.test.js: the real worked plugins do the
// real work, nothing mocked except what Node does not have.
import { describe, it, expect } from 'vitest'
import { resolve } from 'node:path'
import { existsSync } from 'node:fs'
import { checkPlugin, checkRenderBudget } from '../../src/host/PluginCheck.js'

const root = resolve(import.meta.dirname, '../..')
const cascadeDir = resolve(root, 'plugins/cascade')
const pulseDir = resolve(root, 'plugins/pulse')
const CASCADE = 'https://strandz.it/jigdaw/plugins/cascade/'
const PULSE = 'https://strandz.it/jigdaw/plugins/pulse/'

const built = existsSync(resolve(cascadeDir, 'cascade.wasm')) && existsSync(resolve(pulseDir, 'pulse.wasm'))
const suite = built ? describe : describe.skip
if (!built) console.warn('run plugins/cascade/build.sh and plugins/pulse/build.sh first')

const roots = { [CASCADE]: cascadeDir, [PULSE]: pulseDir }

suite('checkPlugin', () => {
  it('passes an instrument given a note it can respond to', async () => {
    const result = await checkPlugin({
      iris: [PULSE], roots, seconds: 0.3,
      notes: [{ frame: 0, note: 69, velocity: 100 }]
    })
    expect(result.ok).toBe(true)
    expect(result.checks).toMatchObject({ producesAudio: true, withinPeakBound: true, respondsToMidi: true })
    expect(result.silentPeak).toBe(0)
  })

  it('does not check MIDI response for an instrument given no notes: nothing to respond to', async () => {
    const result = await checkPlugin({ iris: [PULSE], roots, seconds: 0.1 })
    expect(result.checks.respondsToMidi).toBeNull()
    // Nothing was asked of it, so it produced nothing: correctly reported
    // as a failure of producesAudio, not silently passed.
    expect(result.checks.producesAudio).toBe(false)
    expect(result.ok).toBe(false)
  })

  it('does not check MIDI response for a chain starting with an effect', async () => {
    // Cascade takes ReferenceHost's own impulse since it starts the chain
    // and gets no notes; that answers "does it produce audio", not "does it
    // play MIDI", so respondsToMidi must not claim either.
    const result = await checkPlugin({ iris: [CASCADE], roots, seconds: 0.5 })
    expect(result.checks.respondsToMidi).toBeNull()
    expect(result.checks.producesAudio).toBe(true)
    expect(result.ok).toBe(true)
  })

  it('fails a peak bound a real plugin does not actually exceed, when set below its peak', async () => {
    const result = await checkPlugin({
      iris: [PULSE], roots, seconds: 0.3,
      notes: [{ frame: 0, note: 69, velocity: 100 }],
      peakBound: 1e-9
    })
    expect(result.checks.withinPeakBound).toBe(false)
    expect(result.ok).toBe(false)
  })

  it('reports the chain it loaded, in order', async () => {
    const result = await checkPlugin({
      iris: [PULSE, CASCADE], roots, seconds: 0.4,
      notes: [{ frame: 0, note: 69, velocity: 100 }]
    })
    expect(result.loaded.map(l => l.label)).toEqual(['Pulse', 'Cascade'])
  })
})

suite('checkRenderBudget', () => {
  it('passes a real plugin comfortably, rendering far faster than real time', async () => {
    const result = await checkRenderBudget({ iris: [CASCADE], roots })
    expect(result.ok).toBe(true)
    expect(result.realTimeMultiple).toBeGreaterThanOrEqual(0)
    expect(result.realTimeMultiple).toBeLessThan(1) // an offline Node render, well under real time
  }, 20000)

  it('fails when the margin is set below what any render takes', async () => {
    // Not a claim about the plugin: proves the check can fail at all, rather
    // than a marginFactor that silently always passes.
    const result = await checkRenderBudget({ iris: [CASCADE], roots, marginFactor: 0 })
    expect(result.ok).toBe(false)
  }, 20000)
})
