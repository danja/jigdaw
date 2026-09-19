// plugins/8b8/8b8-processor.js
//
// The AudioWorklet processor for the 8-Bit 8asterd.
//
// The module is the 8b8 firmware itself, compiled to WebAssembly and driving
// three emulated AY-3-8910s, so this side does nothing musical. It hands over
// MIDI, sets parameters that changed, calls the module, and copies the result
// out.
//
// It speaks jig:Abi2 rather than Abi1 because the device's percussion is MIDI
// channel 10 and every one of its controls also answers to a CC. Version 1's
// jig_note_on and jig_note_off carry neither, so whole MIDI messages go
// through the event buffer instead.
//
// The two rules from contract section 6, as in every processor here. Every
// event carries an absolute stream position and is applied in the quantum
// that contains it, compared by range: never by an offset within a block,
// which is meaningless once the block has passed, and never by equality with
// a block boundary, which an event not exactly on one never meets. And the
// queue is bounded and preallocated, because a processor cannot allocate and
// cannot grow, so reporting what it dropped is the only honest thing left.
//
// The parameter list below is not a second definition. It is the same list as
// profile.json's ports, which make.js generates from the firmware's own
// parameter definition, and tests/dsp/8b8.test.js fails if the two disagree
// in a name, a range or a default.

const PARAM_INDEX = Object.freeze({
  buzz_enable: 0,
  buzz_ratio: 1,
  buzz_shape: 2,
  buzz_detune: 3,
  warp_mode: 4,
  warp_rate: 5,
  warp_depth: 6,
  warp_motion: 7,
  vib_enable: 8,
  vib_rate: 9,
  vib_depth: 10,
  vib_delay: 11,
  trem_enable: 12,
  trem_rate: 13,
  trem_depth: 14,
  noise_enable: 15,
  noise_period: 16,
  drum_tune: 17,
  drum_decay: 18,
  drum_bend: 19,
  drum_noise: 20,
  drum_roll: 21,
  drum_flam: 22,
  drum_reverse: 23,
  drum_chaos: 24,
  arp_mode: 25,
  arp_rate: 26,
  sweep_amount: 27,
  retrig_rate: 28,
  env_mode: 29,
  env_attack: 30,
  env_decay: 31,
  env_sustain: 32,
  env_release: 33,
  glide: 34,
  transpose: 35,
  mix_noise: 36,
  mix_tone: 37,
  mix_drum: 38,
  temperament: 39,
  temper_root: 40,
  vel_sense: 41
})

const PARAM_COUNT = Object.keys(PARAM_INDEX).length

const QUEUE_CAPACITY = 512
const EVENT_BYTES = 8          // docs/module-abi.md fixes the record at 8 bytes

class EightBit8asterdProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors () {
    return [
      { name: 'buzz_enable', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'buzz_ratio', defaultValue: 1, minValue: 1, maxValue: 8, automationRate: 'k-rate' },
      { name: 'buzz_shape', defaultValue: 0, minValue: 0, maxValue: 3, automationRate: 'k-rate' },
      { name: 'buzz_detune', defaultValue: 0, minValue: -32, maxValue: 32, automationRate: 'k-rate' },
      { name: 'warp_mode', defaultValue: 0, minValue: 0, maxValue: 8, automationRate: 'k-rate' },
      { name: 'warp_rate', defaultValue: 30, minValue: 1, maxValue: 120, automationRate: 'k-rate' },
      { name: 'warp_depth', defaultValue: 20, minValue: 1, maxValue: 63, automationRate: 'k-rate' },
      { name: 'warp_motion', defaultValue: 0, minValue: 0, maxValue: 64, automationRate: 'k-rate' },
      { name: 'vib_enable', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'vib_rate', defaultValue: 5, minValue: 0.1, maxValue: 20, automationRate: 'k-rate' },
      { name: 'vib_depth', defaultValue: 6, minValue: 0, maxValue: 31, automationRate: 'k-rate' },
      { name: 'vib_delay', defaultValue: 0, minValue: 0, maxValue: 2000, automationRate: 'k-rate' },
      { name: 'trem_enable', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'trem_rate', defaultValue: 4, minValue: 0.1, maxValue: 20, automationRate: 'k-rate' },
      { name: 'trem_depth', defaultValue: 5, minValue: 0, maxValue: 15, automationRate: 'k-rate' },
      { name: 'noise_enable', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'noise_period', defaultValue: 8, minValue: 0, maxValue: 15, automationRate: 'k-rate' },
      { name: 'drum_tune', defaultValue: 100, minValue: 50, maxValue: 200, automationRate: 'k-rate' },
      { name: 'drum_decay', defaultValue: 100, minValue: 50, maxValue: 200, automationRate: 'k-rate' },
      { name: 'drum_bend', defaultValue: 100, minValue: 0, maxValue: 200, automationRate: 'k-rate' },
      { name: 'drum_noise', defaultValue: 0, minValue: -7, maxValue: 7, automationRate: 'k-rate' },
      { name: 'drum_roll', defaultValue: 0, minValue: 0, maxValue: 50, automationRate: 'k-rate' },
      { name: 'drum_flam', defaultValue: 0, minValue: 0, maxValue: 300, automationRate: 'k-rate' },
      { name: 'drum_reverse', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'drum_chaos', defaultValue: 0, minValue: 0, maxValue: 63, automationRate: 'k-rate' },
      { name: 'arp_mode', defaultValue: 0, minValue: 0, maxValue: 6, automationRate: 'k-rate' },
      { name: 'arp_rate', defaultValue: 17, minValue: 1, maxValue: 50, automationRate: 'k-rate' },
      { name: 'sweep_amount', defaultValue: 0, minValue: -32, maxValue: 32, automationRate: 'k-rate' },
      { name: 'retrig_rate', defaultValue: 0, minValue: 0, maxValue: 50, automationRate: 'k-rate' },
      { name: 'env_mode', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'env_attack', defaultValue: 1, minValue: 1, maxValue: 32, automationRate: 'k-rate' },
      { name: 'env_decay', defaultValue: 8, minValue: 1, maxValue: 32, automationRate: 'k-rate' },
      { name: 'env_sustain', defaultValue: 32, minValue: 0, maxValue: 32, automationRate: 'k-rate' },
      { name: 'env_release', defaultValue: 32, minValue: 1, maxValue: 32, automationRate: 'k-rate' },
      { name: 'glide', defaultValue: 0, minValue: 0, maxValue: 100, automationRate: 'k-rate' },
      { name: 'transpose', defaultValue: 0, minValue: -24, maxValue: 24, automationRate: 'k-rate' },
      { name: 'mix_noise', defaultValue: 15, minValue: 0, maxValue: 15, automationRate: 'k-rate' },
      { name: 'mix_tone', defaultValue: 15, minValue: 0, maxValue: 15, automationRate: 'k-rate' },
      { name: 'mix_drum', defaultValue: 15, minValue: 0, maxValue: 15, automationRate: 'k-rate' },
      { name: 'temperament', defaultValue: 0, minValue: 0, maxValue: 9, automationRate: 'k-rate' },
      { name: 'temper_root', defaultValue: 0, minValue: 0, maxValue: 11, automationRate: 'k-rate' },
      { name: 'vel_sense', defaultValue: 1, minValue: 0, maxValue: 1, automationRate: 'k-rate' }
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
   * Due means at or before the end of the block, not within it: an event
   * whose frame has already passed is delivered now rather than dropped,
   * because moving it is better than losing it. messaging.md section 1.4.
   * The module requires ascending frame order, which the host's queue is
   * already in and which compaction preserves.
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
          // The earliest fit and the rest did not. Dropping the latest keeps
          // a note on with its note off; dropping the earliest would orphan
          // one and leave a voice sounding for ever.
          overflow += 1
        }
        continue
      }
      // Compact in place. No allocation, and the queue stays contiguous and
      // in order.
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

    // An instrument keeps running: a note may arrive at any time, and the
    // firmware's own arpeggiator, roll and warp tick whether or not one has.
    return true
  }
}

registerProcessor('eightbit8asterd', EightBit8asterdProcessor)
