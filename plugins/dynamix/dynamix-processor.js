// plugins/dynamix/dynamix-processor.js
//
// The AudioWorklet processor for Dynamix. This is the only plugin code that
// runs on the audio thread. See plugins/cascade/cascade-processor.js for the
// pattern this follows; the difference here is a second audio input, read the
// same defensive way as the first (contract section 4.2: a disconnected input
// arrives as an empty array, which is silence and not an error) but also used
// to decide whether the compressor/expander detects on the side chain or on
// the main signal itself. That decision belongs here, in the one place that
// holds the Web Audio inputs array, and is passed into the wasm rather than
// re-derived there.

const PARAM_INDEX = Object.freeze({
  comp_enable: 0,
  comp_mode: 1,
  threshold: 2,
  ratio: 3,
  attack: 4,
  release: 5,
  knee: 6,
  makeup: 7,
  limit_enable: 8,
  ceiling: 9,
  limit_release: 10,
  clip_enable: 11,
  drive: 12,
  shape: 13
})

class DynamixProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors () {
    // Derived by hand here from the same lv2:port declarations the host
    // reads, because a worklet cannot fetch its own profile. A mismatch with
    // the profile is caught by tests/dsp/dynamix.test.js rather than left to
    // drift.
    return [
      { name: 'comp_enable', defaultValue: 1, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'comp_mode', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'threshold', defaultValue: -18, minValue: -60, maxValue: 0, automationRate: 'k-rate' },
      { name: 'ratio', defaultValue: 4, minValue: 1, maxValue: 20, automationRate: 'k-rate' },
      { name: 'attack', defaultValue: 10, minValue: 0.1, maxValue: 200, automationRate: 'k-rate' },
      { name: 'release', defaultValue: 100, minValue: 5, maxValue: 1000, automationRate: 'k-rate' },
      { name: 'knee', defaultValue: 6, minValue: 0, maxValue: 24, automationRate: 'k-rate' },
      { name: 'makeup', defaultValue: 0, minValue: -12, maxValue: 24, automationRate: 'k-rate' },
      { name: 'limit_enable', defaultValue: 1, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'ceiling', defaultValue: -0.3, minValue: -12, maxValue: 0, automationRate: 'k-rate' },
      { name: 'limit_release', defaultValue: 50, minValue: 5, maxValue: 500, automationRate: 'k-rate' },
      { name: 'clip_enable', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'drive', defaultValue: 0, minValue: 0, maxValue: 24, automationRate: 'k-rate' },
      { name: 'shape', defaultValue: 0.3, minValue: 0, maxValue: 1, automationRate: 'k-rate' }
    ]
  }

  constructor (options) {
    super(options)
    this.ready = false
    this.exports = null
    this.inputViews = []
    this.outputViews = []
    this.lastValues = new Float32Array(Object.keys(PARAM_INDEX).length).fill(NaN)
    this.lastSidechainActive = null

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

    // Compiled here, synchronously. Contract section 3.3: a compiled Module
    // cannot be posted into a worklet at all, it is silently never delivered,
    // and the 4 KB synchronous-compile limit applies to the main thread only.
    const compiled = new WebAssembly.Module(moduleBytes)
    const instance = new WebAssembly.Instance(compiled, {})
    const exports = instance.exports

    for (const name of [
      'jig_init', 'jig_process', 'jig_input_ptr', 'jig_output_ptr', 'jig_set_param',
      'jig_set_sidechain_active', 'jig_max_frames', 'memory'
    ]) {
      if (!(name in exports)) throw new Error(`the module does not export ${name}`)
    }

    exports.jig_init(rate)

    const maxFrames = exports.jig_max_frames()
    const buffer = exports.memory.buffer

    // Views are created once. WebAssembly.Memory.grow() would detach every
    // one of them, which is why nothing here ever grows memory: the symptom
    // is silence, not an exception. Channels 0 and 1 are the main input,
    // 2 and 3 the side chain key.
    for (let channel = 0; channel < 4; channel++) {
      this.inputViews.push(new Float32Array(buffer, exports.jig_input_ptr(channel), maxFrames))
    }
    for (let channel = 0; channel < 2; channel++) {
      this.outputViews.push(new Float32Array(buffer, exports.jig_output_ptr(channel), maxFrames))
    }

    this.exports = exports
    this.maxFrames = maxFrames
  }

  /** Copy one Web Audio input's channels into two of the wasm's four input
   * scratch buffers, starting at `base`. A disconnected input is an empty
   * array, contract section 4.2, and is written as silence rather than read. */
  copyStereoInput (input, base, frames) {
    for (let channel = 0; channel < 2; channel++) {
      const source = input && input.length > 0 ? input[Math.min(channel, input.length - 1)] : null
      const view = this.inputViews[base + channel]
      if (source) {
        view.set(source.subarray(0, frames))
      } else {
        view.fill(0, 0, frames)
      }
    }
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

    this.copyStereoInput(inputs[0], 0, frames)
    this.copyStereoInput(inputs[1], 2, frames)

    const sidechainActive = Boolean(inputs[1] && inputs[1].length > 0)
    if (sidechainActive !== this.lastSidechainActive) {
      this.exports.jig_set_sidechain_active(sidechainActive ? 1 : 0)
      this.lastSidechainActive = sidechainActive
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

    // Always true: a dynamics processor may yet produce output even from a
    // quiet block, and its envelope and limiter gain are state a false would
    // discard for no reason.
    return true
  }
}

registerProcessor('dynamix', DynamixProcessor)
