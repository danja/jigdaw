// src/engine/Engine.js
//
// The audio graph. One AudioWorkletNode per plugin, with Web Audio owning the
// graph, the routing and the scheduling (docs/architecture.md).
//
// The engine holds no policy. It does what it is told and reports what
// happened; deciding what to tell it is the dispatcher's job.
import { LoadError, CompositeFound, STEPS } from '../host/LoadError.js'
import { resolveComposite } from '../host/CompositeResolver.js'
import { restoreState } from '../host/CompositeState.js'
import { voicing } from '../host/CompositeParameters.js'
import { compositeProfile, readComposite, isComposite } from '../rdf/CompositeReader.js'
import { readProfile } from '../rdf/ProfileReader.js'
import { pluginForm } from '../rdf/Canonical.js'
import { digestOf } from '../host/Integrity.js'
import { Mixing } from './Mixing.js'

let counter = 0
const nextId = () => `node-${++counter}`

export class Engine {
  #context
  #loader
  #nodeClass
  #nodes = new Map()
  #links = []
  #mixing

  /**
   * `AudioWorkletNode` is injected rather than read from globals so the engine
   * can be driven by an offline host in a test. Web Audio hangs the class off
   * the global rather than off the context, so there is nowhere else to get it
   * from and no way to substitute it without this.
   */
  constructor ({ context, loader, output = null, maxTrackDelaySeconds = null, AudioWorkletNode = globalThis.AudioWorkletNode }) {
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
    this.#mixing = new Mixing({ context, output, maxTrackDelaySeconds, get: id => this.get(id) })
  }

  /**
   * The node every sink reaches, and the only one wired to the destination (see Mixing.js).
   */
  get master () { return this.#mixing.master }

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
    let loaded
    try {
      loaded = await this.#loader.loadProfile(iri)
    } catch (error) {
      if (error instanceof CompositeFound) return this.#addComposite(iri, error.dataset, { state })
      throw error
    }
    const { profile, granted } = loaded
    const { node, ready, descriptors } = await this.#loader.instantiate(
      profile, granted, this.#context, { AudioWorkletNode: this.#nodeClass, state })
    return this.adopt({ iri, profile, node, ready, descriptors, granted })
  }

  /**
   * The canonical digest of a plugin's profile, which is what a composite pins it by (docs/nested-plugins.md section 9.1). Over the
   * identity the profile states and not the URL it was fetched from. Fetches the profile and nothing else.
   */
  async profileDigest (iri) {
    const dataset = await this.#loader.fetchDataset(iri)
    const identity = isComposite(dataset) ? readComposite(dataset).iri : readProfile(dataset).iri
    return digestOf(new TextEncoder().encode(pluginForm(dataset, identity)), 'sha384')
  }

  /**
   * A composite plugin, loaded whole or not at all: the tree is checked first (CompositeResolver, which
   * fetches no code), then each member is instantiated as a plugin in its own right, and a failure
   * removes the members already made and fails the composite naming the member.
   *
   * Returns one entry, not the members' own, for the dispatcher to hold for the node: `composite: true`,
   * `profile` as the rest of the host reads a plugin's, `tree`, and `members` as `{ path, entry }` with
   * the path of member IRIs from the composite inward. It has no `id` and no `node` of its own.
   * docs/nested-plugins.md.
   */
  async #addComposite (iri, dataset, { state }) {
    const tree = await resolveComposite(iri, { loader: this.#loader, bundled: target => (target === iri ? dataset : null) })
    const saved = new Map()
    restoreState(tree, state, (path, value) => saved.set(JSON.stringify(path), value))

    const members = []
    const byPath = new Map()
    const walk = async (composite, path) => {
      for (const member of composite.members) {
        const here = [...path, member.id]
        if (member.tree.kind === 'composite') { await walk(member.tree, here); continue }
        const { profile, granted } = member.tree
        try {
          const { node, ready, descriptors } = await this.#loader.instantiate(
            profile, granted, this.#context, { AudioWorkletNode: this.#nodeClass, state: saved.get(JSON.stringify(here)) ?? null })
          const adopted = this.adopt({ iri: member.tree.iri, profile, node, ready, descriptors, granted })
          members.push({ path: here, entry: adopted })
          byPath.set(JSON.stringify(here), adopted)
        } catch (cause) {
          // Whatever went wrong, the person needs to know which member of which composite, and the step
          // when the failure had one. An error that is not a LoadError is reported as the composite's.
          throw new LoadError(cause.step ?? STEPS.composite, `${iri}, member ${here.join(' > ')}: ${cause.message}`, { cause, iri: cause.iri ?? member.tree.iri })
        }
      }
    }
    try {
      await walk(tree, [])
      this.#voice(tree, byPath)
    } catch (error) {
      for (const { entry } of members) this.remove(entry.id)
      throw error
    }
    return { composite: true, iri, tree, profile: compositeProfile(tree.composite), members }
  }

  /**
   * Set what the composite's author set, before anything is heard: each exposed port's default on the
   * parameters it drives, and each member's own settings, which are the voicing a person using the composite
   * cannot reach. Inner composites first, so the outer author's choice is the last word. A person's own
   * settings, from a saved session, arrive after this through the dispatcher and win over all of it.
   */
  #voice (tree, byPath) {
    for (const { path, symbol, value } of voicing(tree)) {
      const entry = byPath.get(JSON.stringify(path))
      if (entry) this.setParameter(entry.id, symbol, value)
    }
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
  link (fromId, toId, { fromOutput = 0, toInput = 0, delayFrames = 0, toParameter = null, connection = null } = {}) {
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
      this.#links.push({ fromId, toId, connection, fromOutput, toInput, toParameter, delay })
      return
    }

    if (toParameter !== null) source.connect(destination, fromOutput)
    else source.connect(destination, fromOutput, targetInput)
    this.#links.push({ fromId, toId, connection, fromOutput, toInput, toParameter, delay: null })
  }

  /**
   * The audio time for an absolute stream position, never in the past.
   *
   * A latency message names the frame its figure applies from
   * (docs/latency.md section 2), and a frame already past means already in
   * effect: scheduling it then is immediate rather than an error.
   */
  frameTime (frame) {
    return Math.max(frame / this.#context.sampleRate, this.#context.currentTime)
  }

  /**
   * Change one compensated link's delay, scheduled at an audio time.
   *
   * Compensation is re-applied without rebuilding the graph: tearing every
   * link down and remaking it would itself be audible, which is what
   * scheduling against fromFrame exists to avoid. An existing delay node is
   * driven with setValueAtTime; a newly needed one is inserted passing
   * through and switched at the same time. A delay that falls to zero stays
   * in the graph as a passthrough until the next full rebuild: removing a
   * node cannot be scheduled, and a zero delay node changes nothing audible.
   */
  retime (connection, delayFrames, { atTime } = {}) {
    const link = this.#links.find(l => l.connection === connection && l.toId !== undefined)
    if (!link) throw new Error(`no compensated link for connection "${connection}"`)
    const when = Math.max(atTime ?? this.#context.currentTime, this.#context.currentTime)
    const seconds = delayFrames / this.#context.sampleRate
    if (link.delay) {
      link.delay.delayTime.setValueAtTime(seconds, when)
      return
    }
    if (seconds <= 0) return
    if (typeof this.#context.createDelay !== 'function') {
      throw new Error('this context cannot create a delay, so latency cannot be compensated')
    }
    const delay = this.#context.createDelay(Math.max(seconds * 2, 1))
    const source = this.get(link.fromId).node
    const destination = link.toParameter != null
      ? this.get(link.toId).node.parameters.get(link.toParameter)
      : (link.toId === 'output' ? this.master : this.get(link.toId).node)
    const targetInput = link.toId === 'output' ? 0 : link.toInput
    source.connect(delay, link.fromOutput, 0)
    if (link.toParameter != null) delay.connect(destination)
    else delay.connect(destination, 0, targetInput)
    delay.delayTime.setValueAtTime(seconds, when)
    link.delay = delay
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

  // The mix is in Mixing.js; the engine keeps the names callers use.
  addTrack (...args) { return this.#mixing.addTrack(...args) }
  removeTrack (...args) { return this.#mixing.removeTrack(...args) }
  setTrackDelay (...args) { return this.#mixing.setTrackDelay(...args) }
  setTrackOutput (...args) { return this.#mixing.setTrackOutput(...args) }
  setTrackArrival (...args) { return this.#mixing.setTrackArrival(...args) }
  setMasterArrival (...args) { return this.#mixing.setMasterArrival(...args) }
  addSend (...args) { return this.#mixing.addSend(...args) }
  setSendLevel (...args) { return this.#mixing.setSendLevel(...args) }
  clearSends (...args) { return this.#mixing.clearSends(...args) }
  setMaster (...args) { return this.#mixing.setMaster(...args) }
  masterParam (...args) { return this.#mixing.masterParam(...args) }
  holdMaster (...args) { return this.#mixing.holdMaster(...args) }
  trackIds (...args) { return this.#mixing.trackIds(...args) }
  trackInput (...args) { return this.#mixing.trackInput(...args) }
  trackTap (...args) { return this.#mixing.trackTap(...args) }
  trackMeter (...args) { return this.#mixing.trackMeter(...args) }
  openInput (...args) { return this.#mixing.openInput(...args) }
  closeInput (...args) { return this.#mixing.closeInput(...args) }
  inputTrackIds () { return this.#mixing.inputTrackIds() }
  setMonitorMono (on) { return this.#mixing.setMonitorMono(on) }
  get monitorMono () { return this.#mixing.monitorMono }
  setTrackChannel (...args) { return this.#mixing.setTrackChannel(...args) }

  /**
   * Connect a node's output to a track's fader. Recorded with the other links,
   * so clearLinks takes it down with them.
   */
  linkToTrack (fromId, trackId, { fromOutput = 0 } = {}) {
    this.get(fromId).node.connect(this.trackInput(trackId), fromOutput, 0)
    this.#links.push({ fromId, toTrack: trackId, delay: null })
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
