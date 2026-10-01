// tests/engine/AutomationHost.test.js
//
// The parameter stand-in refuses what a real AudioParam refuses: a negative or non-finite time, a
// ramp with no value to start from, and a curve over a time already taken by another event.
import { describe, it, expect } from 'vitest'
import { createAutomationHost } from '../../src/engine/AutomationHost.js'

function fakeParam (name) {
  const events = []
  const at = (kind, value, time, extra = {}) => {
    if (!Number.isFinite(time) || time < 0) throw new RangeError(`${name}: ${kind} takes a finite time at or after zero`)
    events.push({ kind, value, time, ...extra })
  }
  return {
    events,
    setValueAtTime: (v, t) => at('set', v, t),
    linearRampToValueAtTime: (v, t) => {
      if (events.length === 0) throw new Error(`${name}: a ramp needs an event before it`)
      at('ramp', v, t)
    },
    setValueCurveAtTime: (values, t, d) => {
      if (events.some(e => e.time > t && e.time < t + d)) throw new Error(`${name}: a curve cannot overlap another event`)
      at('curve', values, t, { duration: d })
    },
    cancelScheduledValues: t => { for (let i = events.length - 1; i >= 0; i--) if (events[i].time >= t) events.splice(i, 1) }
  }
}

function setup () {
  const params = new Map([['n:cutoff', fakeParam('cutoff')]])
  const listeners = new Set()
  const logs = []
  const settings = new Map([['cutoff', 400]])
  const ctx = {
    log: (message, kind = 'info') => logs.push({ message, kind }),
    engine: { context: { currentTime: 5 } },
    dispatcher: {
      subscribe: fn => { listeners.add(fn); return () => listeners.delete(fn) },
      engineNode: id => ({ node: { parameters: { get: symbol => params.get(`${id}:${symbol}`) } }, profile: { ports: [{ symbol: 'cutoff', defaultValue: 1000 }] } }),
      project: {
        envelopes: [
          { id: 'e1', target: { node: 'n', symbol: 'cutoff' }, points: [{ atBeat: 0, value: 100, curve: 'linear' }] },
          { id: 'e2', target: { kind: 'masterGain' }, points: [{ atBeat: 0, value: 1, curve: 'linear' }] },
          { id: 'e3', target: { node: 'n', symbol: 'cutoff' }, points: [] }
        ],
        node: id => (id === 'n' ? { settings } : null)
      }
    }
  }
  const emit = event => { for (const fn of listeners) fn(event) }
  return { host: createAutomationHost(ctx), ctx, params, emit, logs, settings, cutoff: params.get('n:cutoff') }
}
const envelope = { id: 'e1', target: { node: 'n', symbol: 'cutoff' } }

describe('playing envelopes on parameters', () => {
  it('offers the envelopes that have points and can be played: a plugin parameter or the master level', () => {
    expect(setup().host.envelopes().map(e => e.id)).toEqual(['e1', 'e2'])
  })

  it('turns each instruction into the parameter\'s own scheduling call', () => {
    const { host, cutoff } = setup()
    host.apply(envelope, { kind: 'set', at: 6, value: 100 })
    host.apply(envelope, { kind: 'ramp', at: 6, value: 100, end: 7, endValue: 500 })
    host.apply(envelope, { kind: 'curve', at: 7, duration: 1, values: Float32Array.from([500, 600]) })
    expect(cutoff.events.map(e => [e.kind, e.time])).toEqual([['set', 6], ['ramp', 7], ['curve', 7]])
  })

  it('ignores a parameter the plugin does not have, and says a refusal once, not on every tick', () => {
    const { host, logs } = setup()
    host.apply({ id: 'e9', target: { node: 'ghost', symbol: 'x' } }, { kind: 'set', at: 1, value: 1 })
    expect(logs).toEqual([])
    for (let i = 0; i < 3; i++) host.apply(envelope, { kind: 'set', at: -1, value: 1 })
    expect(logs).toHaveLength(1)
    expect(logs[0]).toMatchObject({ kind: 'error' })
    expect(logs[0].message).toMatch(/automation e1/)
  })

  it('on stop cancels what is scheduled and puts the parameter back to the value set by hand', () => {
    const { host, cutoff } = setup()
    host.apply(envelope, { kind: 'set', at: 6, value: 100 })
    host.stop()
    expect(cutoff.events).toEqual([{ kind: 'set', value: 400, time: 5 }])
  })

  it('falls back to the plugin\'s default when nothing was set by hand', () => {
    const { host, cutoff, settings } = setup()
    settings.clear()
    host.apply(envelope, { kind: 'set', at: 6, value: 100 })
    host.stop()
    expect(cutoff.events.at(-1)).toMatchObject({ kind: 'set', value: 1000 })
  })

  it('a hand edit takes over at once, cancels what was scheduled, and keeps the envelope quiet until Stop', () => {
    const { host, cutoff, emit, logs } = setup()
    host.apply(envelope, { kind: 'set', at: 6, value: 100 })
    emit({ type: 'parameter', nodeId: 'n', symbol: 'cutoff', value: 800 })
    expect(cutoff.events).toEqual([{ kind: 'set', value: 800, time: 5 }])
    expect(logs.at(-1).message).toMatch(/changed by hand.*paused until you press Stop/)
    host.apply(envelope, { kind: 'set', at: 7, value: 200 })
    expect(cutoff.events).toHaveLength(1)
    host.stop()
    host.apply(envelope, { kind: 'set', at: 9, value: 300 })
    expect(cutoff.events.at(-1)).toMatchObject({ kind: 'set', value: 300, time: 9 })
  })

  it('an edit to a parameter no envelope is playing on, or said twice, changes nothing more', () => {
    const { host, cutoff, emit, logs } = setup()
    host.apply(envelope, { kind: 'set', at: 6, value: 100 })
    emit({ type: 'parameter', nodeId: 'n', symbol: 'other', value: 1 })
    expect(logs).toEqual([])
    emit({ type: 'parameter', nodeId: 'n', symbol: 'cutoff', value: 800 })
    emit({ type: 'parameter', nodeId: 'n', symbol: 'cutoff', value: 900 })
    expect(logs).toHaveLength(1)
    expect(cutoff.events).toHaveLength(1)
  })

  it('is not troubled by an edit before anything has played', () => {
    const { host, emit } = setup()
    expect(() => emit({ type: 'parameter', nodeId: 'n', symbol: 'cutoff', value: 1 })).not.toThrow()
    expect(host.envelopes()).toHaveLength(2)
  })
})

describe('envelopes on the master', () => {
  function withMaster () {
    const gain = fakeParam('master gain')
    const pan = fakeParam('master pan')
    const held = new Set()
    const setMasterCalls = []
    const listeners = new Set()
    const master = { gain: 0.8, pan: 0.2, muted: false }
    const ctx = {
      log: () => {},
      engine: {
        context: { currentTime: 5 },
        masterParam: which => (which === 'gain' ? gain : pan),
        holdMaster: (which, on) => (on ? held.add(which) : held.delete(which)),
        setMaster: value => setMasterCalls.push({ ...value })
      },
      dispatcher: {
        subscribe: fn => { listeners.add(fn); return () => listeners.delete(fn) },
        engineNode: () => null,
        project: { master, envelopes: [{ id: 'g', target: { kind: 'masterGain' }, points: [{ atBeat: 0, value: 1, curve: 'linear' }] }, { id: 'p', target: { kind: 'masterPan' }, points: [{ atBeat: 0, value: 0, curve: 'linear' }] }, { id: 't', target: { kind: 'tempo' }, points: [{ atBeat: 0, value: 120, curve: 'linear' }] }], node: () => null }
      }
    }
    ctx.dispatcher.listeners = listeners
    const emit = event => { for (const fn of listeners) fn(event) }
    return { host: createAutomationHost(ctx), gain, pan, held, master, emit, setMasterCalls, ctx }
  }
  const gainEnv = { id: 'g', target: { kind: 'masterGain' } }
  const panEnv = { id: 'p', target: { kind: 'masterPan' } }

  it('offers the master level and pan envelopes, and not a tempo one it cannot play yet', () => {
    expect(withMaster().host.envelopes().map(e => e.id)).toEqual(['g', 'p'])
  })

  it('schedules on the master\'s own parameters and holds them, so a rebuild of the graph does not cut in', () => {
    const { host, gain, pan, held } = withMaster()
    host.apply(gainEnv, { kind: 'set', at: 6, value: 1 })
    host.apply(panEnv, { kind: 'set', at: 6, value: -1 })
    expect(gain.events).toHaveLength(1)
    expect(pan.events).toHaveLength(1)
    expect([...held].sort()).toEqual(['gain', 'pan'])
  })

  it('on stop lets go of the master and puts level and pan back to what the project holds', () => {
    const { host, gain, pan, held } = withMaster()
    host.apply(gainEnv, { kind: 'set', at: 6, value: 1 })
    host.apply(panEnv, { kind: 'set', at: 6, value: -1 })
    host.stop()
    expect(held.size).toBe(0)
    expect(gain.events).toEqual([{ kind: 'set', value: 0.8, time: 5 }])
    expect(pan.events).toEqual([{ kind: 'set', value: 0.2, time: 5 }])
  })

  it('a muted master plays no level envelope, and stop restores silence', () => {
    const { host, gain, master } = withMaster()
    master.muted = true
    host.apply(gainEnv, { kind: 'set', at: 6, value: 1 })
    expect(gain.events).toEqual([])
    host.stop()
    // Stopping leaves the level where the master's mute puts it.
    expect(gain.events).toEqual([{ kind: 'set', value: 0, time: 5 }])
  })

  it('a change to the master by hand steps the envelope aside, and the engine applies the new value', () => {
    const { host, gain, held, master, emit, setMasterCalls } = withMaster()
    host.apply(gainEnv, { kind: 'set', at: 6, value: 1 })
    emit({ type: 'changed' })
    expect(held.has('gain')).toBe(true)
    master.gain = 0.3
    emit({ type: 'changed' })
    expect(held.has('gain')).toBe(false)
    expect(setMasterCalls).toEqual([{ gain: 0.3, pan: 0.2, muted: false }])
    expect(gain.events).toEqual([])
    host.apply(gainEnv, { kind: 'set', at: 7, value: 0.9 })
    expect(gain.events).toEqual([])
  })
})

