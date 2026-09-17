// src/testing/OfflineHost.js
//
// A minimal Web Audio stand-in that really runs a processor.
//
// This is not a mock of the loader's collaborators: the loader, the profile
// reader, the validator, the integrity check, the wasm compile and the plugin's
// own processor and DSP all run for real. Only the parts node does not have,
// the AudioContext and AudioWorkletNode, are supplied here, and they are
// supplied by actually evaluating the processor module and calling its
// process() with buffers.
//
// AGENTS.md prefers deterministic offline audio tests over device-based ones,
// and this is what makes one possible: a render is reproducible, a live context
// is not.
import { readFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'

const QUANTUM = 128

/** A fetch that serves a directory, so the real loader does real fetching. */
export function directoryFetch (roots) {
  return async (url) => {
    for (const [prefix, dir] of Object.entries(roots)) {
      if (!url.startsWith(prefix)) continue
      const rest = url.slice(prefix.length) || 'profile.ttl'
      const path = resolve(dir, rest === '' ? 'profile.ttl' : rest)
      try {
        const body = await readFile(path)
        return {
          ok: true,
          status: 200,
          text: async () => body.toString('utf8'),
          arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength)
        }
      } catch {
        return { ok: false, status: 404 }
      }
    }
    throw new TypeError('Failed to fetch')
  }
}

class OfflineParam {
  constructor (value) { this.value = value; this.values = new Float32Array(1) }
  setValueAtTime (value) { this.value = value; return this }
}

class OfflinePort {
  constructor () {
    this.onmessage = null
    this.peer = null
    // Recorded so a test can assert what did NOT travel as a message, which is
    // how messaging.md 1.5 is checked: a parameter must reach the processor as
    // an AudioParam and never as a post.
    this.posted = []
  }

  postMessage (message) {
    this.posted.push(message)
    // Delivered asynchronously, as a real MessagePort would, so nothing can
    // accidentally depend on synchronous delivery.
    queueMicrotask(() => this.peer?.onmessage?.({ data: message }))
  }
}

/**
 * A node that owns a real processor instance.
 *
 * The processor module is evaluated with AudioWorkletProcessor and
 * registerProcessor supplied, which is what an AudioWorkletGlobalScope does.
 */
export class OfflineWorkletNode {
  constructor (context, name, options = {}) {
    const registered = context.registry.get(name)
    if (!registered) throw new Error(`Unknown processor "${name}"`)

    this.context = context
    this.name = name
    this.options = options
    this.numberOfOutputs = options.numberOfOutputs ?? 1
    this.channels = (options.outputChannelCount ?? [2])[0]

    const hostSide = new OfflinePort()
    const processorSide = new OfflinePort()
    hostSide.peer = processorSide
    processorSide.peer = hostSide
    this.port = hostSide

    this.parameters = new Map()
    for (const descriptor of registered.parameterDescriptors ?? []) {
      this.parameters.set(descriptor.name, new OfflineParam(descriptor.defaultValue))
    }

    this.processor = new registered.ctor({ ...options, port: processorSide })
    this.connections = []
    this.outputs = [Array.from({ length: this.channels }, () => new Float32Array(QUANTUM))]
    this.inputs = [Array.from({ length: this.channels }, () => new Float32Array(QUANTUM))]
  }

  connect (destination, output = 0, input = 0) {
    this.connections.push({ destination, output, input })
    return destination
  }

  disconnect () { this.connections = []; return this }

  /** Run one render quantum. Returns the output channels. */
  render (inputChannels = null) {
    for (let c = 0; c < this.channels; c++) {
      if (inputChannels) this.inputs[0][c].set(inputChannels[Math.min(c, inputChannels.length - 1)])
      else this.inputs[0][c].fill(0)
    }
    const parameters = {}
    for (const [name, param] of this.parameters) {
      param.values[0] = param.value
      parameters[name] = param.values
    }
    this.processor.process(this.inputs, this.outputs, parameters)
    return this.outputs[0]
  }
}

export class OfflineContext {
  constructor ({ sampleRate = 48000 } = {}) {
    this.sampleRate = sampleRate
    this.currentTime = 0
    this.registry = new Map()
    this.destination = { connect () {}, disconnect () {} }
    // Enough of a DelayNode for latency compensation to be exercised offline.
    this.delays = []
    this.createDelay = max => {
      const delay = {
        maxDelayTime: max,
        delayTime: { value: 0 },
        connections: [],
        connect (destination, output = 0, input = 0) { this.connections.push({ destination, output, input }); return destination },
        disconnect () { this.connections = []; return this }
      }
      this.delays.push(delay)
      return delay
    }
    const registry = this.registry
    this.audioWorklet = {
      async addModule (url) {
        // A real worklet evaluates the module in a scope that provides these.
        const previous = {
          AudioWorkletProcessor: globalThis.AudioWorkletProcessor,
          registerProcessor: globalThis.registerProcessor,
          sampleRate: globalThis.sampleRate
        }
        globalThis.AudioWorkletProcessor = class {
          constructor (options) {
            this.options = options
            // The real base class gives a subclass its port before the
            // subclass constructor body runs, and Cascade's constructor
            // assigns port.onmessage immediately.
            this.port = options?.port
          }
        }
        globalThis.registerProcessor = (name, ctor) => {
          registry.set(name, { ctor, parameterDescriptors: ctor.parameterDescriptors ?? [] })
        }
        globalThis.sampleRate = 48000
        try {
          // Cache-busted so two loads in one process both evaluate.
          await import(`${url}${url.includes('?') ? '&' : '?'}v=${registry.size}-${Date.now()}`)
        } finally {
          Object.assign(globalThis, previous)
        }
      }
    }
  }
}

export { QUANTUM, join }
