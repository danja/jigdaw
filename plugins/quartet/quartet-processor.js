// plugins/quartet/quartet-processor.js
//
// The AudioWorklet processor for Quartet.
//
// The module is the FM engine, compiled to WebAssembly, so this side does
// nothing musical. It hands over MIDI, sets parameters that changed, calls the
// module, and copies the result out. There is no plugin state: every control is
// an ordinary parameter.
//
// The two rules from contract section 6, as in every processor here. Every
// event carries an absolute stream position and is applied in the quantum that
// contains it, compared by range, never by an offset within a block and never
// by equality with a block boundary. And the queue is bounded and preallocated,
// so reporting what it dropped is the only honest thing left on overflow.
//
// The parameter list below is not a second definition. It is the same list as
// profile.json's ports, and tests/dsp/quartet.test.js fails if the two
// disagree in a name, a range or a default.

const PARAM_INDEX = Object.freeze({
  opa_wave: 0,
  opa_fixed: 1,
  opa_ratio: 2,
  opa_fine: 3,
  opa_fixed_hz: 4,
  opa_level: 5,
  opa_attack: 6,
  opa_decay: 7,
  opa_sustain: 8,
  opa_release: 9,
  opb_wave: 10,
  opb_fixed: 11,
  opb_ratio: 12,
  opb_fine: 13,
  opb_fixed_hz: 14,
  opb_level: 15,
  opb_attack: 16,
  opb_decay: 17,
  opb_sustain: 18,
  opb_release: 19,
  opc_wave: 20,
  opc_fixed: 21,
  opc_ratio: 22,
  opc_fine: 23,
  opc_fixed_hz: 24,
  opc_level: 25,
  opc_attack: 26,
  opc_decay: 27,
  opc_sustain: 28,
  opc_release: 29,
  opd_wave: 30,
  opd_fixed: 31,
  opd_ratio: 32,
  opd_fine: 33,
  opd_fixed_hz: 34,
  opd_level: 35,
  opd_attack: 36,
  opd_decay: 37,
  opd_sustain: 38,
  opd_release: 39,
  algorithm: 40,
  feedback: 41,
  depth: 42,
  pitch_env: 43,
  pitch_env_amount: 44,
  pitch_attack: 45,
  pitch_decay: 46,
  pitch_sustain: 47,
  pitch_release: 48,
  filter_type: 49,
  cutoff: 50,
  resonance: 51,
  key_track: 52,
  master: 53,
  velocity: 54,
  bend_range: 55,
  quality: 56,
  play_mode: 57,
  glide: 58
})

const PARAM_COUNT = Object.keys(PARAM_INDEX).length

const QUEUE_CAPACITY = 512
const EVENT_BYTES = 8          // docs/module-abi.md fixes the record at 8 bytes

class QuartetProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors () {
    return [
      { name: 'opa_wave', defaultValue: 0, minValue: 0, maxValue: 2, automationRate: 'k-rate' },
      { name: 'opa_fixed', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'opa_ratio', defaultValue: 1, minValue: 0.25, maxValue: 32, automationRate: 'k-rate' },
      { name: 'opa_fine', defaultValue: 0, minValue: -50, maxValue: 50, automationRate: 'k-rate' },
      { name: 'opa_fixed_hz', defaultValue: 440, minValue: 10, maxValue: 20000, automationRate: 'k-rate' },
      { name: 'opa_level', defaultValue: 0.9, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'opa_attack', defaultValue: 2, minValue: 0.5, maxValue: 5000, automationRate: 'k-rate' },
      { name: 'opa_decay', defaultValue: 600, minValue: 1, maxValue: 8000, automationRate: 'k-rate' },
      { name: 'opa_sustain', defaultValue: 0.8, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'opa_release', defaultValue: 140, minValue: 1, maxValue: 8000, automationRate: 'k-rate' },
      { name: 'opb_wave', defaultValue: 0, minValue: 0, maxValue: 2, automationRate: 'k-rate' },
      { name: 'opb_fixed', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'opb_ratio', defaultValue: 1, minValue: 0.25, maxValue: 32, automationRate: 'k-rate' },
      { name: 'opb_fine', defaultValue: 0, minValue: -50, maxValue: 50, automationRate: 'k-rate' },
      { name: 'opb_fixed_hz', defaultValue: 440, minValue: 10, maxValue: 20000, automationRate: 'k-rate' },
      { name: 'opb_level', defaultValue: 0.42, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'opb_attack', defaultValue: 1, minValue: 0.5, maxValue: 5000, automationRate: 'k-rate' },
      { name: 'opb_decay', defaultValue: 220, minValue: 1, maxValue: 8000, automationRate: 'k-rate' },
      { name: 'opb_sustain', defaultValue: 0.18, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'opb_release', defaultValue: 90, minValue: 1, maxValue: 8000, automationRate: 'k-rate' },
      { name: 'opc_wave', defaultValue: 0, minValue: 0, maxValue: 2, automationRate: 'k-rate' },
      { name: 'opc_fixed', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'opc_ratio', defaultValue: 2, minValue: 0.25, maxValue: 32, automationRate: 'k-rate' },
      { name: 'opc_fine', defaultValue: 0, minValue: -50, maxValue: 50, automationRate: 'k-rate' },
      { name: 'opc_fixed_hz', defaultValue: 440, minValue: 10, maxValue: 20000, automationRate: 'k-rate' },
      { name: 'opc_level', defaultValue: 0.14, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'opc_attack', defaultValue: 1, minValue: 0.5, maxValue: 5000, automationRate: 'k-rate' },
      { name: 'opc_decay', defaultValue: 120, minValue: 1, maxValue: 8000, automationRate: 'k-rate' },
      { name: 'opc_sustain', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'opc_release', defaultValue: 60, minValue: 1, maxValue: 8000, automationRate: 'k-rate' },
      { name: 'opd_wave', defaultValue: 0, minValue: 0, maxValue: 2, automationRate: 'k-rate' },
      { name: 'opd_fixed', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'opd_ratio', defaultValue: 1, minValue: 0.25, maxValue: 32, automationRate: 'k-rate' },
      { name: 'opd_fine', defaultValue: 0, minValue: -50, maxValue: 50, automationRate: 'k-rate' },
      { name: 'opd_fixed_hz', defaultValue: 440, minValue: 10, maxValue: 20000, automationRate: 'k-rate' },
      { name: 'opd_level', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'opd_attack', defaultValue: 1, minValue: 0.5, maxValue: 5000, automationRate: 'k-rate' },
      { name: 'opd_decay', defaultValue: 100, minValue: 1, maxValue: 8000, automationRate: 'k-rate' },
      { name: 'opd_sustain', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'opd_release', defaultValue: 60, minValue: 1, maxValue: 8000, automationRate: 'k-rate' },
      { name: 'algorithm', defaultValue: 0, minValue: 0, maxValue: 10, automationRate: 'k-rate' },
      { name: 'feedback', defaultValue: 0.1, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'depth', defaultValue: 1, minValue: 0, maxValue: 4, automationRate: 'k-rate' },
      { name: 'pitch_env', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'pitch_env_amount', defaultValue: 12, minValue: -48, maxValue: 48, automationRate: 'k-rate' },
      { name: 'pitch_attack', defaultValue: 1, minValue: 0.5, maxValue: 5000, automationRate: 'k-rate' },
      { name: 'pitch_decay', defaultValue: 100, minValue: 1, maxValue: 8000, automationRate: 'k-rate' },
      { name: 'pitch_sustain', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'pitch_release', defaultValue: 100, minValue: 1, maxValue: 8000, automationRate: 'k-rate' },
      { name: 'filter_type', defaultValue: 1, minValue: 0, maxValue: 4, automationRate: 'k-rate' },
      { name: 'cutoff', defaultValue: 2400, minValue: 20, maxValue: 20000, automationRate: 'k-rate' },
      { name: 'resonance', defaultValue: 0.2, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'key_track', defaultValue: 0.3, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'master', defaultValue: 0.6, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'velocity', defaultValue: 0.7, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'bend_range', defaultValue: 2, minValue: 0, maxValue: 24, automationRate: 'k-rate' },
      { name: 'quality', defaultValue: 1, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'play_mode', defaultValue: 1, minValue: 0, maxValue: 2, automationRate: 'k-rate' },
      { name: 'glide', defaultValue: 0, minValue: 0, maxValue: 2000, automationRate: 'k-rate' }
    ]
  }

  constructor (options) {
    super(options)
    this.ready = false
    this.exports = null
    this.outputViews = []
    this.lastValues = new Float32Array(PARAM_COUNT).fill(NaN)

    // Preallocated and never grown. A ring would let a late writer overwrite
    // an unread event; a bounded queue that refuses is easier to reason about
    // and the refusal is reported.
    this.queueFrames = new Float64Array(QUEUE_CAPACITY)
    this.queueBytes = new Uint8Array(QUEUE_CAPACITY * 3)
    this.queueCount = 0

    this.port.onmessage = event => this.handle(event.data)
  }

  handle (message) {
    switch (message?.type) {
      case 'init': return this.init(message)
      case 'events': return this.enqueue(message.events)
      case 'dispose': this.ready = false; return
      default:
        // Unknown types are ignored so a newer host and an older plugin
        // interoperate as far as they are able. messaging.md.
    }
  }

  init (message) {
    try {
      if (!message.module) throw new Error('init carried no WebAssembly bytes')
      // Compiled here, synchronously. The 4 KB limit on synchronous
      // compilation applies to the main thread, not to a worklet, and a
      // compiled Module cannot be posted into one at all: it is silently
      // never delivered. Contract section 3.3.
      const compiled = new WebAssembly.Module(message.module)
      const instance = new WebAssembly.Instance(compiled, {})
      const exports = instance.exports

      for (const name of ['jig_init', 'jig_process', 'jig_output_ptr', 'jig_set_param',
        'jig_max_frames', 'jig_midi_in_ptr', 'jig_midi_in_capacity', 'jig_midi_in',
        'memory']) {
        if (!(name in exports)) throw new Error(`the module does not export ${name}`)
      }

      exports.jig_init(message.sampleRate ?? sampleRate)

      // Taken once. The ABI forbids growing memory after jig_init precisely so
      // a host can hold these, and a view over a grown memory is zero length,
      // which is silence rather than an error.
      const maxFrames = exports.jig_max_frames()
      for (let channel = 0; channel < 2; channel++) {
        this.outputViews.push(
          new Float32Array(exports.memory.buffer, exports.jig_output_ptr(channel), maxFrames))
      }
      this.inCapacity = exports.jig_midi_in_capacity()
      this.midiIn = new DataView(exports.memory.buffer, exports.jig_midi_in_ptr(),
        this.inCapacity * EVENT_BYTES)

      this.exports = exports
      this.maxFrames = maxFrames

      this.ready = true
      const rate = message.sampleRate ?? sampleRate
      this.port.postMessage({ type: 'ready', latencyFrames: 0, tailFrames: 8 * rate })
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
   * Due means at or before the end of the block, not within it: an event
   * whose frame has already passed is delivered now rather than dropped,
   * because moving it is better than losing it. messaging.md section 1.4.
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
          // Dropping the latest keeps a note on with its note off.
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
      for (const channel of output) channel.fill(0)
      return true
    }

    const frames = Math.min(output[0].length, this.maxFrames)
    const blockStart = currentFrame
    this.deliverDue(blockStart, blockStart + frames)

    for (const [name, index] of Object.entries(PARAM_INDEX)) {
      const values = parameters[name]
      if (!values) continue
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

    // An instrument keeps running: a note may arrive at any time.
    return true
  }
}

registerProcessor('quartet', QuartetProcessor)
