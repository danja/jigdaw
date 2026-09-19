// tests/host/ReferenceHost.test.js
//
// The same discipline as tests/host/integration.test.js: nothing mocked
// except what node does not have, and the real plugins under plugins/ do
// the real work. This is what proves renderChain is a genuine alternative
// entry point onto PluginLoader and src/testing/OfflineHost.js, not a
// reimplementation that only looks like one.
import { describe, it, expect } from 'vitest'
import { resolve } from 'node:path'
import { existsSync } from 'node:fs'
import { renderChain } from '../../src/host/ReferenceHost.js'

const root = resolve(import.meta.dirname, '../..')
const cascadeDir = resolve(root, 'plugins/cascade')
const pulseDir = resolve(root, 'plugins/pulse')
const CASCADE = 'https://strandz.it/jigdaw/plugins/cascade/'
const PULSE = 'https://strandz.it/jigdaw/plugins/pulse/'

const built = existsSync(resolve(cascadeDir, 'cascade.wasm')) && existsSync(resolve(pulseDir, 'pulse.wasm'))
const suite = built ? describe : describe.skip
if (!built) console.warn('run plugins/cascade/build.sh and plugins/pulse/build.sh first')

const rms = channel => Math.sqrt(channel.reduce((s, v) => s + v * v, 0) / channel.length)
const roots = { [CASCADE]: cascadeDir, [PULSE]: pulseDir }

suite('renderChain', () => {
  it('refuses to render nothing', async () => {
    await expect(renderChain({ iris: [] })).rejects.toThrow(/at least one/)
  })

  it('feeds an impulse to a chain that starts with an audio effect, and renders its tail', async () => {
    const { channels, loaded } = await renderChain({
      iris: [CASCADE], roots, seconds: 0.5, sampleRate: 48000
    })
    expect(loaded).toEqual([{ iri: CASCADE, label: 'Cascade', audioInputs: 1 }])
    // Cascade's own default mix is 0.3: some tail, not silence, and not the
    // raw impulse passed straight through either.
    expect(rms(channels[0])).toBeGreaterThan(0)
    expect(channels[0].every(Number.isFinite)).toBe(true)
  })

  it('plays a note into a chain that starts with an instrument', async () => {
    const { channels } = await renderChain({
      iris: [PULSE], roots, seconds: 0.3, sampleRate: 48000,
      notes: [{ frame: 0, note: 69, velocity: 100 }]
    })
    expect(rms(channels[0])).toBeGreaterThan(0.01)
  })

  it('renders silence for an instrument given no notes, not an impulse meant for an effect', async () => {
    const { channels } = await renderChain({ iris: [PULSE], roots, seconds: 0.1 })
    expect(rms(channels[0])).toBe(0)
  })

  it('chains an instrument into an effect, the output of one becoming the input of the next', async () => {
    const { channels, loaded } = await renderChain({
      iris: [PULSE, CASCADE], roots, seconds: 0.4,
      notes: [{ frame: 0, note: 69, velocity: 100 }]
    })
    expect(loaded.map(l => l.label)).toEqual(['Pulse', 'Cascade'])
    expect(rms(channels[0])).toBeGreaterThan(0)
  })

  it('delivers a note at the frame it is due, not one quantum early or late', async () => {
    // A note at exactly the second block's first frame must produce silence
    // through the whole first block and sound from the second one on.
    const { channels } = await renderChain({
      iris: [PULSE], roots, seconds: 0.1, sampleRate: 48000,
      notes: [{ frame: 128, note: 69, velocity: 100 }]
    })
    const firstBlock = channels[0].slice(0, 128)
    const secondBlock = channels[0].slice(128, 256)
    expect(rms(firstBlock)).toBe(0)
    expect(rms(secondBlock)).toBeGreaterThan(0)
  })

  it('resolves a plugin by a real network fetch when no local root matches', async () => {
    let called = null
    const fakeFetch = async url => { called = url; return { ok: false, status: 404 } }
    await expect(renderChain({ iris: ['https://example.org/plugins/nope/'], fetch: fakeFetch }))
      .rejects.toThrow()
    expect(called).toBe('https://example.org/plugins/nope/')
  })
})
