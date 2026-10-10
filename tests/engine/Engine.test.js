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
    // As a real node does: with no argument, everything; with a destination, only that, and an error if it was
    // not connected, which is how a caller that disconnects too much or too little is found out.
    disconnect (destination) {
      if (destination === undefined) { this.outgoing = []; return }
      if (!this.outgoing.some(o => o.destination === destination)) throw new Error('InvalidAccessError: not connected')
      this.outgoing = this.outgoing.filter(o => o.destination !== destination)
    }
  }
}

/** Whether a signal leaving `from` can reach `to` through the recorded connections. */
function reaches (from, to, seen = new Set()) {
  if (from === to) return true
  if (!from || seen.has(from)) return false
  seen.add(from)
  return (from.outgoing ?? []).some(o => reaches(o.destination, to, seen))
}

function fakeContext () {
  return {
    sampleRate: 48000,
    currentTime: 0,
    destination: fakeNode(),
    createGain () {
      const gain = fakeNode()
      gain.gain = { ...fakeParam(), value: 1 }
      return gain
    },
    createAnalyser () {
      const analyser = fakeNode()
      analyser.fftSize = 2048
      return analyser
    },
    createStereoPanner () {
      const panner = fakeNode()
      panner.pan = fakeParam()
      return panner
    },
    createDelay (maxSeconds) {
      const delay = fakeNode()
      delay.delayTime = { ...fakeParam(), value: 0 }
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

describe('track strips', () => {
  const noWorklet = class { }
  const engineWith = () => {
    const context = fakeContext()
    const engine = new Engine({ context, loader: noLoader, AudioWorkletNode: noWorklet })
    return { context, engine }
  }

  it('runs an arrival point into a fader into a panner into the master', () => {
    const { engine } = engineWith()
    engine.addTrack('t1')
    const arrival = engine.trackInput('t1')
    const fader = arrival.outgoing[0].destination
    const panner = fader.outgoing[0].destination
    expect(panner.pan).toBeDefined()
    // Then the master's arrival, its fader input, and its own pan in front of the master, which is still
    // what the speakers hang off.
    const masterArrive = panner.outgoing[0].destination
    const masterPre = masterArrive.outgoing[0].destination
    const masterPan = masterPre.outgoing[0].destination
    expect(masterPan.pan).toBeDefined()
    expect(masterPan.outgoing.map(o => o.destination)).toEqual([engine.master])
    expect(engine.trackIds()).toEqual(['t1'])
  })

  it('connects a node to its track, and lets go of it with the other links', () => {
    const { engine } = engineWith()
    engine.addTrack('t1')
    const source = fakeNode()
    engine.get = () => ({ id: 'a', node: source, profile: { label: 'A', ports: [] } })
    engine.linkToTrack('a', 't1')
    expect(source.outgoing[0].destination).toBe(engine.trackInput('t1'))
    expect(engine.links).toEqual([{ fromId: 'a', toTrack: 't1', delay: null }])
    engine.clearLinks()
    expect(source.outgoing).toEqual([])
    expect(engine.links).toEqual([])
  })

  it('sets level and position, and silences without forgetting the level', () => {
    const { engine } = engineWith()
    engine.addTrack('t1')
    const fader = engine.trackInput('t1').outgoing[0].destination
    const panner = fader.outgoing[0].destination
    engine.setTrackChannel('t1', { gain: 0.5, pan: -0.25, silent: false })
    expect(fader.gain.value).toBe(0.5)
    expect(panner.pan.value).toBe(-0.25)
    engine.setTrackChannel('t1', { gain: 0.5, pan: -0.25, silent: true })
    expect(fader.gain.value).toBe(0)
  })

  it('refuses a strip made twice, and one used or removed that was never made', () => {
    const { engine } = engineWith()
    engine.addTrack('t1')
    expect(() => engine.addTrack('t1')).toThrow(/already exists/)
    expect(() => engine.trackInput('t2')).toThrow(/no such track strip/)
    expect(() => engine.setTrackChannel('t2', {})).toThrow(/no such track strip/)
    expect(() => engine.removeTrack('t2')).toThrow(/no such track strip/)
    engine.removeTrack('t1')
    expect(engine.trackIds()).toEqual([])
  })
})

describe('Engine.retime', () => {
  // A latency message names the frame its figure applies from
  // (docs/latency.md section 2), and the compensation moves there rather
  // than at the message's arrival. These drive retime through the same seam
  // as the link tests above: stubbed entries, fake nodes recording.
  function compensated () {
    const context = fakeContext()
    const engine = new Engine({ context, loader: noLoader, AudioWorkletNode: noWorkletNode })
    const source = fakeNode()
    const target = fakeNode()
    const entries = new Map([
      ['a', { id: 'a', node: source, profile: { label: 'A', ports: [] } }],
      ['b', { id: 'b', node: target, profile: { label: 'B', ports: [] } }]
    ])
    engine.get = id => {
      const entry = entries.get(id)
      if (!entry) throw new Error(`no such node: ${id}`)
      return entry
    }
    engine.link('a', 'b', { connection: 'e1', delayFrames: 480 })
    const delay = source.outgoing[0].destination
    return { engine, context, source, target, delay }
  }

  it('moves an existing delay to the scheduled time, not to now', () => {
    const { engine, delay, context } = compensated()
    context.currentTime = 5
    engine.retime('e1', 960, { atTime: 7 })
    expect(delay.delayTime.scheduled).toEqual([{ value: 960 / context.sampleRate, at: 7 }])
  })

  it('inserts a newly needed delay as a passthrough and switches it at the time', () => {
    const { engine, source, target, context } = compensated()
    engine.link('a', 'b', { connection: 'e2' })
    const direct = source.outgoing.find(o => o.destination === target)
    expect(direct).toBeDefined()
    const before = source.outgoing.length
    engine.retime('e2', 480, { atTime: 3 })
    const delay = source.outgoing[before].destination
    expect(delay.delayTime.scheduled).toEqual([{ value: 480 / context.sampleRate, at: 3 }])
    expect(delay.outgoing).toEqual([{ destination: target, output: 0, input: 0 }])
  })

  it('leaves a delay that falls to zero in place, as a passthrough', () => {
    // Removing a node cannot be scheduled, and a zero delay node changes
    // nothing audible. The next full rebuild clears it.
    const { engine, delay } = compensated()
    engine.retime('e1', 0, { atTime: 9 })
    expect(delay.delayTime.scheduled).toEqual([{ value: 0, at: 9 }])
    expect(engine.links.find(l => l.connection === 'e1').delay).toBe(delay)
  })

  it('does nothing where no delay is needed and none exists', () => {
    const { engine, source, target } = compensated()
    engine.link('a', 'b', { connection: 'e2' })
    engine.retime('e2', 0, { atTime: 1 })
    expect(source.outgoing.filter(o => o.destination === target)).toHaveLength(1)
  })

  it('refuses a connection with no link in the running graph', () => {
    const { engine } = compensated()
    expect(() => engine.retime('nope', 480, { atTime: 1 })).toThrow(/no compensated link/)
  })
})

describe('Engine.frameTime', () => {
  const engineAt = now => {
    const context = fakeContext()
    context.currentTime = now
    return new Engine({ context, loader: noLoader, AudioWorkletNode: noWorkletNode })
  }

  it('reads an absolute stream position as an audio time', () => {
    expect(engineAt(0).frameTime(96000)).toBe(2)
  })

  it('never schedules in the past: a passed frame means already in effect', () => {
    expect(engineAt(5).frameTime(48000)).toBe(5)
  })
})

describe('Engine track delay (aligning tracks)', () => {
  const make = (over = {}) => {
    const context = fakeContext()
    const engine = new Engine({ context, loader: noLoader, AudioWorkletNode: noWorkletNode, ...over })
    return { context, engine }
  }

  it('puts a delay at the end of each strip when the host allows one, and sets it in seconds at an audio time', () => {
    const { context, engine } = make({ maxTrackDelaySeconds: 2 })
    engine.addTrack('t1')
    const strip = engine.trackTap('t1')
    // gain -> panner -> delay -> the master
    const delay = strip.outgoing[0].destination
    expect(delay.maxDelayTime).toBe(2)
    expect(reaches(delay, engine.master)).toBe(true)
    context.currentTime = 1.5
    engine.setTrackDelay('t1', 4800)
    expect(delay.delayTime.scheduled).toEqual([{ value: 0.1, at: 1.5 }])
    engine.setTrackDelay('t1', 0, { atTime: 3 })
    expect(delay.delayTime.scheduled.at(-1)).toEqual({ value: 0, at: 3 })
  })

  it('refuses a delay it was not built for, and one longer than it allows', () => {
    const none = make().engine
    none.addTrack('t1')
    expect(() => none.setTrackDelay('t1', 100)).toThrow(/no track delay/)
    const { engine } = make({ maxTrackDelaySeconds: 0.5 })
    engine.addTrack('t1')
    expect(() => engine.setTrackDelay('t1', 48000)).toThrow(/more than the 500 ms/)
    expect(() => engine.setTrackDelay('t1', -1)).toThrow(/more than/)
    expect(() => engine.setTrackDelay('ghost', 1)).toThrow(/no such track strip/)
  })

  it('leaves the strip wired straight to the master when no delay is built', () => {
    const { engine } = make()
    engine.addTrack('t1')
    expect(reaches(engine.trackTap('t1').outgoing[0].destination, engine.master)).toBe(true)
  })
})

describe('Engine sends, bus outputs and the master', () => {
  const make = () => {
    const context = fakeContext()
    const engine = new Engine({ context, loader: noLoader, AudioWorkletNode: noWorkletNode })
    engine.addTrack('a')
    engine.addTrack('b')
    return { context, engine }
  }
  const strip = (engine, id) => {
    const pre = engine.trackInput(id)
    const fader = pre.outgoing[0].destination
    return { pre, fader, panner: engine.trackTap(id) }
  }

  it('takes a post-fader send after fader and pan, at a level, into the other track', () => {
    const { engine } = make()
    engine.addSend('s1', 'a', 'b', { level: 0.4, tap: 'post' })
    const { panner } = strip(engine, 'a')
    const sendGain = panner.outgoing.find(o => o.destination.gain && o.destination.outgoing?.some(x => x.destination.outgoing.some(y => y.destination === engine.trackInput('b'))))
    expect(sendGain).toBeDefined()
    expect(sendGain.destination.gain.scheduled.at(-1).value).toBe(0.4)
  })

  it('takes a pre-fader send before the fader, so the fader does not change it', () => {
    const { engine } = make()
    engine.addSend('s1', 'a', 'b', { level: 1, tap: 'pre' })
    const { pre } = strip(engine, 'a')
    expect(pre.outgoing.some(o => o.destination.outgoing?.some(x => x.destination.outgoing.some(y => y.destination === engine.trackInput('b'))))).toBe(true)
  })

  it('changes a level in place, and clears every send', () => {
    const { engine } = make()
    engine.addSend('s1', 'a', 'b')
    const { panner } = strip(engine, 'a')
    const gain = panner.outgoing.find(o => o.destination.gain && o.destination.outgoing.some(x => x.destination.outgoing.some(y => y.destination === engine.trackInput('b')))).destination
    engine.setSendLevel('s1', 0.25)
    expect(gain.gain.scheduled.at(-1).value).toBe(0.25)
    engine.clearSends()
    expect(gain.outgoing).toEqual([])
    expect(() => engine.setSendLevel('s1', 1)).toThrow(/no such send/)
  })

  it('refuses a send between strips that are not there, and a tap that is neither pre nor post', () => {
    const { engine } = make()
    expect(() => engine.addSend('s', 'a', 'ghost')).toThrow(/no such track strip: ghost/)
    expect(() => engine.addSend('s', 'ghost', 'a')).toThrow(/no such track strip: ghost/)
    expect(() => engine.addSend('s', 'a', 'b', { tap: 'mid' })).toThrow(/pre or post/)
  })

  it('routes a track into another as a bus, and back to the master, touching the graph only on a change', () => {
    const { engine } = make()
    const out = engine.trackTap('a')
    engine.setTrackOutput('a', 'b')
    // Into the other track's arrival, which feeds its fader when it has no audio input node.
    expect(out.outgoing.at(-1).destination.outgoing[0].destination).toBe(engine.trackInput('b'))
    const count = out.outgoing.length
    engine.setTrackOutput('a', 'b')
    expect(out.outgoing).toHaveLength(count)
    engine.setTrackOutput('a', null)
    expect(reaches(out.outgoing.at(-1).destination, engine.master)).toBe(true)
    expect(reaches(out.outgoing.at(-1).destination, engine.trackInput('b'))).toBe(false)
    expect(() => engine.setTrackOutput('a', 'ghost')).toThrow(/no such track strip/)
    expect(() => engine.setTrackOutput('ghost', null)).toThrow(/no such track strip/)
  })

  it('sets the master level, pan and mute, a mute being a level of zero', () => {
    const { context, engine } = make()
    context.currentTime = 2
    engine.setMaster({ gain: 0.5, pan: -0.5 })
    expect(engine.master.gain.scheduled.at(-1)).toEqual({ value: 0.5, at: 2 })
    engine.setMaster({ gain: 0.5, pan: 0, muted: true })
    expect(engine.master.gain.scheduled.at(-1).value).toBe(0)
  })
})

describe('a track meter tap', () => {
  const make = () => {
    const context = fakeContext()
    const engine = new Engine({ context, loader: noLoader, AudioWorkletNode: noWorkletNode })
    engine.addTrack('a')
    engine.addTrack('b')
    return { context, engine }
  }

  it('listens after the fader and the pan, and is the same analyser each time it is asked for', () => {
    const { engine } = make()
    const meter = engine.trackMeter('a')
    expect(meter.fftSize).toBe(1024)
    expect(engine.trackTap('a').outgoing.map(o => o.destination)).toContain(meter)
    expect(engine.trackMeter('a')).toBe(meter)
    // Not stacked: one tap however often it is asked for.
    expect(engine.trackTap('a').outgoing.filter(o => o.destination === meter)).toHaveLength(1)
  })

  it('stays connected when the track is sent to a bus and back, which only moves where its sound goes', () => {
    const { engine } = make()
    const meter = engine.trackMeter('a')
    engine.setTrackOutput('a', 'b')
    expect(engine.trackTap('a').outgoing.map(o => o.destination)).toContain(meter)
    expect(reaches(engine.trackTap('a'), engine.trackInput('b'))).toBe(true)
    engine.setTrackOutput('a', null)
    expect(engine.trackTap('a').outgoing.map(o => o.destination)).toContain(meter)
    expect(reaches(engine.trackTap('a'), engine.master)).toBe(true)
  })

  it('refuses a track that is not there, and a context that cannot make an analyser', () => {
    const { engine } = make()
    expect(() => engine.trackMeter('ghost')).toThrow(/no such track strip/)
    const context = fakeContext()
    delete context.createAnalyser
    const bare = new Engine({ context, loader: noLoader, AudioWorkletNode: noWorkletNode })
    bare.addTrack('a')
    expect(() => bare.trackMeter('a')).toThrow(/cannot make an analyser/)
  })
})

describe('arrival points and the master chain', () => {
  const make = () => {
    const context = fakeContext()
    const engine = new Engine({ context, loader: noLoader, AudioWorkletNode: noWorkletNode })
    engine.addTrack('a')
    engine.addTrack('bus')
    // Entries are placed directly: the thing under test is the wiring, which only ever sees entries.
    const effect = Object.assign(fakeNode(), { numberOfInputs: 1 })
    const instrument = Object.assign(fakeNode(), { numberOfInputs: 0 })
    engine.get = id => ({ effect: { id, node: effect }, instrument: { id, node: instrument } }[id])
    return { engine, effect, instrument }
  }

  it('lets audio from another track reach the fader when the track has no audio input node', () => {
    const { engine } = make()
    engine.setTrackOutput('a', 'bus')
    expect(reaches(engine.trackTap('a'), engine.trackInput('bus'))).toBe(true)
  })

  it('sends it through the audio input node instead, so a plugin on a bus is in the path', () => {
    const { engine, effect } = make()
    engine.setTrackOutput('a', 'bus')
    engine.setTrackArrival('bus', 'effect')
    expect(reaches(engine.trackTap('a'), effect)).toBe(true)
    // The arrival no longer reaches the fader by itself: only what the effect passes on does.
    expect(reaches(engine.trackTap('a'), engine.trackInput('bus'))).toBe(false)
    engine.linkToTrack('effect', 'bus')
    expect(reaches(engine.trackTap('a'), engine.trackInput('bus'))).toBe(true)
    expect(reaches(effect, engine.master)).toBe(true)
  })

  it('does the same for a send, and goes back to the fader when the input is cleared', () => {
    const { engine, effect } = make()
    engine.addSend('s1', 'a', 'bus', { level: 1, tap: 'post' })
    engine.setTrackArrival('bus', 'effect')
    expect(reaches(engine.trackTap('a'), effect)).toBe(true)
    engine.setTrackArrival('bus', null)
    expect(reaches(engine.trackTap('a'), engine.trackInput('bus'))).toBe(true)
    expect(reaches(engine.trackTap('a'), effect)).toBe(false)
  })

  it('touches the graph only when the destination changed', () => {
    const { engine } = make()
    const before = engine.trackTap('a').outgoing.length
    engine.setTrackArrival('bus', 'effect')
    engine.setTrackArrival('bus', 'effect')
    expect(engine.trackTap('a').outgoing).toHaveLength(before)
  })

  it('refuses a node with no audio input, and a track that is not there', () => {
    const { engine } = make()
    expect(() => engine.setTrackArrival('bus', 'instrument')).toThrow(/no audio input/)
    expect(() => engine.setTrackArrival('ghost', null)).toThrow(/no such track strip/)
    expect(() => engine.setMasterArrival('instrument')).toThrow(/no audio input/)
  })

  it('puts the mix of every track through the master\'s audio input node, then its pan and level', () => {
    const { engine, effect } = make()
    // Without one, the tracks reach the master directly.
    expect(reaches(engine.trackTap('a'), engine.master)).toBe(true)
    engine.setMasterArrival('effect')
    expect(reaches(engine.trackTap('a'), effect)).toBe(true)
    // The master's pre-fader input is where a plugin on the master sounds through.
    expect(reaches(engine.trackTap('a'), engine.trackInput('master'))).toBe(false)
    engine.linkToTrack('effect', 'master')
    expect(reaches(engine.trackTap('a'), engine.master)).toBe(true)
    expect(reaches(effect, engine.master)).toBe(true)
    engine.setMasterArrival(null)
    expect(reaches(engine.trackTap('a'), effect)).toBe(false)
    expect(reaches(engine.trackTap('a'), engine.master)).toBe(true)
  })

  it('has a master fader input only where the context can make a gain', () => {
    const context = fakeContext()
    delete context.createGain
    const engine = new Engine({ context, loader: noLoader, AudioWorkletNode: noWorkletNode })
    expect(() => engine.trackInput('master')).toThrow(/no master/)
    expect(() => engine.setMasterArrival(null)).not.toThrow()
  })
})

describe('the master under an envelope', () => {
  const make = () => {
    const context = fakeContext()
    return { context, engine: new Engine({ context, loader: noLoader, AudioWorkletNode: noWorkletNode }) }
  }

  it('gives out the master\'s level, and its pan where the context has one, and refuses anything else', () => {
    const { engine } = make()
    expect(engine.masterParam('gain')).toBe(engine.master.gain)
    expect(() => engine.masterParam('width')).toThrow(/no width/)
    expect(() => engine.holdMaster('width', true)).toThrow(/no width/)
  })

  it('leaves a held parameter alone when the master is set, and sets it again when let go', () => {
    const { context, engine } = make()
    context.currentTime = 3
    engine.holdMaster('gain', true)
    engine.setMaster({ gain: 0.4, pan: 0 })
    expect(engine.master.gain.scheduled).toEqual([])
    engine.holdMaster('gain', false)
    engine.setMaster({ gain: 0.4, pan: 0 })
    expect(engine.master.gain.scheduled.at(-1)).toEqual({ value: 0.4, at: 3 })
  })
})

describe('Engine live input (a microphone into a track)', () => {
  const make = () => {
    const context = fakeContext()
    const sources = []
    context.createMediaStreamSource = stream => { const s = fakeNode(); s.stream = stream; sources.push(s); return s }
    const engine = new Engine({ context, loader: noLoader, AudioWorkletNode: noWorkletNode })
    engine.addTrack('m')
    return { context, engine, sources }
  }
  const fakeStream = () => { const stopped = []; return { stopped, getTracks: () => [{ stop: () => stopped.push(1) }, { stop: () => stopped.push(2) }] } }

  it('feeds a stream into the track arrival point, and taps it before the fader when asked', () => {
    const { engine, sources } = make()
    engine.openInput('m', fakeStream())
    expect(sources[0].outgoing[0].destination).toBe(engine.trackInput('m'))
    expect(engine.trackTap('m', { pre: true })).toBe(engine.trackInput('m'))
    expect(engine.trackTap('m')).not.toBe(engine.trackInput('m'))
  })

  it('lets go of the input and stops every track of the stream, so the recording light goes out', () => {
    const { engine, sources } = make()
    const stream = fakeStream()
    engine.openInput('m', stream)
    engine.closeInput('m')
    expect(sources[0].outgoing).toEqual([])
    expect(stream.stopped).toEqual([1, 2])
    expect(() => engine.closeInput('m')).not.toThrow()
  })

  it('a second stream replaces the first, and removing the track lets go of its input', () => {
    const { engine } = make()
    const a = fakeStream()
    const b = fakeStream()
    engine.openInput('m', a)
    engine.openInput('m', b)
    expect(a.stopped).toHaveLength(2)
    engine.removeTrack('m')
    expect(b.stopped).toHaveLength(2)
  })

  it('refuses a strip that is not there, and a context that cannot take a live input', () => {
    const { engine } = make()
    expect(() => engine.openInput('ghost', fakeStream())).toThrow(/no such track strip/)
    const bare = new Engine({ context: fakeContext(), loader: noLoader, AudioWorkletNode: noWorkletNode })
    bare.addTrack('m')
    expect(() => bare.openInput('m', fakeStream())).toThrow(/cannot take a live input/)
  })
})
