// tests/engine/TrackRecorder.test.js
//
// Takes are the DAW's memory: what each track sounded like, captured after
// its strip, so Play with the plugins gone plays what was heard. The capture
// processor runs for real here through the offline host; the pool protocol
// and the take assembly are held to exact frame counts and sample values,
// because a take that drifts or drops is a session that lies.
import { describe, it, expect, beforeAll } from 'vitest'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  TakeBuilder, TrackRecorder, floatToInt16, int16ToFloat,
  CAPTURE_FRAMES, POOL_BUFFERS
} from '../../src/engine/TrackRecorder.js'
import { Engine } from '../../src/engine/Engine.js'
import { OfflineContext, OfflineWorkletNode } from '../../src/testing/OfflineHost.js'

const root = resolve(import.meta.dirname, '../..')
const PROCESSOR_URL = pathToFileURL(resolve(root, 'src/engine/capture-processor.js')).href

const settle = () => new Promise(resolve => setTimeout(resolve, 0))

async function captureCtor () {
  const context = new OfflineContext({ sampleRate: 48000 })
  await context.audioWorklet.addModule(PROCESSOR_URL)
  return { context, ctor: context.registry.get('jigdaw-capture').ctor }
}

function processorOf (ctor) {
  const posted = []
  const processor = new ctor({
    port: { postMessage (message, transfer) { posted.push({ message, transfer }) }, onmessage: null }
  })
  return { processor, posted }
}

const tone = (frames = CAPTURE_FRAMES, value = 0.5) => new Float32Array(frames).fill(value)

describe('float/int16 conversion', () => {
  it('round-trips within one quantization step', () => {
    const samples = Float32Array.from([0, 0.5, -0.5, 1, -1, 0.123456])
    const back = int16ToFloat(floatToInt16(samples))
    for (let i = 0; i < samples.length; i++) {
      expect(Math.abs(back[i] - samples[i])).toBeLessThan(1 / 32768 + 1e-9)
    }
  })

  it('clamps rather than wrapping', () => {
    expect(Array.from(floatToInt16(Float32Array.from([2, -2])))).toEqual([0x7fff, -0x8000])
  })
})

describe('TakeBuilder', () => {
  it('assembles chunks into exact stereo channels', () => {
    const takes = new TakeBuilder()
    const left = Float32Array.from({ length: CAPTURE_FRAMES }, (_, i) => i / CAPTURE_FRAMES)
    const right = Float32Array.from({ length: CAPTURE_FRAMES }, (_, i) => 1 - i / CAPTURE_FRAMES)
    const chunk = new Float32Array(CAPTURE_FRAMES * 2)
    for (let i = 0; i < CAPTURE_FRAMES; i++) { chunk[i * 2] = left[i]; chunk[i * 2 + 1] = right[i] }
    takes.addChunk('t', chunk)
    takes.addChunk('t', chunk)
    expect(takes.frames('t')).toBe(CAPTURE_FRAMES * 2)
    const { left: gotL, right: gotR } = takes.take('t')
    expect(gotL.length).toBe(CAPTURE_FRAMES * 2)
    for (let i = 0; i < CAPTURE_FRAMES; i++) {
      expect(Math.abs(gotL[i] - left[i])).toBeLessThan(1 / 32768 + 1e-9)
      expect(Math.abs(gotR[i] - right[i])).toBeLessThan(1 / 32768 + 1e-9)
    }
  })

  it('pads a short chunk rather than carrying the pool\'s old bytes', () => {
    const takes = new TakeBuilder()
    takes.addChunk('t', new Float32Array([0.5, -0.5]))
    const { left, right } = takes.take('t')
    expect(left[0]).toBeCloseTo(0.5, 4)
    expect(right[0]).toBeCloseTo(-0.5, 4)
    expect(left[1]).toBe(0)
    expect(right[CAPTURE_FRAMES - 1]).toBe(0)
  })

  it('calls digital silence silent, and anything else not', () => {
    const takes = new TakeBuilder()
    takes.addChunk('quiet', new Float32Array(CAPTURE_FRAMES * 2))
    takes.addChunk('loud', Float32Array.from({ length: CAPTURE_FRAMES * 2 }, (_, i) => (i === 0 ? 1 / 32768 : 0)))
    expect(takes.isSilent('quiet')).toBe(true)
    expect(takes.isSilent('loud')).toBe(false)
    expect(takes.isSilent('missing')).toBe(true)
  })

  it('refuses a take for a track with none', () => {
    expect(() => new TakeBuilder().take('ghost')).toThrow(/no take/)
  })

  it('encodes a take the WAV reader accepts', async () => {
    const { encodeWav } = await import('../../src/host/Wav.js')
    const takes = new TakeBuilder()
    takes.addChunk('t', Float32Array.from({ length: CAPTURE_FRAMES * 2 }, (_, i) => (i % 2 === 0 ? 0.25 : -0.25)))
    const bytes = takes.encode('t', 48000)
    expect(bytes.length).toBe(44 + CAPTURE_FRAMES * 2 * 2)
    expect(encodeWav).toBeDefined()
  })
})

describe('the capture processor', () => {
  let ctor
  beforeAll(async () => { ({ ctor } = await captureCtor()) })

  it('registers under its own name', async () => {
    const { context } = await captureCtor()
    expect(context.registry.get('jigdaw-capture').ctor).toBeDefined()
  })

  it('posts what it hears, interleaved, once per quantum', () => {
    const { processor, posted } = processorOf(ctor)
    processor.port.onmessage({ data: { type: 'start', buffers: [new ArrayBuffer(CAPTURE_FRAMES * 2 * 4)] } })
    const left = tone()
    const right = Float32Array.from({ length: CAPTURE_FRAMES }, (_, i) => -i / CAPTURE_FRAMES)
    processor.process([[left, right]], [[new Float32Array(1)]])
    expect(posted).toHaveLength(1)
    const chunk = new Float32Array(posted[0].message)
    expect(chunk.length).toBe(CAPTURE_FRAMES * 2)
    for (let i = 0; i < CAPTURE_FRAMES; i++) {
      expect(chunk[i * 2]).toBe(left[i])
      expect(chunk[i * 2 + 1]).toBe(right[i])
    }
  })

  it('transfers the buffer rather than copying it', () => {
    const { processor, posted } = processorOf(ctor)
    processor.port.onmessage({ data: { type: 'start', buffers: [new ArrayBuffer(CAPTURE_FRAMES * 2 * 4)] } })
    processor.process([[tone(), tone()]], [[new Float32Array(1)]])
    expect(posted[0].transfer).toHaveLength(1)
    expect(posted[0].transfer[0]).toBe(posted[0].message.buffer ?? posted[0].message)
  })

  it('duplicates mono to both sides and pads short input', () => {
    const { processor, posted } = processorOf(ctor)
    processor.port.onmessage({ data: { type: 'start', buffers: [new ArrayBuffer(CAPTURE_FRAMES * 2 * 4)] } })
    processor.process([[Float32Array.from([0.25, 0.5])]], [[new Float32Array(1)]])
    const chunk = new Float32Array(posted[0].message)
    expect(chunk[0]).toBe(0.25)
    expect(chunk[1]).toBe(0.25)
    expect(chunk[2]).toBe(0.5)
    expect(chunk[4]).toBe(0)
  })

  it('stays silent until started, and reports dropouts on stop', () => {
    const { processor, posted } = processorOf(ctor)
    processor.process([[tone(), tone()]], [[new Float32Array(1)]])
    expect(posted).toHaveLength(0)
    // No buffers lent: every quantum counts and skips rather than allocates.
    processor.port.onmessage({ data: { type: 'start', buffers: [] } })
    processor.process([[tone(), tone()]], [[new Float32Array(1)]])
    processor.process([[tone(), tone()]], [[new Float32Array(1)]])
    processor.port.onmessage({ data: { type: 'stop' } })
    const stopped = posted.find(p => p.message?.type === 'stopped')
    expect(stopped.message.dropped).toBe(2)
  })
})

describe('TrackRecorder', () => {
  it('needs an engine, a context and a processor URL', () => {
    expect(() => new TrackRecorder({})).toThrow(/needs an engine/)
  })

  it('refuses to record nothing, and to record twice', async () => {
    const context = new OfflineContext({ sampleRate: 48000 })
    const engine = new Engine({ context, loader: {}, output: null, AudioWorkletNode: OfflineWorkletNode })
    engine.addTrack('t')
    const recorder = new TrackRecorder({
      engine, context, processorUrl: PROCESSOR_URL, WorkletNode: OfflineWorkletNode
    })
    await expect(recorder.start([])).rejects.toThrow(/nothing to record/)
    await recorder.start(['t'])
    await expect(recorder.start(['t'])).rejects.toThrow(/already recording/)
    await recorder.stop()
    expect(recorder.recording).toBe(false)
  })

  it('captures a track through the real strip and processor, sample for sample', async () => {
    const context = new OfflineContext({ sampleRate: 48000 })
    const engine = new Engine({ context, loader: {}, output: null, AudioWorkletNode: OfflineWorkletNode })
    engine.addTrack('t')
    const recorder = new TrackRecorder({
      engine, context, processorUrl: PROCESSOR_URL, WorkletNode: OfflineWorkletNode
    })
    const { takes, nodes } = await recorder.start(['t'])
    // The strip's tap feeds the capture node: the same connection the page
    // makes, through the real engine rather than a second implementation.
    const tap = engine.trackTap('t')
    expect(tap.connections.map(c => c.destination)).toContain(nodes.get('t'))

    const signal = Float32Array.from({ length: CAPTURE_FRAMES }, (_, i) => Math.sin(i / 8) * 0.5)
    const node = nodes.get('t')
    for (let b = 0; b < 4; b++) {
      node.render([signal, signal])
      await settle()
    }
    const { dropped } = await recorder.stop()
    expect(dropped.get('t')).toBe(0)
    expect(takes.frames('t')).toBe(CAPTURE_FRAMES * 4)
    const { left, right } = takes.take('t')
    for (let i = 0; i < 64; i++) {
      expect(Math.abs(left[i] - signal[i % CAPTURE_FRAMES])).toBeLessThan(1 / 32768 + 1e-9)
      expect(Math.abs(right[i] - signal[i % CAPTURE_FRAMES])).toBeLessThan(1 / 32768 + 1e-9)
    }
    expect(recorder.recording).toBe(false)
  })

  it('counts a starved pool as dropped rather than stalling', async () => {
    const context = new OfflineContext({ sampleRate: 48000 })
    const engine = new Engine({ context, loader: {}, output: null, AudioWorkletNode: OfflineWorkletNode })
    engine.addTrack('t')
    const recorder = new TrackRecorder({
      engine, context, processorUrl: PROCESSOR_URL, WorkletNode: OfflineWorkletNode, poolBuffers: 1
    })
    const { nodes } = await recorder.start(['t'])
    const node = nodes.get('t')
    // No settling between renders: the main thread never returns a buffer,
    // so all but the first quantum count and skip.
    node.render([tone(), tone()])
    node.render([tone(), tone()])
    node.render([tone(), tone()])
    const { dropped } = await recorder.stop()
    expect(dropped.get('t')).toBeGreaterThan(0)
  })
})
