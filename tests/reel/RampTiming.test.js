// tests/reel/RampTiming.test.js
//
// A Reel ramp is an envelope, and an envelope is sample accurate because the scheduler hands the audio clock the
// exact time (docs/livecoding.md, "Time is stream position"). This holds a script's ramp to that, end to end: the
// script is parsed, planned and run through the real tools into the real project, and the real Scheduler plays
// the envelope on a clock the test moves. The two failures CLAUDE.md names for anything located in time are both
// here: a start exactly on a quantum boundary, which must not be missed, and one between two, which must not be
// rounded to the quantum, and neither may fire twice however the ticks fall.
import { describe, it, expect } from 'vitest'
import { parse } from '../../src/reel/Parser.js'
import { plan } from '../../src/reel/Planner.js'
import { createRunner } from '../../src/reel/Runner.js'
import { createTools } from '../../src/mcp/tools.js'
import { OpDispatcher } from '../../src/ops/OpDispatcher.js'
import { Scheduler } from '../../src/engine/Scheduler.js'

const RATE = 48000
const QUANTUM = 128
const ORIGIN = 10 // the clock time at which beat zero is heard: not zero, so position is not elapsed time
const IRI = 'https://example.org/plugins/filter/'
const PORTS = [
  { symbol: 'cutoff', unit: 'hz', minimum: 20, maximum: 20000 },
  { symbol: 'mix', unit: null, minimum: 0, maximum: 1 }
]
// 120 bpm at 48 kHz: a beat is 24000 frames. Beat 0.064 is 1536 frames, exactly 12 quanta; beat 0.065 is 1560.
const FRAMES_PER_BEAT = 24000

/** A script run into a real project, then played by a real scheduler; returns what the audio clock was told. */
async function played (script, { step, until, bpm = null }) {
  const dispatcher = new OpDispatcher()
  if (bpm !== null) dispatcher.apply([{ op: 'setTransport', tempoPoints: [{ atBeat: 0, bpm }] }])
  const loadPlugin = async iri => {
    dispatcher.apply([{ op: 'addTrack', id: 't1' }, { op: 'addNode', id: 'n1', track: 't1', pluginIri: iri }])
    return { ok: true, nodeId: 'n1', trackId: 't1', revision: dispatcher.revision, entry: { profile: { label: 'F', ports: PORTS }, ready: { latencyFrames: 0 } } }
  }
  const tools = Object.fromEntries(createTools({ dispatcher, loadPlugin }).map(t => [t.name, t.handler]))
  const parsed = parse(`load f = ${IRI}\n${script}`)
  expect(parsed.errors).toEqual([])
  const planned = await plan(parsed.statements, { beatsPerBar: 4, existing: new Map(), resolvePlugin: async () => ({ ok: true, ports: PORTS }) })
  expect(planned.errors ?? []).toEqual([])
  const runner = createRunner({ tools, scheduler: { at () {}, every () {} }, session: { names: new Map() }, beatsPerBar: 4 })
  const run = await runner.run(planned.plan)
  expect(run.errors).toEqual([])

  const applied = []
  let clock = ORIGIN
  const scheduler = new Scheduler({
    now: () => clock,
    sampleRate: RATE,
    lookahead: 0.1,
    notes: () => new Map(),
    transport: () => dispatcher.transport(),
    send: () => {},
    automation: {
      envelopes: () => dispatcher.project.envelopes.filter(e => e.target.node !== undefined && e.points.length > 0),
      apply: (envelope, instruction) => applied.push({ symbol: envelope.target.symbol, ...instruction }),
      stop: () => {}
    }
  })
  scheduler.start(ORIGIN)
  const stepOf = typeof step === 'function' ? step : () => step
  let i = 0
  while (clock - ORIGIN < until) { clock += stepOf(i++); scheduler.tick() }
  return { applied, dispatcher }
}

/**
 * The stream frame an audio clock time is heard at, counted from the start of the stream. The scheduler hands the
 * audio clock times that already include the clock time of beat zero, so that is taken off.
 */
const frameOf = at => Math.round(at * RATE) - ORIGIN * RATE

// Every envelope also holds its first value from the start of the transport, which is right: before its first
// point it holds the first value. So an envelope's instructions are a hold at frame 0, a set and a ramp where
// the ramp starts, and a set where it ends. What is held to account is where the ramp starts.
const rampStarts = (applied, symbol) => applied.filter(a => a.symbol === symbol && a.kind === 'ramp').map(a => frameOf(a.at))
const setFrames = (applied, symbol) => applied.filter(a => a.symbol === symbol && a.kind === 'set').map(a => frameOf(a.at))
const ramps = (applied, symbol) => applied.filter(a => a.symbol === symbol && a.kind === 'ramp')

describe('a ramp placed in time', () => {
  it('starts on a quantum boundary exactly, and is not missed', async () => {
    const { applied } = await played('at 1:1.064 ramp f.cutoff 200Hz -> 4kHz over 1 beat', { step: QUANTUM / RATE, until: 1 })
    expect(rampStarts(applied, 'cutoff')).toEqual([1536])
    expect(1536 % QUANTUM).toBe(0)
  })

  it('starts between two quanta at its own frame, and is not rounded to a quantum', async () => {
    const { applied } = await played('at 1:1.065 ramp f.cutoff 200Hz -> 4kHz over 1 beat', { step: QUANTUM / RATE, until: 1 })
    expect(rampStarts(applied, 'cutoff')).toEqual([1560])
    expect(1560 % QUANTUM).toBe(24)
  })

  it('starts at a beat of the bar that is no multiple of a quantum, a few bars in', async () => {
    // Bar 3 beat 2.5 is beat 9.5, 228000 frames: 1781.25 quanta.
    const { applied } = await played('at 3:2.5 ramp f.cutoff 200Hz -> 4kHz over 1 bar', { step: QUANTUM / RATE, until: 6 })
    expect(rampStarts(applied, 'cutoff')).toEqual([9.5 * FRAMES_PER_BEAT])
    expect((9.5 * FRAMES_PER_BEAT) % QUANTUM).not.toBe(0)
  })

  it('moves from the first value to the last over exactly the length it was given', async () => {
    const { applied } = await played('at 1:1.065 ramp f.cutoff 200Hz -> 4kHz over 2 beats', { step: QUANTUM / RATE, until: 3 })
    const [ramp] = ramps(applied, 'cutoff')
    expect(ramp.value).toBe(200)
    expect(ramp.endValue).toBe(4000)
    expect(frameOf(ramp.end) - frameOf(ramp.at)).toBe(2 * FRAMES_PER_BEAT)
  })

  it('is told to the audio clock once, whatever size the ticks are', async () => {
    const script = 'at 1:1.065 ramp f.cutoff 200Hz -> 4kHz over 1 beat\nat 1:1.064 ramp f.mix 0 -> 1 over 1 beat'
    const patterns = {
      'one quantum': QUANTUM / RATE,
      'a few quanta': 5 * QUANTUM / RATE,
      '25 ms': 0.025,
      '1 ms': 0.001,
      // Never a multiple of anything: ticks 1 to 90 ms apart.
      'irregular': (() => { let seed = 7; return () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return 0.001 + (seed % 90) / 1000 } })()
    }
    for (const [name, step] of Object.entries(patterns)) {
      const { applied } = await played(script, { step, until: 2 })
      expect(rampStarts(applied, 'cutoff'), name).toEqual([1560])
      expect(rampStarts(applied, 'mix'), name).toEqual([1536])
      // The hold at the start, the set where the ramp begins and the set where it ends: each once.
      expect(setFrames(applied, 'cutoff'), name).toEqual([0, 1560, 1560 + FRAMES_PER_BEAT])
      expect(setFrames(applied, 'mix'), name).toEqual([0, 1536, 1536 + FRAMES_PER_BEAT])
    }
  })

  it('is placed from the clock\'s beat zero and not from time zero', async () => {
    const { applied } = await played('at 1:1.065 ramp f.cutoff 200Hz -> 4kHz over 1 beat', { step: 0.01, until: 1 })
    const [ramp] = ramps(applied, 'cutoff')
    // On the audio clock: beat zero is heard at ORIGIN, and the ramp 1560 frames after it.
    expect(ramp.at).toBeCloseTo(ORIGIN + 1560 / RATE, 9)
  })

  it('follows a tempo, a beat being sooner when the tempo is higher', async () => {
    // 240 bpm: a beat is 12000 frames, so beat 0.065 is 780.
    const { applied } = await played('at 1:1.065 ramp f.cutoff 200Hz -> 4kHz over 1 beat', { step: QUANTUM / RATE, until: 1, bpm: 240 })
    expect(rampStarts(applied, 'cutoff')).toEqual([780])
    const [ramp] = ramps(applied, 'cutoff')
    expect(frameOf(ramp.end) - frameOf(ramp.at)).toBe(12000)
  })
})

describe('what a ramp does not do', () => {
  it('does not start before it is placed: only the hold of its first value is heard until then', async () => {
    // The scheduler tells the audio clock 0.1 s ahead of time, so the ramp at 2.0 s is handed over from 1.9 s. Until 1.8
    // the window ends at 1.9 and holds nothing of it.
    const { applied } = await played('at 2:1 ramp f.cutoff 200Hz -> 4kHz over 1 bar', { step: QUANTUM / RATE, until: 1.8 })
    expect(applied.filter(a => a.kind !== 'set')).toEqual([])
    expect(setFrames(applied, 'cutoff')).toEqual([0])
    expect(applied.find(a => a.kind === 'set').value).toBe(200)
  })

  it('is handed to the audio clock ahead of its time, by the lookahead and no more, never late', async () => {
    const { applied } = await played('at 2:1 ramp f.cutoff 200Hz -> 4kHz over 1 bar', { step: QUANTUM / RATE, until: 1.95 })
    expect(rampStarts(applied, 'cutoff')).toEqual([2 * RATE])
  })

  it('does not repeat when the transport is not looping', async () => {
    const { applied } = await played('at 1:1 ramp f.cutoff 200Hz -> 4kHz over 1 beat', { step: 0.02, until: 8 })
    expect(rampStarts(applied, 'cutoff')).toHaveLength(1)
  })

  it('leaves what the script said in the project, as an envelope of two points', async () => {
    const { dispatcher } = await played('at 1:1.065 ramp f.cutoff 200Hz -> 4kHz over 1 beat', { step: 0.1, until: 0.1 })
    const [envelope] = dispatcher.project.envelopes
    expect(envelope.points).toHaveLength(2)
    expect(envelope.points[0].atBeat).toBeCloseTo(0.065, 9)
    expect(envelope.points[1].atBeat).toBeCloseTo(1.065, 9)
    expect(envelope.points.map(p => p.value)).toEqual([200, 4000])
    expect(envelope.points[0].curve).toBe('linear')
  })
})
