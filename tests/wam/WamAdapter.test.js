// tests/wam/WamAdapter.test.js
//
// The engine asks a node for a parameter map, a port, and the AudioNode
// methods. A WamNode answers none of those the way a JigDAW processor does, and
// this is the translation. What it can translate is asserted here; what it
// cannot is asserted too, because a lossy conversion that nobody wrote down
// becomes a bug report about timing three months later.
//
// A stub WamNode rather than a real one: tests/wam/WamModule.test.js already
// runs a real plugin, and web/foreign/probe.html runs a real Web Audio Module
// in a browser. What is under test here is the translation, and a stub is the
// only way to assert that a specific WAM call was made.
import { describe, it, expect, beforeEach } from 'vitest'
import { adoptWamNode, foreignProfile } from '../../src/wam/WamAdapter.js'

const INFO = {
  time: { label: 'Time', type: 'float', defaultValue: 375, minValue: 10, maxValue: 2000, choices: [] },
  mode: { label: 'Mode', type: 'choice', defaultValue: 0, minValue: 0, maxValue: 2, choices: ['Plate', 'Hall', 'Bloom'] },
  bypass: { label: 'Bypass', type: 'boolean', defaultValue: 0, minValue: 0, maxValue: 1, choices: [] }
}

/** Only what the adapter touches, and a record of every call it made. */
function stubWam (over = {}) {
  const calls = { setParameterValues: [], scheduleEvents: [], destroy: 0, getState: 0 }
  const listeners = new Map()
  const node = {
    context: { currentTime: 1.5, sampleRate: 48000 },
    async getParameterInfo () { return INFO },
    async setParameterValues (values) { calls.setParameterValues.push(values) },
    async getState () { calls.getState++; return { preset: 'a' } },
    destroy () { calls.destroy++ },
    scheduleEvents (...events) { calls.scheduleEvents.push(...events) },
    addEventListener (type, fn) {
      if (!listeners.has(type)) listeners.set(type, new Set())
      listeners.get(type).add(fn)
    },
    connect () {}, disconnect () {}
  }
  const wam = {
    audioNode: node,
    descriptor: { name: 'Ping Pong Delay', vendor: 'example', description: 'A delay.', hasAudioInput: true, hasAudioOutput: true },
    ...over
  }
  return { wam, node, calls, emit: (type, detail) => { for (const fn of listeners.get(type) ?? []) fn({ detail }) } }
}

describe('a WAM adopted as an engine node', () => {
  let stub
  let node
  beforeEach(async () => { stub = stubWam(); node = await adoptWamNode(stub.wam) })

  it('answers parameters.get, which is how the engine sets a value', async () => {
    expect(node.parameters.get('time')).toBeTruthy()
    expect(node.parameters.get('nonesuch')).toBeUndefined()
    expect([...node.parameters.keys()].sort()).toEqual(['bypass', 'mode', 'time'])
  })

  it('carries the range the engine clamps against', () => {
    const time = node.parameters.get('time')
    expect(time.minValue).toBe(10)
    expect(time.maxValue).toBe(2000)
    expect(time.defaultValue).toBe(375)
  })

  it('turns setValueAtTime into a WAM parameter write', () => {
    node.parameters.get('time').setValueAtTime(500, 0)
    expect(stub.calls.setParameterValues).toEqual([{ time: { id: 'time', value: 500, normalized: false } }])
    expect(node.parameters.get('time').value).toBe(500)
  })

  it('applies a ramp immediately, because WAM cannot accept a time', () => {
    // Stated as a test rather than a comment. WAM's setParameterValues takes no
    // time, so a JigDAW automation curve becomes a series of immediate writes.
    // Audible on a fast sweep, and the reason contract section 12.6 says the
    // real-time rules still apply to the adapter rather than being met by it.
    node.parameters.get('time').linearRampToValueAtTime(900, 99)
    expect(stub.calls.setParameterValues.at(-1)).toEqual({ time: { id: 'time', value: 900, normalized: false } })
  })

  it('does not throw on the rest of the AudioParam surface', () => {
    const time = node.parameters.get('time')
    expect(() => time.setTargetAtTime(1, 0, 1)).not.toThrow()
    expect(() => time.cancelScheduledValues(0)).not.toThrow()
  })
})

describe('the port the engine posts to', () => {
  let stub
  let node
  beforeEach(async () => { stub = stubWam(); node = await adoptWamNode(stub.wam) })

  it('turns an events message into scheduled MIDI', () => {
    node.port.postMessage({ type: 'events', events: [{ frame: 64, bytes: Uint8Array.from([0x90, 60, 100]) }] })
    expect(stub.calls.scheduleEvents).toHaveLength(1)
    expect(stub.calls.scheduleEvents[0].type).toBe('wam-midi')
    expect(stub.calls.scheduleEvents[0].data.bytes).toEqual([0x90, 60, 100])
  })

  it('turns a transport message into a WAM transport event', () => {
    node.port.postMessage({ type: 'transport', playing: true, tempo: 128, beat: 9, timeSignature: [4, 4] })
    const event = stub.calls.scheduleEvents[0]
    expect(event.type).toBe('wam-transport')
    expect(event.data.tempo).toBe(128)
    expect(event.data.playing).toBe(true)
    expect(event.data.currentBar).toBe(2)
  })

  it('answers a stateRequest with the token it was given', async () => {
    const seen = []
    node.port.onmessage = event => seen.push(event.data)
    node.port.postMessage({ type: 'stateRequest', token: 7 })
    await new Promise(r => setTimeout(r, 0))
    expect(stub.calls.getState).toBe(1)
    expect(seen).toEqual([{ type: 'state', token: 7, state: { preset: 'a' } }])
  })

  it('turns dispose into destroy', () => {
    node.port.postMessage({ type: 'dispose' })
    expect(stub.calls.destroy).toBe(1)
  })

  it('refuses init rather than ignoring it', async () => {
    // A foreign plugin is already instantiated by the time the adapter exists.
    // A caller that sends init has misunderstood something, and silence would
    // let it keep believing.
    const seen = []
    node.port.onmessage = event => seen.push(event.data)
    node.port.postMessage({ type: 'init', module: new ArrayBuffer(8) })
    expect(seen[0]).toMatchObject({ type: 'error', phase: 'instantiate', fatal: true })
  })

  it('reports MIDI the plugin emits as a JigDAW events message', () => {
    const seen = []
    node.port.onmessage = event => seen.push(event.data)
    stub.emit('wam-midi', { type: 'wam-midi', data: { bytes: [0x90, 64, 90] } })
    expect(seen).toHaveLength(1)
    expect(seen[0].type).toBe('events')
    expect([...seen[0].events[0].bytes]).toEqual([0x90, 64, 90])
  })
})

describe('the profile the panel is drawn from', () => {
  it('comes from the plugin, not from what the profile claimed', async () => {
    // The declared ports in a foreign profile are a description by whoever
    // catalogued it. These are the plugin's own answer, and they are what the
    // host must draw, because the plugin is the authority on its parameters.
    const stub = stubWam()
    const declared = { iri: 'https://example.org/wam/p/', label: 'Stale Name', ports: [] }
    const profile = await foreignProfile(declared, stub.wam)

    expect(profile.kind).toBe('foreign')
    expect(profile.label).toBe('Ping Pong Delay')
    expect(profile.ports.map(p => p.symbol).sort()).toEqual(['bypass', 'mode', 'time'])
  })

  it('chooses a widget by the same rule a native plugin gets', async () => {
    // Contract section 5.3: the shape of the declaration decides, never a name.
    // A foreign panel and a native one come out of one set of decisions.
    const profile = await foreignProfile({ iri: 'https://example.org/wam/p/' }, stubWam().wam)
    const widget = symbol => profile.ports.find(p => p.symbol === symbol).widget
    expect(widget('bypass')).toBe('switch')
    expect(widget('mode')).toBe('selector')
    expect(widget('time')).toBe('dial')
  })

  it('names the choices a selector offers', async () => {
    const profile = await foreignProfile({ iri: 'https://example.org/wam/p/' }, stubWam().wam)
    expect(profile.ports.find(p => p.symbol === 'mode').scalePoints)
      .toEqual([{ label: 'Plate', value: 0 }, { label: 'Hall', value: 1 }, { label: 'Bloom', value: 2 }])
  })

  it('marks a plugin with no audio as needing to be driven', async () => {
    // Web Audio pulls from the destination, so a node with no outputs and no
    // inputs is never called. The engine drives it with a constant source, and
    // this is the flag it looks for.
    const silent = stubWam({ descriptor: { name: 'Gen', hasAudioInput: false, hasAudioOutput: false } })
    const node = await adoptWamNode(silent.wam)
    expect(node.jigdawNeedsDriving).toBe(true)
    expect((await adoptWamNode(stubWam().wam)).jigdawNeedsDriving).toBe(false)
  })
})
