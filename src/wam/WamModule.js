// src/wam/WamModule.js
//
// A JigDAW plugin as a Web Audio Module, for hosts that speak WAM 2.0 rather
// than this contract.
//
// `bin/wam.js` bakes a plugin's profile into a data object at build time and
// bundles it with this file. Nothing here parses RDF: by the time this runs,
// every question the profile answers has already been answered, which is why
// the whole package is a few kilobytes rather than the 1.7 MB a Turtle parser
// costs in a browser.
//
// Two things survive the translation that a WAM host would not otherwise have.
//
// **Integrity.** The WAM API has no concept of it: no digest, no hash, nothing.
// The digests come from the profile and are checked here before anything is
// registered or instantiated, exactly as contract section 3.2 requires, in a
// host that never asked for it.
//
// **A sandboxed interface.** `createGui` must return an `Element`, and an
// iframe is an Element, so the cross-origin sandbox that contract section 9.1
// requires and the WAM contract are satisfied by the same object. A plugin with
// no `jig:ui` gets nothing here and the host draws its own controls from the
// parameter info, which is what WAM hosts do anyway.
//
// What does not survive is stated rather than hidden: see PARAMETER NOTE below.
import { instantiate } from '../host/Instantiate.js'
import { verifyIntegrity } from '../host/Integrity.js'
import { LoadError, STEPS } from '../host/LoadError.js'

/** Seconds on the WebAudio clock to absolute frames, which is what JigDAW uses. */
const framesOf = (time, sampleRate, currentTime) =>
  Math.max(0, Math.round((time ?? currentTime) * sampleRate))

/**
 * Fetch and verify, with no RDF anywhere.
 *
 * The same shape as PluginLoader.fetchVerified and for the same reason: there
 * is no continue-anyway path. A WAM host cannot ask for one because it does not
 * know this exists.
 */
function verifiedFetch (fetchImpl) {
  return async (resource, { kind }) => {
    if (!resource?.location) {
      throw new LoadError(STEPS.fetchResource, `no location for the ${kind}`)
    }
    let response
    try {
      response = await fetchImpl(resource.location)
    } catch (cause) {
      throw new LoadError(STEPS.fetchResource,
        `could not fetch the ${kind} at ${resource.location}: ${cause?.message ?? cause}. ` +
        'If it is on another origin, it must be served with Access-Control-Allow-Origin.',
        { cause })
    }
    if (!response.ok) {
      throw new LoadError(STEPS.fetchResource, `the ${kind} at ${resource.location} returned ${response.status}`)
    }
    const bytes = new Uint8Array(await response.arrayBuffer())
    try {
      await verifyIntegrity(bytes, resource.integrity)
    } catch (cause) {
      throw new LoadError(STEPS.integrity,
        `the ${kind} at ${resource.location} failed verification: ${cause.message}`, { cause })
    }
    return bytes
  }
}

/** WamParameterInfo, from the table baked in at build time. */
function parameterInfo (parameters) {
  const info = {}
  for (const p of parameters) {
    const span = p.maxValue - p.minValue
    info[p.id] = {
      ...p,
      normalize: value => span === 0 ? 0 : (value - p.minValue) / span,
      denormalize: norm => p.minValue + norm * span,
      valueString: value => p.choices.length > 0
        ? (p.choices[Math.round(value)] ?? String(value))
        : `${value}${p.units ? ` ${p.units}` : ''}`
    }
  }
  return info
}

/**
 * Event listeners, without assuming the node is an EventTarget.
 *
 * A real AudioWorkletNode is one, so in a browser this delegates and a host's
 * other listeners are untouched. An offline harness node is not, and a plugin
 * that only works where the node happens to inherit from EventTarget is a
 * plugin nothing can render deterministically. Found by the offline test
 * throwing on dispatchEvent.
 */
function listeners (node) {
  if (typeof node.addEventListener === 'function') {
    return {
      add: (type, listener, options) => node.addEventListener(type, listener, options),
      remove: (type, listener, options) => node.removeEventListener(type, listener, options),
      dispatch: event => node.dispatchEvent(event)
    }
  }
  const registry = new Map()
  return {
    add: (type, listener) => {
      if (!registry.has(type)) registry.set(type, new Set())
      registry.get(type).add(listener)
    },
    remove: (type, listener) => registry.get(type)?.delete(listener),
    dispatch: event => {
      for (const listener of registry.get(event.type) ?? []) listener(event)
      return true
    }
  }
}

/**
 * Subscribe to a MessagePort without assuming it is an EventTarget.
 *
 * A real MessagePort is one. The offline harness's is not, and neither is any
 * other stand-in built to the shape PluginLoader actually uses, which is
 * `port.onmessage = ...`. Chaining rather than assigning, so that a host or a
 * later subscriber that set one keeps receiving.
 */
function onPortMessage (port, handler) {
  if (typeof port.addEventListener === 'function') {
    port.addEventListener('message', handler)
    port.start?.()
    return
  }
  const previous = port.onmessage
  port.onmessage = event => {
    previous?.call(port, event)
    handler(event)
  }
}

/** A CustomEvent, or a plain stand-in where the environment has none. */
const customEvent = (type, detail) =>
  typeof CustomEvent === 'function' ? new CustomEvent(type, { detail }) : { type, detail }

/**
 * The AudioNode a WAM host connects to.
 *
 * It is the plugin's own AudioWorkletNode with the WamNode interface added,
 * rather than a wrapper around it. Wrapping would put a node in the signal path
 * that the latency figure does not account for.
 */
function asWamNode (node, module, data) {
  const events = listeners(node)
  const info = parameterInfo(data.parameters)
  const byId = new Map(data.parameters.map(p => [p.id, p]))
  let stateToken = 0
  const pending = new Map()

  onPortMessage(node.port, event => {
    const message = event.data
    if (message?.type === 'state' && pending.has(message.token)) {
      pending.get(message.token)(message.state)
      pending.delete(message.token)
    }
    if (message?.type === 'events') {
      for (const e of message.events ?? []) {
        events.dispatch(customEvent('wam-midi', { type: 'wam-midi', data: { bytes: [...e.bytes] } }))
      }
    }
    if (message?.type === 'latency') module.latencyFrames = message.latencyFrames
  })

  return Object.assign(node, {
    module,

    // Named explicitly rather than inherited, so that the node satisfies WamNode
    // whether or not it happens to be an EventTarget.
    addEventListener: (type, listener, options) => events.add(type, listener, options),
    removeEventListener: (type, listener, options) => events.remove(type, listener, options),
    dispatchEvent: event => events.dispatch(event),

    groupId: module.groupId,
    moduleId: module.moduleId,
    instanceId: module.instanceId,

    async getParameterInfo (...ids) {
      if (ids.length === 0) return info
      return Object.fromEntries(ids.filter(id => id in info).map(id => [id, info[id]]))
    },

    async getParameterValues (normalized = false, ...ids) {
      const wanted = ids.length > 0 ? ids : [...byId.keys()]
      const values = {}
      for (const id of wanted) {
        const param = node.parameters.get(id)
        if (!param) continue
        const value = param.value
        values[id] = { id, value: normalized ? info[id].normalize(value) : value, normalized }
      }
      return values
    },

    // PARAMETER NOTE. WAM addresses parameters through this method and through
    // wam-automation events; JigDAW parameters are AudioParams and
    // messaging.md section 1.5 forbids sending them as messages. The bridge is
    // here, and it is lossy in one direction only: a WAM host cannot express
    // a-rate automation, because WAM has no a-rate concept, so audio-rate
    // modulation of a port declared jig:ARate degrades to k-rate steps. Said
    // out loud because the alternative is a plugin author discovering it.
    async setParameterValues (values) {
      for (const [id, data] of Object.entries(values ?? {})) {
        const param = node.parameters.get(id)
        if (!param) continue
        const value = data.normalized ? info[id].denormalize(data.value) : data.value
        param.setValueAtTime(value, node.context.currentTime)
      }
    },

    getState () {
      const token = ++stateToken
      return new Promise(resolve => {
        pending.set(token, resolve)
        node.port.postMessage({ type: 'stateRequest', token })
      })
    },

    async setState (state) {
      node.port.postMessage({ type: 'state', state })
    },

    async getCompensationDelay () { return module.latencyFrames },

    scheduleEvents (...events) {
      const midi = []
      for (const event of events) {
        if (event?.type === 'wam-midi' || event?.type === 'wam-mpe') {
          midi.push({
            frame: framesOf(event.time, node.context.sampleRate, node.context.currentTime),
            bytes: Uint8Array.from(event.data.bytes)
          })
        } else if (event?.type === 'wam-automation') {
          this.setParameterValues({ [event.data.id]: event.data })
        } else if (event?.type === 'wam-transport') {
          node.port.postMessage({ type: 'transport', ...transportOf(event.data, node.context.sampleRate) })
        }
      }
      // Batched, because each postMessage costs a structured clone and a task
      // and a dense passage produces hundreds of events a second.
      if (midi.length > 0) {
        midi.sort((a, b) => a.frame - b.frame)
        node.port.postMessage({ type: 'events', events: midi })
      }
    },

    clearEvents () { node.port.postMessage({ type: 'events', events: [] }) },

    // Event connections between WAMs run on the audio thread through WamGroup.
    // This package does not join one: its processor is the plugin author's own
    // AudioWorkletProcessor, not a WamProcessor, so there is nothing for a
    // group to route to. Refusing loudly beats appearing to connect.
    connectEvents () {
      throw new Error(
        `${data.descriptor.name} does not implement audio-thread event connections. ` +
        'Route its MIDI through the host, or use a WamProcessor-based build.')
    },
    disconnectEvents () {},

    destroy () {
      node.port.postMessage({ type: 'dispose' })
      node.disconnect()
    }
  })
}

/** WamTransportData to the JigDAW transport message. */
function transportOf (data, sampleRate) {
  const beatsPerSecond = (data.tempo ?? 120) / 60
  return {
    playing: !!data.playing,
    frame: framesOf(data.currentBarStarted, sampleRate, 0),
    beat: (data.currentBar ?? 0) * (data.timeSigNumerator ?? 4),
    beatsPerFrame: beatsPerSecond / sampleRate,
    tempo: data.tempo ?? 120,
    timeSignature: [data.timeSigNumerator ?? 4, data.timeSigDenominator ?? 4]
  }
}

/**
 * Build the WebAudioModule constructor for one baked plugin.
 *
 * A factory rather than a class to subclass, because the generated index.js has
 * exactly one plugin in it and nothing to extend.
 */
export function webAudioModule (data, {
  // Injected for the same reason PluginLoader injects them: a browser's fetch
  // throws "Illegal invocation" when detached from its receiver, and an offline
  // harness has to supply its own node class to run a processor without a
  // device. A test that stubs neither proves nothing about either.
  fetch: fetchImpl = (...a) => globalThis.fetch(...a),
  AudioWorkletNode = undefined,
  processorUrl = undefined
} = {}) {
  let counter = 0

  class JigdawWebAudioModule {
    static isWebAudioModuleConstructor = true

    static async createInstance (groupId, audioContext, initialState) {
      const wam = new JigdawWebAudioModule(groupId, audioContext)
      await wam.initialize(initialState)
      return wam
    }

    constructor (groupId, audioContext) {
      this.groupId = groupId
      this.audioContext = audioContext
      this.moduleId = data.descriptor.identifier
      this.instanceId = `${data.descriptor.identifier}#${++counter}`
      this.initialized = false
      this.audioNode = null
      this.latencyFrames = 0
    }

    get isWebAudioModule () { return true }
    get descriptor () { return data.descriptor }
    get name () { return data.descriptor.name }
    get vendor () { return data.descriptor.vendor }

    async createAudioNode (initialState) {
      // Contract section 3.1 steps 4 to 8, unchanged. The profile was resolved
      // at build time, so steps 1 to 3 have already happened.
      const { node, ready } = await instantiate(data.profile, data.capabilities, this.audioContext, {
        fetchVerified: verifiedFetch(fetchImpl),
        ...(AudioWorkletNode ? { AudioWorkletNode } : {}),
        ...(processorUrl ? { processorUrl } : {})
      })
      this.latencyFrames = ready.latencyFrames
      const wamNode = asWamNode(node, this, data)
      if (initialState) await wamNode.setState(initialState)
      return wamNode
    }

    async initialize (state) {
      this.audioNode = await this.createAudioNode(state)
      this.initialized = true
      return this
    }

    /**
     * The plugin's own interface, cross-origin in a sandboxed frame.
     *
     * Contract section 9.1 is absolute: a plugin UI is never loaded into the
     * host document. An iframe satisfies both that and WAM's requirement to
     * return an Element. A plugin with no jig:ui returns null, and the host
     * draws its own controls from getParameterInfo.
     */
    async createGui () {
      if (!data.ui) return null
      const frame = document.createElement('iframe')
      frame.setAttribute('sandbox', 'allow-scripts')
      frame.setAttribute('title', `${data.descriptor.name} interface`)
      frame.src = data.ui.location
      return frame
    }

    destroyGui (gui) { gui?.remove() }
  }

  return JigdawWebAudioModule
}
