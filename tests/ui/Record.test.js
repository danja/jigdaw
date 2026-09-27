// tests/ui/Record.test.js
//
// Record without a browser: every seam it touches arrives injected or faked,
// and everything it decides runs for real: the dispatcher, the transport
// model, the take assembly and the encoder. What this cannot prove is sound
// coming out of a worklet; tests/engine/TrackRecorder.test.js drives the
// real capture processor for exactly that half.
import { describe, it, expect, beforeEach } from 'vitest'
import { OpDispatcher } from '../../src/ops/OpDispatcher.js'
import { createRecord } from '../../web/app/Record.js'
import { CAPTURE_FRAMES } from '../../src/engine/TrackRecorder.js'

/** An AudioWorkletNode stand-in: scriptable ports, recorded wiring. */
class FakeNode {
  static instances = []
  static reset () { FakeNode.instances = [] }
  constructor (context, name, options) {
    this.context = context
    this.name = name
    this.options = options
    this.connected = []
    this.port = {
      onmessage: null,
      posted: [],
      postMessage: (message, transfer) => {
        this.port.posted.push({ message, transfer })
        // Answers stop the way the real processor does, on a later turn, so
        // stop() resolves without the test pumping messages by hand.
        if (message?.type === 'stop') {
          queueMicrotask(() => this.port.onmessage?.({ data: { type: 'stopped', dropped: 0 } }))
        }
      }
    }
    FakeNode.instances.push(this)
  }

  connect (destination) { this.connected.push(destination); return destination }

  disconnect () {}
}

const fakeGain = () => ({ gain: { value: 1 }, connect () {}, disconnect () {} })

function fakeContext () {
  return {
    sampleRate: 48000,
    destination: { name: 'destination' },
    createGain: fakeGain,
    audioWorklet: { addModule: async () => {} }
  }
}

function build ({ tracks = ['t1', 't2'], playing = false } = {}) {
  FakeNode.reset()
  const context = fakeContext()
  const logLines = []
  const mediaFiles = new Map()
  const mediaBase = 'https://s.test/sessions/1/'
  let played = 0
  let beat = 4
  const dispatcher = new OpDispatcher()
  dispatcher.apply(tracks.map(id => ({ op: 'addTrack', id })))
  const ctx = {
    document: { baseURI: 'https://s.test/' },
    $: id => ({ setAttribute () {}, textContent: '' }),
    log: (message, kind = 'info') => logLines.push({ message, kind }),
    runtime: { ensureRunning: async () => dispatcher },
    engine: {
      trackIds: () => tracks,
      context,
      trackTap: () => ({ connect () {} })
    },
    dispatcher,
    media: {
      iriFor: (hex, extension) => `${mediaBase}media/${hex}.${extension}`,
      put: (iri, bytes, mediaType) => mediaFiles.set(iri, { bytes, mediaType }),
      get: iri => mediaFiles.get(iri) ?? null
    },
    clipPlayer: { load: async () => ({ duration: 1 }), failure: () => null },
    transport: {
      playing: () => playing,
      play: async () => { played += 1 },
      position: () => ({ beat })
    }
  }
  const record = createRecord(ctx, { processorUrl: 'https://s.test/src/engine/capture-processor.js', WorkletNode: FakeNode })
  // The capture nodes the recorder made, in track order.
  const nodes = () => FakeNode.instances
  const feed = (trackIndex, value) => {
    const node = nodes()[trackIndex]
    const chunk = new Float32Array(CAPTURE_FRAMES * 2).fill(value)
    node.port.onmessage({ data: chunk })
  }
  return { ctx, record, dispatcher, logLines, mediaFiles, nodes, feed, played: () => played }
}

describe('record', () => {
  let setup
  beforeEach(() => { setup = build() })

  it('starts nothing with no tracks', async () => {
    setup = build({ tracks: [] })
    await setup.record.toggle()
    expect(setup.record.isRecording()).toBe(false)
    expect(setup.logLines.some(l => l.message.includes('nothing to record'))).toBe(true)
    expect(setup.played()).toBe(0)
  })

  it('plays first when stopped, and punches into a playing transport', async () => {
    await setup.record.toggle()
    expect(setup.played()).toBe(1)
    await setup.record.finishTake()
    expect(setup.record.isRecording()).toBe(false)

    setup = build({ playing: true })
    await setup.record.toggle()
    expect(setup.played()).toBe(0)
    expect(setup.record.isRecording()).toBe(true)
  })

  it('keeps a sounding track as an audio clip, and skips a silent one', async () => {
    await setup.record.toggle()
    setup.feed(0, 0.5)
    setup.feed(0, 0.5)
    setup.feed(1, 0)
    await setup.record.finishTake()

    const clips = setup.dispatcher.project.clips
    expect(clips).toHaveLength(1)
    const [clip] = clips
    expect(clip.track).toBe('t1')
    expect(clip.kind).toBe('audio')
    expect(clip.startBeat).toBe(4)
    // Two quanta at 48 kHz, in beats at the 120 BPM default tempo.
    expect(clip.lengthBeats).toBeCloseTo((2 * CAPTURE_FRAMES / 48000) * 2, 6)
    expect(clip.offsetSeconds).toBe(0)
    expect(clip.source).toMatch(/^https:\/\/s\.test\/sessions\/1\/media\/[0-9a-f]{64}\.wav$/)

    // Stored where sessions keep media, as a WAV that starts RIFF.
    const held = setup.mediaFiles.get(clip.source)
    expect(held.mediaType).toBe('audio/wav')
    expect(String.fromCharCode(...held.bytes.slice(0, 4))).toBe('RIFF')
  })

  it('finishing twice keeps one pass, and undo takes it back out', async () => {
    await setup.record.toggle()
    setup.feed(0, 0.5)
    await setup.record.finishTake()
    await setup.record.finishTake()
    expect(setup.dispatcher.project.clips).toHaveLength(1)
    setup.dispatcher.undo()
    expect(setup.dispatcher.project.clips).toHaveLength(0)
  })

  it('reports a main-thread dropout rather than a short take', async () => {
    await setup.record.toggle()
    setup.feed(0, 0.5)
    // A stopped report carrying drops, as a starved pool sends.
    setup.nodes()[0].port.onmessage({ data: { type: 'stopped', dropped: 3 } })
    await setup.record.finishTake()
    expect(setup.logLines.some(l => l.message.includes('dropped 3'))).toBe(true)
    expect(setup.dispatcher.project.clips).toHaveLength(1)
  })

  it('says plainly when the take cannot be placed', async () => {
    await setup.record.toggle()
    setup.feed(0, 0.5)
    // Remove the tracks out from under the take: the changeset is refused.
    setup.dispatcher.apply([{ op: 'removeTrack', id: 't1' }, { op: 'removeTrack', id: 't2' }])
    await setup.record.finishTake()
    expect(setup.logLines.some(l => l.message.includes('could not be placed'))).toBe(true)
  })
})
