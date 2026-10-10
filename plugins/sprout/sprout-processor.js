// plugins/sprout/sprout-processor.js
//
// The AudioWorklet processor for Sprout, and the whole plugin: there is no
// WebAssembly module (Dice, MIDI Filter).
//
// Ported from the Downspout VST3 of the same name. An L-system grammar is
// rewritten for N generations, the string is read as a turtle, and the result
// plays as a monophonic, scale-quantised line locked to the host transport. The
// idea is Subsequence's (https://subsystem.co/subsequence); the grammars and the
// interpretation are original.
//
// Every expansion is built in the constructor, so process() only indexes into
// typed arrays. Timing is derived from the transport's beat position and never
// from counting blocks (contract section 7). A step is placed by the stream
// position of its boundary, in the block that contains it (CLAUDE.md).
//
// One departure from the VST3: its random draw is a 64-bit mix, and this one is
// a 32-bit mix, because 64-bit integers in JavaScript are BigInt and allocate.
// The same seed gives the same line every time, but not the same line as the
// VST3 gave.

const QUEUE_CAPACITY = 256
const RENDER_QUANTUM = 128
const MAX_GENERATION = 16
// An expansion longer than this is not used (about 8k bars at 1/16).
const MAX_SYMBOLS = 131072

// The parameter list is the only definition of ranges and defaults here. It is the
// same list as profile.json's ports, and tests/host/sprout.test.js fails if they disagree.
const PARAMS = [
  { name: 'preset', min: 0, max: 6, def: 0 },
  { name: 'generations', min: 1, max: MAX_GENERATION, def: 4 },
  { name: 'grow_bars', min: 0, max: 16, def: 0 },
  { name: 'scale', min: 0, max: 23, def: 1 },
  { name: 'root', min: 0, max: 127, def: 60 },
  { name: 'step_size', min: 1, max: 3, def: 1 },
  { name: 'range', min: 3, max: 28, def: 14 },
  { name: 'grid', min: 0, max: 11, def: 2 },
  { name: 'gate', min: 0.1, max: 1, def: 0.7, real: true },
  { name: 'probability', min: 0, max: 1, def: 1, real: true },
  { name: 'velocity', min: 1, max: 127, def: 90 },
  { name: 'channel', min: 1, max: 16, def: 1 },
  { name: 'seed', min: 1, max: 65535, def: 1 },
  { name: 'pitch_source', min: 0, max: 2, def: 0 },
  { name: 'input_channel', min: 0, max: 16, def: 0 },
  { name: 'cc_channel', min: 0, max: 16, def: 0 },
  { name: 'conductor_ch', min: 0, max: 16, def: 0 }
]
const P = Object.freeze(Object.fromEntries(PARAMS.map((p, i) => [p.name, i])))

const PITCH_HELD = 1
const PITCH_LATCHED = 2

// F and G are notes, f is a rest, + and - move the pitch, [ and ] branch. Every other
// symbol is a variable that expands but sounds nothing.
const PRESETS = [
  { axiom: 'X', rules: { F: 'FF', X: 'F+[[X]-X]-F[-FX]+X' } },
  { axiom: 'F', rules: { F: 'F+F-F-F+F' } },
  { axiom: 'FX', rules: { X: 'X+YF+', Y: '-FX-Y' } },
  { axiom: 'F-G-G', rules: { F: 'F-G+F+G-F', G: 'GG' } },
  { axiom: 'F', rules: { F: 'FfF', f: 'fff' } },
  { axiom: 'F', rules: { F: '+F--F+' } },
  { axiom: 'F', rules: { F: 'F[+F]F[-F]F' } }
]

// The canonical 24 of docs/scales.md: semitones above the root, append-only, 0 = chromatic.
const INTERVALS = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
  [0, 2, 4, 5, 7, 9, 11], [0, 2, 4, 5, 7, 9, 11], [0, 2, 3, 5, 7, 8, 10],
  [0, 2, 3, 5, 7, 8, 11], [0, 2, 3, 5, 7, 9, 11], [0, 2, 3, 5, 7, 9, 10],
  [0, 1, 3, 5, 7, 8, 10], [0, 2, 4, 6, 7, 9, 11], [0, 2, 4, 5, 7, 9, 10],
  [0, 1, 3, 5, 6, 8, 10], [0, 1, 4, 5, 7, 8, 10], [0, 1, 3, 5, 7, 9, 11],
  [0, 1, 3, 5, 7, 8, 11], [0, 2, 4, 7, 9], [0, 3, 5, 7, 10], [0, 3, 5, 6, 7, 10],
  [0, 2, 4, 6, 8, 10], [0, 1, 3, 4, 6, 8, 10], [0, 1, 3, 4, 6, 7, 9, 10],
  [0, 2, 3, 5, 6, 8, 9, 11], [0, 2, 4, 5, 7, 9, 10, 11], [0, 2, 4, 5, 7, 8, 9, 11],
  [0, 2, 3, 4, 5, 7, 9, 10]
].map(list => Uint8Array.from(list))

// Grid divisions in quarter notes; the last entry (one bar) comes from the time signature.
const GRID_QUARTERS = [0.125, 1 / 6, 0.25, 0.375, 1 / 3, 0.5, 0.75, 2 / 3, 1, 1.5, 2]
const GRID_BAR = 11

function floorDiv (a, b) { return Math.floor(a / b) }

/** A 32-bit integer finaliser, the stand-in for the VST3's 64-bit mix. */
function mix32 (x) {
  x = Math.imul(x ^ (x >>> 16), 0x7feb352d)
  x = Math.imul(x ^ (x >>> 15), 0x846ca68b)
  return (x ^ (x >>> 16)) >>> 0
}

/** A unit-interval draw fixed by (seed, index), in [0, 1). */
function randomUnit (seed, index) {
  const lo = index >>> 0
  const hi = Math.floor(index / 4294967296) | 0
  const h = mix32((seed ^ mix32(lo ^ mix32(hi + 0x9e3779b9))) >>> 0)
  return (h >>> 8) / 16777216
}

/** Fold a degree into [-range, +range] by reflection at the edges. */
function foldDegree (degree, range) {
  const r = Math.max(1, range)
  const period = 4 * r
  let u = (degree + r) % period
  if (u < 0) u += period
  if (u > 2 * r) u = period - u
  return u - r
}

function degreeToNote (scale, root, degree) {
  const intervals = INTERVALS[scale]
  const count = intervals.length
  let octave = Math.trunc(degree / count)
  let index = degree % count
  if (index < 0) { index += count; octave -= 1 }
  return Math.min(127, Math.max(0, root + 12 * octave + intervals[index]))
}

/** Generation in force during `bar` when growing: 1 at bar 0, one more every `growBars` bars. */
function generationAtBar (generations, growBars, bar) {
  const top = Math.min(MAX_GENERATION, Math.max(1, generations))
  if (growBars <= 0) return top
  return Math.min(1 + Math.floor(Math.max(0, bar) / growBars), top)
}

function expandOnce (rules, input) {
  let out = ''
  for (const c of input) out += rules[c] ?? c
  return out
}

/** The turtle reading of a symbol string, as parallel arrays so that playing it allocates nothing. */
function interpret (symbols, generation) {
  const unitList = new Int16Array(symbols.length)
  const depthList = new Uint8Array(symbols.length)
  const noteList = new Uint8Array(symbols.length)
  const stack = new Int16Array(33)
  let count = 0
  let unit = 0
  let depth = 0
  for (let i = 0; i < symbols.length; i++) {
    const c = symbols[i]
    if (c === 'F' || c === 'G' || c === 'f') {
      unitList[count] = unit
      depthList[count] = depth
      noteList[count] = c === 'f' ? 0 : 1
      count += 1
    } else if (c === '+') unit = Math.min(unit + 1, 4096)
    else if (c === '-') unit = Math.max(unit - 1, -4096)
    else if (c === '[') { if (depth < 32) stack[depth++] = unit }
    else if (c === ']') { if (depth > 0) unit = stack[--depth] }
  }
  return {
    generation,
    length: count,
    unit: unitList.slice(0, count),
    depth: depthList.slice(0, count),
    note: noteList.slice(0, count)
  }
}

/** For each preset, the sequences of every generation that fits, indexed by generation. */
function buildTables () {
  return PRESETS.map(preset => {
    const sequences = []
    let current = preset.axiom
    for (let g = 0; g <= MAX_GENERATION; g++) {
      if (g > 0) current = expandOnce(preset.rules, current)
      if (current.length > MAX_SYMBOLS) break
      sequences.push(interpret(current, g))
    }
    return sequences
  })
}

class SproutProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors () {
    return PARAMS.map(p => ({ name: p.name, defaultValue: p.def, minValue: p.min, maxValue: p.max, automationRate: 'k-rate' }))
  }

  constructor (options) {
    super(options)
    this.ready = false
    this.tables = buildTables()
    this.queueFrames = new Float64Array(QUEUE_CAPACITY)
    this.queueBytes = new Uint8Array(QUEUE_CAPACITY * 3)
    this.queueLengths = new Uint8Array(QUEUE_CAPACITY)
    this.queueCount = 0
    this.transport = null

    // The CC sets write over a parameter until the person moves that parameter again.
    this.seen = new Float64Array(PARAMS.length).fill(NaN)
    this.override = new Float64Array(PARAMS.length).fill(NaN)
    this.values = new Float64Array(PARAMS.length)

    this.held = new Uint8Array(128)
    this.down = new Uint8Array(128)
    this.heldCount = 0
    this.downCount = 0
    this.resetPlayback()
    this.port.onmessage = event => this.handle(event.data)
  }

  resetPlayback () {
    this.lastBar = -1
    this.latchedGenerations = 0
    this.lastGeneration = -1
    this.restartPending = false
    this.restartStep = 0
    this.activeNote = -1
    this.activeChannel = 1
    this.offQuarter = 0
    this.lastStep = -1
    this.havePosition = false
    this.previousEnd = 0
  }

  handle (message) {
    switch (message?.type) {
      case 'init':
        this.ready = true
        this.port.postMessage({ type: 'ready', latencyFrames: 0, tailFrames: null })
        return
      case 'events': if (this.ready) this.enqueue(message.events); return
      case 'transport': this.transport = message; return
      case 'dispose': this.ready = false; return
      default:
    }
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

  /** Read this block's parameters into `values`, letting a CC override stand until the parameter moves. */
  readParameters (parameters) {
    for (let i = 0; i < PARAMS.length; i++) {
      const spec = PARAMS[i]
      const raw = parameters[spec.name][0]
      if (raw !== this.seen[i]) { this.seen[i] = raw; this.override[i] = NaN }
      let v = Number.isNaN(this.override[i]) ? raw : this.override[i]
      v = Math.min(spec.max, Math.max(spec.min, Number.isFinite(v) ? v : spec.def))
      this.values[i] = spec.real ? v : Math.round(v)
    }
  }

  /** A CC value 0 to 127 laid linearly across a parameter's range. */
  setFromCc (index, value) {
    const spec = PARAMS[index]
    const v = spec.min + (Math.min(value, 127) / 127) * (spec.max - spec.min)
    this.override[index] = v
    // This block's parameters were read before its MIDI was applied; the CC is in force from this block on.
    this.values[index] = spec.real ? v : Math.round(v)
  }

  setHeld (note, on) {
    if (this.held[note] === (on ? 1 : 0)) return
    this.held[note] = on ? 1 : 0
    this.heldCount += on ? 1 : -1
  }

  setDown (note, on) {
    if (this.down[note] === (on ? 1 : 0)) return
    this.down[note] = on ? 1 : 0
    this.downCount += on ? 1 : -1
  }

  clearHeld () { this.held.fill(0); this.heldCount = 0 }

  noteEvent (note, on, latch) {
    if (on) {
      // The first note after every key was released starts a new latched chord.
      if (latch && this.downCount === 0) this.clearHeld()
      this.setDown(note, true)
      this.setHeld(note, true)
    } else {
      this.setDown(note, false)
      if (!latch) this.setHeld(note, false)
    }
  }

  /** Apply the block's incoming MIDI: held notes, and the two CC sets. Takes effect on the first step of the block or later. */
  handleMidi (blockEnd) {
    const v = this.values
    const latch = v[P.pitch_source] === PITCH_LATCHED
    if (!latch) {
      // Leaving Latched: the chord is just the keys that are down.
      for (let n = 0; n < 128; n++) this.held[n] = this.down[n]
      this.heldCount = this.downCount
    }
    let kept = 0
    for (let i = 0; i < this.queueCount; i++) {
      if (this.queueFrames[i] >= blockEnd) {
        this.queueFrames[kept] = this.queueFrames[i]
        this.queueLengths[kept] = this.queueLengths[i]
        this.queueBytes[kept * 3] = this.queueBytes[i * 3]
        this.queueBytes[kept * 3 + 1] = this.queueBytes[i * 3 + 1]
        this.queueBytes[kept * 3 + 2] = this.queueBytes[i * 3 + 2]
        kept += 1
        continue
      }
      if (this.queueLengths[i] < 2) continue
      const kind = this.queueBytes[i * 3] & 0xf0
      const channel = (this.queueBytes[i * 3] & 0x0f) + 1
      const d1 = this.queueBytes[i * 3 + 1] & 0x7f
      const d2 = this.queueLengths[i] > 2 ? this.queueBytes[i * 3 + 2] & 0x7f : 0
      const inputChannel = v[P.input_channel]
      const noteChannel = inputChannel === 0 || channel === inputChannel
      if (kind === 0x90 || kind === 0x80) {
        if (noteChannel) this.noteEvent(d1, kind === 0x90 && d2 > 0, latch)
      } else if (kind === 0xb0) {
        if (noteChannel && (d1 === 120 || d1 === 123)) {
          this.clearHeld()
          this.down.fill(0)
          this.downCount = 0
        }
        const ccChannel = v[P.cc_channel]
        if (ccChannel > 0 && channel === ccChannel) {
          // The Drift convention.
          if (d1 === 1) this.setFromCc(P.probability, d2)
          else if (d1 === 2) this.setFromCc(P.gate, d2)
          else if (d1 === 3) this.setFromCc(P.range, d2)
          else if (d1 === 4) this.setFromCc(P.generations, d2)
        }
        const conductor = v[P.conductor_ch]
        if (conductor > 0 && channel === conductor) {
          if (d1 === 21) this.setFromCc(P.probability, d2)
          else if (d1 === 22) this.setFromCc(P.velocity, d2)
          else if (d1 === 23) this.setFromCc(P.seed, d2)
          else if (d1 === 24 && d2 === 127) this.restartPending = true
        }
      }
    }
    this.queueCount = kept
  }

  /** The note for a degree when the pitch source is the held notes, or -1 with nothing held. */
  heldDegreeToNote (degree) {
    if (this.heldCount <= 0) return -1
    const n = this.heldCount
    // Degrees spread across the held tones, about seven per octave whatever the chord size.
    const tone = floorDiv(degree * n, 7)
    const octave = floorDiv(tone, n)
    const index = tone - octave * n
    let seen = 0
    for (let note = 0; note < 128; note++) {
      if (this.held[note] === 0) continue
      if (seen++ === index) return Math.min(127, Math.max(0, note + 12 * octave))
    }
    return -1
  }

  release (frame, out) {
    if (this.activeNote < 0) return
    out.push({ frame, bytes: Uint8Array.of(0x80 | (this.activeChannel - 1), this.activeNote, 0) })
    this.activeNote = -1
  }

  /**
   * The transport as the block sees it: the beat at the block start, quarter notes per frame,
   * and the bar length in quarters. Null when it is not rolling or reports no position.
   */
  blockClock (blockStart) {
    const t = this.transport
    if (!t?.playing || typeof t.beat !== 'number') return null
    const beatUnit = t.timeSignature?.beatUnit > 0 ? t.timeSignature.beatUnit : 4
    const perBar = t.timeSignature?.beatsPerBar > 0 ? t.timeSignature.beatsPerBar : 4
    const quartersPerBeat = 4 / beatUnit
    const beatsPerFrame = typeof t.beatsPerFrame === 'number' ? t.beatsPerFrame : t.tempo / (60 * sampleRate)
    if (!(beatsPerFrame > 0)) return null
    const beat = t.beat + (blockStart - (t.frame ?? blockStart)) * beatsPerFrame
    return {
      start: beat * quartersPerBeat,
      qpf: beatsPerFrame * quartersPerBeat,
      barQ: Math.max(0.25, perBar * quartersPerBeat)
    }
  }

  frameAt (quarter, start, qpf) {
    if (quarter <= start || qpf <= 0) return 0
    return Math.min(RENDER_QUANTUM - 1, Math.max(0, Math.round((quarter - start) / qpf)))
  }

  process (inputs, outputs, parameters) {
    // No audio output, so `outputs` is empty in a real worklet and the block is a render quantum.
    if (!this.ready) return true
    const blockStart = currentFrame
    const blockEnd = blockStart + RENDER_QUANTUM
    this.readParameters(parameters)
    this.handleMidi(blockEnd)

    const out = []
    const clock = this.blockClock(blockStart)
    if (!clock) {
      this.release(blockStart, out)
      this.havePosition = false
      this.lastStep = -1
      this.lastBar = -1
      this.restartPending = false
      this.restartStep = 0
      if (out.length > 0) this.port.postMessage({ type: 'events', events: out })
      return true
    }
    this.playBlock(clock, blockStart, out)
    if (out.length > 0) this.port.postMessage({ type: 'events', events: out })
    return true
  }

  playBlock (clock, blockStart, out) {
    const v = this.values
    const { start, qpf, barQ } = clock
    const end = start + RENDER_QUANTUM * qpf
    const gridIndex = v[P.grid]
    const grid = gridIndex === GRID_BAR ? barQ : GRID_QUARTERS[gridIndex]

    if (this.havePosition && (start + 1e-5 < this.previousEnd || Math.abs(start - this.previousEnd) > 0.05)) {
      this.release(blockStart, out)
      this.lastStep = -1
      this.lastBar = -1
      this.restartPending = false
      this.restartStep = 0
    }

    // A held note whose gate ends inside this block.
    if (this.activeNote >= 0 && this.offQuarter < end) {
      this.release(blockStart + this.frameAt(this.offQuarter, start, qpf), out)
    }

    let step = this.lastStep < 0 ? Math.ceil((start - 1e-8) / grid) : this.lastStep + 1
    let boundary = step * grid

    const sequences = this.tables[v[P.preset]]
    const growBars = v[P.grow_bars]
    const stepSize = v[P.step_size]
    const range = v[P.range]
    const heldPitch = v[P.pitch_source] >= PITCH_HELD
    const channel = v[P.channel]
    const baseVelocity = v[P.velocity]
    const probability = v[P.probability]
    const gate = v[P.gate]
    const seed = v[P.seed]

    while (boundary < end - 1e-8) {
      const frame = this.frameAt(boundary, start, qpf)
      this.release(blockStart + frame, out)

      const bar = Math.floor((boundary + 1e-8) / barQ)
      // Once per bar: take in the generation count, and honour a pending restart.
      let restartNow = false
      if (bar !== this.lastBar) {
        this.lastBar = bar
        this.latchedGenerations = v[P.generations]
        restartNow = this.restartPending
        this.restartPending = false
      }
      const usable = sequences[Math.min(sequences.length - 1, Math.max(0, Math.min(MAX_GENERATION, this.latchedGenerations)))].generation
      const wanted = generationAtBar(usable, growBars, bar)
      if (wanted !== this.lastGeneration) {
        this.lastGeneration = wanted
        this.restartStep = 0 // a new generation restarts the pattern by itself
      }
      const seq = sequences[Math.min(sequences.length - 1, wanted)]
      const total = seq.length
      if (total > 0) {
        // The pattern restarts each time a new generation begins.
        const startBar = growBars > 0 ? (wanted - 1) * growBars : 0
        const startStep = Math.round((startBar * barQ) / grid)
        if (restartNow) this.restartStep = step - startStep
        let pos = (step - startStep - this.restartStep) % total
        if (pos < 0) pos += total

        if (seq.note[pos] === 1 && randomUnit(seed, step) <= probability) {
          const degree = foldDegree(seq.unit[pos] * stepSize, range)
          const note = heldPitch ? this.heldDegreeToNote(degree) : degreeToNote(v[P.scale], v[P.root], degree)
          if (note >= 0) { // held-notes mode with nothing held is a rest
            const velocity = Math.min(127, Math.max(1, baseVelocity - seq.depth[pos] * 10 + (pos === 0 ? 10 : 0)))
            out.push({ frame: blockStart + frame, bytes: Uint8Array.of(0x90 | (channel - 1), note, velocity) })
            this.activeNote = note
            this.activeChannel = channel
            this.offQuarter = boundary + grid * gate
            if (this.offQuarter < end) this.release(blockStart + this.frameAt(this.offQuarter, start, qpf), out)
          }
        }
      }
      this.lastStep = step
      step += 1
      boundary = step * grid
    }
    this.havePosition = true
    this.previousEnd = end
  }
}

registerProcessor('sprout', SproutProcessor)
