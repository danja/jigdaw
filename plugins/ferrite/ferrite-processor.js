// plugins/ferrite/ferrite-processor.js
//
// The AudioWorklet processor for Ferrite. Two jig:asset resources arrive
// alongside the module in the init message (docs/messaging.md section 1.2):
// the .nam model and the cabinet impulse response, each copied into its own
// buffer inside the module's memory and handed off with its own
// jig_load_<name> call, the same shape plugins/_jsfx-runtime's compiled
// script uses for its one asset.
//
// jig_load_nam and jig_load_ir both return a status this module defines
// itself (0 ok, 1 loaded but the file's own sample rate does not match the
// host's, negative on a real parse failure): a convention between this
// processor and its own module, not part of the host contract, exactly as
// for-plugin-authors.md says that ABI is free to be.
const PARAM_INDEX = Object.freeze({ input: 0, output: 1 })

class FerriteProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors () {
    return [
      { name: 'input', defaultValue: 1.0, minValue: 0.0, maxValue: 4.0, automationRate: 'k-rate' },
      { name: 'output', defaultValue: 1.0, minValue: 0.0, maxValue: 2.0, automationRate: 'k-rate' }
    ]
  }

  constructor (options) {
    super(options)
    this.ready = false
    this.exports = null
    this.inputViews = []
    this.outputViews = []
    this.lastValues = new Float32Array(Object.keys(PARAM_INDEX).length).fill(NaN)
    this.port.onmessage = event => this.handle(event.data)
  }

  handle (message) {
    if (message?.type !== 'init') return
    try {
      this.instantiate(message.module, message.assets ?? {}, message.sampleRate ?? sampleRate)
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

  /** Copy `bytes` into the module's buffer at `ptrExport()`, refusing rather
   * than truncating if it does not fit, then call `loadExport(length)` and
   * report what it says. */
  loadAsset (exports, bytes, what, ptrName, maxLenName, loadName) {
    if (!bytes) throw new Error(`init carried no "${what}" asset`)
    const maxLen = exports[maxLenName]()
    if (bytes.byteLength > maxLen) {
      throw new Error(`${what} is ${bytes.byteLength} bytes, larger than this module's ${maxLen} byte buffer`)
    }
    new Uint8Array(exports.memory.buffer, exports[ptrName](), bytes.byteLength).set(new Uint8Array(bytes))
    const status = exports[loadName](bytes.byteLength)
    if (status < 0) throw new Error(`${what} did not parse (code ${status})`)
    if (status > 0) {
      // Not fatal: the model or the impulse response is real and loaded, it
      // is just timed for a different sample rate than this session is
      // running at. Reported so it is not mistaken for a normal load.
      this.port.postMessage({ type: 'warning', message: `${what}'s own sample rate does not match this session's` })
    }
  }

  instantiate (moduleBytes, assets, rate) {
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

    // The host's rate first: both loaders below compare a file's own
    // declared rate against it, and can only do that once it is known.
    exports.jig_init(rate)

    this.loadAsset(exports, assets.nam, 'the neural amp model', 'jig_nam_ptr', 'jig_nam_max_len', 'jig_load_nam')
    this.loadAsset(exports, assets.ir, 'the cabinet impulse response', 'jig_ir_ptr', 'jig_ir_max_len', 'jig_load_ir')

    const maxFrames = exports.jig_max_frames()
    const buffer = exports.memory.buffer
    for (let channel = 0; channel < 2; channel++) {
      this.inputViews.push(new Float32Array(buffer, exports.jig_input_ptr(channel), maxFrames))
      this.outputViews.push(new Float32Array(buffer, exports.jig_output_ptr(channel), maxFrames))
    }

    this.exports = exports
    this.maxFrames = maxFrames
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
