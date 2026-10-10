// tests/host/moka.test.js
//
// Moka through the real loader and engine, rendering real audio offline. What is checked is what
// the VST3's notes say it does: a note starts from exact silence and ramps in, a MIDI event lands
// on its own sample, a voice cap steals the oldest, Release chokes a tail, Tone darkens, and the
// per-channel pitch bend that Retune sends moves a ringing note. The last test runs the two
// plugins together, Retune into Moka, and checks the pitch that results.
import { describe, it, expect, beforeAll } from 'vitest'
import { resolve } from 'node:path'
import { PluginLoader } from '../../src/host/PluginLoader.js'
import { shapeValidatorFromFile } from '../../src/validate/files.js'
import { parseText } from '../../src/rdf/parse.js'
import { detectCapabilities } from '../../src/host/Capabilities.js'
import { Engine } from '../../src/engine/Engine.js'
import { OfflineContext, OfflineWorkletNode, sitePlugins } from '../../src/testing/OfflineHost.js'

const root = resolve(import.meta.dirname, '../..')
const ORIGIN = 'https://strandz.it/jigdaw/'
const CANONICAL = `${ORIGIN}plugins/moka/`
const SAMPLE_RATE = 48000
const settle = () => new Promise(resolve => setTimeout(resolve, 0))

function makeEngine (validator) {
  const site = sitePlugins(ORIGIN, resolve(root, 'plugins'))
  const context = new OfflineContext({ sampleRate: SAMPLE_RATE })
  const loader = new PluginLoader({
    fetch: site.fetch, parse: parseText, validator,
    capabilities: detectCapabilities({}), processorUrl: site.processorUrl
  })
  const engine = new Engine({ context, loader, AudioWorkletNode: OfflineWorkletNode })
  engine.testLoader = loader
  return engine
}

async function load (validator, settings = {}) {
  const engine = makeEngine(validator)
  const entry = await engine.addPlugin(CANONICAL)
  for (const [symbol, value] of Object.entries(settings)) engine.setParameter(entry.id, symbol, value)
  return { engine, entry, node: entry.node }
}

/** Post MIDI at frame offsets from now, render `blocks` quanta, return the two channels joined. */
async function play (node, messages, blocks) {
  node.port.postMessage({
    type: 'events',
    events: messages.map(([offset, ...bytes]) => ({ frame: node.frame + offset, bytes: Uint8Array.from(bytes) }))
  })
  await settle()
  const left = new Float32Array(blocks * 128)
  const right = new Float32Array(blocks * 128)
  for (let b = 0; b < blocks; b++) {
    const out = node.render()
    left.set(out[0], b * 128)
    right.set(out[1], b * 128)
  }
  return { left, right }
}

const energy = (samples, from = 0, to = samples.length) => {
  let sum = 0
  for (let i = from; i < to; i++) sum += samples[i] * samples[i]
  return Math.sqrt(sum / (to - from))
}
const maxStep = (samples, from, to) => {
  let worst = 0
  for (let i = from + 1; i < to; i++) worst = Math.max(worst, Math.abs(samples[i] - samples[i - 1]))
  return worst
}
const roughness = samples => { let sum = 0; for (let i = 1; i < samples.length; i++) sum += (samples[i] - samples[i - 1]) ** 2; return sum / energy(samples) ** 2 / samples.length }

describe('moka, a modal MIDI synth', () => {
  let validator
  beforeAll(async () => { validator = await shapeValidatorFromFile(resolve(root, 'vocabs/shapes.ttl')) })

  it('declares an instrument: MIDI in, stereo audio out, no module', async () => {
    const { engine } = await load(validator)
    const { profile } = await engine.testLoader.loadProfile(CANONICAL)
    expect(profile.label).toBe('Moka')
    expect(profile.module).toBeNull()
    expect(profile.requires).toContain('http://purl.org/stuff/jigdaw/MidiEvents')
    expect(profile.audioInputs).toBe(0)
    expect(profile.audioOutputs).toBe(1)
    expect(profile.outputChannels).toBe(2)
  })

  it('binds the processor descriptors to the profile ports', async () => {
    const { engine, node } = await load(validator)
    const { profile } = await engine.testLoader.loadProfile(CANONICAL)
    const descriptors = node.processor.constructor.parameterDescriptors
    expect(descriptors.map(d => d.name).sort()).toEqual(profile.ports.map(p => p.symbol).sort())
    for (const port of profile.ports) {
      const d = descriptors.find(x => x.name === port.symbol)
      expect([d.defaultValue, d.minValue, d.maxValue]).toEqual([port.defaultValue, port.minimum, port.maximum])
    }
  })

  it('is exactly silent until a note arrives', async () => {
    const { node } = await load(validator)
    const { left, right } = await play(node, [], 40)
    expect(left.every(v => v === 0) && right.every(v => v === 0)).toBe(true)
  })

  it('starts a note on its own sample, from exact silence, with no click', async () => {
    const { node } = await load(validator, { instrument: 4, mallet: 1 }) // the hardest beater on the brightest plate
    const { left, right } = await play(node, [[200, 0x90, 60, 127]], 60)
    expect(left.subarray(0, 200).every(v => v === 0)).toBe(true)
    expect(right.subarray(0, 200).every(v => v === 0)).toBe(true)
    expect(energy(left, 200, 4000)).toBeGreaterThan(0.01)
    // The raised-cosine onset: the first sound is far below the note's level, and no step is a pop.
    expect(Math.abs(left[200])).toBeLessThan(0.001)
    const peak = Math.max(...left.subarray(200, 4000).map(Math.abs))
    expect(maxStep(left, 200, 4000)).toBeLessThan(0.5 * peak)
    expect(left.every(Number.isFinite)).toBe(true)
  })

  it('applies a late event at once rather than dropping it', async () => {
    const { node } = await load(validator)
    await play(node, [], 4) // the stream is already past frame 0
    const { left } = await play(node, [[-300, 0x90, 60, 100]], 20)
    expect(energy(left)).toBeGreaterThan(0.01)
  })

  it('applies events in frame order even when they arrive out of order', async () => {
    // A note-off before its note-on, by frame, posted the other way round: the note must still sound
    // between them, not be released before it starts.
    const { node } = await load(validator, { release: 0, instrument: 3 })
    const { left } = await play(node, [[100, 0x80, 60, 0], [10, 0x90, 60, 100]], 3)
    expect(left.subarray(0, 10).every(v => v === 0)).toBe(true)
    expect(energy(left, 10, 100)).toBeGreaterThan(0)
    // Released at sample 100 with the shortest release, so by 40 ms later it has gone quiet.
    const { left: later } = await play(node, [], 30)
    expect(energy(later, 1800, 3840)).toBeLessThan(0.2 * energy(left, 20, 100))
  })

  it('rings out on its own, chokes on note-off, and a short Release is shorter than a long one', async () => {
    const tail = async release => {
      const { node } = await load(validator, { instrument: 3, release, decay: 1 }) // a glass bowl rings for seconds
      await play(node, [[0, 0x90, 60, 100]], 100)
      const { left } = await play(node, [[0, 0x80, 60, 0]], 400) // 1.07 s after the release
      return { held: energy(left, 0, 128), late: energy(left, left.length - 2000), node }
    }
    const short = await tail(0)
    const long = await tail(1)
    expect(short.late).toBeLessThan(long.late)
    expect(short.late).toBeLessThan(1e-4)
    expect(long.late).toBeGreaterThan(1e-3)
  })

  it('frees the voice once a released tail has died away, and goes back to exact silence', async () => {
    const { node } = await load(validator, { instrument: 2, decay: 0, release: 0 }) // a woodblock, shortest everything
    await play(node, [[0, 0x90, 72, 100], [128, 0x80, 72, 0]], 4)
    const { left, right } = await play(node, [], 700)
    expect(node.processor.activeVoiceCount()).toBe(0)
    expect(left.subarray(left.length - 256).every(v => v === 0) && right.subarray(right.length - 256).every(v => v === 0)).toBe(true)
  })

  it('caps polyphony at Voices, stealing the oldest, and a repeated note retriggers rather than doubling', async () => {
    const { node } = await load(validator, { voices: 2, instrument: 3 })
    await play(node, [[0, 0x90, 60, 100], [200, 0x90, 64, 100], [400, 0x90, 67, 100]], 6)
    expect(node.processor.activeVoiceCount()).toBe(2)
    expect(node.processor.voices.filter(v => v.active).map(v => v.note).sort()).toEqual([64, 67]) // 60 was the oldest
    await play(node, [[0, 0x90, 67, 100]], 2)
    expect(node.processor.activeVoiceCount()).toBe(2)
    expect(node.processor.voices.filter(v => v.active && v.note === 67)).toHaveLength(1)
  })

  it('plays all six instruments to finite, bounded, distinct audio', async () => {
    const rendered = []
    for (let instrument = 0; instrument < 6; instrument++) {
      const { node } = await load(validator, { instrument })
      const { left, right } = await play(node, [[0, 0x90, 64, 100]], 120)
      expect(left.every(Number.isFinite) && right.every(Number.isFinite)).toBe(true)
      expect(Math.max(...left.map(Math.abs), ...right.map(Math.abs))).toBeLessThanOrEqual(1)
      expect(energy(left)).toBeGreaterThan(0.005)
      rendered.push(left)
    }
    for (let i = 0; i < 6; i++) for (let j = i + 1; j < 6; j++) expect(Array.from(rendered[i].subarray(0, 2000))).not.toEqual(Array.from(rendered[j].subarray(0, 2000)))
  })

  it('renders the same audio for the same notes, and louder for a harder hit and a higher Level', async () => {
    const take = async (settings, velocity) => {
      const { node } = await load(validator, settings)
      return (await play(node, [[0, 0x90, 60, velocity]], 60)).left
    }
    const a = await take({}, 100)
    const b = await take({}, 100)
    expect(Array.from(a)).toEqual(Array.from(b))
    expect(energy(await take({}, 120))).toBeGreaterThan(energy(await take({}, 30)))
    expect(energy(await take({ level: 1 }, 100))).toBeGreaterThan(energy(await take({ level: 0.3 }, 100)))
    expect((await take({ level: 0 }, 100)).every(v => v === 0)).toBe(true)
  })

  it('darkens with Tone, and spreads partials across the stereo field with Width', async () => {
    const bright = await load(validator, { instrument: 4, tone: 1 })
    const dark = await load(validator, { instrument: 4, tone: 0 })
    const b = (await play(bright.node, [[0, 0x90, 72, 100]], 60)).left
    const d = (await play(dark.node, [[0, 0x90, 72, 100]], 60)).left
    expect(roughness(d)).toBeLessThan(roughness(b))

    const spread = async width => {
      const { node } = await load(validator, { instrument: 4, width })
      const { left, right } = await play(node, [[0, 0x90, 60, 100]], 60)
      let diff = 0
      for (let i = 0; i < left.length; i++) diff += (left[i] - right[i]) ** 2
      return Math.sqrt(diff / left.length) / energy(left)
    }
    expect(await spread(1)).toBeGreaterThan(2 * await spread(0))
  })

  it('moves a ringing note with its channel pitch bend, over the range RPN 0 sets', async () => {
    const { node } = await load(validator)
    await play(node, [[0, 0x90, 60, 100]], 4)
    const voice = node.processor.voices.find(v => v.active)
    const settled = voice.increment[0]
    await play(node, [[0, 0xe0, 0x7f, 0x7f]], 1) // full up, default range 2 semitones
    expect(voice.increment[0] / settled).toBeCloseTo(Math.pow(2, 2 / 12), 3)

    // RPN 0 data 12 on that channel: the same bend is now an octave.
    await play(node, [[0, 0xb0, 101, 0], [0, 0xb0, 100, 0], [0, 0xb0, 6, 12]], 1)
    expect(voice.increment[0] / settled).toBeCloseTo(2, 2)

    // Another channel is not bent, and a note on it sounds at its own pitch.
    await play(node, [[0, 0x91, 60, 100]], 2)
    const other = node.processor.voices.find(v => v.active && v.channel === 1)
    expect(other.increment[0]).toBeCloseTo(settled, 6)
  })

  it('releases everything on CC 123 and CC 120', async () => {
    for (const cc of [120, 123]) {
      const { node } = await load(validator, { release: 0, instrument: 2, decay: 0 })
      await play(node, [[0, 0x90, 60, 100], [0, 0x90, 64, 100]], 4)
      await play(node, [[0, 0xb0, cc, 0]], 700)
      expect(node.processor.activeVoiceCount()).toBe(0)
    }
  })

  it('takes the pitch Retune sends it, end to end', async () => {
    const engine = makeEngine(validator)
    const retune = await engine.addPlugin(`${ORIGIN}plugins/retune/`)
    const moka = await engine.addPlugin(CANONICAL)
    const scl = await (await import('node:fs/promises')).readFile(resolve(root, 'plugins/retune/scales/19-edo.scl'))
    retune.node.port.postMessage({ type: 'loadAsset', key: 'scl', bytes: scl.buffer.slice(scl.byteOffset, scl.byteOffset + scl.byteLength) })
    await settle()

    retune.node.port.postMessage({ type: 'events', events: [{ frame: 0, bytes: Uint8Array.of(0x90, 61, 100) }] })
    await settle()
    const before = retune.node.processor.port.posted.length
    retune.node.render()
    await settle()
    const events = retune.node.processor.port.posted.slice(before).filter(m => m.type === 'events').flatMap(m => m.events)
    expect(events).toHaveLength(2) // the bend, then the note

    moka.node.port.postMessage({ type: 'events', events: events.map(e => ({ frame: e.frame, bytes: e.bytes })) })
    await settle()
    moka.node.render()
    const voice = moka.node.processor.voices.find(v => v.active)
    // Degree 1 of 19-EDO above middle C: 63.16 cents.
    const hertz = 440 * Math.pow(2, (60 - 69) / 12 + 1200 / 19 / 1200)
    const sounding = (voice.increment[0] * SAMPLE_RATE) / 1 // the fundamental's ratio is 1 for every instrument
    expect(Math.abs(1200 * Math.log2(sounding / hertz))).toBeLessThan(0.5) // within half a cent
  })
})
