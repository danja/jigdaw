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
import { compositeProfile } from '../rdf/CompositeReader.js'

let counter = 0
const nextId = () => `node-${++counter}`

export class Engine {
  #context
  #master = null
  #masterPanner = null
  #sends = []
  #inputs = new Map()
  #masterHeld = new Set()
  #loader
  #nodeClass
  #nodes = new Map()
  #links = []
  // One strip per track, keyed by the model's track id. The engine holds no
  // policy about what a track is; it is a named place for audio to arrive.
  #tracks = new Map()
  #maxTrackDelay = null

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
    // Null means tracks cannot be delayed, and setTrackDelay says so rather than pretending.
    this.#maxTrackDelay = maxTrackDelaySeconds
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
      // Where the tracks arrive: through the pan, then the level. `master` stays the
      // node the speakers hang off, as it always was.
      this.#masterPanner = typeof context.createStereoPanner === 'function' ? context.createStereoPanner() : null
      if (this.#masterPanner) this.#masterPanner.connect(this.#master)
    }
  }

  /**
   * The node every sink reaches, and the only one wired to the destination.
   *
   * Exposed so a meter can tap the mix rather than each node separately, which
   * is what a meter is for and what stops it reading one voice of many.
   */
  get master () { return this.#master ?? this.#context.destination }

  /** Where a track's output arrives: the master's pan when there is one, else the master. */
  get #mixInput () { return this.#masterPanner ?? this.master }

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

  /**
   * Make a track's strip: a fader then a panner, into the master.
   *
   * Gain then pan, which is the order a mixer works in: the fader sets how much
   * of the signal there is and the pan decides where it goes.
   */
  addTrack (trackId) {
    if (this.#tracks.has(trackId)) throw new Error(`track strip already exists: ${trackId}`)
    // `pre` is where the track's signal arrives and where a pre-fader send is
    // taken, before the fader; a track fed by another track's output or send
    // arrives here too.
    const pre = this.#context.createGain()
    const gain = this.#context.createGain()
    const panner = typeof this.#context.createStereoPanner === 'function'
      ? this.#context.createStereoPanner()
      : null
    pre.connect(gain)
    // A delay at the strip's output, so tracks with less latency can be lined up
    // with the slowest. Present only when the host says how long it may be.
    const delay = this.#maxTrackDelay !== null && typeof this.#context.createDelay === 'function'
      ? this.#context.createDelay(this.#maxTrackDelay)
      : null
    const last = panner ?? gain
    if (panner) gain.connect(panner)
    const out = delay ?? last
    if (delay) last.connect(delay)
    out.connect(this.#mixInput)
    // `to` is where the strip's output goes: null is the master.
    this.#tracks.set(trackId, { pre, gain, panner, delay, out, to: null, input: pre })
  }

  removeTrack (trackId) {
    const strip = this.#tracks.get(trackId)
    if (!strip) throw new Error(`no such track strip: ${trackId}`)
    this.closeInput(trackId)
    try { strip.pre.disconnect(); strip.gain.disconnect(); strip.panner?.disconnect(); strip.delay?.disconnect() } catch { /* already torn down */ }
    this.#tracks.delete(trackId)
  }

  /**
   * Delay a track's output by `frames`, to line it up with a slower track. Set
   * at an audio time so a change while playing does not click at the wrong moment.
   * Refuses what cannot be done: no delay built into the strips, or more than the
   * host allowed for.
   */
  setTrackDelay (trackId, frames, { atTime } = {}) {
    const strip = this.#tracks.get(trackId)
    if (!strip) throw new Error(`no such track strip: ${trackId}`)
    if (!strip.delay) throw new Error('this engine was built with no track delay, so tracks cannot be aligned')
    const seconds = frames / this.#context.sampleRate
    if (!(seconds >= 0) || seconds > this.#maxTrackDelay) {
      throw new Error(`a track delay of ${frames} frames (${(seconds * 1000).toFixed(1)} ms) is more than the ${(this.#maxTrackDelay * 1000)} ms this host allows`)
    }
    strip.delay.delayTime.setValueAtTime(seconds, atTime ?? this.#context.currentTime)
  }

  /**
   * Send a track's output somewhere other than the master: into another track,
   * which makes that track a bus, or back to the master with null. Only touches
   * the audio graph when the destination changed, since the dispatcher says it
   * for every track on every rebuild.
   */
  setTrackOutput (trackId, toTrackId) {
    const strip = this.#tracks.get(trackId)
    if (!strip) throw new Error(`no such track strip: ${trackId}`)
    const target = toTrackId === null ? null : this.#tracks.get(toTrackId)
    if (toTrackId !== null && !target) throw new Error(`no such track strip: ${toTrackId}`)
    if (strip.to === toTrackId) return
    try { strip.out.disconnect() } catch { /* nothing was connected */ }
    strip.out.connect(target ? target.pre : this.#mixInput)
    strip.to = toTrackId
  }

  /**
   * A send: a copy of one track's signal, at `level`, into another track. Taken
   * before the fader with `tap: 'pre'` and after fader and pan with 'post'. Not
   * a link between plugins, so clearLinks leaves it alone; clearSends takes them
   * all down and the dispatcher makes them again from the model.
   */
  addSend (id, fromTrackId, toTrackId, { level = 1, tap = 'post' } = {}) {
    const from = this.#tracks.get(fromTrackId)
    const to = this.#tracks.get(toTrackId)
    if (!from) throw new Error(`no such track strip: ${fromTrackId}`)
    if (!to) throw new Error(`no such track strip: ${toTrackId}`)
    if (tap !== 'pre' && tap !== 'post') throw new Error(`a send is pre or post, not ${tap}`)
    const gain = this.#context.createGain()
    gain.gain.setValueAtTime(level, this.#context.currentTime)
    const source = tap === 'pre' ? from.pre : (from.panner ?? from.gain)
    source.connect(gain)
    gain.connect(to.pre)
    this.#sends.push({ id, source, gain })
  }

  /** Change one send's level without remaking it. */
  setSendLevel (id, level) {
    const send = this.#sends.find(x => x.id === id)
    if (!send) throw new Error(`no such send: ${id}`)
    send.gain.gain.setValueAtTime(level, this.#context.currentTime)
  }

  clearSends () {
    for (const { source, gain } of this.#sends) {
      try { source.disconnect(gain) } catch { /* the strip is gone */ }
      try { gain.disconnect() } catch { /* already disconnected */ }
    }
    this.#sends = []
  }

  /**
   * The master's level, pan and mute. Muted is a level of zero, not a disconnect. A parameter an envelope is
   * playing on (`holdMaster`) is left alone: this runs on every rebuild of the graph, and setting a value at
   * the current time would cut into the envelope's own scheduling on every edit.
   */
  setMaster ({ gain = 1, pan = 0, muted = false } = {}) {
    if (!this.#master) return
    const at = this.#context.currentTime
    if (!this.#masterHeld.has('gain')) this.#master.gain.setValueAtTime(muted ? 0 : gain, at)
    if (this.#masterPanner && !this.#masterHeld.has('pan')) this.#masterPanner.pan.setValueAtTime(pan, at)
  }

  /** The master's AudioParam for an envelope to schedule on: 'gain' or 'pan'. Null where the context has none. */
  masterParam (which) {
    if (which === 'gain') return this.#master?.gain ?? null
    if (which === 'pan') return this.#masterPanner?.pan ?? null
    throw new Error(`the master has no ${which}`)
  }

  /** Leave the master's level or pan to an envelope (on), or take it back (off). */
  holdMaster (which, on) {
    if (which !== 'gain' && which !== 'pan') throw new Error(`the master has no ${which}`)
    if (on) this.#masterHeld.add(which)
    else this.#masterHeld.delete(which)
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
   * The node a track sounds through: after its fader and panner, on the way
   * to the master. For a caller that captures what a track sounds like, such
   * as a take recorder: mute and solo record as heard, because they act
   * upstream of here.
   */
  trackTap (trackId, { pre = false } = {}) {
    const strip = this.#tracks.get(trackId)
    if (!strip) throw new Error(`no such track strip: ${trackId}`)
    // `pre` is the arrival point, before the fader: what came in, whatever the fader,
    // mute or solo say, which is what a recording of a microphone needs so that
    // silencing the track (to keep it out of the speakers) does not silence the take.
    return pre ? strip.pre : (strip.panner ?? strip.gain)
  }

  /**
   * Feed a live stream (a microphone) into a track's arrival point. One stream
   * per track; a second replaces the first. The track's fader and mute decide
   * what is heard, so a track holding only a microphone is muted to keep the
   * person out of the speakers, and recorded pre-fader (`trackTap`).
   */
  openInput (trackId, stream) {
    const strip = this.#tracks.get(trackId)
    if (!strip) throw new Error(`no such track strip: ${trackId}`)
    if (typeof this.#context.createMediaStreamSource !== 'function') {
      throw new Error('this context cannot take a live input')
    }
    this.closeInput(trackId)
    const source = this.#context.createMediaStreamSource(stream)
    source.connect(strip.pre)
    this.#inputs.set(trackId, { source, stream })
  }

  /** Let go of a track's live input, and stop the stream so the browser's recording light goes out. */
  closeInput (trackId) {
    const held = this.#inputs.get(trackId)
    if (!held) return
    try { held.source.disconnect() } catch { /* already gone */ }
    for (const track of held.stream.getTracks?.() ?? []) track.stop()
    this.#inputs.delete(trackId)
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
