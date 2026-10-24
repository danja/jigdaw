// plugins/sam/sam-processor.js
//
// The AudioWorklet processor for Sam.
//
// The module is the speech synthesiser and the engine around it, compiled to
// WebAssembly, so this side does nothing musical. It hands over MIDI, fills in
// the transport block, sets parameters that changed, calls the module, and
// copies the result out. It also owns the text, which is not a parameter: it
// arrives as the `text` asset (or as saved state, which wins over the shipped
// file), is written into the module's text buffer, and is what a state request
// returns, so a restore and what is actually loaded cannot disagree.
//
// The two rules from contract section 6, as in every processor here. Every
// event carries an absolute stream position and is applied in the quantum that
// contains it, compared by range, never by an offset within a block and never
// by equality with a block boundary. And the queue is bounded and preallocated,
// so reporting what it dropped is the only honest thing left on overflow.
//
// The parameter list below is not a second definition. It is the same list as
// profile.json's ports, and tests/dsp/sam.test.js fails if the two disagree in
// a name, a range or a default.

const PARAM_INDEX = Object.freeze({
  mode: 0,
  speed: 1,
  pitch: 2,
  mouth: 3,
  throat: 4,
  monotone: 5,
  phonetic: 6,
  midi_ch: 7,
  advance: 8,
  transpose: 9,
  release: 10,
  step: 11,
  start_bar: 12,
  loop: 13,
  speak: 14,
  tone: 15,
  level: 16
})

const PARAM_COUNT = Object.keys(PARAM_INDEX).length

const QUEUE_CAPACITY = 512
const EVENT_BYTES = 8          // docs/module-abi.md fixes the record at 8 bytes

// The transport valid bits, from the same place.
const VALID_BPM = 1
const VALID_BEAT = 2
const VALID_BBT = 4
const VALID_METER = 8
const VALID_SECONDS = 16

class SamProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors () {
    return [
      { name: 'mode', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'speed', defaultValue: 72, minValue: 20, maxValue: 200, automationRate: 'k-rate' },
      { name: 'pitch', defaultValue: 64, minValue: 16, maxValue: 255, automationRate: 'k-rate' },
      { name: 'mouth', defaultValue: 128, minValue: 0, maxValue: 255, automationRate: 'k-rate' },
      { name: 'throat', defaultValue: 128, minValue: 0, maxValue: 255, automationRate: 'k-rate' },
      { name: 'monotone', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'phonetic', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'midi_ch', defaultValue: 17, minValue: 0, maxValue: 17, automationRate: 'k-rate' },
      { name: 'advance', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'transpose', defaultValue: 0, minValue: -24, maxValue: 24, automationRate: 'k-rate' },
      { name: 'release', defaultValue: 60, minValue: 5, maxValue: 1000, automationRate: 'k-rate' },
      { name: 'step', defaultValue: 2, minValue: 0, maxValue: 7, automationRate: 'k-rate' },
      { name: 'start_bar', defaultValue: 1, minValue: 1, maxValue: 256, automationRate: 'k-rate' },
      { name: 'loop', defaultValue: 1, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'speak', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'tone', defaultValue: 8000, minValue: 1000, maxValue: 12000, automationRate: 'k-rate' },
      { name: 'level', defaultValue: 0.7, minValue: 0, maxValue: 1, automationRate: 'k-rate' }
    ]
  }

  constructor (options) {
    super(options)
    this.ready = false
    this.exports = null
    this.outputViews = []
    this.lastValues = new Float32Array(PARAM_COUNT).fill(NaN)
    this.transport = null
    this.textBytes = null       // the ArrayBuffer that produced the loaded text, for state requests

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
      case 'transport': this.transport = message; return
      case 'plugin': if (this.ready) this.onPlugin(message.payload); return
      case 'loadAsset': if (this.ready && message.key === 'text') this.applyText(message.bytes); return
      case 'stateRequest':
        if (this.ready) this.port.postMessage({ type: 'state', token: message.token, state: { text: this.textBytes } })
        return
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
        'jig_transport_ptr', 'jig_text_ptr', 'jig_text_capacity', 'jig_set_text', 'jig_word_count',
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
      this.transportView = new DataView(exports.memory.buffer, exports.jig_transport_ptr(), 64)
      this.textCapacity = exports.jig_text_capacity()
      this.textView = new Uint8Array(exports.memory.buffer, exports.jig_text_ptr(), this.textCapacity)

      this.exports = exports
      this.maxFrames = maxFrames

      // Saved state wins over the shipped file, as a restored value wins over a
      // fresh install's.
      const bytes = message.state?.text instanceof ArrayBuffer ? message.state.text : message.assets?.text
      if (!this.applyText(bytes)) {
        throw new Error('the shipped text (assets.text) is missing')
      }

      this.ready = true
      const rate = message.sampleRate ?? sampleRate
      this.port.postMessage({ type: 'ready', latencyFrames: 0, tailFrames: rate })
    } catch (error) {
      this.port.postMessage({
        type: 'error', phase: 'instantiate', fatal: true, message: String(error?.message ?? error)
      })
    }
  }

  /**
   * Hand the module the text. Returns whether the bytes became the text.
   *
   * The module keeps printable ASCII, up to its capacity, and ignores the
   * rest, so what is written here is the file as given, clipped. A failure
   * changes nothing and, once running, is reported without stopping the music.
   */
  applyText (bytes) {
    if (!(bytes instanceof ArrayBuffer)) {
      if (this.ready) this.port.postMessage({ type: 'error', phase: 'asset', fatal: false, message: 'text not loaded: no bytes were given' })
      return false
    }
    const source = new Uint8Array(bytes)
    const length = Math.min(source.length, this.textCapacity)
    this.textView.set(source.subarray(0, length))
    this.exports.jig_set_text(length)
    this.textBytes = bytes
    // An open editor follows the text, whichever way it changed (a replaced file, or its own Apply).
    if (this.ready) this.sendText()
    return true
  }

  /**
   * A message from the plugin's own editor (messaging.md section 2.4). The payload is data from code
   * the host does not control, so it is checked rather than trusted: only the two shapes below do
   * anything, a text is clipped to what the module holds, and anything else is ignored.
   */
  onPlugin (payload) {
    if (payload?.type === 'getText') this.sendText()
    else if (payload?.type === 'setText' && typeof payload.text === 'string') {
      this.applyText(new TextEncoder().encode(payload.text.slice(0, this.textCapacity)).buffer)
    }
  }

  /** Tell an open editor the text now loaded, and how many words the module made of it. */
  sendText () {
    this.port.postMessage({
      type: 'plugin',
      payload: {
        type: 'text',
        text: new TextDecoder().decode(this.textBytes),
        words: this.exports.jig_word_count()
      }
    })
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

  /**
   * Fill the transport block for the block starting at blockStart.
   *
   * The host sends its message once per quantum, but the beat in it is where
   * the transport was when it was sent, so the position is carried forward by
   * the frames since. Every field is flagged rather than merely written: a
   * host with a tempo and no beat is ordinary, and Transport mode is silent
   * then rather than guessing.
   */
  writeTransport (blockStart) {
    const view = this.transportView
    const t = this.transport
    let valid = 0

    view.setUint32(0, t?.playing ? 1 : 0, true)

    if (t) {
      const tempo = typeof t.tempo === 'number' ? t.tempo : null
      if (tempo !== null) { view.setFloat64(8, tempo, true); valid |= VALID_BPM }
      if (typeof t.beat === 'number') {
        const beatsPerFrame = typeof t.beatsPerFrame === 'number'
          ? t.beatsPerFrame
          : (tempo ?? 0) / (60 * sampleRate)
        const beat = t.beat + (blockStart - (t.frame ?? blockStart)) * beatsPerFrame
        const perBar = t.timeSignature?.beatsPerBar > 0 ? t.timeSignature.beatsPerBar : 4
        const bars = Math.floor(beat / perBar)
        view.setFloat64(16, beat, true)
        view.setFloat64(24, bars * perBar, true)
        valid |= VALID_BEAT
        view.setInt32(32, bars + 1, true)
        view.setInt32(36, Math.floor(beat - bars * perBar) + 1, true)
        view.setUint32(4, 960, true)
        view.setInt32(40, Math.floor((beat % 1) * 960), true)
        valid |= VALID_BBT
      }
      // An object with named fields, which is what Transport.messageAt sends.
      if (typeof t.timeSignature?.beatsPerBar === 'number') {
        view.setInt32(44, t.timeSignature.beatsPerBar, true)
        view.setInt32(48, t.timeSignature.beatUnit ?? 4, true)
        valid |= VALID_METER
      }
      if (typeof t.frame === 'number') {
        view.setFloat64(56, t.frame / sampleRate, true)
        valid |= VALID_SECONDS
      }
    }
    view.setUint32(52, valid, true)
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

    this.writeTransport(blockStart)
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

registerProcessor('sam', SamProcessor)
