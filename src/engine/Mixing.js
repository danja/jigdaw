// src/engine/Mixing.js
//
// The mix: one strip per track (fader, pan, a delay to line tracks up, a place for audio from other tracks to arrive), the sends between
// them, the master chain every track ends in, and the inputs and meters tapped off a strip. The Engine keeps the plugin nodes and the links
// between them and hands the mix what it needs to find a node (`host.get(id)`); the Engine's own methods of the same names call these. The
// engine holds no policy about what a track is: a strip is a named place for audio to arrive.
import { MASTER_TRACK } from '../model/ArrangementOps.js'

export class Mixing {
  #context
  #host
  #master = null
  #masterPanner = null
  // The master's chain, as a track's strip has one: the mix of every track lands on #masterArrive, which
  // feeds the master's audio input node if it has one and #masterPre if not, and a plugin on the master
  // sounds through #masterPre, then the pan and the level. #masterArrival is that node, or null.
  #masterArrive = null
  #masterPre = null
  #masterArrival = null
  // A listening aid after the master: sums the mix to one channel so a person can hear what a mono speaker would. Not part of
  // the project, and not in a render (a render builds its own engine and never sets it).
  #mono = null
  #sends = []
  #inputs = new Map()
  #masterHeld = new Set()
  // One strip per track, keyed by the model's track id.
  #tracks = new Map()
  #maxTrackDelay = null

  /**
   * `output` is where the mix goes, defaulting to the speakers. `maxTrackDelaySeconds` null means tracks cannot be delayed, and
   * setTrackDelay says so rather than pretending.
   */
  constructor ({ context, output = null, maxTrackDelaySeconds = null, get }) {
    this.#context = context
    this.#host = { get }
    this.#maxTrackDelay = maxTrackDelaySeconds

    if (typeof context.createGain === 'function') {
      this.#master = context.createGain()
      this.#master.connect(output ?? context.destination)
      // Where the tracks arrive: through the pan, then the mono stage, then the level. `master` stays the node the speakers hang
      // off, as it always was. The mono stage is always in the path and passes both channels through unchanged: the switch only
      // changes how many channels it takes in. Explicit, so what comes in is mixed down to that many whatever its own count; a
      // down-mix to one is the average, and the speakers take one channel as both.
      this.#mono = context.createGain()
      this.#mono.channelCountMode = 'explicit'
      this.#mono.channelInterpretation = 'speakers'
      this.#mono.channelCount = 2
      this.#mono.connect(this.#master)
      this.#masterPanner = typeof context.createStereoPanner === 'function' ? context.createStereoPanner() : null
      if (this.#masterPanner) this.#masterPanner.connect(this.#mono)
      this.#masterPre = context.createGain()
      this.#masterPre.connect(this.#masterPanner ?? this.#mono)
      this.#masterArrive = context.createGain()
      this.#masterArrive.connect(this.#masterPre)
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
  get #mixInput () { return this.#masterArrive ?? this.#masterPanner ?? this.master }

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
    // Where audio from another track lands (a bus output or a send). It goes to the track's audio input
    // node when it has one, so a plugin on a bus is in the path, and to `pre` when it has not.
    const arrive = this.#context.createGain()
    arrive.connect(pre)
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
    this.#tracks.set(trackId, { pre, arrive, arrival: null, gain, panner, delay, out, to: null, input: pre })
  }

  removeTrack (trackId) {
    const strip = this.#tracks.get(trackId)
    if (!strip) throw new Error(`no such track strip: ${trackId}`)
    this.closeInput(trackId)
    try { strip.arrive.disconnect(); strip.pre.disconnect(); strip.gain.disconnect(); strip.panner?.disconnect(); strip.delay?.disconnect() } catch { /* already torn down */ }
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
    // Only where it went before, so a meter tapped off the same node is left connected.
    try { strip.out.disconnect(strip.to === null ? this.#mixInput : this.#tracks.get(strip.to)?.arrive) } catch { /* nothing was connected */ }
    strip.out.connect(target ? target.arrive : this.#mixInput)
    strip.to = toTrackId
  }

  /**
   * Where audio that arrives from another track goes: into `nodeId`, the track's audio input node, so that
   * the plugins on a bus process what is sent to it, or to the track's fader when it is null. Only touches
   * the graph when the destination changed, since the dispatcher says it for every track on every rebuild.
   * A node with no audio input cannot take it, and is refused here rather than failing inside Web Audio.
   */
  setTrackArrival (trackId, nodeId) {
    const strip = this.#tracks.get(trackId)
    if (!strip) throw new Error(`no such track strip: ${trackId}`)
    const node = this.#arrivalNode(nodeId)
    if (node === strip.arrival) return
    try { strip.arrive.disconnect() } catch { /* nothing was connected */ }
    strip.arrive.connect(node ?? strip.pre)
    strip.arrival = node
  }

  /** The same for the master: where the mix of every track goes before the master's fader. */
  setMasterArrival (nodeId) {
    if (!this.#masterArrive) return
    const node = this.#arrivalNode(nodeId)
    if (node === this.#masterArrival) return
    try { this.#masterArrive.disconnect() } catch { /* nothing was connected */ }
    this.#masterArrive.connect(node ?? this.#masterPre)
    this.#masterArrival = node
  }

  #arrivalNode (nodeId) {
    if (nodeId === null || nodeId === undefined) return null
    const node = this.#host.get(nodeId).node
    if (!(node.numberOfInputs > 0)) throw new Error(`node ${nodeId} has no audio input, so nothing can arrive at it`)
    return node
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
    gain.connect(to.arrive)
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

  /** Listen to the mix summed to mono, or not. A listening aid for checking how a mix folds down; nothing recorded or rendered hears it. */
  setMonitorMono (on) {
    if (!this.#mono) throw new Error('this context cannot sum the mix to mono')
    this.#mono.channelCount = on ? 1 : 2
  }

  /** Whether the mix is being summed to mono for listening. */
  get monitorMono () { return this.#mono?.channelCount === 1 }

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
    if (trackId === MASTER_TRACK) {
      if (!this.#masterPre) throw new Error('this context has no master to take a plugin on it')
      return this.#masterPre
    }
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
   * An analyser on what a track sounds like, after its fader and pan, for a level meter. Made the first time
   * it is asked for and kept, so a meter that is redrawn does not stack up taps on the track.
   */
  trackMeter (trackId) {
    const strip = this.#tracks.get(trackId)
    if (!strip) throw new Error(`no such track strip: ${trackId}`)
    if (!strip.meter) {
      if (typeof this.#context.createAnalyser !== 'function') throw new Error('this context cannot make an analyser')
      const analyser = this.#context.createAnalyser()
      // 1024 samples is about 21 ms, longer than a frame, so a short peak between two reads is not missed.
      analyser.fftSize = 1024
      ;(strip.panner ?? strip.gain).connect(analyser)
      strip.meter = analyser
    }
    return strip.meter
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

  /** The tracks that have a live input, which a take records before the fader. */
  inputTrackIds () { return [...this.#inputs.keys()] }

  /** Let go of a track's live input, and stop the stream so the browser's recording light goes out. */
  closeInput (trackId) {
    const held = this.#inputs.get(trackId)
    if (!held) return
    try { held.source.disconnect() } catch { /* already gone */ }
    for (const track of held.stream.getTracks?.() ?? []) track.stop()
    this.#inputs.delete(trackId)
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
}
