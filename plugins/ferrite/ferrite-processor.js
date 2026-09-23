// plugins/ferrite/ferrite-processor.js
//
// The AudioWorklet processor for Ferrite. Two jig:asset resources arrive
// alongside the module in the init message (docs/messaging.md section 1.2):
// the .nam model and the cabinet impulse response, each copied into its own
// buffer inside the module's memory and handed off with its own
// jig_load_<name> call, the same shape plugins/_jsfx-runtime's compiled
// script uses for its one asset.
//
// Both are also jig:userReplaceable: a person can load a different file for
// either from the generated panel, at any time, and the currently loaded
// bytes are this plugin's whole state (contract section 8), handed back
// whenever the host asks and restored from init's `state` field when a
// saved session provides one. Three call sites, one method, applyAsset
// below, so "load a file" means the same thing whichever of the three asked
// for it.
//
// jig_load_nam and jig_load_ir both return a status this module defines
// itself (0 ok, 1 loaded but the file's own sample rate does not match the
// host's, negative on a real parse failure): a convention between this
// processor and its own module, not part of the host contract, exactly as
// for-plugin-authors.md says that ABI is free to be. Reported to the host
// as messaging.md's own `error` with `fatal: false` for the negative case
// and `fatal: false` again for the rate mismatch, never as a made up
// message type nothing listens for.
const PARAM_INDEX = Object.freeze({ input: 0, output: 1, amp: 2, mix: 3 })

/** Which module exports each asset key loads through. Adding a third asset
 * some day is one more entry here, not a third copy of applyAsset. */
const ASSETS = Object.freeze({
  nam: {
    label: 'the neural amp model', ptr: 'jig_nam_ptr', maxLen: 'jig_nam_max_len', load: 'jig_load_nam',
    failures: { '-1': 'is not UTF-8 text', '-2': 'is not a .nam model this plugin can read', '-3': 'could not be built' }
  },
  ir: {
    label: 'the impulse response', ptr: 'jig_ir_ptr', maxLen: 'jig_ir_max_len', load: 'jig_load_ir',
    failures: {
      '-1': 'is not a WAV file this plugin can read: PCM 16, 24 or 32 bit, or 32 bit float',
      '-2': 'is silent',
      '-3': 'is longer than 131072 samples, 2.7 seconds at 48 kHz'
    }
  }
})

class FerriteProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors () {
    return [
      { name: 'input', defaultValue: 1.0, minValue: 0.0, maxValue: 4.0, automationRate: 'k-rate' },
      { name: 'output', defaultValue: 1.0, minValue: 0.0, maxValue: 2.0, automationRate: 'k-rate' },
      { name: 'amp', defaultValue: 1, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'mix', defaultValue: 1.0, minValue: 0.0, maxValue: 1.0, automationRate: 'k-rate' }
    ]
  }

  constructor (options) {
    super(options)
    this.ready = false
    this.exports = null
    this.inputViews = []
    this.outputViews = []
    this.lastValues = new Float32Array(Object.keys(PARAM_INDEX).length).fill(NaN)
    // The bytes currently applied for each asset, kept so a stateRequest can
    // hand them back. Each is an ArrayBuffer this processor exclusively
    // owns, transferred in rather than copied, because ownership passing
    // once at the message boundary is the whole reason postMessage
    // transfers rather than clones.
    this.currentAssets = { nam: null, ir: null }
    this.port.onmessage = event => this.handle(event.data)
  }

  handle (message) {
    switch (message?.type) {
      case 'init': return this.onInit(message)
      case 'loadAsset': return this.onLoadAsset(message)
      case 'stateRequest': return this.onStateRequest(message)
      default: return
    }
  }

  onInit (message) {
    try {
      // state, if any, is applied inside instantiate(), before input and
      // output views are taken over the module's memory, never after: a
      // restored .nam re-runs jig_load_nam, which can grow the module's own
      // memory as nam-rs allocates the new model, and the ABI rule that
      // views must not be taken until nothing will grow it again applies to
      // a restore exactly as it does to the first load. Measured, not
      // assumed: doing this after instantiate() returned a
      // "detached ArrayBuffer" the first time it was tried.
      this.instantiate(message.module, message.assets ?? {}, message.sampleRate ?? sampleRate, message.state)
      this.ready = true
      this.port.postMessage({ type: 'ready', latencyFrames: 0, tailFrames: null })
    } catch (error) {
      // A failed load is reported, not thrown. Contract section 10.2: the
      // rest of the graph keeps running and this node stays silent.
      this.port.postMessage({
        type: 'error', phase: 'instantiate', fatal: true, message: String(error?.message ?? error)
      })
    }
  }

  /** messaging.md 1.2: a person choosing a different file from the
   * generated panel, after the plugin is already running. Never fatal: the
   * plugin keeps whatever it had loaded before if the new file does not
   * parse.
   *
   * refreshViews() runs even on success alone, not on every message: a
   * bigger .nam than any loaded so far can make nam-rs's own allocation
   * grow the module's memory, which silently detaches the input and output
   * views process() already holds. The ABI's "must not grow after init" is
   * a rule for jig_process; a reload asked for from outside it is exactly
   * the case that rule does not cover, so the host side has to assume
   * growth is possible and re-take the views after every one, not just the
   * first. */
  onLoadAsset ({ key, bytes }) {
    if (!this.ready) return
    try {
      this.applyAsset(key, bytes)
      this.refreshViews()
    } catch (error) {
      this.port.postMessage({ type: 'error', phase: 'asset', fatal: false, message: String(error?.message ?? error) })
    }
  }

  /** messaging.md 1.3: the state this plugin's whole contribution to a
   * saved session is, the currently loaded bytes for each asset. Posted
   * without transferring: transferring would detach this processor's own
   * retained copy, and the next stateRequest needs it too. A structured
   * clone copies instead, which is what "the host now has its own copy to
   * write into jig:nodeState" actually requires. */
  onStateRequest ({ token }) {
    this.port.postMessage({ type: 'state', token, state: { ...this.currentAssets } })
  }

  /** Applied once per asset key at init from a saved session's state,
   * exactly the same call applyAsset makes for a live loadAsset message:
   * one path for "this plugin now has different bytes for this asset",
   * whichever of the two asked for it. A key the state does not mention
   * keeps whatever init's own assets already loaded.
   *
   * A key that fails to restore (a save from an incompatible version, a
   * corrupted value) is reported and skipped rather than thrown: this runs
   * inside instantiate(), before ready, and a bad saved value must not be a
   * worse outcome than the save never having existed, which is what the
   * shipped default it falls back to already is. */
  restoreState (state) {
    for (const key of Object.keys(ASSETS)) {
      if (!(state[key] instanceof ArrayBuffer)) continue
      try {
        this.applyAsset(key, state[key])
      } catch (error) {
        this.port.postMessage({
          type: 'error', phase: 'asset', fatal: false,
          message: `restoring the saved ${ASSETS[key].label}: ${error.message}`
        })
      }
    }
  }

  /** Copy `bytes` into the module's buffer for `key`, refusing rather than
   * truncating if it does not fit, call the module's own loader, and keep a
   * reference for the next stateRequest. Every one of the three ways this
   * plugin's assets change (the shipped default, a loadAsset message, a
   * restored state) goes through here, so the module and this.currentAssets
   * cannot disagree about what is actually loaded. */
  applyAsset (key, bytes) {
    const shape = ASSETS[key]
    if (!shape) throw new Error(`no such asset: ${key}`)
    if (!bytes) throw new Error(`no bytes given for ${shape.label}`)
    const exports = this.exports
    const maxLen = exports[shape.maxLen]()
    if (bytes.byteLength > maxLen) {
      throw new Error(`${shape.label} is ${bytes.byteLength} bytes, larger than this module's ${maxLen} byte buffer`)
    }
    new Uint8Array(exports.memory.buffer, exports[shape.ptr](), bytes.byteLength).set(new Uint8Array(bytes))
    const status = exports[shape.load](bytes.byteLength)
    if (status < 0) throw new Error(`${shape.label} ${shape.failures[status] ?? `did not load (code ${status})`}`)
    this.currentAssets[key] = bytes
    if (status > 0) {
      // Not fatal: the model or the impulse response is real and loaded, it
      // is just timed for a different sample rate than this session is
      // running at.
      this.port.postMessage({
        type: 'error', phase: 'asset', fatal: false,
        message: `${shape.label}'s own sample rate does not match this session's`
      })
    }
  }

  instantiate (moduleBytes, assets, rate, state) {
    if (!moduleBytes) throw new Error('init carried no WebAssembly bytes')
    const compiled = new WebAssembly.Module(moduleBytes)
    const instance = new WebAssembly.Instance(compiled, {})
    const exports = instance.exports

    for (const name of [
      'jig_init', 'jig_process', 'jig_input_ptr', 'jig_output_ptr', 'jig_set_param',
      'jig_nam_ptr', 'jig_nam_max_len', 'jig_load_nam',
      'jig_ir_ptr', 'jig_ir_max_len', 'jig_load_ir',
      'jig_max_frames', 'memory'
    ]) {
      if (!(name in exports)) throw new Error(`the module does not export ${name}`)
    }

    this.exports = exports

    // The host's rate first: applyAsset's loaders compare a file's own
    // declared rate against it, and can only do that once it is known.
    exports.jig_init(rate)

    this.applyAsset('nam', assets.nam)
    this.applyAsset('ir', assets.ir)
    // A restored session's bytes, if any, override the shipped defaults
    // just loaded, still before views are taken: restoring is exactly as
    // capable of growing the module's memory as the first load was.
    if (state) this.restoreState(state)

    this.refreshViews()
  }

  /** (Re)build inputViews/outputViews from the module's current memory and
   * pointers. Never assumes a previous call is still valid: `jig_load_nam`
   * or `jig_load_ir` may have grown the module's own linear memory since,
   * which replaces `exports.memory.buffer` with a new object and detaches
   * every view taken over the old one. The pointers themselves do not move
   * when memory grows, only the buffer object they are read against does,
   * which is why this re-reads the buffer on every call but not the module. */
  refreshViews () {
    const exports = this.exports
    this.maxFrames = exports.jig_max_frames()
    const buffer = exports.memory.buffer
    this.inputViews = []
    this.outputViews = []
    for (let channel = 0; channel < 2; channel++) {
      this.inputViews.push(new Float32Array(buffer, exports.jig_input_ptr(channel), this.maxFrames))
      this.outputViews.push(new Float32Array(buffer, exports.jig_output_ptr(channel), this.maxFrames))
    }
  }

  process (inputs, outputs, parameters) {
    const output = outputs[0]
    if (!output || output.length === 0) return true

    if (!this.ready) {
      // Contract section 3.1: a processor that is not ready outputs
      // silence, does not throw, and is not audible.
      for (const channel of output) channel.fill(0)
      return true
    }

    const frames = Math.min(output[0].length, this.maxFrames)
    const input = inputs[0]

    for (let channel = 0; channel < 2; channel++) {
      const source = input && input.length > 0 ? input[Math.min(channel, input.length - 1)] : null
      const view = this.inputViews[channel]
      if (source) {
        // A disconnected input arrives as an empty array, which is silence
        // and not an error. Contract section 4.2.
        view.set(source.subarray(0, frames))
      } else {
        view.fill(0, 0, frames)
      }
    }

    for (const [name, index] of Object.entries(PARAM_INDEX)) {
      const values = parameters[name]
      if (!values) continue
      // Length 1 when the value is constant across the quantum, 128 when it
      // is not. Both must be handled. Contract section 5.2.
      const value = values.length === 1 ? values[0] : values[values.length - 1]
      if (value !== this.lastValues[index]) {
        this.exports.jig_set_param(index, value)
        this.lastValues[index] = value
      }
    }

    this.exports.jig_process(frames)

    for (let channel = 0; channel < output.length; channel++) {
      const view = this.outputViews[Math.min(channel, 1)]
      output[channel].set(view.subarray(0, frames))
      if (frames < output[channel].length) output[channel].fill(0, frames)
    }

    return true
  }
}

registerProcessor('ferrite', FerriteProcessor)
