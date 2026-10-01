// tests/engine/Bounce.test.js
//
// The offline context stand-in refuses what a real OfflineAudioContext refuses: a suspend that is not on a
// render quantum, not after the start, not before the end, not after the one before it, or at a time already
// taken. Node has no OfflineAudioContext, so what a real render sounds like is checked in a browser
// (TODO.md); here the schedule and the guards are held.
import { describe, it, expect } from 'vitest'
import { bounce, suspendTimes, bounceSeconds } from '../../src/engine/Bounce.js'
import { Project } from '../../src/model/Project.js'
import { OfflineContext, OfflineWorkletNode } from '../../src/testing/OfflineHost.js'

const HOST = { schedulerLookaheadMs: 200, schedulerTickMs: 50, maxTrackDelayMs: 100 }

class StrictOffline extends OfflineContext {
  constructor ({ numberOfChannels, length, sampleRate }) {
    super({ sampleRate })
    this.length = length
    this.currentTime = 0
    this.suspends = []
    this.pending = []
    StrictOffline.last = this
  }

  suspend (time) {
    const frame = Math.round(time * this.sampleRate)
    if (frame % 128 !== 0) throw new RangeError('suspend time must be a multiple of the render quantum')
    if (frame <= 0) throw new RangeError('suspend time must be after the start')
    if (frame >= this.length) throw new RangeError('suspend time must be before the end')
    if (this.suspends.length > 0 && frame <= Math.round(this.suspends.at(-1) * this.sampleRate)) throw new RangeError('suspend times must increase')
    this.suspends.push(time)
    return new Promise(resolve => this.pending.push([time, resolve]))
  }

  resume () { this.resumed = (this.resumed ?? 0) + 1 }

  async startRendering () {
    for (const [time, resolve] of this.pending) {
      this.currentTime = time
      resolve()
      await Promise.resolve()
    }
    this.currentTime = this.length / this.sampleRate
    return { duration: this.currentTime, length: this.length, numberOfChannels: 2, sampleRate: this.sampleRate }
  }
}

const loaderFactory = () => ({})
function project () {
  const p = new Project()
  p.apply([{ op: 'addTrack', id: 'a' }, { op: 'addTrack', id: 'b' }])
  return p.snapshot()
}

describe('the suspend schedule', () => {
  it('is every tick on a render quantum, after the start and before the end, without repeats', () => {
    const times = suspendTimes(2, 0.05, 48000)
    expect(times.length).toBeGreaterThan(30)
    for (const t of times) {
      expect(Math.round(t * 48000) % 128).toBe(0)
      expect(t).toBeGreaterThan(0)
      expect(t).toBeLessThan(2)
    }
    expect(times.every((t, i) => i === 0 || t > times[i - 1])).toBe(true)
  })

  it('cannot be finer than one render quantum', () => {
    const times = suspendTimes(0.1, 0.000001, 48000)
    expect(times[1] - times[0]).toBeCloseTo(128 / 48000, 10)
  })

  it('has none for a render too short to stop in', () => {
    expect(suspendTimes(128 / 48000, 0.05, 48000)).toEqual([])
  })
})

describe('bounce', () => {
  it('suspends the context at each tick, resumes it each time, and reports progress', async () => {
    const progress = []
    const result = await bounce({ snapshot: project(), makeLoader: loaderFactory, fetchBytes: async () => new ArrayBuffer(0), hostConfig: HOST, seconds: 1, OfflineContext: StrictOffline, AudioWorkletNode: OfflineWorkletNode, onProgress: p => progress.push(p) })
    const context = StrictOffline.last
    expect(context.suspends).toEqual(suspendTimes(1, 0.05, 48000))
    expect(context.resumed).toBe(context.suspends.length)
    expect(result.seconds).toBeCloseTo(1, 2)
    expect(result.buffer.numberOfChannels).toBe(2)
    expect(result.errors).toEqual([])
    expect(progress.length).toBe(context.suspends.length)
    expect(progress.at(-1)).toBeLessThan(1)
    expect(progress.every((p, i) => i === 0 || p > progress[i - 1])).toBe(true)
  })

  it('rounds the length up to whole render quanta', async () => {
    await bounce({ snapshot: project(), makeLoader: loaderFactory, fetchBytes: async () => new ArrayBuffer(0), hostConfig: HOST, seconds: 0.5001, OfflineContext: StrictOffline, AudioWorkletNode: OfflineWorkletNode })
    expect(StrictOffline.last.length % 128).toBe(0)
    expect(StrictOffline.last.length).toBeGreaterThanOrEqual(Math.ceil(0.5001 * 48000))
  })

  it('refuses a length of nothing, a track that is not there, a host with no timing, and no context to render with', async () => {
    const base = { snapshot: project(), makeLoader: loaderFactory, fetchBytes: async () => new ArrayBuffer(0), hostConfig: HOST, seconds: 1, OfflineContext: StrictOffline, AudioWorkletNode: OfflineWorkletNode }
    await expect(bounce({ ...base, seconds: 0 })).rejects.toThrow(/length above zero/)
    await expect(bounce({ ...base, onlyTrack: 'ghost' })).rejects.toThrow(/no such track/)
    await expect(bounce({ ...base, hostConfig: { ...HOST, schedulerTickMs: undefined } })).rejects.toThrow(/schedulerTickMs/)
    await expect(bounce({ ...base, OfflineContext: undefined })).rejects.toThrow(/OfflineAudioContext/)
  })

  it('renders one track alone when asked, without error', async () => {
    const result = await bounce({ snapshot: project(), makeLoader: loaderFactory, fetchBytes: async () => new ArrayBuffer(0), hostConfig: HOST, seconds: 0.5, onlyTrack: 'a', OfflineContext: StrictOffline, AudioWorkletNode: OfflineWorkletNode })
    expect(result.errors).toEqual([])
  })
})

describe('how long a render is', () => {
  const timing = { secondsAtBeat: b => b / 2 }
  const project = (clips, transport = {}) => ({ clips, transport: { beatsPerBar: 4, loopEnabled: false, loopEnd: 0, ...transport } })
  it('is four bars when nothing is longer, plus the tail', () => {
    expect(bounceSeconds(project([]), timing)).toBe(16 / 2 + 2)
  })
  it('follows the last clip, rounded up to a bar', () => {
    expect(bounceSeconds(project([{ startBeat: 10, lengthBeats: 12 }]), timing)).toBe(24 / 2 + 2)
    expect(bounceSeconds(project([{ startBeat: 10, lengthBeats: 13 }]), timing)).toBe(24 / 2 + 2)
  })
  it('follows the loop end when the loop is on, and ignores it when it is off', () => {
    expect(bounceSeconds(project([], { loopEnabled: true, loopEnd: 40 }), timing)).toBe(40 / 2 + 2)
    expect(bounceSeconds(project([], { loopEnabled: false, loopEnd: 40 }), timing)).toBe(16 / 2 + 2)
  })
  it('takes the tail and the minimum as given', () => {
    expect(bounceSeconds(project([]), timing, { tailSeconds: 0, minimumBars: 1 })).toBe(2)
  })
})
