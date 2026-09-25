// plugins/drumkit/drumkit-processor.js
//
// The AudioWorklet processor for DrumKit.
//
// An eleven-voice drum instrument: MIDI in, stereo audio out. It speaks
// jig:Abi2 rather than Abi1 because velocity and per-sample timing both
// matter to a drum hit, and version 1's jig_note_on carries neither, so
// whole MIDI messages go through the event buffer instead. The module
// interleaves them per sample; this side hands them over, sets parameters
// that changed, calls the module, and copies the result out.
//
// The two rules from contract section 6, as in every processor here. Every
// event carries an absolute stream position and is applied in the quantum
// that contains it, compared by range: never by an offset within a block,
// which is meaningless once the block has passed, and never by equality with
// a block boundary, which an event not exactly on one never meets. And the
// queue is bounded and preallocated, because a processor cannot allocate and
// cannot grow, so reporting what it dropped is the only honest thing left.
//
// The parameter list below is not a second definition. It is the same list
// as profile.json's ports, in the same order as the module's jig:paramIndex,
// and tests/host/drumkit.test.js fails if the three disagree in a name, a
// range or a default.

const PARAM_INDEX = Object.freeze({
  kick_pitch: 0, kick_decay: 1, kick_drive: 2, kick_punch: 3, kick_level: 4,
  snare_tone: 5, snare_snap: 6, snare_level: 7,
  clap_density: 8, clap_tone: 9, clap_level: 10,
  tom1_pitch: 11, tom1_decay: 12, tom1_level: 13,
  tom2_pitch: 14, tom2_decay: 15, tom2_level: 16,
  hh_closed_brightness: 17, hh_closed_decay: 18, hh_closed_level: 19,
  hh_open_brightness: 20, hh_open_decay: 21, hh_open_level: 22,
  crash_brightness: 23, crash_decay: 24, crash_level: 25,
  cowbell_tone: 26, cowbell_decay: 27, cowbell_level: 28,
  clave_tone: 29, clave_decay: 30, clave_level: 31,
  bash_size: 32, bash_spread: 33, bash_decay: 34, bash_drive: 35, bash_noise: 36,
  bash_edge: 37, bash_level: 38,
  bit_crush: 39, master_drive: 40, master_reverb: 41, master_gain: 42,
  kick_mute: 43, clap_mute: 44, snare_mute: 45, crash_mute: 46,
  hh_closed_mute: 47, tom1_mute: 48, hh_open_mute: 49, tom2_mute: 50,
  bash_mute: 51, cowbell_mute: 52, clave_mute: 53,
  kick_transient: 54, clap_metal: 55, snare_metal: 56, crash_metal: 57,
  hh_closed_metal: 58, tom1_metal: 59, hh_open_metal: 60, tom2_metal: 61,
  cowbell_metal: 62, clave_metal: 63,
  kick_pan: 64, clap_pan: 65, snare_pan: 66, crash_pan: 67,
  hh_closed_pan: 68, tom1_pan: 69, hh_open_pan: 70, tom2_pan: 71,
  bash_pan: 72, cowbell_pan: 73, clave_pan: 74
})

const PARAM_COUNT = Object.keys(PARAM_INDEX).length

const QUEUE_CAPACITY = 512
const EVENT_BYTES = 8          // docs/module-abi.md fixes the record at 8 bytes

class DrumkitProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors () {
    const dial = (name, defaultValue, minValue, maxValue) =>
      ({ name, defaultValue, minValue, maxValue, automationRate: 'k-rate' })
    return [
      dial('kick_pitch', 0.35, 0, 1), dial('kick_decay', 0.4, 0, 1),
      dial('kick_drive', 0.3, 0, 1), dial('kick_punch', 0.15, 0, 1),
      dial('kick_level', 1.0, 0, 1.5),
      dial('snare_tone', 0.5, 0, 1), dial('snare_snap', 0.6, 0, 1),
      dial('snare_level', 1.05, 0, 1.5),
      dial('clap_density', 0.55, 0, 1), dial('clap_tone', 0.45, 0, 1),
      dial('clap_level', 1.0, 0, 1.5),
      dial('tom1_pitch', 0.4, 0, 1), dial('tom1_decay', 0.45, 0, 1),
      dial('tom1_level', 0.74, 0, 1.5),
      dial('tom2_pitch', 0.55, 0, 1), dial('tom2_decay', 0.45, 0, 1),
      dial('tom2_level', 0.72, 0, 1.5),
      dial('hh_closed_brightness', 0.6, 0, 1), dial('hh_closed_decay', 0.3, 0, 1),
      dial('hh_closed_level', 1.05, 0, 1.5),
      dial('hh_open_brightness', 0.7, 0, 1), dial('hh_open_decay', 0.55, 0, 1),
      dial('hh_open_level', 1.02, 0, 1.5),
      dial('crash_brightness', 0.65, 0, 1), dial('crash_decay', 0.5, 0, 1),
      dial('crash_level', 1.0, 0, 1.5),
      dial('cowbell_tone', 0.45, 0, 1), dial('cowbell_decay', 0.35, 0, 1),
      dial('cowbell_level', 1.0, 0, 1.5),
      dial('clave_tone', 0.5, 0, 1), dial('clave_decay', 0.25, 0, 1),
      dial('clave_level', 1.0, 0, 1.5),
      dial('bash_size', 0.45, 0, 1), dial('bash_spread', 0.55, 0, 1),
      dial('bash_decay', 0.7, 0, 1), dial('bash_drive', 0.65, 0, 1),
      dial('bash_noise', 0.6, 0, 1), dial('bash_edge', 0.7, 0, 1),
      dial('bash_level', 1.0, 0, 1.5),
      dial('bit_crush', 0.0, 0, 1), dial('master_drive', 0.25, 0, 1),
      dial('master_reverb', 0.2, 0, 1), dial('master_gain', 0.7, 0, 1),
      dial('kick_mute', 0, 0, 1), dial('clap_mute', 0, 0, 1),
      dial('snare_mute', 0, 0, 1), dial('crash_mute', 0, 0, 1),
      dial('hh_closed_mute', 0, 0, 1), dial('tom1_mute', 0, 0, 1),
      dial('hh_open_mute', 0, 0, 1), dial('tom2_mute', 0, 0, 1),
      dial('bash_mute', 0, 0, 1), dial('cowbell_mute', 0, 0, 1),
      dial('clave_mute', 0, 0, 1),
      dial('kick_transient', 0.0, 0, 1), dial('clap_metal', 0.0, 0, 1),
      dial('snare_metal', 0.0, 0, 1), dial('crash_metal', 0.0, 0, 1),
      dial('hh_closed_metal', 0.0, 0, 1), dial('tom1_metal', 0.0, 0, 1),
      dial('hh_open_metal', 0.0, 0, 1), dial('tom2_metal', 0.0, 0, 1),
      dial('cowbell_metal', 0.0, 0, 1), dial('clave_metal', 0.0, 0, 1),
      dial('kick_pan', 0.0, -1, 1), dial('clap_pan', 0.16, -1, 1),
      dial('snare_pan', -0.08, -1, 1), dial('crash_pan', -0.44, -1, 1),
      dial('hh_closed_pan', -0.52, -1, 1), dial('tom1_pan', 0.22, -1, 1),
      dial('hh_open_pan', 0.32, -1, 1), dial('tom2_pan', -0.16, -1, 1),
      dial('bash_pan', 0.42, -1, 1), dial('cowbell_pan', 0.14, -1, 1),
      dial('clave_pan', -0.24, -1, 1)
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

    // An instrument keeps running: a note may arrive at any time.
    return true
  }
}

registerProcessor('drumkit', DrumkitProcessor)
