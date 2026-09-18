// tests/engine/Engine.test.js
//
// The engine was covered only through the dispatcher, whose fake engine records
// the options it is handed and connects nothing. That is enough to prove the
// dispatcher decided correctly and says nothing about whether the connection was
// made, which is exactly where a parameter endpoint was being lost: the symbol
// reached Engine.link and Engine.link ignored it.
//
// The fakes here are the two things node does not have, an AudioContext and an
// AudioNode, and they record what was connected to what so the assertions are
// about connections rather than about arguments.
import { describe, it, expect } from 'vitest'
import { Engine } from '../../src/engine/Engine.js'

// Nothing here loads a plugin. The entries are placed directly, because the
// thing under test is link, which only ever sees entries.
const noLoader = { loadProfile: async () => { throw new Error('not used') } }
// Injected rather than read from the global, which is the seam that lets the
// engine be driven without a browser. Nothing here constructs one.
const noWorkletNode = class { }

/** An AudioParam that remembers what was connected into it. */
const fakeParam = () => ({
  value: 0,
  scheduled: [],
  incoming: [],
  setValueAtTime (value, at) { this.value = value; this.scheduled.push({ value, at }) }
})

/** An AudioNode that records its outgoing connections. */
function fakeNode (parameters = {}) {
  return {
    parameters: new Map(Object.entries(parameters)),
    outgoing: [],
    connect (destination, output = 0, input) {
      this.outgoing.push({ destination, output, input })
      if (destination && Array.isArray(destination.incoming)) {
        destination.incoming.push({ from: this, output })
      }
    },
    disconnect () { this.outgoing = [] }
  }
}

function fakeContext () {
  return {
    sampleRate: 48000,
    currentTime: 0,
    destination: fakeNode(),
    createGain () {
      const gain = fakeNode()
      gain.gain = { value: 1 }
      return gain
    },
    createDelay (maxSeconds) {
      const delay = fakeNode()
      delay.delayTime = { value: 0 }
      delay.maxDelayTime = maxSeconds
      return delay
    }
  }
}

describe('Engine.link', () => {
  // The engine keeps its nodes privately and only addPlugin fills them, so these
  // drive link through a subclass-free seam: a stub get().
  function linkable () {
    const context = fakeContext()
    const engine = new Engine({ context, loader: noLoader, AudioWorkletNode: noWorkletNode })
    const mix = fakeParam()
    const source = fakeNode()
    const target = fakeNode({ mix })
    const entries = new Map([
      ['a', { id: 'a', node: source, profile: { label: 'A', ports: [] } }],
      ['b', { id: 'b', node: target, profile: { label: 'B', ports: [{ symbol: 'mix', minimum: 0, maximum: 1 }] } }]
    ])
    engine.get = id => {
      const entry = entries.get(id)
      if (!entry) throw new Error(`no such node: ${id}`)
      return entry
    }
    return { engine, context, source, target, mix }
  }

  it('connects a node to a node, by output and input index', () => {
    const { engine, source, target } = linkable()
    engine.link('a', 'b', { fromOutput: 0, toInput: 0 })
    expect(source.outgoing).toEqual([{ destination: target, output: 0, input: 0 }])
  })

  it('connects a node to a parameter when the endpoint names one', () => {
    // The fix. An endpoint carrying jig:portSymbol modulates a parameter, and
    // Web Audio sums that into the parameter's own value.
    const { engine, source, mix, target } = linkable()
    engine.link('a', 'b', { toParameter: 'mix' })
    expect(source.outgoing).toHaveLength(1)
    expect(source.outgoing[0].destination).toBe(mix)
    expect(mix.incoming).toHaveLength(1)
    // Not the node, which is where it used to go.
    expect(source.outgoing[0].destination).not.toBe(target)
  })

  it('does not give a parameter an input index, because it has none', () => {
    const { engine, source } = linkable()
    engine.link('a', 'b', { toParameter: 'mix', toInput: 3 })
    expect(source.outgoing[0].input).toBeUndefined()
  })

  it('refuses a parameter the plugin does not have, by name', () => {
    // Silently connecting somewhere else is what this replaces.
    const { engine } = linkable()
    expect(() => engine.link('a', 'b', { toParameter: 'nosuch' }))
      .toThrow(/has no parameter "nosuch"/)
  })

  it('compensates a modulation edge through a delay, into the parameter', () => {
    // Latency compensation does not stop applying because the destination is a
    // parameter: the signal still arrives late and still has to be aligned.
    const { engine, source, mix, context } = linkable()
    engine.link('a', 'b', { toParameter: 'mix', delayFrames: 480 })
    expect(source.outgoing).toHaveLength(1)
    const delay = source.outgoing[0].destination
    expect(delay.delayTime.value).toBeCloseTo(480 / context.sampleRate, 10)
    expect(delay.outgoing[0].destination).toBe(mix)
    expect(delay.outgoing[0].input).toBeUndefined()
  })

  it('compensates an audio edge through a delay, into the input index', () => {
    const { engine, source, target, context } = linkable()
    engine.link('a', 'b', { toInput: 1, delayFrames: 240 })
    const delay = source.outgoing[0].destination
    expect(delay.delayTime.value).toBeCloseTo(240 / context.sampleRate, 10)
    expect(delay.outgoing[0]).toEqual({ destination: target, output: 0, input: 1 })
  })

  it('reaches the speakers through the master, not straight past it', () => {
    // One place everything arrives, so there is one thing to measure and one
    // place a master level can live.
    const { engine, source, context } = linkable()
    engine.link('a', 'output', {})
    expect(source.outgoing[0].destination).toBe(engine.master)
    expect(engine.master.outgoing[0].destination).toBe(context.destination)
  })
})

describe('Engine.clampParameter', () => {
  function withPorts (ports) {
    const engine = new Engine({ context: fakeContext(), loader: noLoader, AudioWorkletNode: noWorkletNode })
    engine.get = () => ({ node: fakeNode(), profile: { label: 'P', ports } })
    return engine
  }

  it('clamps to the declared range', () => {
    const engine = withPorts([{ symbol: 'mix', minimum: 0, maximum: 1 }])
    expect(engine.clampParameter('x', 'mix', 99)).toBe(1)
    expect(engine.clampParameter('x', 'mix', -5)).toBe(0)
    expect(engine.clampParameter('x', 'mix', 0.25)).toBe(0.25)
  })

  it('reads the range from the profile, which is the single declaration', () => {
    // Contract section 5.1: one declaration, from which both the parameter and
    // the widget are derived. Reading it from the live AudioParam instead would
    // be reading it from something derived.
    const engine = withPorts([{ symbol: 'cutoff', minimum: 100, maximum: 18000 }])
    expect(engine.clampParameter('x', 'cutoff', 1e9)).toBe(18000)
  })

  it('refuses a symbol the plugin does not declare', () => {
    const engine = withPorts([{ symbol: 'mix', minimum: 0, maximum: 1 }])
    expect(() => engine.clampParameter('x', 'nope', 1)).toThrow(/has no parameter "nope"/)
  })

  it('does not apply anything', () => {
    // The whole reason it is separate: a caller records the value it is about to
    // apply before applying it, so one edit is one revision.
    const engine = new Engine({ context: fakeContext(), loader: noLoader, AudioWorkletNode: noWorkletNode })
    const mix = fakeParam()
    engine.get = () => ({ node: fakeNode({ mix }), profile: { label: 'P', ports: [{ symbol: 'mix', minimum: 0, maximum: 1 }] } })
    engine.clampParameter('x', 'mix', 0.5)
    expect(mix.scheduled).toEqual([])
  })
})

describe('the master', () => {
  const noWorklet = class { }

  it('is the only thing connected to the speakers', () => {
    const context = fakeContext()
    const engine = new Engine({ context, loader: noLoader, AudioWorkletNode: noWorklet })
    expect(engine.master).not.toBe(context.destination)
    expect(engine.master.outgoing).toEqual([
      { destination: context.destination, output: 0, input: undefined }
    ])
  })

  it('goes wherever the host says, so a meter measures the mix', () => {
    // The page used to tap each node separately, which measures one voice of
    // several. Handing the engine its output means one meter measures what you
    // actually hear, and the page never rewires what the engine built.
    const context = fakeContext()
    const meter = fakeNode()
    const engine = new Engine({ context, loader: noLoader, output: meter, AudioWorkletNode: noWorklet })
    expect(engine.master.outgoing[0].destination).toBe(meter)
    expect(engine.master.outgoing.map(o => o.destination)).not.toContain(context.destination)
  })

  it('is what "output" resolves to', () => {
    const context = fakeContext()
    const engine = new Engine({ context, loader: noLoader, AudioWorkletNode: noWorklet })
    const source = fakeNode()
    engine.get = () => ({ id: 'a', node: source, profile: { label: 'A', ports: [] } })
    engine.link('a', 'output', {})
    expect(source.outgoing[0].destination).toBe(engine.master)
  })

  it('falls back to the destination in a context that cannot make a gain', () => {
    // The offline test host supplies only what it needs to. A missing createGain
    // must not stop the engine being constructed.
    const context = fakeContext()
    delete context.createGain
    const engine = new Engine({ context, loader: noLoader, AudioWorkletNode: noWorklet })
    expect(engine.master).toBe(context.destination)
  })
})
