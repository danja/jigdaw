// plugins/moka/moka-processor.js
//
// The AudioWorklet processor for Moka, and the whole plugin: there is no
// WebAssembly module (Tremolo, Dice).
//
// Ported from the Downspout VST3 of the same name. Each voice is a bank of eight
// damped sine modes, excited by a short mallet transient, which models struck
// objects: bars, blocks, bowls, plates and a soft-beaten tube. Spread, Mallet and
// Position reshape the same instrument table (computeModeWeights); Decay scales
// every mode's ring time around the instrument's own.
//
// A note starts from silence and ramps in over the mallet's contact time with a
// raised cosine, crossfading from whatever the voice was already sounding.
// Without that the first sample out of silence is a step of several tenths, a
// click on every note and a full-scale one on a chord.
//
// A MIDI event is applied at its own sample, in the block that contains it, by
// stream position (CLAUDE.md). Pitch bend is per channel, as Retune sends it, with
// the range set by RPN 0.
//
// Every voice, buffer and queue is allocated in the constructor. process()
// allocates nothing and renders silence until the processor has reported ready.

const QUEUE_CAPACITY = 256
const MODE_COUNT = 8
const MAX_VOICES = 12
const TWO_PI = Math.PI * 2
const OUTPUT_GAIN = 1.6
const SILENCE_EPS = 0.00012
const MIN_RING_T60 = 0.03
const LN_1000 = 6.9077553 // the natural log of 1000: a T60 is the time to fall 60 dB
// Mallet contact time bounds, in seconds: hard beater short, soft beater long.
const CONTACT_HARD = 0.0015
const CONTACT_SOFT = 0.006
// Scales the mallet burst down from a raw full-scale noise pop. It is the attack, not the body.
const TRANSIENT_SCALE = 0.55
const TRANSIENT_HIGHPASS_HZ = 1800

// The parameter list is the only definition of ranges and defaults here. It is the same list
// as profile.json's ports, and tests/host/moka.test.js fails if they disagree.
const PARAMS = [
  { name: 'instrument', min: 0, max: 5, def: 0 },
  { name: 'decay', min: 0, max: 1, def: 0.55 },
  { name: 'mallet', min: 0, max: 1, def: 0.75 },
  { name: 'tone', min: 0, max: 1, def: 0.65 },
  { name: 'spread', min: 0, max: 1, def: 0.3 },
  { name: 'position', min: 0, max: 1, def: 0.45 },
  { name: 'voices', min: 1, max: MAX_VOICES, def: 4 },
  { name: 'level', min: 0, max: 1, def: 0.7 },
  { name: 'release', min: 0, max: 1, def: 0.3 },
  { name: 'width', min: 0, max: 1, def: 0.7 }
]

// Each instrument is a bank of damped modes: frequency ratio, relative level, and a per-mode decay
// multiplier (upper partials die faster on bars and ring longer on glass and metal). A ratio of 0
// is an unused slot.
const MODELS = [
  { // Xylophone: rosewood bar, strong fundamental, fast upper partials
    baseT60: 1.4, transient: 0.55,
    modes: [[1.0, 1.0, 1.0], [3.92, 0.42, 0.45], [9.24, 0.18, 0.22], [11.54, 0.08, 0.14]]
  },
  { // Glockenspiel: steel bar, bright and long
    baseT60: 4.5, transient: 0.7,
    modes: [[1.0, 1.0, 1.0], [2.76, 0.55, 0.7], [5.4, 0.32, 0.5], [8.93, 0.16, 0.32], [13.2, 0.07, 0.2]]
  },
  { // Woodblock: hollow slit drum, short and woody
    baseT60: 0.28, transient: 0.9,
    modes: [[1.0, 1.0, 1.0], [2.32, 0.5, 0.6], [3.85, 0.22, 0.35], [5.6, 0.08, 0.2]]
  },
  { // Glass Bowl: near-harmonic with a beating pair on the fundamental
    baseT60: 6.0, transient: 0.25,
    modes: [[1.0, 0.8, 1.0], [1.006, 0.8, 1.0], [2.01, 0.45, 0.85], [2.74, 0.35, 0.7], [3.92, 0.2, 0.55], [5.43, 0.1, 0.4]]
  },
  { // Metal Sheet: struck plate, a dense inharmonic cluster
    baseT60: 3.2, transient: 0.8,
    modes: [[1.0, 0.75, 1.0], [1.48, 0.62, 0.9], [2.09, 0.55, 0.8], [2.78, 0.42, 0.68], [3.6, 0.3, 0.55], [4.7, 0.2, 0.42], [5.95, 0.12, 0.3], [7.4, 0.07, 0.22]]
  },
  { // Tube: soft flip-flop beater on a hollow tube, mellow hum and sparse overtones
    baseT60: 2.6, transient: 0.35,
    modes: [[1.0, 1.0, 1.0], [1.5, 0.35, 0.7], [2.0, 0.5, 0.75], [2.76, 0.28, 0.55], [4.2, 0.12, 0.35], [6.8, 0.05, 0.22]]
  }
]

const clampUnit = v => Math.min(1, Math.max(0, Number.isFinite(v) ? v : 0))
const decayScaleFor = decay => 0.15 * Math.pow(20, clampUnit(decay)) // 0.15x to 3x the instrument's base
const toneCutoffHz = tone => 900 + clampUnit(tone) ** 2 * 11000
const releaseT60For = release => 0.03 * Math.pow(50, clampUnit(release)) // a 30 ms choke up to a 1.5 s tail
const noteToFrequency = note => 440 * Math.pow(2, (note - 69) / 12)

/** Fill `ratio` and `weight` with the stretched, weighted modes of an instrument. */
function computeModeWeights (model, spread, mallet, position, ratio, weight) {
  const spec = MODELS[model]
  // Spread stretches partials from near-harmonic (0.6x) to bell-like (1.5x).
  const stretch = 0.6 + 0.9 * clampUnit(spread)
  // A hard beater excites upper partials; a soft one stays near the hum.
  const slope = (1.8 - 1.74 * clampUnit(mallet)) * 0.5
  // Strike position: edge (0) is bright and clangorous, centre (1) is round.
  const edgeMix = 1 - clampUnit(position)
  for (let i = 0; i < MODE_COUNT; i++) {
    const entry = spec.modes[i]
    if (!entry || entry[0] <= 0 || entry[1] <= 0) { ratio[i] = 0; weight[i] = 0; continue }
    const r = 1 + (entry[0] - 1) * stretch
    let w = entry[1] * Math.exp(-(r - 1) * slope)
    // Centre strike damps partials by their distance from the fundamental; edge strike lets them ring.
    w /= 1 + (1 - edgeMix) * (r - 1) * 1.1
    w *= 1 + edgeMix * Math.min(r / 8, 1) * 0.9
    if (i === 0) w *= 1 + (1 - edgeMix) * 0.25
    ratio[i] = r
    weight[i] = w
  }
}

/** A tiny xorshift32, so that identical notes render identically. */
function noiseSeed (note, velocity, serial) {
  const state = (Math.imul(note, 2654435761) ^ Math.imul(velocity, 2246822519) ^ Math.imul(serial, 3266489917)) >>> 0
  return state !== 0 ? state : 0x9e3779b9
}

class Voice {
  constructor () {
    this.ratio = new Float64Array(MODE_COUNT)
    this.weight = new Float64Array(MODE_COUNT)
    this.phase = new Float64Array(MODE_COUNT)
    this.increment = new Float64Array(MODE_COUNT)
    this.amplitude = new Float64Array(MODE_COUNT)
    this.decayCoeff = new Float64Array(MODE_COUNT)
    this.gainL = new Float64Array(MODE_COUNT)
    this.gainR = new Float64Array(MODE_COUNT)
    this.active = false
    this.releasing = false
    this.note = -1
    this.channel = 0
    this.bendRatio = 1
    this.serial = 0
    this.releaseCoeff = 1
    this.rng = 0x9e3779b9
    this.transientSamples = 0
    this.transientPosition = 0
    this.transientLevel = 0
    this.transientDecay = 1
    this.attackSamples = 1
    this.attackPosition = 1
    this.lastLeft = 0
    this.lastRight = 0
    this.toneL = 0
    this.toneR = 0
    this.hpX = 0
    this.hpY = 0
  }

  reset () {
    this.active = false
    this.releasing = false
    this.note = -1
    this.amplitude.fill(0)
    this.increment.fill(0)
    this.lastLeft = this.lastRight = 0
    this.toneL = this.toneR = 0
    this.hpX = this.hpY = 0
  }

  nextNoise () {
    let s = this.rng
    s ^= s << 13
    s ^= s >>> 17
    s ^= s << 5
    this.rng = s >>> 0
    return this.rng / 2147483648
  }

  start (note, channel, bendRatio, velocity, values, serial, sampleRate) {
    this.note = note
    this.channel = channel
    this.bendRatio = bendRatio
    this.serial = serial
    this.releasing = false
    const vel = Math.min(1, Math.max(0, velocity / 127))
    const model = Math.round(values.instrument)
    const spec = MODELS[model]
    const mallet = values.mallet
    const edgeMix = 1 - clampUnit(values.position)
    const decayScale = decayScaleFor(values.decay)
    const width = clampUnit(values.width)
    const baseFrequency = noteToFrequency(note) * bendRatio

    computeModeWeights(model, values.spread, mallet, values.position, this.ratio, this.weight)
    // Seeds the mode phases, as xorshift32 with a different mix from the burst stream below.
    this.rng = ((Math.imul(note, 131) + Math.imul(velocity, 17) + Math.imul(serial, 1013904223)) >>> 0) || 0x9e3779b9
    for (let i = 0; i < MODE_COUNT; i++) {
      const ratio = this.ratio[i]
      if (ratio <= 0) { this.amplitude[i] = 0; this.increment[i] = 0; continue }
      const frequency = Math.min(baseFrequency * ratio, sampleRate * 0.42)
      this.increment[i] = frequency / sampleRate
      this.phase[i] = this.nextNoise() * 0.5
      this.amplitude[i] = this.weight[i] * (0.25 + 0.75 * vel)
      const t60 = Math.max(MIN_RING_T60, spec.baseT60 * decayScale * spec.modes[i][2])
      this.decayCoeff[i] = Math.exp(-LN_1000 / (t60 * sampleRate))
      // Alternate partials across the stereo field, higher partials wider; Width collapses them toward centre.
      const side = i % 2 === 0 ? -1 : 1
      const pan = Math.min(0.85, Math.max(-0.85,
        (side * 0.55 * Math.min(ratio / 4 + 0.35, 1) + (((note * 37 + i * 11) % 101) / 100 - 0.5) * 0.1) * (0.05 + 0.95 * width)))
      this.gainL[i] = Math.sqrt(0.5 * (1 - pan))
      this.gainR[i] = Math.sqrt(0.5 * (1 + pan))
    }

    // Mallet transient: a hard beater is a short loud click, a soft one a longer quiet thud.
    const transientSeconds = 0.014 - 0.0115 * clampUnit(mallet)
    this.transientSamples = Math.max(8, Math.floor(transientSeconds * sampleRate))
    this.transientPosition = 0
    this.transientLevel = TRANSIENT_SCALE * spec.transient * (0.35 + 0.65 * vel) * (0.5 + 0.5 * edgeMix) * (0.45 + 0.75 * clampUnit(mallet))
    this.transientDecay = Math.exp(-6 / this.transientSamples)
    this.hpX = this.hpY = 0
    // The tone filters keep their state across a retrigger: zeroing them mid-tail would step the
    // ringing output down to nothing. The onset ramp crossfades that tail into the new strike.
    this.rng = noiseSeed(note, velocity, serial)

    // The bar rings from the displacement the beater built up, so the bank ramps in over the contact time.
    const contact = CONTACT_HARD + (CONTACT_SOFT - CONTACT_HARD) * (1 - clampUnit(mallet))
    this.attackSamples = Math.max(1, Math.floor(contact * sampleRate))
    this.attackPosition = 0
    this.releaseCoeff = this.decayCoeff[0]
    if (!this.active) this.lastLeft = this.lastRight = 0 // it was silent, so crossfade from zero
    this.active = true
  }

  release (t60, sampleRate) {
    this.releasing = true
    this.releaseCoeff = Math.exp(-LN_1000 / (Math.max(MIN_RING_T60, t60) * sampleRate))
  }

  /** Scale every mode's pitch for a channel pitch bend on a ringing voice. */
  setBend (bendRatio) {
    if (this.bendRatio <= 0) return
    const scale = bendRatio / this.bendRatio
    for (let i = 0; i < MODE_COUNT; i++) this.increment[i] *= scale
    this.bendRatio = bendRatio
  }

  /** Adds one sample into `sum` (left, right) and returns nothing; `toneCoef` and `hpAlpha` are per-block constants. */
  process (sum, toneCoef, hpAlpha) {
    let left = 0
    let right = 0
    let peak = 0
    for (let i = 0; i < MODE_COUNT; i++) {
      if (this.amplitude[i] < SILENCE_EPS && this.releasing) continue
      if (this.increment[i] <= 0) continue
      let phase = this.phase[i] + this.increment[i]
      if (phase >= 1) phase -= 1
      this.phase[i] = phase
      this.amplitude[i] *= this.releasing ? this.releaseCoeff : this.decayCoeff[i]
      const amplitude = this.amplitude[i]
      const sample = Math.sin(TWO_PI * phase) * amplitude
      if (Math.abs(amplitude) > peak) peak = Math.abs(amplitude)
      left += sample * this.gainL[i]
      right += sample * this.gainR[i]
    }

    if (this.transientPosition < this.transientSamples) {
      this.transientLevel *= this.transientDecay
      const input = this.nextNoise()
      const y = hpAlpha * (this.hpY + input - this.hpX)
      this.hpX = input
      this.hpY = Number.isFinite(y) ? y : 0
      const click = this.hpY * this.transientLevel
      left += click * 0.7
      right += click * 0.7
      if (Math.abs(click) > peak) peak = Math.abs(click)
      this.transientPosition += 1
    }

    this.toneL += toneCoef * (left - this.toneL)
    this.toneR += toneCoef * (right - this.toneR)
    if (!Number.isFinite(this.toneL)) this.toneL = 0
    if (!Number.isFinite(this.toneR)) this.toneR = 0

    // Onset shaping: a raised cosine over the contact time starts the output at exactly zero with
    // zero slope, and blends from the voice's last output so a retrigger crossfades its tail.
    let ramp = 1
    if (this.attackPosition < this.attackSamples) {
      ramp = this.attackPosition / this.attackSamples
      this.attackPosition += 1
    }
    const env = 0.5 * (1 - Math.cos(Math.PI * ramp))
    this.lastLeft = this.lastLeft * (1 - ramp) + this.toneL * env
    this.lastRight = this.lastRight * (1 - ramp) + this.toneR * env

    if (this.releasing && peak < SILENCE_EPS && this.transientPosition >= this.transientSamples) {
      this.active = false
      this.note = -1
      this.lastLeft = this.lastRight = 0
      return
    }
    sum[0] += this.lastLeft
    sum[1] += this.lastRight
  }
}

class MokaProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors () {
    return PARAMS.map(p => ({ name: p.name, defaultValue: p.def, minValue: p.min, maxValue: p.max, automationRate: 'k-rate' }))
  }

  constructor (options) {
    super(options)
    this.ready = false
    this.sampleRate = sampleRate
    this.voices = Array.from({ length: MAX_VOICES }, () => new Voice())
    this.values = Object.fromEntries(PARAMS.map(p => [p.name, p.def]))
    this.sum = new Float64Array(2)
    this.serialCounter = 0
    this.dcX = 0
    this.dcY = 0
    this.bendRatio = new Float64Array(16).fill(1)
    this.bendRange = new Float64Array(16).fill(2)
    this.bendValue = new Int32Array(16).fill(8192)
    this.rpnMsb = new Uint8Array(16).fill(127)
    this.rpnLsb = new Uint8Array(16).fill(127)

    this.queueFrames = new Float64Array(QUEUE_CAPACITY)
    this.queueBytes = new Uint8Array(QUEUE_CAPACITY * 3)
    this.queueLengths = new Uint8Array(QUEUE_CAPACITY)
    this.queueCount = 0
    this.due = new Int32Array(QUEUE_CAPACITY)
    this.port.onmessage = event => this.handle(event.data)
  }

  handle (message) {
    if (message?.type === 'init') {
      this.sampleRate = message.sampleRate ?? sampleRate
      this.ready = true
      this.port.postMessage({ type: 'ready', latencyFrames: 0, tailFrames: null })
      return
    }
    if (!this.ready) return
    if (message?.type === 'events') this.enqueue(message.events)
    else if (message?.type === 'dispose') this.ready = false
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
    if (dropped > 0) this.port.postMessage({ type: 'dropped', count: dropped, since: currentFrame })
  }

  readParameters (parameters) {
    for (const spec of PARAMS) {
      const raw = parameters[spec.name][0]
      const v = Math.min(spec.max, Math.max(spec.min, Number.isFinite(raw) ? raw : spec.def))
      this.values[spec.name] = (spec.name === 'instrument' || spec.name === 'voices') ? Math.round(v) : v
    }
  }

  activeVoiceCount () {
    let n = 0
    for (const voice of this.voices) if (voice.active) n += 1
    return n
  }

  noteOn (note, velocity, channel) {
    const bend = this.bendRatio[channel & 15]
    const serial = ++this.serialCounter
    for (const voice of this.voices) {
      if (voice.active && voice.note === note && voice.channel === channel) {
        voice.start(note, channel, bend, velocity, this.values, serial, this.sampleRate)
        return
      }
    }
    let target = null
    if (this.activeVoiceCount() < this.values.voices) target = this.voices.find(voice => !voice.active) ?? null
    if (!target) {
      // Steal a releasing voice first, oldest first, then the oldest sounding one.
      for (const voice of this.voices) {
        if (voice.active && voice.releasing && (!target || voice.serial < target.serial)) target = voice
      }
      if (!target) {
        for (const voice of this.voices) if (voice.active && (!target || voice.serial < target.serial)) target = voice
      }
    }
    target?.start(note, channel, bend, velocity, this.values, serial, this.sampleRate)
  }

  noteOff (note, channel) {
    const t60 = releaseT60For(this.values.release)
    for (const voice of this.voices) {
      if (voice.active && voice.note === note && voice.channel === channel) voice.release(t60, this.sampleRate)
    }
  }

  allNotesOff () {
    const t60 = releaseT60For(this.values.release)
    for (const voice of this.voices) if (voice.active) voice.release(t60, this.sampleRate)
  }

  pitchBend (channel, value14) {
    const ch = channel & 15
    this.bendValue[ch] = value14
    this.bendRatio[ch] = Math.pow(2, (((value14 - 8192) / 8192) * this.bendRange[ch]) / 12)
    for (const voice of this.voices) if (voice.active && voice.channel === ch) voice.setBend(this.bendRatio[ch])
  }

  applyMidi (status, data1, data2, length) {
    const kind = status & 0xf0
    const channel = status & 0x0f
    if ((kind === 0x80 || kind === 0x90) && length >= 3) {
      if (kind === 0x90 && data2 > 0) this.noteOn(data1 & 0x7f, data2 & 0x7f, channel)
      else this.noteOff(data1 & 0x7f, channel)
    } else if (kind === 0xe0 && length >= 3) {
      this.pitchBend(channel, (data1 & 0x7f) | ((data2 & 0x7f) << 7))
    } else if (kind === 0xb0 && length >= 3) {
      const cc = data1 & 0x7f
      const value = data2 & 0x7f
      if (cc === 120 || cc === 123) this.allNotesOff()
      else if (cc === 101) this.rpnMsb[channel] = value
      else if (cc === 100) this.rpnLsb[channel] = value
      else if (cc === 6 && this.rpnMsb[channel] === 0 && this.rpnLsb[channel] === 0 && value >= 1) {
        // RPN 0: pitch bend range in semitones, per channel.
        this.bendRange[channel] = Math.min(value, 48)
        this.pitchBend(channel, this.bendValue[channel])
      }
    }
  }

  /** Move this block's events to `due`, in frame order, and compact the rest of the queue. */
  takeDue (blockEnd) {
    let dueCount = 0
    for (let i = 0; i < this.queueCount; i++) {
      if (this.queueFrames[i] < blockEnd) {
        // Insertion sort, stable: events usually arrive in order, so this is a single comparison each.
        let at = dueCount
        while (at > 0 && this.queueFrames[this.due[at - 1]] > this.queueFrames[i]) { this.due[at] = this.due[at - 1]; at -= 1 }
        this.due[at] = i
        dueCount += 1
      }
    }
    return dueCount
  }

  process (inputs, outputs, parameters) {
    const output = outputs[0]
    if (!output || output.length === 0) return true
    const frames = output[0].length

    if (!this.ready) {
      for (const channel of output) channel.fill(0)
      return true
    }

    this.readParameters(parameters)
    const blockStart = currentFrame
    const dueCount = this.takeDue(blockStart + frames)
    const toneCutoff = Math.min(this.sampleRate * 0.42, Math.max(40, toneCutoffHz(this.values.tone)))
    const toneCoef = 1 - Math.exp((-TWO_PI * toneCutoff) / this.sampleRate)
    const rc = 1 / (TWO_PI * TRANSIENT_HIGHPASS_HZ)
    const hpAlpha = rc / (rc + 1 / this.sampleRate)
    const gain = this.values.level * OUTPUT_GAIN
    const left = output[0]
    const right = output.length > 1 ? output[1] : null
    const sum = this.sum

    let next = 0
    for (let i = 0; i < frames; i++) {
      // An event whose frame has passed is applied now rather than dropped (messaging.md 1.4).
      while (next < dueCount && this.queueFrames[this.due[next]] <= blockStart + i) {
        const q = this.due[next]
        this.applyMidi(this.queueBytes[q * 3], this.queueBytes[q * 3 + 1], this.queueBytes[q * 3 + 2], this.queueLengths[q])
        next += 1
      }
      sum[0] = 0
      sum[1] = 0
      for (const voice of this.voices) if (voice.active) voice.process(sum, toneCoef, hpAlpha)
      let l = sum[0] * gain
      let r = sum[1] * gain

      // A DC blocker on the mono sum, then the same soft limit the VST3 has.
      const mono = (l + r) * 0.5
      const dc = mono - this.dcX + 0.995 * this.dcY
      this.dcX = mono
      this.dcY = dc
      l -= mono - dc
      r -= mono - dc
      l = Number.isFinite(l) ? Math.tanh(Math.min(4, Math.max(-4, l))) : 0
      r = Number.isFinite(r) ? Math.tanh(Math.min(4, Math.max(-4, r))) : 0
      if (right) { left[i] = l; right[i] = r } else left[i] = (l + r) * 0.5
    }

    // Anything not due stays queued. Compact once, after the block, so the due indices stayed valid.
    let kept = 0
    for (let i = 0; i < this.queueCount; i++) {
      if (this.queueFrames[i] < blockStart + frames) continue
      this.queueFrames[kept] = this.queueFrames[i]
      this.queueLengths[kept] = this.queueLengths[i]
      this.queueBytes[kept * 3] = this.queueBytes[i * 3]
      this.queueBytes[kept * 3 + 1] = this.queueBytes[i * 3 + 1]
      this.queueBytes[kept * 3 + 2] = this.queueBytes[i * 3 + 2]
      kept += 1
    }
    this.queueCount = kept
    return true
  }
}

registerProcessor('moka', MokaProcessor)
