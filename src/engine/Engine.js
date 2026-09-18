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
  #master = null
  #loader
  #nodeClass
  #nodes = new Map()
  #links = []

  /**
   * `AudioWorkletNode` is injected rather than read from globals so the engine
   * can be driven by an offline host in a test. Web Audio hangs the class off
   * the global rather than off the context, so there is nowhere else to get it
   * from and no way to substitute it without this.
   */
  constructor ({ context, loader, output = null, AudioWorkletNode = globalThis.AudioWorkletNode }) {
    if (!context) throw new Error('Engine needs an AudioContext')
    if (!loader) throw new Error('Engine needs a PluginLoader')
    if (typeof AudioWorkletNode !== 'function') {
      throw new Error('Engine needs an AudioWorkletNode constructor; this environment has none')
    }
    this.#context = context
    this.#loader = loader
    this.#nodeClass = AudioWorkletNode

    // Everything the graph produces arrives here, and this is the only thing
    // connected to the speakers. Before it existed the dispatcher had no path to
    // the destination at all: Engine.link could resolve 'output', and nothing
    // ever passed it, so the page reached around the model and connected each
    // node itself. A single point also gives a master level somewhere to live
    // and gives a meter one thing to measure.
    // `output` is where the mix goes, defaulting to the speakers. A host that
    // wants to measure or record the mix passes its own node rather than
    // reaching in afterwards and rewiring what the engine built.
    if (typeof context.createGain === 'function') {
      this.#master = context.createGain()
      this.#master.connect(output ?? context.destination)
    }
  }

  /**
   * The node every sink reaches, and the only one wired to the destination.
   *
   * Exposed so a meter can tap the mix rather than each node separately, which
   * is what a meter is for and what stops it reading one voice of many.
   */
  get master () { return this.#master ?? this.#context.destination }

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
    return this.adopt({ iri, profile, node, ready, descriptors, granted })
  }

  /**
   * Take an instantiated node into the graph.
   *
   * Everything after instantiation is the same whoever made the node: it needs
   * driving if it has no audio, it gets a channel strip if it has, and it
   * becomes an entry. A foreign plugin (contract section 12) is instantiated by
   * its own adapter and arrives here rather than through addPlugin, and this is
   * the seam that stops that being a second copy of the code below.
   */
  adopt ({ iri, profile, node, ready = { latencyFrames: 0 }, descriptors = [], granted = null }) {
    // Keep a plugin with no audio ports being rendered. See PluginLoader: it
    // asks for one input precisely so that something can be connected to it,
    // and a constant source of zero is the cheapest thing that pulls a node.
    let driver = null
    if (node.jigdawNeedsDriving && typeof this.#context.createConstantSource === 'function') {
      driver = this.#context.createConstantSource()
      driver.offset.value = 0
      driver.connect(node, 0, 0)
      driver.start()
    }

    // The channel strip, on the node's first output. Gain then pan, which is the
    // order a mixer works in: panning after the fader means the fader sets how
    // much of the signal there is and the pan decides where it goes.
    //
    // Only output zero. A plugin with several outputs is not a channel, and
    // giving each output its own strip would be inventing a mixer the project
    // format does not describe. Connections from any other output bypass it.
    let strip = null
    if (profile.audioOutputs > 0 && typeof this.#context.createGain === 'function') {
      const gain = this.#context.createGain()
      const panner = typeof this.#context.createStereoPanner === 'function'
        ? this.#context.createStereoPanner()
        : null
      node.connect(gain, 0)
      if (panner) gain.connect(panner)
      strip = { gain, panner, output: panner ?? gain }
    }

    const id = nextId()
    const entry = { id, iri, profile, node, ready, descriptors, granted, driver, strip }
    this.#nodes.set(id, entry)
    return entry
  }

  /** Remove a node, disconnecting it and telling the processor to release. */
  remove (id) {
    const entry = this.get(id)
    try {
      if (entry.driver) { entry.driver.stop(); entry.driver.disconnect() }
      if (entry.strip) { entry.strip.gain.disconnect(); entry.strip.panner?.disconnect() }
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
    const destination = toId === 'output' ? this.master : this.get(toId).node
    source.connect(destination, fromOutput, toId === 'output' ? 0 : toInput)
  }

  /**
   * Link two nodes, inserting the delay the compiler asked for.
   *
   * Compensation is delay added to the fast paths, per docs/latency.md. The
   * delay node is owned here and torn down with the link, so a recompile
   * cannot leave one behind feeding silence into a mix.
   */
  /**
   * Connect one node to another, or to one of its parameters.
   *
   * `toParameter` names an AudioParam by its lv2:symbol, and is what an endpoint
   * carrying jig:portSymbol means. Web Audio sums a connection into a parameter
   * on top of that parameter's own value, which is the modulation the project
   * format has been able to express since it was written and which nothing
   * honoured: the symbol was ignored and the signal was connected to audio input
   * zero instead, silently and audibly.
   *
   * A parameter takes no input index, so toInput is not consulted for one.
   */
  link (fromId, toId, { fromOutput = 0, toInput = 0, delayFrames = 0, toParameter = null } = {}) {
    const from = this.get(fromId)
    // Through the strip when there is one and the signal leaves by output zero,
    // so a fader and a mute reach everything downstream rather than only the
    // speakers. Anything else leaves the node directly.
    const viaStrip = Boolean(from.strip) && fromOutput === 0
    const source = viaStrip ? from.strip.output : from.node
    if (viaStrip) fromOutput = 0
    let destination
    if (toParameter !== null) {
      const entry = this.get(toId)
      destination = entry.node.parameters?.get(toParameter)
      if (!destination) {
        throw new Error(`${entry.profile.label} has no parameter "${toParameter}" to modulate`)
      }
    } else {
      destination = toId === 'output' ? this.master : this.get(toId).node
    }
    const targetInput = toId === 'output' ? 0 : toInput

    if (delayFrames > 0) {
      if (typeof this.#context.createDelay !== 'function') {
        throw new Error('this context cannot create a delay, so latency cannot be compensated')
      }
      const seconds = delayFrames / this.#context.sampleRate
      // maxDelayTime must exceed the value, and the constructor takes seconds.
      const delay = this.#context.createDelay(Math.max(seconds * 2, 1))
      delay.delayTime.value = seconds
      source.connect(delay, fromOutput, 0)
      if (toParameter !== null) delay.connect(destination)
      else delay.connect(destination, 0, targetInput)
      this.#links.push({ fromId, toId, delay })
      return
    }

    if (toParameter !== null) source.connect(destination, fromOutput)
    else source.connect(destination, fromOutput, targetInput)
    this.#links.push({ fromId, toId, delay: null })
  }

  /** Tear down every link, including the delay nodes this engine created. */
  clearLinks () {
    for (const link of this.#links) {
      try {
        if (link.delay) link.delay.disconnect()
        const from = this.get(link.fromId)
        // The strip is what was connected onward, so it is what has to let go.
        // Disconnecting the node instead would tear it off its own fader.
        if (from.strip) from.strip.output.disconnect()
        else from.node.disconnect()
      } catch {
        // A node already removed is still worth clearing past.
      }
    }
    this.#links = []
  }

  get links () { return [...this.#links] }

  connectSource (audioNode, toId, { toInput = 0 } = {}) {
    audioNode.connect(this.get(toId).node, 0, toInput)
  }

  /**
   * Parameters are AudioParams, addressed by lv2:symbol. Never a message:
   * contract section 5.1 and messaging.md section 1.5, because two paths for
   * one value arrive at different times with no defined precedence.
   */
  /**
   * Apply a node's channel strip.
   *
   * `muted` is given separately from the model's own flag because solo makes a
   * node silent without it being muted: what a listener hears is a property of
   * the whole graph, and the dispatcher is what can see the whole graph.
   */
  setChannel (id, { gain = 1, pan = 0, silent = false } = {}) {
    const entry = this.get(id)
    if (!entry.strip) return
    const at = this.#context.currentTime
    entry.strip.gain.gain.setValueAtTime(silent ? 0 : gain, at)
    if (entry.strip.panner) entry.strip.panner.pan.setValueAtTime(pan, at)
  }

  /**
   * What a value would become, without applying it.
   *
   * Separate from setParameter so a caller can record the value it is going to
   * apply before applying it. Writing the asked-for value and then correcting it
   * is two edits to the model for one edit by the person, which an undo stack
   * then has to unpick.
   */
  clampParameter (id, symbol, value) {
    const entry = this.get(id)
    // Against the profile rather than against the live AudioParam, because the
    // profile is the single declaration the range comes from and the parameter
    // map is derived from it. Contract section 5.1.
    const port = entry.profile.ports?.find(p => p.symbol === symbol)
    if (!port) throw new Error(`${entry.profile.label} has no parameter "${symbol}"`)
    return Math.min(port.maximum, Math.max(port.minimum, value))
  }

  setParameter (id, symbol, value) {
    const entry = this.get(id)
    const param = entry.node.parameters.get(symbol)
    if (!param) {
      throw new Error(`${entry.profile.label} has no parameter "${symbol}"`)
    }
    const clamped = this.clampParameter(id, symbol, value)
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

  /**
   * Register a handler for messages from a node's processor.
   *
   * A port has one `onmessage`, and more than one part of the host needs to
   * hear from a processor: errors, outgoing events, dropped counts. So the
   * engine owns the handler and fans out, rather than each subsystem
   * overwriting the last one to register.
   */
  onMessage (id, handler) {
    const entry = this.get(id)
    if (!entry.handlers) {
      entry.handlers = new Set()
      entry.node.port.onmessage = event => {
        for (const listener of entry.handlers) {
          try { listener(event.data, entry) } catch (error) { console.error('message handler failed', error) }
        }
      }
    }
    entry.handlers.add(handler)
    return () => entry.handlers.delete(handler)
  }

  /** Watch a node for the errors a processor reports after loading. */
  watch (id, onError) {
    return this.onMessage(id, message => {
      if (message?.type !== 'error') return
      this.quarantine(id, message.message)
      onError?.(new LoadError('process', `${this.get(id).profile.label}: ${message.message}`))
    })
  }

  /** Post a message to a node's processor. */
  post (id, message) {
    this.get(id).node.port.postMessage(message)
  }
}
