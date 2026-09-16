// src/engine/Engine.js
//
// The audio graph. One AudioWorkletNode per plugin, with Web Audio owning the
// graph, the routing and the scheduling (docs/architecture.md).
//
// The engine holds no policy. It does what it is told and reports what
// happened; deciding what to tell it is the dispatcher's job.
import { LoadError } from '../host/LoadError.js'

let counter = 0
const nextId = () => `node-${++counter}`

export class Engine {
  #context
  #loader
  #nodeClass
  #nodes = new Map()

  /**
   * `AudioWorkletNode` is injected rather than read from globals so the engine
   * can be driven by an offline host in a test. Web Audio hangs the class off
   * the global rather than off the context, so there is nowhere else to get it
   * from and no way to substitute it without this.
   */
  constructor ({ context, loader, AudioWorkletNode = globalThis.AudioWorkletNode }) {
    if (!context) throw new Error('Engine needs an AudioContext')
    if (!loader) throw new Error('Engine needs a PluginLoader')
    if (typeof AudioWorkletNode !== 'function') {
      throw new Error('Engine needs an AudioWorkletNode constructor; this environment has none')
    }
    this.#context = context
    this.#loader = loader
    this.#nodeClass = AudioWorkletNode
  }

  get context () { return this.#context }

  nodes () { return [...this.#nodes.values()] }

  get (id) {
    const entry = this.#nodes.get(id)
    if (!entry) throw new Error(`no such node: ${id}`)
    return entry
  }

  /**
   * Contract section 3 in full: fetch, validate, negotiate, verify, register,
   * construct, await ready. The node is connected to nothing until the caller
   * says so.
   */
  async addPlugin (iri) {
    const { profile, granted } = await this.#loader.loadProfile(iri)
    const { node, ready, descriptors } = await this.#loader.instantiate(
      profile, granted, this.#context, { AudioWorkletNode: this.#nodeClass })

    const id = nextId()
    const entry = { id, iri, profile, node, ready, descriptors, granted }
    this.#nodes.set(id, entry)
    return entry
  }

  /** Remove a node, disconnecting it and telling the processor to release. */
  remove (id) {
    const entry = this.get(id)
    try {
      entry.node.disconnect()
      entry.node.port.postMessage({ type: 'dispose' })
    } catch {
      // A node already torn down by a failure is still removable. Refusing
      // here would leave the graph holding a reference to something dead.
    }
    this.#nodes.delete(id)
  }

  connect (fromId, toId, { fromOutput = 0, toInput = 0 } = {}) {
    const source = this.get(fromId).node
    const destination = toId === 'output' ? this.#context.destination : this.get(toId).node
    source.connect(destination, fromOutput, toId === 'output' ? 0 : toInput)
  }

  connectSource (audioNode, toId, { toInput = 0 } = {}) {
    audioNode.connect(this.get(toId).node, 0, toInput)
  }

  /**
   * Parameters are AudioParams, addressed by lv2:symbol. Never a message:
   * contract section 5.1 and messaging.md section 1.5, because two paths for
   * one value arrive at different times with no defined precedence.
   */
  setParameter (id, symbol, value) {
    const entry = this.get(id)
    const param = entry.node.parameters.get(symbol)
    if (!param) {
      throw new Error(`${entry.profile.label} has no parameter "${symbol}"`)
    }
    const port = entry.profile.ports.find(p => p.symbol === symbol)
    const clamped = port ? Math.min(port.maximum, Math.max(port.minimum, value)) : value
    param.setValueAtTime(clamped, this.#context.currentTime)
    return clamped
  }

  /**
   * Mute and disconnect a node that failed, leaving the rest of the graph
   * running. Contract section 10.2: a host whose failure mode is silence for
   * the whole project is one nobody will load an unfamiliar plugin into.
   */
  quarantine (id, reason) {
    const entry = this.get(id)
    try { entry.node.disconnect() } catch { /* already gone */ }
    entry.failed = reason
    return entry
  }

  /** Watch a node for the errors a processor reports after loading. */
  watch (id, onError) {
    const entry = this.get(id)
    entry.node.port.onmessage = event => {
      const message = event.data
      if (message?.type === 'error') {
        this.quarantine(id, message.message)
        onError?.(new LoadError('process', `${entry.profile.label}: ${message.message}`))
      }
    }
  }
}
