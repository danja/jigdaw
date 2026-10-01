// plugins/keyframe/keyframe-processor.js
//
// The AudioWorklet processor for Keyframe. Its shape is Quefrency's: the module
// is compiled and instantiated synchronously from bytes, every view exists
// before ready is posted, and process() allocates nothing and never grows
// memory. It takes no MIDI, so there is no event queue.
//
// Latency is a constant, two forced keyframe hops, so ready carries what the
// module reports and no latency message is ever sent.

// Hand-written from the same lv2:port declarations the host reads, because a
// worklet cannot fetch its own profile. tests/dsp/keyframe.test.js binds the
// two. Listed in jig:paramIndex order: the position is the index.
const DESCRIPTORS = Object.freeze([
  { name: 'time_rate', defaultValue: 100, minValue: 25, maxValue: 400, automationRate: 'k-rate' },
  { name: 'pitch_shift', defaultValue: 0, minValue: -24, maxValue: 24, automationRate: 'k-rate' },
  { name: 'splice_keyframes', defaultValue: 16, minValue: 4, maxValue: 256, automationRate: 'k-rate' },
  { name: 'max_splice', defaultValue: 200, minValue: 5, maxValue: 500, automationRate: 'k-rate' },
  { name: 'threshold', defaultValue: -60, minValue: -90, maxValue: -30, automationRate: 'k-rate' },
  { name: 'mix', defaultValue: 1, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
  { name: 'output', defaultValue: 0, minValue: -24, maxValue: 12, automationRate: 'k-rate' },
  { name: 'quality', defaultValue: 0, minValue: 0, maxValue: 2, automationRate: 'k-rate' },
  { name: 'stereo', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate' }
])

const NAMES = Object.freeze(DESCRIPTORS.map(d => d.name))

class KeyframeProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors () {
    return DESCRIPTORS
  }

  constructor (options) {
    super(options)
    this.ready = false
    this.exports = null
    this.inputViews = []
    this.outputViews = []
    // A value is pushed into the wasm only when it changes, because writing a
    // new Quality or Stereo restarts the capture.
    this.lastValues = new Float32Array(NAMES.length).fill(NaN)

    this.port.onmessage = event => this.handle(event.data)
  }

  handle (message) {
    if (message?.type !== 'init') return
    try {
      this.instantiate(message.module, message.sampleRate ?? sampleRate)
      this.ready = true
      this.port.postMessage({
        type: 'ready', latencyFrames: this.exports.jig_latency_frames(), tailFrames: null
      })
    } catch (error) {
      // Reported, not thrown. Contract section 10.2.
      this.port.postMessage({
        type: 'error', phase: 'instantiate', fatal: true, message: String(error?.message ?? error)
      })
    }
  }

  instantiate (moduleBytes, rate) {
    if (!moduleBytes) throw new Error('init carried no WebAssembly bytes')

    // Compiled here, synchronously: a compiled Module cannot be posted into a
    // worklet at all. Contract section 3.3.
    const compiled = new WebAssembly.Module(moduleBytes)
    const exports = new WebAssembly.Instance(compiled, {}).exports

    for (const name of ['jig_init', 'jig_process', 'jig_input_ptr', 'jig_output_ptr', 'jig_set_param',
      'jig_max_frames', 'jig_latency_frames', 'memory']) {
      if (!(name in exports)) throw new Error(`the module does not export ${name}`)
    }

    exports.jig_init(rate)

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
      for (const channel of output) channel.fill(0)
      return true
    }

    const frames = Math.min(output[0].length, this.maxFrames)
    const input = inputs[0]

    for (let channel = 0; channel < 2; channel++) {
      const source = input && input.length > 0 ? input[Math.min(channel, input.length - 1)] : null
      const view = this.inputViews[channel]
      if (source) {
        view.set(source.subarray(0, frames))
      } else {
        // A disconnected input is silence, not an error. Contract section 4.2.
        view.fill(0, 0, frames)
      }
    }

    // A value is written into the module only when it changes: a change of
    // Quality or Stereo empties the capture, so it must not be repeated.
    for (let index = 0; index < NAMES.length; index++) {
      const values = parameters[NAMES[index]]
      if (!values) continue
      const value = values[values.length - 1]
      if (value !== this.lastValues[index]) {
        this.exports.jig_set_param(index, value)
        this.lastValues[index] = value
      }
    }

    this.exports.jig_process(frames)

    for (let channel = 0; channel < output.length; channel++) {
      output[channel].set(this.outputViews[Math.min(channel, 1)].subarray(0, frames))
      if (frames < output[channel].length) output[channel].fill(0, frames)
    }

    // Always true: the frame buffer still holds up to latencyFrames of output.
    return true
  }
}

registerProcessor('keyframe', KeyframeProcessor)
