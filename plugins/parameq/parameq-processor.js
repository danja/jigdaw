// plugins/parameq/parameq-processor.js
//
// The AudioWorklet processor for Parameq: ABI wiring (contract sections 3.3,
// 3.4, 4.1), not DSP. The shape follows plugins/boost/boost-processor.js,
// with thirty-one parameters instead of one: a master enable and, per band,
// on, type, frequency, gain and Q. Parameter positions come from the same
// lv2:port declarations the host reads; a worklet cannot fetch its own
// profile, so they are repeated here by hand.

const PARAM_INDEX = Object.freeze({
  enabled: 0,
  b1_on: 1, b1_type: 2, b1_freq: 3, b1_gain: 4, b1_q: 5,
  b2_on: 6, b2_type: 7, b2_freq: 8, b2_gain: 9, b2_q: 10,
  b3_on: 11, b3_type: 12, b3_freq: 13, b3_gain: 14, b3_q: 15,
  b4_on: 16, b4_type: 17, b4_freq: 18, b4_gain: 19, b4_q: 20,
  b5_on: 21, b5_type: 22, b5_freq: 23, b5_gain: 24, b5_q: 25,
  b6_on: 26, b6_type: 27, b6_freq: 28, b6_gain: 29, b6_q: 30
})

const BAND_DEFAULT_TYPE = [4, 1, 0, 0, 2, 3]
const BAND_DEFAULT_FREQ = [80, 250, 1000, 4000, 8000, 16000]
const BAND_DEFAULT_Q = [0.7, 1, 1, 1, 1, 0.7]

function bandDescriptors (band) {
  const n = band + 1
  return [
    { name: `b${n}_on`, defaultValue: 1, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
    { name: `b${n}_type`, defaultValue: BAND_DEFAULT_TYPE[band], minValue: 0, maxValue: 6, automationRate: 'k-rate' },
    { name: `b${n}_freq`, defaultValue: BAND_DEFAULT_FREQ[band], minValue: 20, maxValue: 20000, automationRate: 'k-rate' },
    { name: `b${n}_gain`, defaultValue: 0, minValue: -24, maxValue: 24, automationRate: 'k-rate' },
    { name: `b${n}_q`, defaultValue: BAND_DEFAULT_Q[band], minValue: 0.1, maxValue: 10, automationRate: 'k-rate' }
  ]
}

class ParameqProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors () {
    // Derived by hand here from the same lv2:port declarations the host
    // reads, because a worklet cannot fetch its own profile.
    return [
      { name: 'enabled', defaultValue: 1, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      ...bandDescriptors(0),
      ...bandDescriptors(1),
      ...bandDescriptors(2),
      ...bandDescriptors(3),
      ...bandDescriptors(4),
      ...bandDescriptors(5)
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
      this.instantiate(message.module, message.sampleRate ?? sampleRate)
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

  instantiate (moduleBytes, rate) {
    if (!moduleBytes) throw new Error('init carried no WebAssembly bytes')

    // Compiled here, synchronously: AudioWorkletGlobalScope has no fetch and
    // process() cannot await. Contract section 3.3.
    const compiled = new WebAssembly.Module(moduleBytes)
    const instance = new WebAssembly.Instance(compiled, {})
    const exports = instance.exports

    for (const name of ['jig_init', 'jig_process', 'jig_input_ptr', 'jig_output_ptr', 'jig_set_param', 'jig_max_frames', 'memory']) {
      if (!(name in exports)) throw new Error(`the module does not export ${name}`)
    }

    exports.jig_init(rate)

    const maxFrames = exports.jig_max_frames()
    const buffer = exports.memory.buffer

    // Views are created once. WebAssembly.Memory.grow() would detach every
    // one of them, which is why nothing here ever grows memory.
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
      // Contract section 3.1: a processor that is not ready outputs silence,
      // does not throw, and is not audible.
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

registerProcessor('parameq', ParameqProcessor)
