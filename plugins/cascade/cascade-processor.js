// plugins/cascade/cascade-processor.js
//
// The AudioWorklet processor for Cascade. This is the only plugin code that
// runs on the audio thread.
//
// Contract sections 3.3, 3.4 and 4.1 are all visible here:
//   the WebAssembly.Module arrives already compiled and is instantiated
//   synchronously, because AudioWorkletGlobalScope has no fetch and process()
//   cannot await;
//   every view and every buffer exists before ready is posted;
//   process() allocates nothing, and memory is never grown.

// The parameter order this plugin's wasm agrees with itself on. Not part of the
// host contract: the host knows only this module.
const PARAM_INDEX = Object.freeze({ mix: 0, size: 1, damping: 2, freeze: 3, mode: 4 })

class CascadeProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors () {
    // Derived by hand here from the same lv2:port declarations the host reads,
    // because a worklet cannot fetch its own profile. A mismatch with the
    // profile is caught by tests/dsp/cascade.test.js rather than left to drift.
    return [
      { name: 'mix', defaultValue: 0.3, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'size', defaultValue: 24, minValue: 2, maxValue: 60, automationRate: 'k-rate' },
      { name: 'damping', defaultValue: 4200, minValue: 200, maxValue: 18000, automationRate: 'k-rate' },
      { name: 'freeze', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'mode', defaultValue: 0, minValue: 0, maxValue: 2, automationRate: 'k-rate' }
    ]
  }

  constructor (options) {
    super(options)
    this.ready = false
    this.exports = null
    this.inputViews = []
    this.outputViews = []
    // Last value seen per parameter, so a value is pushed into the wasm only
    // when it changes. Retuning the delay lines is not free and most
    // parameters do not move on most blocks.
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
      // A failed load is reported, not thrown. Contract section 10.2: the rest
      // of the graph keeps running and this node stays silent.
      this.port.postMessage({
        type: 'error', phase: 'instantiate', fatal: true, message: String(error?.message ?? error)
      })
    }
  }

  instantiate (compiledModule, rate) {
    if (!compiledModule) throw new Error('init carried no WebAssembly module')

    // Synchronous. new WebAssembly.Instance takes a Module that already holds
    // compiled code, so nothing is awaited and nothing blocks the thread on a
    // network round trip that could not happen here anyway.
    const instance = new WebAssembly.Instance(compiledModule, {})
    const exports = instance.exports

    for (const name of ['jig_init', 'jig_process', 'jig_input_ptr', 'jig_output_ptr', 'jig_set_param', 'jig_max_frames', 'memory']) {
      if (!(name in exports)) throw new Error(`the module does not export ${name}`)
    }

    exports.jig_init(rate)

    const maxFrames = exports.jig_max_frames()
    const buffer = exports.memory.buffer

    // Views are created once. WebAssembly.Memory.grow() would detach every one
    // of them, which is why nothing here ever grows memory: the symptom is
    // silence, not an exception.
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
        // A disconnected input arrives as an empty array, which is silence and
        // not an error. Contract section 4.2.
        view.set(source.subarray(0, frames))
      } else {
        view.fill(0, 0, frames)
      }
    }

    for (const [name, index] of Object.entries(PARAM_INDEX)) {
      const values = parameters[name]
      if (!values) continue
      // Length 1 when the value is constant across the quantum, 128 when it is
      // not. Both must be handled. Contract section 5.2.
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

    // Always true: a reverb may yet produce output even with silent input.
    return true
  }
}

registerProcessor('cascade', CascadeProcessor)
