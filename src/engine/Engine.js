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
  // One strip per track, keyed by the model's track id. The engine holds no
  // policy about what a track is; it is a named place for audio to arrive.
  #tracks = new Map()

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
  async addPlugin (iri, { state = null } = {}) {
    const { profile, granted } = await this.#loader.loadProfile(iri)
    const { node, ready, descriptors } = await this.#loader.instantiate(
      profile, granted, this.#context, { AudioWorkletNode: this.#nodeClass, state })
    return this.adopt({ iri, profile, node, ready, descriptors, granted })
  }

  /**
   * Take an instantiated node into the graph.
   *
   * Everything after instantiation is the same whoever made the node: it needs
   * driving if it has no audio, and it becomes an entry. A foreign plugin (contract section 12) is instantiated by
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

    const id = nextId()
    const entry = { id, iri, profile, node, ready, descriptors, granted, driver }
    this.#nodes.set(id, entry)
    return entry
  }

  /** Remove a node, disconnecting it and telling the processor to release. */
  remove (id) {
    const entry = this.get(id)
    try {
      if (entry.driver) { entry.driver.stop(); entry.driver.disconnect() }
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
    const source = this.get(fromId).node
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
        this.get(link.fromId).node.disconnect()
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
   * Make a track's strip: a fader then a panner, into the master.
   *
   * Gain then pan, which is the order a mixer works in: the fader sets how much
   * of the signal there is and the pan decides where it goes.
   */
  addTrack (trackId) {
    if (this.#tracks.has(trackId)) throw new Error(`track strip already exists: ${trackId}`)
    const gain = this.#context.createGain()
    const panner = typeof this.#context.createStereoPanner === 'function'
      ? this.#context.createStereoPanner()
      : null
    if (panner) { gain.connect(panner); panner.connect(this.master) } else gain.connect(this.master)
    this.#tracks.set(trackId, { gain, panner, input: gain })
  }

  removeTrack (trackId) {
    const strip = this.#tracks.get(trackId)
    if (!strip) throw new Error(`no such track strip: ${trackId}`)
    try { strip.gain.disconnect(); strip.panner?.disconnect() } catch { /* already torn down */ }
    this.#tracks.delete(trackId)
  }

  /** The track ids that have a strip. */
  trackIds () { return [...this.#tracks.keys()] }

  /**
   * The node a track's audio arrives at: its fader. For a caller that plays
   * something into a track from outside the plugin graph, such as an audio
   * clip with nowhere else to go.
   */
  trackInput (trackId) {
    const strip = this.#tracks.get(trackId)
    if (!strip) throw new Error(`no such track strip: ${trackId}`)
    return strip.input
  }

  /**
   * Connect a node's output to a track's fader. Recorded with the other links,
   * so clearLinks takes it down with them.
   */
  linkToTrack (fromId, trackId, { fromOutput = 0 } = {}) {
    this.get(fromId).node.connect(this.trackInput(trackId), fromOutput, 0)
    this.#links.push({ fromId, toTrack: trackId, delay: null })
  }

  /**
   * Apply a track's channel strip.
   *
   * `silent` is given separately from the model's own mute because solo makes
   * a track silent without it being muted: what a listener hears is a property
   * of the whole mix, and the dispatcher is what can see the whole mix.
   */
  setTrackChannel (trackId, { gain = 1, pan = 0, silent = false } = {}) {
    const strip = this.#tracks.get(trackId)
    if (!strip) throw new Error(`no such track strip: ${trackId}`)
    const at = this.#context.currentTime
    strip.gain.gain.setValueAtTime(silent ? 0 : gain, at)
    if (strip.panner) strip.panner.pan.setValueAtTime(pan, at)
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

  /** The value a parameter has before anything sets it, from the profile. */
  defaultParameter (id, symbol) {
    const entry = this.get(id)
    const port = entry.profile.ports?.find(p => p.symbol === symbol)
    if (!port) throw new Error(`${entry.profile.label} has no parameter "${symbol}"`)
    return port.defaultValue
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

  /**
   * Watch a node for the errors a processor reports after loading.
   *
   * Only a fatal one quarantines. messaging.md 1.3 documents `fatal: false`
   * for a problem the node survives, such as a `loadAsset` that failed to
   * parse: contract 10.2 says a *plugin that throws* is what gets muted and
   * disconnected, not every message a processor happens to send with type
   * "error", and those are different populations.
   */
  watch (id, onError) {
    return this.onMessage(id, message => {
      if (message?.type !== 'error' || message.fatal === false) return
      this.quarantine(id, message.message)
      onError?.(new LoadError('process', `${this.get(id).profile.label}: ${message.message}`))
    })
  }

  /** Post a message to a node's processor. */
  post (id, message) {
    this.get(id).node.port.postMessage(message)
  }

  /**
   * Ask a node's processor for its current state (contract section 8,
   * messaging.md 1.2's `stateRequest` and 1.3's `state`). Resolves with
   * whatever it returns, or `null` if nothing answers before `timeoutMs`: a
   * plugin with no state to report simply never replies, which is the
   * ordinary case and not a failure, so a timeout resolves rather than
   * rejects.
   *
   * A token round-trips with the request rather than trusting "the next
   * `state` message must be the answer to this one", because `watch()` and
   * any other `onMessage` listener share the same port and a message meant
   * for one caller must not resolve another's promise.
   */
  requestState (id, { timeoutMs = 2000 } = {}) {
    const entry = this.get(id)
    const token = `${Date.now()}-${Math.random().toString(36).slice(2)}`
    return new Promise(resolve => {
      let settled = false
      const stop = this.onMessage(id, message => {
        if (settled || message?.type !== 'state' || message.token !== token) return
        settled = true
        stop()
        resolve(message.state ?? null)
      })
      entry.node.port.postMessage({ type: 'stateRequest', token })
      setTimeout(() => {
        if (settled) return
        settled = true
        stop()
        resolve(null)
      }, timeoutMs)
    })
  }

  /**
   * Replace one `jig:userReplaceable` asset in a running node, messaging.md
   * 1.2's `loadAsset`: a person choosing a different file from the
   * generated panel, after the plugin is already loaded. `bytes` is
   * transferred, so the caller must not use it again afterward.
   */
  loadAsset (id, key, bytes) {
    this.get(id).node.port.postMessage({ type: 'loadAsset', key, bytes }, [bytes])
  }
}
