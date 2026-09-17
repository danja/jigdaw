// plugins/pulse/pulse-processor.js
//
// The AudioWorklet processor for Pulse.
//
// This is where contract section 6 becomes code. Two rules shape it.
//
// Every event carries an absolute stream position, and is applied in the
// quantum that contains it, compared by range. Never by an offset within a
// block, which is meaningless once the block has passed, and never by equality
// against a block boundary, which an event that is not exactly on one never
// meets. Both halves of that are written twice in valis's MISTAKES.md.
//
// The queue is bounded and preallocated. On overflow it drops and says how
// many, because a processor cannot grow a queue and cannot allocate, so saying
// so is the only thing it can do.

const PARAM_INDEX = Object.freeze({ waveform: 0, attack: 1, release: 2, cutoff: 3, gain: 4 })

// Deep enough for a dense passage at a sane buffer size, shallow enough that
// the memory is trivial. Overflow is reported rather than hidden.
const QUEUE_CAPACITY = 512

const NOTE_OFF = 0x80
const NOTE_ON = 0x90
const CONTROL_CHANGE = 0xb0
const ALL_NOTES_OFF = 123

class PulseProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors () {
    return [
      { name: 'waveform', defaultValue: 0, minValue: 0, maxValue: 2, automationRate: 'k-rate' },
      { name: 'attack', defaultValue: 5, minValue: 0.5, maxValue: 500, automationRate: 'k-rate' },
      { name: 'release', defaultValue: 200, minValue: 1, maxValue: 4000, automationRate: 'k-rate' },
      { name: 'cutoff', defaultValue: 6000, minValue: 100, maxValue: 18000, automationRate: 'k-rate' },
      { name: 'gain', defaultValue: 0.3, minValue: 0, maxValue: 1, automationRate: 'k-rate' }
    ]
  }

  constructor (options) {
    super(options)
    this.ready = false
    this.exports = null
    this.outputViews = []
    this.lastValues = new Float32Array(Object.keys(PARAM_INDEX).length).fill(NaN)

    // Preallocated, and never grown. A ring would let a late writer overwrite
    // an unread event; a bounded queue that refuses is easier to reason about
    // and the refusal is reported.
    this.queueFrames = new Float64Array(QUEUE_CAPACITY)
    this.queueBytes = new Uint8Array(QUEUE_CAPACITY * 3)
    this.queueCount = 0
    this.dropped = 0

    this.transport = null

    this.port.onmessage = event => this.handle(event.data)
  }

  handle (message) {
    switch (message?.type) {
      case 'init': return this.init(message)
      case 'events': return this.enqueue(message.events)
      case 'transport': this.transport = message; return
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
        'jig_note_on', 'jig_note_off', 'jig_max_frames', 'memory']) {
        if (!(name in exports)) throw new Error(`the module does not export ${name}`)
      }

      exports.jig_init(message.sampleRate ?? sampleRate)

      const maxFrames = exports.jig_max_frames()
      for (let channel = 0; channel < 2; channel++) {
        this.outputViews.push(new Float32Array(exports.memory.buffer, exports.jig_output_ptr(channel), maxFrames))
      }

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
    if (dropped > 0) {
      this.dropped += dropped
      this.port.postMessage({ type: 'dropped', count: dropped, since: currentFrame })
    }
  }

  /**
   * Apply every event at or before the end of this quantum.
   *
   * At or before, not within: an event whose frame has already passed is
   * applied now rather than dropped, because moving it is better than losing
   * it. messaging.md section 1.4.
   */
  applyDue (blockEnd) {
    let kept = 0
    for (let i = 0; i < this.queueCount; i++) {
      if (this.queueFrames[i] < blockEnd) {
        this.dispatch(
          this.queueBytes[i * 3],
          this.queueBytes[i * 3 + 1],
          this.queueBytes[i * 3 + 2]
        )
        continue
      }
      // Compact in place. No allocation, and the queue stays contiguous.
      this.queueFrames[kept] = this.queueFrames[i]
      this.queueBytes[kept * 3] = this.queueBytes[i * 3]
      this.queueBytes[kept * 3 + 1] = this.queueBytes[i * 3 + 1]
      this.queueBytes[kept * 3 + 2] = this.queueBytes[i * 3 + 2]
      kept += 1
    }
    this.queueCount = kept
  }

  dispatch (status, data1, data2) {
    const kind = status & 0xf0
    if (kind === NOTE_ON && data2 > 0) this.exports.jig_note_on(data1, data2)
    // A note on with velocity zero is a note off. Every MIDI source does this
    // and a synth that ignores it sustains for ever.
    else if (kind === NOTE_OFF || (kind === NOTE_ON && data2 === 0)) this.exports.jig_note_off(data1)
    else if (kind === CONTROL_CHANGE && data1 === ALL_NOTES_OFF) this.exports.jig_all_notes_off?.()
  }

  process (inputs, outputs, parameters) {
    const output = outputs[0]
    if (!output || output.length === 0) return true

    if (!this.ready) {
      for (const channel of output) channel.fill(0)
      return true
    }

    const frames = Math.min(output[0].length, this.maxFrames)
    this.applyDue(currentFrame + frames)

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

registerProcessor('pulse', PulseProcessor)
