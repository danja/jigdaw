// plugins/monochord/monochord-processor.js
//
// The AudioWorklet processor for Monochord.
//
// The module is the string model, compiled to WebAssembly, so this side does
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
// profile.json's ports, and tests/dsp/monochord.test.js fails if the two
// disagree in a name, a range or a default.

const PARAM_INDEX = Object.freeze({
  exciter: 0,
  position: 1,
  hardness: 2,
  bow_pressure: 3,
  decay: 4,
  damping: 5,
  stiffness: 6,
  body_size: 7,
  body_level: 8,
  pickup: 9,
  release: 10,
  master: 11,
  velocity: 12,
  bend_range: 13
})

const PARAM_COUNT = Object.keys(PARAM_INDEX).length

const QUEUE_CAPACITY = 512
const EVENT_BYTES = 8          // docs/module-abi.md fixes the record at 8 bytes

class MonochordProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors () {
    return [
      { name: 'exciter', defaultValue: 0, minValue: 0, maxValue: 2, automationRate: 'k-rate' },
      { name: 'position', defaultValue: 0.2, minValue: 0.05, maxValue: 0.5, automationRate: 'k-rate' },
      { name: 'hardness', defaultValue: 0.6, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'bow_pressure', defaultValue: 0.5, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'decay', defaultValue: 3, minValue: 0.1, maxValue: 20, automationRate: 'k-rate' },
      { name: 'damping', defaultValue: 0.3, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'stiffness', defaultValue: 0.5, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'body_size', defaultValue: 1, minValue: 0.5, maxValue: 2, automationRate: 'k-rate' },
      { name: 'body_level', defaultValue: 0.3, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'pickup', defaultValue: 0, minValue: 0, maxValue: 0.5, automationRate: 'k-rate' },
      { name: 'release', defaultValue: 250, minValue: 5, maxValue: 2000, automationRate: 'k-rate' },
      { name: 'master', defaultValue: 0.6, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'velocity', defaultValue: 0.7, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'bend_range', defaultValue: 2, minValue: 0, maxValue: 24, automationRate: 'k-rate' }
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
      this.port.postMessage({ type: 'ready', latencyFrames: 0, tailFrames: 2 * rate })
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

registerProcessor('monochord', MonochordProcessor)
