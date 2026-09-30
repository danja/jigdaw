// tests/engine/ClipPlayer.test.js
//
// The fake context refuses what a real one refuses: decodeAudioData wants an
// ArrayBuffer, start() takes no negative time, offset or duration, a source
// starts once, and stop() before start() throws. A fake that accepted these
// would pass a player that fails on the first real page.
import { describe, it, expect } from 'vitest'
import { ClipPlayer } from '../../src/engine/ClipPlayer.js'

function fakeContext () {
  const sources = []
  return {
    currentTime: 0,
    sources,
    decoded: 0,
    async decodeAudioData (bytes) {
      if (!(bytes instanceof ArrayBuffer)) throw new TypeError('decodeAudioData takes an ArrayBuffer')
      if (bytes.byteLength === 0) throw new Error('EncodingError: unable to decode audio data')
      this.decoded += 1
      const data = new Float32Array(bytes.byteLength).map((_, i) => (i % 4) / 4 - 0.5)
      return { duration: data.length / 48000, getChannelData: () => data }
    },
    // Refuses what a real AudioParam refuses: a negative or non-finite time.
    createGain () {
      const events = []
      const at = (kind, value, time) => {
        if (!Number.isFinite(time) || time < 0) throw new RangeError(`${kind} takes a finite time at or after zero`)
        events.push([kind, value, time])
      }
      return {
        events,
        gain: { setValueAtTime: (v, t) => at('set', v, t), linearRampToValueAtTime: (v, t) => at('ramp', v, t) },
        connected: [],
        connect (d) { this.connected.push(d) },
        disconnect () { this.connected = [] }
      }
    },
    createBufferSource () {
      const source = {
        buffer: null, started: null, stopped: false, connected: [],
        connect (d) { this.connected.push(d) },
        disconnect () { this.connected = [] },
        start (when, offset, duration) {
          if (this.started) throw new Error('InvalidStateError: start called twice')
          if ([when, offset, duration].some(v => v < 0)) throw new RangeError('start takes no negative values')
          this.started = { when, offset, duration }
        },
        stop () {
          if (!this.started) throw new Error('InvalidStateError: stop before start')
          this.stopped = true
        }
      }
      sources.push(source)
      return source
    }
  }
}

const bytesOf = n => new ArrayBuffer(n)

describe('loading', () => {
  it('decodes a source once, however many ask for it', async () => {
    const context = fakeContext()
    let fetched = 0
    const player = new ClipPlayer({ context, fetchBytes: async () => { fetched += 1; return bytesOf(16) } })
    const [a, b] = await Promise.all([player.load('x'), player.load('x')])
    await player.load('x')
    expect(a).toBe(b)
    expect(fetched).toBe(1)
    expect(context.decoded).toBe(1)
  })

  it('resolves null for a source it cannot have, says why, and tries again next time', async () => {
    let fail = true
    const player = new ClipPlayer({ context: fakeContext(), fetchBytes: async () => { if (fail) throw new Error('404 for x'); return bytesOf(8) } })
    expect(await player.load('x')).toBeNull()
    expect(player.failure('x').message).toBe('404 for x')
    fail = false
    expect(await player.load('x')).not.toBeNull()
    expect(player.failure('x')).toBeNull()
  })

  it('reports a file that will not decode', async () => {
    const player = new ClipPlayer({ context: fakeContext(), fetchBytes: async () => bytesOf(0) })
    expect(await player.load('x')).toBeNull()
    expect(player.failure('x').message).toMatch(/unable to decode/)
  })
})

describe('playing', () => {
  it('starts a loaded source at its time, offset and length, into its destination', async () => {
    const context = fakeContext()
    const player = new ClipPlayer({ context, fetchBytes: async () => bytesOf(16) })
    await player.load('x')
    const destination = {}
    expect(player.start({ iri: 'x', when: 2, offset: 0.5, duration: 1, destination })).toBe(true)
    expect(context.sources[0].started).toEqual({ when: 2, offset: 0.5, duration: 1 })
    expect(context.sources[0].connected).toEqual([destination])
  })

  it('starts one whose time has passed from where the clock is, not late from its start', async () => {
    const context = fakeContext()
    const player = new ClipPlayer({ context, fetchBytes: async () => bytesOf(16) })
    await player.load('x')
    context.currentTime = 2.25
    player.start({ iri: 'x', when: 2, offset: 0.5, duration: 1, destination: {} })
    expect(context.sources[0].started).toEqual({ when: 2.25, offset: 0.75, duration: 0.75 })
  })

  it('starts nothing for a source not loaded', () => {
    const context = fakeContext()
    const player = new ClipPlayer({ context, fetchBytes: async () => bytesOf(16) })
    expect(player.start({ iri: 'x', when: 0, offset: 0, duration: 1, destination: {} })).toBe(false)
    expect(context.sources).toEqual([])
  })

  it('stops everything it started', async () => {
    const context = fakeContext()
    const player = new ClipPlayer({ context, fetchBytes: async () => bytesOf(16) })
    await player.load('x')
    player.start({ iri: 'x', when: 0, offset: 0, duration: 1, destination: {} })
    player.start({ iri: 'x', when: 1, offset: 0, duration: 1, destination: {} })
    expect(player.active).toBe(2)
    player.stopAll()
    expect(context.sources.every(s => s.stopped)).toBe(true)
    expect(player.active).toBe(0)
  })
})

describe('fades', () => {
  const loaded = async () => {
    const context = fakeContext()
    context.gains = []
    const make = context.createGain
    context.createGain = () => { const g = make(); context.gains.push(g); return g }
    const player = new ClipPlayer({ context, fetchBytes: async () => bytesOf(48000) })
    await player.load('x')
    return { context, player }
  }

  it('plays straight into the destination when there is no fade', async () => {
    const { context, player } = await loaded()
    const destination = {}
    player.start({ iri: 'x', when: 1, offset: 0, duration: 2, destination })
    expect(context.gains).toHaveLength(0)
    expect(context.sources[0].connected).toEqual([destination])
  })

  it('shapes a fade in and a fade out as straight lines from the clip start to its end', async () => {
    const { context, player } = await loaded()
    const destination = {}
    player.start({ iri: 'x', when: 1, offset: 0, duration: 4, destination, fadeIn: 1, fadeOut: 0.5 })
    expect(context.sources[0].connected).toEqual(context.gains)
    expect(context.gains[0].connected).toEqual([destination])
    expect(context.gains[0].events).toEqual([['set', 0, 1], ['ramp', 1, 2], ['set', 1, 4.5], ['ramp', 0, 5]])
  })

  it('a fade out alone starts at full level, and two that are too long are scaled to fit', async () => {
    const { context, player } = await loaded()
    player.start({ iri: 'x', when: 0, offset: 0, duration: 2, destination: {}, fadeOut: 0.5 })
    expect(context.gains[0].events).toEqual([['set', 1, 0], ['set', 1, 1.5], ['ramp', 0, 2]])
    player.start({ iri: 'x', when: 0, offset: 0, duration: 2, destination: {}, fadeIn: 3, fadeOut: 1 })
    expect(context.gains[1].events).toEqual([['set', 0, 0], ['ramp', 1, 1.5], ['set', 1, 1.5], ['ramp', 0, 2]])
  })

  it('lets go of the gain when the source ends', async () => {
    const { context, player } = await loaded()
    player.start({ iri: 'x', when: 0, offset: 0, duration: 2, destination: {}, fadeIn: 1 })
    context.sources[0].onended()
    expect(context.gains[0].connected).toEqual([])
    expect(player.active).toBe(0)
  })
})

describe('peaks', () => {
  it('gives the loudest sample of each stretch, once per source and count', async () => {
    const player = new ClipPlayer({ context: fakeContext(), fetchBytes: async () => bytesOf(16) })
    expect(player.peaks('x', 4)).toBeNull()
    await player.load('x')
    const peaks = player.peaks('x', 4)
    expect([...peaks]).toEqual([0.5, 0.5, 0.5, 0.5])
    expect(player.peaks('x', 4)).toBe(peaks)
  })
})
