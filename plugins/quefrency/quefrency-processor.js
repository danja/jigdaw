// plugins/quefrency/quefrency-processor.js
//
// The AudioWorklet processor for Quefrency. Its shape is Cascade's: the module
// is compiled and instantiated synchronously from bytes, every view exists
// before ready is posted, and process() allocates nothing and never grows
// memory.
//
// Two differences. This plugin has latency, which depends on the sample rate,
// so ready carries what the module reports for the rate it was given rather
// than a constant. And it takes MIDI control changes, queued here the way
// BassGen queues its notes: every event carries an absolute stream position
// and is handed to the module in the quantum that contains it, compared by
// range and never by equality with a block boundary. The queue is bounded,
// preallocated, and says how much it dropped.

// Hand-written from the same lv2:port declarations the host reads, because a
// worklet cannot fetch its own profile. tests/dsp/quefrency.test.js binds the
// two. Listed in jig:paramIndex order: the position is the index.
const DESCRIPTORS = Object.freeze([
  { name: 'formant_shift', defaultValue: 0, minValue: -12, maxValue: 12, automationRate: 'k-rate' },
  { name: 'formant_depth', defaultValue: 100, minValue: 0, maxValue: 200, automationRate: 'k-rate' },
  { name: 'formant_tilt', defaultValue: 0, minValue: -6, maxValue: 6, automationRate: 'k-rate' },
  { name: 'pitch_shift', defaultValue: 0, minValue: -24, maxValue: 24, automationRate: 'k-rate' },
  { name: 'pitch_fine', defaultValue: 0, minValue: -100, maxValue: 100, automationRate: 'k-rate' },
  { name: 'freq_shift', defaultValue: 0, minValue: -1000, maxValue: 1000, automationRate: 'k-rate' },
  { name: 'harmonic_depth', defaultValue: 100, minValue: 0, maxValue: 200, automationRate: 'k-rate' },
  { name: 'lifter', defaultValue: 1.5, minValue: 0.5, maxValue: 5, automationRate: 'k-rate' },
  { name: 'estimator', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
  { name: 'mix', defaultValue: 1, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
  { name: 'output', defaultValue: 0, minValue: -24, maxValue: 12, automationRate: 'k-rate' }
])

const NAMES = Object.freeze(DESCRIPTORS.map(d => d.name))

const QUEUE_CAPACITY = 512
const EVENT_BYTES = 8 // docs/module-abi.md fixes the record at 8 bytes

class QuefrencyProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors () {
    return DESCRIPTORS
  }

  constructor (options) {
    super(options)
    this.ready = false
    this.exports = null
    this.inputViews = []
    this.outputViews = []
    // A value is pushed into the wasm only when it changes; the tilt table is
    // rebuilt on every write to it.
    this.lastValues = new Float32Array(NAMES.length).fill(NaN)

    this.queueFrames = new Float64Array(QUEUE_CAPACITY)
    this.queueBytes = new Uint8Array(QUEUE_CAPACITY * 3)
    this.queueCount = 0

    this.port.onmessage = event => this.handle(event.data)
  }

  handle (message) {
    if (message?.type === 'events') return this.enqueue(message.events)
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
      'jig_max_frames', 'jig_latency_frames', 'jig_midi_in_ptr', 'jig_midi_in_capacity', 'jig_midi_in',
      'memory']) {
      if (!(name in exports)) throw new Error(`the module does not export ${name}`)
    }

    exports.jig_init(rate)

    const maxFrames = exports.jig_max_frames()
    const buffer = exports.memory.buffer
    for (let channel = 0; channel < 2; channel++) {
      this.inputViews.push(new Float32Array(buffer, exports.jig_input_ptr(channel), maxFrames))
      this.outputViews.push(new Float32Array(buffer, exports.jig_output_ptr(channel), maxFrames))
    }

    this.inCapacity = exports.jig_midi_in_capacity()
    this.midiIn = new DataView(buffer, exports.jig_midi_in_ptr(), this.inCapacity * EVENT_BYTES)

    this.exports = exports
    this.maxFrames = maxFrames
  }

  enqueue (events) {
    if (!events?.length) return
    let dropped = 0
    for (const event of events) {
      if (this.queueCount >= QUEUE_CAPACITY) { dropped += 1; continue }
      const slot = this.queueCount
      this.queueFrames[slot] = event.frame
      const bytes = event.bytes
      this.queueBytes[slot * 3] = bytes[0] ?? 0
      this.queueBytes[slot * 3 + 1] = bytes[1] ?? 0
      this.queueBytes[slot * 3 + 2] = bytes[2] ?? 0
      this.queueCount += 1
    }
    if (dropped > 0) this.port.postMessage({ type: 'dropped', count: dropped, since: currentFrame })
  }

  /** Hand the module every event due in this quantum, in the ABI's layout. */
  deliverDue (blockStart, blockEnd) {
    let written = 0
    let kept = 0
    for (let i = 0; i < this.queueCount; i++) {
      const at = this.queueFrames[i]
      if (at < blockEnd) {
        if (written < this.inCapacity) {
          // An event whose frame has already passed is applied now rather than
          // dropped: moving it is better than losing it. messaging.md 1.4.
          const offset = Math.max(0, Math.min(blockEnd - blockStart - 1, at - blockStart))
          const base = written * EVENT_BYTES
          this.midiIn.setUint32(base, offset, true)
          this.midiIn.setUint8(base + 4, 3)
          this.midiIn.setUint8(base + 5, this.queueBytes[i * 3])
          this.midiIn.setUint8(base + 6, this.queueBytes[i * 3 + 1])
          this.midiIn.setUint8(base + 7, this.queueBytes[i * 3 + 2])
          written += 1
        }
        continue
      }
      this.queueFrames[kept] = at
      this.queueBytes[kept * 3] = this.queueBytes[i * 3]
      this.queueBytes[kept * 3 + 1] = this.queueBytes[i * 3 + 1]
      this.queueBytes[kept * 3 + 2] = this.queueBytes[i * 3 + 2]
      kept += 1
    }
    this.queueCount = kept
    this.exports.jig_midi_in(written)
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

    // Parameters first, then the events due: a host automating a parameter and
    // a controller sending its CC in the same quantum, the controller wins.
    // After that the module keeps the controller's value until the host's
    // own value next changes, because a value is only written on a change.
    for (let index = 0; index < NAMES.length; index++) {
      const values = parameters[NAMES[index]]
      if (!values) continue
      const value = values[values.length - 1]
      if (value !== this.lastValues[index]) {
        this.exports.jig_set_param(index, value)
        this.lastValues[index] = value
      }
    }

    this.deliverDue(currentFrame, currentFrame + frames)
    this.exports.jig_process(frames)

    for (let channel = 0; channel < output.length; channel++) {
      output[channel].set(this.outputViews[Math.min(channel, 1)].subarray(0, frames))
      if (frames < output[channel].length) output[channel].fill(0, frames)
    }

    // Always true: the frame buffer still holds up to latencyFrames of output.
    return true
  }
}

registerProcessor('quefrency', QuefrencyProcessor)
