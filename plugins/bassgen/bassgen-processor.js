// plugins/bassgen/bassgen-processor.js
//
// The AudioWorklet processor for BassGen.
//
// The first processor here that produces no audio and emits MIDI instead, which
// is what jig:Abi2 added and what messaging.md section 1.3 `events` has always
// described. It fills the transport block the module reads, hands over incoming
// events, and posts back whatever the module generated.
//
// The same two rules as pulse. Every incoming event carries an absolute stream
// position and is applied in the quantum that contains it, compared by range
// and never by equality with a boundary. The queue is bounded, preallocated,
// and says how much it dropped.
//
// Outgoing events carry an absolute stream position too, worked out from the
// frame offset the module wrote. A frame offset is meaningless once its block
// has passed, so converting it here is not a convenience: sending it raw would
// give the host a number with no fixed meaning.

const PARAM_INDEX = Object.freeze({
  root: 0, scale: 1, genre: 2, length: 3, subdivision: 4, density: 5,
  register: 6, hold: 7, accent: 8, colour: 9, vary: 10, seed: 11, follow: 12
})

const QUEUE_CAPACITY = 512
const EVENT_BYTES = 8          // docs/module-abi.md fixes the record at 8 bytes
const TRANSPORT_BYTES = 64

// The transport valid bits, from the same place.
const VALID_BPM = 1
const VALID_BEAT = 2
const VALID_BBT = 4
const VALID_METER = 8
const VALID_SECONDS = 16

class BassgenProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors () {
    return [
      { name: 'root', defaultValue: 36, minValue: 12, maxValue: 72, automationRate: 'k-rate' },
      { name: 'scale', defaultValue: 2, minValue: 0, maxValue: 22, automationRate: 'k-rate' },
      { name: 'genre', defaultValue: 0, minValue: 0, maxValue: 11, automationRate: 'k-rate' },
      { name: 'length', defaultValue: 16, minValue: 1, maxValue: 32, automationRate: 'k-rate' },
      { name: 'subdivision', defaultValue: 1, minValue: 0, maxValue: 3, automationRate: 'k-rate' },
      { name: 'density', defaultValue: 0.45, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'register', defaultValue: 1, minValue: 0, maxValue: 3, automationRate: 'k-rate' },
      { name: 'hold', defaultValue: 0.35, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'accent', defaultValue: 0.45, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'colour', defaultValue: 0.5, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'vary', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'seed', defaultValue: 1, minValue: 1, maxValue: 9999, automationRate: 'k-rate' },
      { name: 'follow', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate' }
    ]
  }

  constructor (options) {
    super(options)
    this.ready = false
    this.exports = null
    this.lastValues = new Float32Array(Object.keys(PARAM_INDEX).length).fill(NaN)

    this.queueFrames = new Float64Array(QUEUE_CAPACITY)
    this.queueBytes = new Uint8Array(QUEUE_CAPACITY * 3)
    this.queueCount = 0

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
      // Compiled here, synchronously: a compiled Module cannot be posted into a
      // worklet at all, it is silently never delivered. Contract section 3.3.
      const compiled = new WebAssembly.Module(message.module)
      const instance = new WebAssembly.Instance(compiled, {})
      const exports = instance.exports

      for (const name of ['jig_init', 'jig_process', 'jig_set_param', 'jig_max_frames',
        'jig_midi_in_ptr', 'jig_midi_in_capacity', 'jig_midi_in',
        'jig_midi_out_ptr', 'jig_midi_out_capacity', 'jig_midi_out_count',
        'jig_transport_ptr', 'memory']) {
        if (!(name in exports)) throw new Error(`the module does not export ${name}`)
      }

      exports.jig_init(message.sampleRate ?? sampleRate)

      // Taken once. The ABI forbids growing memory after jig_init precisely so
      // these can be held, and a view over a grown memory is zero length.
      this.inCapacity = exports.jig_midi_in_capacity()
      this.outCapacity = exports.jig_midi_out_capacity()
      this.midiIn = new DataView(exports.memory.buffer, exports.jig_midi_in_ptr(),
        this.inCapacity * EVENT_BYTES)
      this.midiOut = new DataView(exports.memory.buffer, exports.jig_midi_out_ptr(),
        this.outCapacity * EVENT_BYTES)
      this.transportView = new DataView(exports.memory.buffer, exports.jig_transport_ptr(),
        TRANSPORT_BYTES)

      this.exports = exports
      this.maxFrames = exports.jig_max_frames()
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

  /**
   * Fill the transport block.
   *
   * Every field is flagged rather than merely written. A host that has a tempo
   * and no bar, beat and tick is ordinary, and a plugin that reads bar 1 beat 1
   * from a host that never filled them in restarts its pattern every block.
   */
  writeTransport () {
    const view = this.transportView
    const t = this.transport
    let valid = 0

    view.setUint32(0, t?.playing ? 1 : 0, true)

    if (t) {
      if (typeof t.tempo === 'number') { view.setFloat64(8, t.tempo, true); valid |= VALID_BPM }
      if (typeof t.beat === 'number') {
        view.setFloat64(16, t.beat, true)
        const perBar = t.timeSignature?.[0] ?? 4
        const bars = Math.floor(t.beat / perBar)
        view.setFloat64(24, bars * perBar, true)
        valid |= VALID_BEAT
        view.setInt32(32, bars + 1, true)
        view.setInt32(36, Math.floor(t.beat - bars * perBar) + 1, true)
        view.setUint32(4, 960, true)
        view.setInt32(40, Math.floor((t.beat % 1) * 960), true)
        valid |= VALID_BBT
      }
      if (t.timeSignature) {
        view.setInt32(44, t.timeSignature[0], true)
        view.setInt32(48, t.timeSignature[1], true)
        valid |= VALID_METER
      }
      if (typeof t.frame === 'number') {
        view.setFloat64(56, t.frame / sampleRate, true)
        valid |= VALID_SECONDS
      }
    }
    view.setUint32(52, valid, true)
  }

  /** Take what the module emitted and post it, on the stream clock. */
  collect (blockStart) {
    const produced = Math.min(this.exports.jig_midi_out_count(), this.outCapacity)
    if (produced === 0) return
    const events = []
    for (let i = 0; i < produced; i++) {
      const base = i * EVENT_BYTES
      const size = this.midiOut.getUint8(base + 4)
      if (size < 1 || size > 3) continue   // the ABI says ignore
      const bytes = new Uint8Array(size)
      for (let b = 0; b < size; b++) bytes[b] = this.midiOut.getUint8(base + 5 + b)
      events.push({ frame: blockStart + this.midiOut.getUint32(base, true), bytes })
    }
    if (events.length > 0) this.port.postMessage({ type: 'events', events })
  }

  process (inputs, outputs, parameters) {
    if (!this.ready) return true

    // A quantum is 128 frames whether or not this plugin writes any of them. It
    // has no audio output, so the block length comes from the render quantum
    // rather than from a buffer that is not there.
    const frames = Math.min(outputs[0]?.[0]?.length ?? 128, this.maxFrames)
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

    this.writeTransport()
    this.exports.jig_process(frames)
    this.collect(blockStart)

    // A generator keeps running: the transport may start at any time.
    return true
  }
}

registerProcessor('bassgen', BassgenProcessor)
