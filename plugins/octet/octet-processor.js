// plugins/octet/octet-processor.js
//
// The AudioWorklet processor for Octet.
//
// The module is the equalizer, compiled to WebAssembly, so this side does nothing musical. It hands over audio and MIDI,
// sets parameters that changed, calls the module, and copies the result out. There is no plugin state: every control is
// an ordinary parameter.
//
// One thing is not an ordinary parameter. The spectrum analyser's 64 levels are measured by the module from the audio,
// and the editor draws them behind the response curve. They go to the host as a `plugin` message (messaging.md 2.4),
// about 30 a second, from an object made once, so the per-quantum path allocates nothing of its own.
//
// The two rules from contract section 6, as in every processor here. Every event carries an absolute stream position
// and is applied in the quantum that contains it, compared by range, never by an offset within a block and never by
// equality with a block boundary. And the queue is bounded and preallocated, so reporting what it dropped is the only
// honest thing left on overflow.
//
// The parameter list below is not a second definition. It is the same list as profile.json's ports, and
// tests/dsp/octet.test.js fails if the two disagree in a name, a range or a default.

const PARAM_INDEX = Object.freeze({
  mode: 0,
  output: 1,
  band1_on: 2,
  band1_type: 3,
  band1_freq: 4,
  band1_gain: 5,
  band1_q: 6,
  band1_channel: 7,
  band2_on: 8,
  band2_type: 9,
  band2_freq: 10,
  band2_gain: 11,
  band2_q: 12,
  band2_channel: 13,
  band3_on: 14,
  band3_type: 15,
  band3_freq: 16,
  band3_gain: 17,
  band3_q: 18,
  band3_channel: 19,
  band4_on: 20,
  band4_type: 21,
  band4_freq: 22,
  band4_gain: 23,
  band4_q: 24,
  band4_channel: 25,
  band5_on: 26,
  band5_type: 27,
  band5_freq: 28,
  band5_gain: 29,
  band5_q: 30,
  band5_channel: 31,
  band6_on: 32,
  band6_type: 33,
  band6_freq: 34,
  band6_gain: 35,
  band6_q: 36,
  band6_channel: 37,
  band7_on: 38,
  band7_type: 39,
  band7_freq: 40,
  band7_gain: 41,
  band7_q: 42,
  band7_channel: 43,
  band8_on: 44,
  band8_type: 45,
  band8_freq: 46,
  band8_gain: 47,
  band8_q: 48,
  band8_channel: 49,
  cc_channel: 50,
  cc_band: 51,
  spectrum_source: 52
})

const PARAM_COUNT = Object.keys(PARAM_INDEX).length

const QUEUE_CAPACITY = 512
const EVENT_BYTES = 8          // docs/module-abi.md fixes the record at 8 bytes
const SPECTRUM_BINS = 64

class OctetProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors () {
    return [
      { name: 'mode', defaultValue: 0, minValue: 0, maxValue: 2, automationRate: 'k-rate' },
      { name: 'output', defaultValue: 0, minValue: -12, maxValue: 12, automationRate: 'k-rate' },
      { name: 'band1_on', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'band1_type', defaultValue: 1, minValue: 0, maxValue: 7, automationRate: 'k-rate' },
      { name: 'band1_freq', defaultValue: 30, minValue: 20, maxValue: 20000, automationRate: 'k-rate' },
      { name: 'band1_gain', defaultValue: 0, minValue: -18, maxValue: 18, automationRate: 'k-rate' },
      { name: 'band1_q', defaultValue: 1, minValue: 0.1, maxValue: 18, automationRate: 'k-rate' },
      { name: 'band1_channel', defaultValue: 0, minValue: 0, maxValue: 2, automationRate: 'k-rate' },
      { name: 'band2_on', defaultValue: 1, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'band2_type', defaultValue: 2, minValue: 0, maxValue: 7, automationRate: 'k-rate' },
      { name: 'band2_freq', defaultValue: 100, minValue: 20, maxValue: 20000, automationRate: 'k-rate' },
      { name: 'band2_gain', defaultValue: 0, minValue: -18, maxValue: 18, automationRate: 'k-rate' },
      { name: 'band2_q', defaultValue: 0.71, minValue: 0.1, maxValue: 18, automationRate: 'k-rate' },
      { name: 'band2_channel', defaultValue: 0, minValue: 0, maxValue: 2, automationRate: 'k-rate' },
      { name: 'band3_on', defaultValue: 1, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'band3_type', defaultValue: 3, minValue: 0, maxValue: 7, automationRate: 'k-rate' },
      { name: 'band3_freq', defaultValue: 250, minValue: 20, maxValue: 20000, automationRate: 'k-rate' },
      { name: 'band3_gain', defaultValue: 0, minValue: -18, maxValue: 18, automationRate: 'k-rate' },
      { name: 'band3_q', defaultValue: 1, minValue: 0.1, maxValue: 18, automationRate: 'k-rate' },
      { name: 'band3_channel', defaultValue: 0, minValue: 0, maxValue: 2, automationRate: 'k-rate' },
      { name: 'band4_on', defaultValue: 1, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'band4_type', defaultValue: 3, minValue: 0, maxValue: 7, automationRate: 'k-rate' },
      { name: 'band4_freq', defaultValue: 600, minValue: 20, maxValue: 20000, automationRate: 'k-rate' },
      { name: 'band4_gain', defaultValue: 0, minValue: -18, maxValue: 18, automationRate: 'k-rate' },
      { name: 'band4_q', defaultValue: 1, minValue: 0.1, maxValue: 18, automationRate: 'k-rate' },
      { name: 'band4_channel', defaultValue: 0, minValue: 0, maxValue: 2, automationRate: 'k-rate' },
      { name: 'band5_on', defaultValue: 1, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'band5_type', defaultValue: 3, minValue: 0, maxValue: 7, automationRate: 'k-rate' },
      { name: 'band5_freq', defaultValue: 1500, minValue: 20, maxValue: 20000, automationRate: 'k-rate' },
      { name: 'band5_gain', defaultValue: 0, minValue: -18, maxValue: 18, automationRate: 'k-rate' },
      { name: 'band5_q', defaultValue: 1, minValue: 0.1, maxValue: 18, automationRate: 'k-rate' },
      { name: 'band5_channel', defaultValue: 0, minValue: 0, maxValue: 2, automationRate: 'k-rate' },
      { name: 'band6_on', defaultValue: 1, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'band6_type', defaultValue: 3, minValue: 0, maxValue: 7, automationRate: 'k-rate' },
      { name: 'band6_freq', defaultValue: 4000, minValue: 20, maxValue: 20000, automationRate: 'k-rate' },
      { name: 'band6_gain', defaultValue: 0, minValue: -18, maxValue: 18, automationRate: 'k-rate' },
      { name: 'band6_q', defaultValue: 1, minValue: 0.1, maxValue: 18, automationRate: 'k-rate' },
      { name: 'band6_channel', defaultValue: 0, minValue: 0, maxValue: 2, automationRate: 'k-rate' },
      { name: 'band7_on', defaultValue: 1, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'band7_type', defaultValue: 5, minValue: 0, maxValue: 7, automationRate: 'k-rate' },
      { name: 'band7_freq', defaultValue: 8000, minValue: 20, maxValue: 20000, automationRate: 'k-rate' },
      { name: 'band7_gain', defaultValue: 0, minValue: -18, maxValue: 18, automationRate: 'k-rate' },
      { name: 'band7_q', defaultValue: 0.71, minValue: 0.1, maxValue: 18, automationRate: 'k-rate' },
      { name: 'band7_channel', defaultValue: 0, minValue: 0, maxValue: 2, automationRate: 'k-rate' },
      { name: 'band8_on', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'band8_type', defaultValue: 7, minValue: 0, maxValue: 7, automationRate: 'k-rate' },
      { name: 'band8_freq', defaultValue: 18000, minValue: 20, maxValue: 20000, automationRate: 'k-rate' },
      { name: 'band8_gain', defaultValue: 0, minValue: -18, maxValue: 18, automationRate: 'k-rate' },
      { name: 'band8_q', defaultValue: 1, minValue: 0.1, maxValue: 18, automationRate: 'k-rate' },
      { name: 'band8_channel', defaultValue: 0, minValue: 0, maxValue: 2, automationRate: 'k-rate' },
      { name: 'cc_channel', defaultValue: 1, minValue: 0, maxValue: 16, automationRate: 'k-rate' },
      { name: 'cc_band', defaultValue: 4, minValue: 1, maxValue: 8, automationRate: 'k-rate' },
      { name: 'spectrum_source', defaultValue: 2, minValue: 0, maxValue: 2, automationRate: 'k-rate' }
    ]
  }

  constructor (options) {
    super(options)
    this.ready = false
    this.exports = null
    this.inputViews = []
    this.outputViews = []
    this.lastValues = new Float32Array(PARAM_COUNT).fill(NaN)

    // Preallocated and never grown. A ring would let a late writer overwrite an unread event; a bounded queue that
    // refuses is easier to reason about and the refusal is reported.
    this.queueFrames = new Float64Array(QUEUE_CAPACITY)
    this.queueBytes = new Uint8Array(QUEUE_CAPACITY * 3)
    this.queueCount = 0

    // What the editor is sent: the levels, the rate the display's curves are drawn at, and which tap they were measured at.
    this.snapshot = { type: 'plugin', payload: { rate: sampleRate, source: 2, levels: new Float32Array(SPECTRUM_BINS) } }
    this.lastSerial = -1

    this.port.onmessage = event => this.handle(event.data)
  }

  handle (message) {
    switch (message?.type) {
      case 'init': return this.init(message)
      case 'events': return this.enqueue(message.events)
      case 'dispose': this.ready = false; return
      default:
        // Unknown types are ignored so a newer host and an older plugin interoperate as far as they are able.
        // messaging.md.
    }
  }

  init (message) {
    try {
      if (!message.module) throw new Error('init carried no WebAssembly bytes')
      // Compiled here, synchronously. A compiled Module cannot be posted into a worklet at all: it is silently never
      // delivered. Contract section 3.3.
      const compiled = new WebAssembly.Module(message.module)
      const instance = new WebAssembly.Instance(compiled, {})
      const exports = instance.exports

      for (const name of ['jig_init', 'jig_process', 'jig_input_ptr', 'jig_output_ptr', 'jig_set_param',
        'jig_max_frames', 'jig_midi_in_ptr', 'jig_midi_in_capacity', 'jig_midi_in',
        'jig_spectrum_ptr', 'jig_spectrum_serial', 'memory']) {
        if (!(name in exports)) throw new Error(`the module does not export ${name}`)
      }

      exports.jig_init(message.sampleRate ?? sampleRate)

      // Taken once. The ABI forbids growing memory after jig_init precisely so a host can hold these, and a view over
      // a grown memory is zero length, which is silence rather than an error.
      const maxFrames = exports.jig_max_frames()
      const buffer = exports.memory.buffer
      for (let channel = 0; channel < 2; channel++) {
        this.inputViews.push(new Float32Array(buffer, exports.jig_input_ptr(channel), maxFrames))
        this.outputViews.push(new Float32Array(buffer, exports.jig_output_ptr(channel), maxFrames))
      }
      this.spectrumView = new Float32Array(buffer, exports.jig_spectrum_ptr(), SPECTRUM_BINS)
      this.inCapacity = exports.jig_midi_in_capacity()
      this.midiIn = new DataView(buffer, exports.jig_midi_in_ptr(), this.inCapacity * EVENT_BYTES)

      this.exports = exports
      this.maxFrames = maxFrames
      this.snapshot.payload.rate = message.sampleRate ?? sampleRate

      this.ready = true
      this.port.postMessage({ type: 'ready', latencyFrames: 0, tailFrames: null })
    } catch (error) {
      this.port.postMessage({
        type: 'error', phase: 'instantiate', fatal: true, message: String(error?.message ?? error)
      })
    }
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

  /**
   * Hand the module every event due in this quantum, in the ABI's layout.
   *
   * Due means at or before the end of the block, not within it: an event whose frame has already passed is delivered
   * now rather than dropped, because moving it is better than losing it. messaging.md section 1.4.
   */
  deliverDue (blockStart, blockEnd) {
    let written = 0
    let kept = 0
    let overflow = 0
    for (let i = 0; i < this.queueCount; i++) {
      const at = this.queueFrames[i]
      if (at < blockEnd) {
        if (written < this.inCapacity) {
          const offset = Math.max(0, Math.min(blockEnd - blockStart - 1, at - blockStart))
          const base = written * EVENT_BYTES
          this.midiIn.setUint32(base, offset, true)
          this.midiIn.setUint8(base + 4, 3)
          this.midiIn.setUint8(base + 5, this.queueBytes[i * 3])
          this.midiIn.setUint8(base + 6, this.queueBytes[i * 3 + 1])
          this.midiIn.setUint8(base + 7, this.queueBytes[i * 3 + 2])
          written += 1
        } else {
          overflow += 1
        }
        continue
      }
      // Compact in place. No allocation, and the queue stays contiguous and in order.
      this.queueFrames[kept] = at
      this.queueBytes[kept * 3] = this.queueBytes[i * 3]
      this.queueBytes[kept * 3 + 1] = this.queueBytes[i * 3 + 1]
      this.queueBytes[kept * 3 + 2] = this.queueBytes[i * 3 + 2]
      kept += 1
    }
    this.queueCount = kept
    this.exports.jig_midi_in(written)
    if (overflow > 0) {
      this.port.postMessage({ type: 'dropped', count: overflow, since: currentFrame })
    }
  }

  process (inputs, outputs, parameters) {
    const output = outputs[0]
    if (!output || output.length === 0) return true

    if (!this.ready) {
      // Contract section 3.1: a processor that is not ready outputs silence, does not throw, and is not audible.
      for (const channel of output) channel.fill(0)
      return true
    }

    const frames = Math.min(output[0].length, this.maxFrames)
    const blockStart = currentFrame
    this.deliverDue(blockStart, blockStart + frames)

    const input = inputs[0]
    for (let channel = 0; channel < 2; channel++) {
      const source = input && input.length > 0 ? input[Math.min(channel, input.length - 1)] : null
      const view = this.inputViews[channel]
      // A disconnected input arrives as an empty array, which is silence and not an error. Contract section 4.2.
      if (source) view.set(source.subarray(0, frames))
      else view.fill(0, 0, frames)
    }

    for (const [name, index] of Object.entries(PARAM_INDEX)) {
      const values = parameters[name]
      if (!values) continue
      // Length 1 when the value is constant across the quantum, 128 when it is not. Both must be handled. Contract
      // section 5.2.
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

    // The editor's display, whenever the module has measured a new one.
    const serial = this.exports.jig_spectrum_serial()
    if (serial !== this.lastSerial) {
      this.lastSerial = serial
      this.snapshot.payload.source = this.lastValues[PARAM_INDEX.spectrum_source]
      this.snapshot.payload.levels.set(this.spectrumView)
      this.port.postMessage(this.snapshot)
    }

    return true
  }
}

registerProcessor('octet', OctetProcessor)
