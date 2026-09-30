// plugins/dice/dice-processor.js
//
// The AudioWorklet processor for Dice, and the whole plugin: there is no
// WebAssembly module (Tremolo, Squelch, Lookahead).
//
// A MIDI probability gate. Each note-on passes with the set probability; a
// note-off passes if and only if its note-on did, so a dropped note never
// leaves anything downstream sustaining. Everything that is not a note passes
// through untouched.
//
// What this plugin exists to exercise is contract section 8: a second plugin
// answering state requests, beside Ferrite. The state is the xorshift32
// generator as an unsigned integer, which advances with every gated note and
// is knowable no other way: two instances with identical parameters diverge
// after different histories, and restoring a saved state re-converges them.
// Parameters are not state, so this lives in the state channel rather than in
// a port (contract 8.2).
//
// process() allocates nothing: the event queue, the passed-note flags and the
// outgoing batch are allocated in the constructor, and a full queue drops and
// reports rather than growing (messaging.md 1.4).

const QUEUE_CAPACITY = 256
const NOTE_ON = 0x90
const NOTE_OFF = 0x80

// Zero means unseeded, which is unambiguous: the generator never produces
// zero from a nonzero state (xorshift32 is a permutation), restore refuses
// zero, and the seed port starts at one. The first quantum seeds from the
// seed parameter, so a fresh load is deterministic without a reseed.
const UNSEEDED = 0

class DiceProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors () {
    return [
      { name: 'probability', defaultValue: 1, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'seed', defaultValue: 1, minValue: 1, maxValue: 9999, automationRate: 'k-rate' },
      { name: 'reseed', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate' }
    ]
  }

  constructor (options) {
    super(options)
    this.ready = false
    this.rng = UNSEEDED
    this.reseedWasHigh = false
    this.queueFrames = new Float64Array(QUEUE_CAPACITY)
    this.queueBytes = new Uint8Array(QUEUE_CAPACITY * 3)
    this.queueCount = 0
    this.dropped = 0
    // Whether each channel and pitch is currently held through the gate.
    this.passed = new Uint8Array(16 * 128)
    this.port.onmessage = event => this.handle(event.data)
  }

  handle (message) {
    if (message?.type === 'init') return this.onInit(message)
    if (!this.ready) return
    if (message?.type === 'events') this.enqueue(message.events)
    else if (message?.type === 'stateRequest') {
      this.port.postMessage({ type: 'state', token: message.token, state: { rng: this.rng } })
    }
  }

  onInit (message) {
    const saved = message.state?.rng
    if (saved !== undefined && saved !== null) {
      // A save from an incompatible version restores as the shipped default,
      // not as a broken generator: reported, then ignored.
      if (!Number.isInteger(saved) || saved < 1 || saved > 0xffffffff) {
        this.port.postMessage({
          type: 'error', phase: 'state', fatal: false,
          message: `saved generator state is not a usable seed: ${JSON.stringify(saved)}`
        })
      } else {
        this.rng = saved
      }
    }
    this.ready = true
    this.port.postMessage({ type: 'ready', latencyFrames: 0, tailFrames: null })
  }

  /** One xorshift32 step, kept unsigned throughout. */
  draw () {
    let x = this.rng >>> 0
    x ^= (x << 13) >>> 0
    x ^= x >>> 17
    x ^= (x << 5) >>> 0
    this.rng = x >>> 0
    return this.rng / 0x100000000
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

  gate (status, data1, data2) {
    const kind = status & 0xf0
    const channel = status & 0x0f
    const slot = channel * 128 + (data1 & 0x7f)
    if (kind === NOTE_ON && data2 > 0) {
      if (this.draw() < this.probability) {
        this.passed[slot] = 1
        return true
      }
      return false
    }
    if (kind === NOTE_OFF || (kind === NOTE_ON && data2 === 0)) {
      if (this.passed[slot] === 1) {
        this.passed[slot] = 0
        return true
      }
      return false
    }
    return true
  }

  process (inputs, outputs, parameters) {
    const output = outputs[0]
    if (!output || output.length === 0) return true

    if (!this.ready) {
      for (const channel of output) channel.fill(0)
      return true
    }

    const probability = parameters.probability[0]
    const seed = Math.max(1, Math.floor(parameters.seed[0]))
    const reseedHigh = parameters.reseed[0] >= 0.5
    if (this.rng === UNSEEDED) this.rng = seed
    // A rising edge, in the style of DrumGen's triggers: a level would
    // re-seed on every restore carrying reseed 1 and destroy the state it
    // arrived with.
    if (reseedHigh && !this.reseedWasHigh) this.rng = seed
    this.reseedWasHigh = reseedHigh
    this.probability = Math.min(1, Math.max(0, probability))

    const frames = output[0].length
    const blockEnd = currentFrame + frames
    const out = []
    let kept = 0
    for (let i = 0; i < this.queueCount; i++) {
      if (this.queueFrames[i] < blockEnd) {
        const status = this.queueBytes[i * 3]
        const data1 = this.queueBytes[i * 3 + 1]
        const data2 = this.queueBytes[i * 3 + 2]
        if (this.gate(status, data1, data2)) {
          out.push({
            frame: this.queueFrames[i],
            bytes: Uint8Array.from([status, data1, data2])
          })
        }
        continue
      }
      this.queueFrames[kept] = this.queueFrames[i]
      this.queueBytes[kept * 3] = this.queueBytes[i * 3]
      this.queueBytes[kept * 3 + 1] = this.queueBytes[i * 3 + 1]
      this.queueBytes[kept * 3 + 2] = this.queueBytes[i * 3 + 2]
      kept += 1
    }
    this.queueCount = kept
    // The gate delays nothing, so passed events keep their frame.
    if (out.length > 0) this.port.postMessage({ type: 'events', events: out })

    return true
  }
}

registerProcessor('dice', DiceProcessor)
