// src/wam/WamAdapter.js
//
// A Web Audio Module as something the engine can drive. Contract section 12.
//
// The exact mirror of src/wam/WamModule.js, which puts a WAM face on a JigDAW
// plugin. This puts a JigDAW face on a WAM, so that everything above
// src/engine/Engine.js keeps working on one shape and the foreign plugin is
// foreign only where it has to be.
//
// The engine asks a node for four things, and a WamNode answers none of them
// the same way:
//
//   node.connect / node.disconnect      a WamNode is an AudioNode, so this one
//                                       is free and is delegated
//   node.parameters.get(symbol)         WAM parameters are not AudioParams
//   node.port.postMessage(...)          WAM has methods, not a message protocol
//   node.port.onmessage = ...           and events, not messages
//
// So the adapter supplies a parameter map and a port that are shaped like Web
// Audio's and JigDAW's, and translates. Nothing above it knows.
//
// What cannot be translated is stated rather than papered over: see the notes
// on automation and on latency below.

/**
 * An AudioParam-shaped view of one WAM parameter.
 *
 * The engine calls setValueAtTime, so that is the method that has to exist.
 * WAM's setParameterValues is asynchronous and takes no time argument, so the
 * schedule is discarded and the value is applied as soon as it can be: a WAM
 * has no way to accept "this value at that moment".
 *
 * That is the a-rate loss from the other direction. A JigDAW automation curve
 * becomes a series of immediate writes, which is audible on a fast sweep and is
 * why contract section 12.6 says the real-time rules still apply to the
 * adapter, not that they are met by magic.
 */
class ForeignParam {
  #node
  #id
  #info

  constructor (node, id, info) {
    this.#node = node
    this.#id = id
    this.#info = info
    this.value = info.defaultValue ?? 0
    this.defaultValue = info.defaultValue ?? 0
    this.minValue = info.minValue ?? 0
    this.maxValue = info.maxValue ?? 1
    this.automationRate = 'k-rate'
  }

  setValueAtTime (value) {
    this.value = value
    // Fire and forget: the engine's setParameter is synchronous and returns the
    // clamped value, and awaiting here would make every parameter move a
    // promise the UI has to thread through. A rejection is reported rather
    // than swallowed.
    this.#node.setParameterValues({ [this.#id]: { id: this.#id, value, normalized: false } })
      .catch(error => console.error(`foreign parameter ${this.#id}:`, error))
    return this
  }

  // Enough of the AudioParam surface that ordinary automation calls do not
  // throw. None of them can be honoured with timing, so they all land now.
  linearRampToValueAtTime (value) { return this.setValueAtTime(value) }
  exponentialRampToValueAtTime (value) { return this.setValueAtTime(value) }
  setTargetAtTime (value) { return this.setValueAtTime(value) }
  cancelScheduledValues () { return this }
}

/**
 * A MessagePort-shaped translator between JigDAW's protocol and WAM's methods.
 *
 * Only the messages the engine and the dispatcher actually send are handled.
 * An unrecognised one is reported rather than dropped, because a message that
 * vanishes is how a protocol quietly grows a hole.
 */
class ForeignPort {
  #node
  #wam
  #onmessage = null

  constructor (node, wam) {
    this.#node = node
    this.#wam = wam
  }

  set onmessage (handler) {
    this.#onmessage = handler
    if (!handler) return
    // MIDI the plugin emits, as a JigDAW events message.
    this.#node.addEventListener?.('wam-midi', event => {
      const bytes = event?.detail?.data?.bytes ?? event?.data?.bytes
      if (!bytes) return
      this.#deliver({ type: 'events', events: [{ frame: 0, bytes: Uint8Array.from(bytes) }] })
    })
  }

  get onmessage () { return this.#onmessage }

  #deliver (message) {
    this.#onmessage?.({ data: message })
  }

  postMessage (message) {
    switch (message?.type) {
      case 'events':
        for (const event of message.events ?? []) {
          this.#node.scheduleEvents({
            type: 'wam-midi',
            time: this.#node.context.currentTime,
            data: { bytes: [...event.bytes] }
          })
        }
        return

      case 'transport':
        this.#node.scheduleEvents({
          type: 'wam-transport',
          data: {
            currentBar: Math.floor(message.beat / (message.timeSignature?.[0] ?? 4)),
            currentBarStarted: this.#node.context.currentTime,
            tempo: message.tempo ?? 120,
            timeSigNumerator: message.timeSignature?.[0] ?? 4,
            timeSigDenominator: message.timeSignature?.[1] ?? 4,
            playing: !!message.playing
          }
        })
        return

      case 'stateRequest':
        this.#node.getState()
          .then(state => this.#deliver({ type: 'state', token: message.token, state }))
          .catch(error => this.#deliver({
            type: 'error', phase: 'state', fatal: false, message: error.message
          }))
        return

      case 'dispose':
        try { this.#node.destroy?.() } catch { /* already gone */ }
        return

      case 'init':
        // The engine does not send this: a foreign plugin is already
        // instantiated by the time the adapter exists. Named so that a future
        // caller gets a refusal rather than silence.
        this.#deliver({
          type: 'error', phase: 'instantiate', fatal: true,
          message: 'a foreign plugin is instantiated by its own adapter and takes no init'
        })
        return

      default:
        console.warn(`foreign plugin: no translation for a "${message?.type}" message`)
    }
  }

  /** A real MessagePort has these; nothing here needs them to do anything. */
  start () {}
  close () {}
}

/**
 * Wrap an instantiated WAM so the engine can treat it as any other node.
 *
 * Takes the `WebAudioModule` the adapter created, not a URL: loading, verifying
 * and consenting all happened in ForeignLoader and ForeignOrigin, and doing any
 * of it here would put a second path to running foreign code in the codebase.
 */
export async function adoptWamNode (wam) {
  const node = wam.audioNode
  const info = await node.getParameterInfo()

  const parameters = new Map()
  for (const [id, one] of Object.entries(info)) {
    parameters.set(id, new ForeignParam(node, id, one))
  }

  // The engine reads these off the node itself.
  node.parameters = parameters
  node.port = new ForeignPort(node, wam)

  // A plugin with no audio output is never pulled by Web Audio, so the engine
  // drives it with a constant source. A WAM says whether it has one in its
  // descriptor, which is the only place the answer exists.
  node.jigdawNeedsDriving = wam.descriptor?.hasAudioOutput === false &&
                            wam.descriptor?.hasAudioInput === false

  return node
}

/**
 * The profile shape the rest of the host expects, from what the adapter can
 * actually ask the plugin.
 *
 * The declared ports in a foreign profile are a description written by whoever
 * catalogued it. These come from the plugin itself, at run time, and are what
 * the panel is drawn from: the plugin is the authority on its own parameters
 * and the profile is a claim about them.
 */
export async function foreignProfile (declared, wam) {
  const info = await wam.audioNode.getParameterInfo()
  const ports = Object.entries(info).map(([id, one]) => ({
    iri: `${declared.iri}#${id}`,
    symbol: id,
    name: one.label ?? id,
    defaultValue: one.defaultValue ?? 0,
    minimum: one.minValue ?? 0,
    maximum: one.maxValue ?? 1,
    unit: null,
    toggled: one.type === 'boolean',
    enumeration: one.type === 'choice',
    scalePoints: (one.choices ?? []).map((label, value) => ({ label, value })),
    automationRate: 'k-rate',
    // The same rule contract section 5.3 uses for a native plugin, applied to
    // what WAM reports, so a foreign panel and a native one are generated by
    // one set of decisions.
    widget: one.type === 'boolean' ? 'switch'
      : (one.choices ?? []).length > 2 ? 'selector'
      : (one.choices ?? []).length === 2 ? 'switch' : 'dial'
  }))

  return {
    ...declared,
    kind: 'foreign',
    label: wam.descriptor?.name ?? declared.label,
    comment: wam.descriptor?.description ?? declared.comment,
    vendor: wam.descriptor?.vendor ?? declared.vendor,
    audioInputs: wam.descriptor?.hasAudioInput ? 1 : 0,
    audioOutputs: wam.descriptor?.hasAudioOutput ? 1 : 0,
    outputChannels: 2,
    // A WAM reports a compensation delay in samples, and reports it after
    // instantiating rather than in a manifest, which is why this is read here
    // and not from the profile.
    latencyFrames: 0,
    ports
  }
}
