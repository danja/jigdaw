// plugins/retune/retune-processor.js
//
// The AudioWorklet processor for Retune, and the whole plugin: there is no
// WebAssembly module (Dice, MIDI Filter).
//
// Ported from the Downspout VST3 of the same name. Each held note takes its own
// output channel from a pool of 15 (channels 2 to 16, channel 1 left free), and
// a pitch bend sent just before the note-on corrects the nearest 12-TET key to
// the pitch the Scala scale asks for. Pitch bend is per channel, which is the
// only reason a note needs a channel to itself.
//
// The scale is a jig:asset the person replaces, so it arrives in `init` as
// `assets.scl`, again as `loadAsset`, and is what a state request returns: the
// bytes belong in one place (messaging.md 1.2, contract 8.2). A file that does
// not parse is reported and the previous scale keeps playing.
//
// process() allocates nothing beyond the outgoing batch. The queue and the slot
// table are allocated in the constructor; a full queue drops and reports.

const QUEUE_CAPACITY = 256
const RENDER_QUANTUM = 128
const POOL_FIRST = 1
const POOL_LAST = 15
const MAX_DEGREES = 1024
const MAX_SCL_BYTES = 256 * 1024

/** Bytes to text without TextDecoder, which an AudioWorkletGlobalScope does not have. */
function bytesToText (bytes) {
  const view = new Uint8Array(bytes)
  let text = ''
  for (let i = 0; i < view.length; i += 4096) {
    text += String.fromCharCode.apply(null, view.subarray(i, Math.min(view.length, i + 4096)))
  }
  return text
}

function parseNumber (token) {
  if (!/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(token)) return null
  const value = Number(token)
  return Number.isFinite(value) ? value : null
}

/** One pitch line to cents: cents when it holds a '.', otherwise a ratio a/b or a. */
function parsePitch (line) {
  const token = line.trim().split(/\s+/)[0]
  if (!token) return null
  if (token.includes('.')) return parseNumber(token)
  const slash = token.indexOf('/')
  const num = parseNumber(slash < 0 ? token : token.slice(0, slash))
  const den = slash < 0 ? 1 : parseNumber(token.slice(slash + 1))
  if (num === null || den === null || num <= 0 || den <= 0) return null
  return 1200 * Math.log2(num / den)
}

/**
 * Strict .scl parser: '!' lines are comments, then a description, a count, and
 * exactly that many pitch lines. Returns the cents of degrees 1..N, or null for
 * anything malformed.
 */
function parseScl (text) {
  const lines = text.split('\n').filter(line => !line.startsWith('!'))
  if (lines.length < 2) return null
  const countToken = lines[1].trim().split(/\s+/)[0]
  const count = parseNumber(countToken ?? '')
  if (count === null || !Number.isInteger(count) || count < 1 || count > MAX_DEGREES) return null
  if (lines.length < 2 + count) return null
  const cents = new Float64Array(count)
  for (let i = 0; i < count; i++) {
    const value = parsePitch(lines[2 + i])
    if (value === null) return null
    cents[i] = value
  }
  for (let i = 2 + count; i < lines.length; i++) if (lines[i].trim() !== '') return null
  if (cents[count - 1] <= 0) return null
  return cents
}

class RetuneProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors () {
    return [
      { name: 'root', defaultValue: 60, minValue: 0, maxValue: 127, automationRate: 'k-rate' },
      { name: 'bend_range', defaultValue: 2, minValue: 1, maxValue: 24, automationRate: 'k-rate' }
    ]
  }

  constructor (options) {
    super(options)
    this.ready = false
    this.queueFrames = new Float64Array(QUEUE_CAPACITY)
    this.queueBytes = new Uint8Array(QUEUE_CAPACITY * 3)
    this.queueLengths = new Uint8Array(QUEUE_CAPACITY)
    this.queueCount = 0
    this.dropped = 0

    this.cents = null           // Float64Array of degrees 1..N above the 1/1
    this.sclBytes = null        // the ArrayBuffer that produced it, for state requests
    this.slotActive = new Uint8Array(16)
    this.slotInChannel = new Uint8Array(16)
    this.slotInNote = new Uint8Array(16)
    this.slotCarrier = new Uint8Array(16)
    this.slotOrder = new Float64Array(16)
    this.clock = 0
    this.tuning = { carrier: 60, bend: 8192 }
    this.root = 60
    this.bendRange = 2
    this.port.onmessage = event => this.handle(event.data)
  }

  handle (message) {
    switch (message?.type) {
      case 'init': return this.onInit(message)
      case 'events': if (this.ready) this.enqueue(message.events); return
      case 'loadAsset': if (this.ready && message.key === 'scl') this.applyScale(message.bytes); return
      case 'stateRequest':
        if (this.ready) this.port.postMessage({ type: 'state', token: message.token, state: { scl: this.sclBytes } })
        return
      default:
    }
  }

  onInit (message) {
    // Saved state wins over the shipped file, as a restored value wins over a fresh install's.
    const bytes = message.state?.scl instanceof ArrayBuffer ? message.state.scl : message.assets?.scl
    if (!this.applyScale(bytes)) {
      this.port.postMessage({
        type: 'error', phase: 'instantiate', fatal: true,
        message: 'the shipped scale (assets.scl) is missing or does not parse'
      })
      return
    }
    this.ready = true
    this.port.postMessage({ type: 'ready', latencyFrames: 0, tailFrames: null })
  }

  /** Returns whether the bytes became the scale. A failure is reported and changes nothing. */
  applyScale (bytes) {
    let cents = null
    let why = 'no bytes were given'
    if (bytes instanceof ArrayBuffer) {
      if (bytes.byteLength > MAX_SCL_BYTES) why = `the file is ${bytes.byteLength} bytes, over the ${MAX_SCL_BYTES} byte limit`
      else {
        cents = parseScl(bytesToText(bytes))
        why = 'it is not a valid Scala .scl file'
      }
    }
    if (!cents) {
      if (this.ready) this.port.postMessage({ type: 'error', phase: 'asset', fatal: false, message: `scale not loaded: ${why}` })
      return false
    }
    this.cents = cents
    this.sclBytes = bytes
    return true
  }

  enqueue (events) {
    if (!events?.length) return
    let dropped = 0
    for (const event of events) {
      if (this.queueCount >= QUEUE_CAPACITY) { dropped += 1; continue }
      const slot = this.queueCount
      const bytes = event.bytes
      this.queueFrames[slot] = event.frame
      this.queueLengths[slot] = Math.min(3, bytes.length)
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

  /** Cents above the root for a note; the scale repeats every period, not necessarily an octave. */
  noteCents (note) {
    const n = this.cents.length
    const offset = note - this.root
    let octave = Math.trunc(offset / n)
    let degree = offset % n
    if (degree < 0) { degree += n; octave -= 1 }
    const base = degree === 0 ? 0 : this.cents[degree - 1]
    return base + octave * this.cents[n - 1]
  }

  /** The 12-TET carrier and 14-bit bend for a note, or null when it cannot be tuned. */
  tune (note, out) {
    const cents = this.noteCents(note)
    const steps = Math.round(cents / 100)
    const carrier = this.root + steps
    if (carrier < 0 || carrier > 127) return false
    const fraction = (cents - 100 * steps) / (this.bendRange * 100)
    if (Math.abs(fraction) > 1) return false
    out.carrier = carrier
    out.bend = Math.min(16383, Math.max(0, Math.round(8192 + fraction * 8192)))
    return true
  }

  /** Longest-idle free channel, else steal the oldest note, silencing it first. */
  pickChannel (frame, out) {
    let best = -1
    for (let ch = POOL_FIRST; ch <= POOL_LAST; ch++) {
      if (this.slotActive[ch] === 0 && (best < 0 || this.slotOrder[ch] < this.slotOrder[best])) best = ch
    }
    if (best >= 0) return best
    best = POOL_FIRST
    for (let ch = POOL_FIRST; ch <= POOL_LAST; ch++) if (this.slotOrder[ch] < this.slotOrder[best]) best = ch
    out.push({ frame, bytes: Uint8Array.of(0x80 | best, this.slotCarrier[best], 0) })
    this.slotActive[best] = 0
    return best
  }

  noteOff (inChannel, note, frame, out) {
    for (let ch = POOL_FIRST; ch <= POOL_LAST; ch++) {
      if (this.slotActive[ch] === 1 && this.slotInChannel[ch] === inChannel && this.slotInNote[ch] === note) {
        out.push({ frame, bytes: Uint8Array.of(0x80 | ch, this.slotCarrier[ch], 0) })
        this.slotActive[ch] = 0
        this.slotOrder[ch] = ++this.clock
        return
      }
    }
  }

  allNotesOff (frame, out) {
    for (let ch = 0; ch < 16; ch++) {
      if (this.slotActive[ch] === 0) continue
      out.push({ frame, bytes: Uint8Array.of(0x80 | ch, this.slotCarrier[ch], 0) })
      this.slotActive[ch] = 0
      this.slotOrder[ch] = ++this.clock
    }
  }

  noteOn (inChannel, note, velocity, frame, out) {
    // A repeated note-on for a held note retriggers: release the old one first.
    this.noteOff(inChannel, note, frame, out)
    const tuning = this.tuning
    if (!this.tune(note, tuning)) return
    const ch = this.pickChannel(frame, out)
    this.slotActive[ch] = 1
    this.slotInChannel[ch] = inChannel
    this.slotInNote[ch] = note
    this.slotCarrier[ch] = tuning.carrier
    this.slotOrder[ch] = ++this.clock
    out.push({ frame, bytes: Uint8Array.of(0xe0 | ch, tuning.bend & 0x7f, (tuning.bend >> 7) & 0x7f) })
    out.push({ frame, bytes: Uint8Array.of(0x90 | ch, tuning.carrier, Math.min(127, Math.max(1, velocity))) })
  }

  /** CC and program change reach every pool channel; poly aftertouch follows its note. */
  other (status, data1, data2, length, frame, out) {
    const type = status >> 4
    const inChannel = status & 0x0f
    if (type === 0xb && (data1 === 120 || data1 === 123)) return this.allNotesOff(frame, out)
    if (type === 0xb || type === 0xc) {
      for (let ch = POOL_FIRST; ch <= POOL_LAST; ch++) {
        out.push({ frame, bytes: length === 2 ? Uint8Array.of((type << 4) | ch, data1 & 0x7f) : Uint8Array.of((type << 4) | ch, data1 & 0x7f, data2 & 0x7f) })
      }
    } else if (type === 0xa) {
      for (let ch = POOL_FIRST; ch <= POOL_LAST; ch++) {
        if (this.slotActive[ch] === 1 && this.slotInChannel[ch] === inChannel && this.slotInNote[ch] === data1) {
          out.push({ frame, bytes: Uint8Array.of(0xa0 | ch, this.slotCarrier[ch], data2 & 0x7f) })
          return
        }
      }
    }
  }

  process (inputs, outputs, parameters) {
    // No audio output, so a real AudioWorkletNode passes `outputs` empty and a MIDI processor that
    // returned early on that would never run.
    if (!this.ready) return true
    this.root = Math.round(parameters.root[0])
    this.bendRange = Math.max(1, parameters.bend_range[0])

    const blockEnd = currentFrame + RENDER_QUANTUM
    const out = []
    let kept = 0
    for (let i = 0; i < this.queueCount; i++) {
      if (this.queueFrames[i] < blockEnd) {
        const frame = this.queueFrames[i]
        const status = this.queueBytes[i * 3]
        const data1 = this.queueBytes[i * 3 + 1]
        const data2 = this.queueBytes[i * 3 + 2]
        const kind = status & 0xf0
        if (kind === 0x90 && data2 > 0) this.noteOn(status & 0x0f, data1, data2, frame, out)
        else if (kind === 0x80 || kind === 0x90) this.noteOff(status & 0x0f, data1, frame, out)
        else if (kind >= 0xa0 && kind < 0xf0 && kind !== 0xd0 && kind !== 0xe0) this.other(status, data1, data2, this.queueLengths[i], frame, out)
        // Pitch bend, channel aftertouch and system messages are dropped: a bend would undo the tuning.
        continue
      }
      this.queueFrames[kept] = this.queueFrames[i]
      this.queueLengths[kept] = this.queueLengths[i]
      this.queueBytes[kept * 3] = this.queueBytes[i * 3]
      this.queueBytes[kept * 3 + 1] = this.queueBytes[i * 3 + 1]
      this.queueBytes[kept * 3 + 2] = this.queueBytes[i * 3 + 2]
      kept += 1
    }
    this.queueCount = kept
    if (out.length > 0) this.port.postMessage({ type: 'events', events: out })
    return true
  }
}

registerProcessor('retune', RetuneProcessor)
