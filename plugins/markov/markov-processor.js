// plugins/markov/markov-processor.js
//
// The AudioWorklet processor for Markov, and the whole plugin: there is no
// WebAssembly module (Dice, MIDI Filter).
//
// Ported from the Downspout VST3 of the same name. The melody is a random walk
// over the twelve pitch classes counted from the Root note. A 12 by 12
// transition matrix says, for the note just played, how likely each note is to
// follow; a style fills it, Randomise rolls it, and with Learn on it is also
// counted from a melodic line arriving on the MIDI input. Each phrase restarts
// the walk from the tonic, seeded by (Seed, a re-roll counter, phrase number),
// so note k of phrase p depends only on those and the model, and any position
// renders the same notes after a loop or a jump.
//
// The model (the drawn matrix and the learned counts) is the one thing
// parameters do not carry, so it is this plugin's state (contract 8.2), in the
// VST3's own text format. Everything else is a parameter.
//
// Timing comes from the transport's beat position, never from counting blocks
// (contract section 7). process() allocates nothing beyond the outgoing batch.
//
// One departure from the VST3: its random draw is a 64-bit mix, and this one is
// a 32-bit mix, because 64-bit integers in JavaScript are BigInt and allocate.
// The same seed gives the same melody every time, but not the same melody as
// the VST3 gave.

const QUEUE_CAPACITY = 256
const RENDER_QUANTUM = 128
const STATES = 12
const CELLS = STATES * STATES
const MAX_WEIGHT = 8

// The parameter list is the only definition of ranges and defaults here. It is the same list
// as profile.json's ports, and tests/host/markov.test.js fails if they disagree.
const PARAMS = [
  { name: 'root', min: 0, max: 127, def: 60 },
  { name: 'scale', min: 0, max: 23, def: 1 },
  { name: 'low', min: 12, max: 96, def: 48 },
  { name: 'octaves', min: 1, max: 4, def: 2 },
  { name: 'order', min: 1, max: 2, def: 1 },
  { name: 'chaos', min: 0, max: 1, def: 0.5, real: true },
  { name: 'grid', min: 0, max: 11, def: 2 },
  { name: 'gate', min: 0.1, max: 1, def: 0.7, real: true },
  { name: 'density', min: 0, max: 1, def: 0.85, real: true },
  { name: 'velocity', min: 1, max: 127, def: 90 },
  { name: 'channel', min: 1, max: 16, def: 1 },
  { name: 'seed', min: 1, max: 65535, def: 1 },
  { name: 'phrase_bars', min: 1, max: 8, def: 2 },
  { name: 'style', min: 0, max: 7, def: 0 },
  { name: 'randomise', min: 0, max: 1, def: 0 },
  { name: 'learn', min: 0, max: 1, def: 0 },
  { name: 'learn_channel', min: 0, max: 16, def: 0 },
  { name: 'learned_mix', min: 0, max: 1, def: 0, real: true },
  { name: 'clear_learned', min: 0, max: 1, def: 0 },
  { name: 'conductor_ch', min: 0, max: 16, def: 0 }
]
const P = Object.freeze(Object.fromEntries(PARAMS.map((p, i) => [p.name, i])))

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
]
const SCALE_MASKS = Uint16Array.from(INTERVALS.map(list => list.reduce((mask, i) => mask | (1 << i), 0)))

// Grid divisions in quarter notes; the last entry (one bar) comes from the time signature.
const GRID_QUARTERS = [0.125, 1 / 6, 0.25, 0.375, 1 / 3, 0.5, 0.75, 2 / 3, 1, 1.5, 2]
const GRID_BAR = 11

// Weight of a move of `interval` semitones up (mod 12), for the transposition-invariant styles.
const STYLE_WEIGHTS = [
  [2, 7, 8, 4, 3, 2, 1, 2, 3, 4, 8, 7], // Stepwise: seconds, with some thirds
  [1, 1, 2, 7, 8, 3, 1, 8, 7, 3, 2, 1], // Triadic: thirds and fifths
  [1, 1, 3, 2, 2, 8, 1, 8, 2, 2, 3, 1], // Fifths: fourths and fifths
  [2, 1, 7, 6, 3, 5, 1, 5, 3, 6, 7, 1], // Pentatonic: seconds, minor thirds, fourths
  [3, 2, 4, 8, 3, 6, 6, 5, 2, 4, 8, 1], // Blues: minor thirds, flat fifths, flat sevenths
  [1, 8, 4, 2, 1, 1, 1, 1, 1, 2, 4, 8], // Chromatic: semitone crawl
  [2, 7, 8, 4, 3, 2, 1, 2, 3, 4, 8, 7], // Tonic pull: stepwise, then pulled toward the tonic below
  [4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4] // Uniform
]
const TONIC_PULL = 6
const TONIC_BONUS = [3, 0, 1, 0, 1, 0, 0, 2, 0, 0, 0, 0]

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

const clampWeight = w => Math.min(MAX_WEIGHT, Math.max(0, w))

function loadStyle (base, style) {
  const weights = STYLE_WEIGHTS[style]
  for (let from = 0; from < STATES; from++) {
    for (let to = 0; to < STATES; to++) {
      let w = weights[(to - from + 12) % 12]
      if (style === TONIC_PULL) {
        // Stepwise motion, plus a lean toward the tonic, the fifth and the third, and the classic
        // resolutions (leading tone and fifth to the tonic, fourth to the third).
        w += TONIC_BONUS[to]
        if (to === 0 && (from === 11 || from === 7 || from === 2)) w = MAX_WEIGHT
        if (to === 4 && from === 5) w = MAX_WEIGHT - 1
      }
      base[from * STATES + to] = clampWeight(w)
    }
  }
}

function randomiseBase (base, seed) {
  for (let i = 0; i < CELLS; i++) {
    // About a third of the moves are never taken, which gives the matrix some character.
    base[i] = randomUnit(seed, i * 2) < 0.34 ? 0 : clampWeight(1 + Math.floor(randomUnit(seed, i * 2 + 1) * MAX_WEIGHT))
  }
}

/** Counts saturate by halving every cell, so the table keeps its proportions. */
function bumpCount (table, index) {
  if (table[index] === 0xffff) for (let i = 0; i < table.length; i++) table[i] >>= 1
  table[index] += 1
}

function serializeModel (model) {
  const sparse = table => {
    const parts = []
    for (let i = 0; i < table.length; i++) if (table[i] !== 0) parts.push(`${i}:${table[i]}`)
    return parts.join(',')
  }
  return `version=1\nbase=${Array.from(model.base).join('')}\nl1=${sparse(model.learned1)}\nl2=${sparse(model.learned2)}\n`
}

/** The VST3's state text back into a model, or null for anything malformed. */
function deserializeModel (text) {
  if (typeof text !== 'string') return null
  const model = newModel()
  let sawVersion = false
  let sawBase = false
  const parseSparse = (value, table) => {
    if (value === '') return true
    for (const item of value.split(',')) {
      const match = /^(\d+):(\d+)$/.exec(item)
      if (!match) return false
      const index = Number(match[1])
      const count = Number(match[2])
      if (index >= table.length || count > 0xffff) return false
      table[index] = count
    }
    return true
  }
  for (const line of text.split('\n')) {
    if (line === '') continue
    const equals = line.indexOf('=')
    if (equals < 0) return null
    const key = line.slice(0, equals)
    const value = line.slice(equals + 1)
    if (key === 'version') {
      if (value !== '1') return null
      sawVersion = true
    } else if (key === 'base') {
      if (value.length !== CELLS || !/^[0-8]+$/.test(value)) return null
      for (let i = 0; i < CELLS; i++) model.base[i] = value.charCodeAt(i) - 48
      sawBase = true
    } else if (key === 'l1') {
      if (!parseSparse(value, model.learned1)) return null
    } else if (key === 'l2') {
      if (!parseSparse(value, model.learned2)) return null
    } else return null
  }
  if (!sawVersion || !sawBase) return null
  model.learnedTotal = model.learned1.reduce((sum, c) => sum + c, 0)
  return model
}

function newModel () {
  return {
    base: new Uint8Array(CELLS),
    learned1: new Uint16Array(CELLS),
    learned2: new Uint16Array(CELLS * STATES),
    learnedTotal: 0
  }
}

class MarkovProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors () {
    return PARAMS.map(p => ({ name: p.name, defaultValue: p.def, minValue: p.min, maxValue: p.max, automationRate: 'k-rate' }))
  }

  constructor (options) {
    super(options)
    this.ready = false
    this.queueFrames = new Float64Array(QUEUE_CAPACITY)
    this.queueBytes = new Uint8Array(QUEUE_CAPACITY * 3)
    this.queueLengths = new Uint8Array(QUEUE_CAPACITY)
    this.queueCount = 0
    this.transport = null

    this.model = newModel()
    loadStyle(this.model.base, PARAMS[P.style].def)
    // The edge-triggered ports adopt the first value they see rather than acting on it, so a
    // restored session does not re-roll or wipe a model that arrived with it. -1 means "adopt".
    this.appliedStyle = PARAMS[P.style].def
    this.previousRandomise = -1
    this.previousClear = -1

    this.seen = new Float64Array(PARAMS.length).fill(NaN)
    this.override = new Float64Array(PARAMS.length).fill(NaN)
    this.values = new Float64Array(PARAMS.length)

    this.matrix = new Float64Array(CELLS)
    this.row = new Float64Array(STATES)
    this.second = new Float64Array(STATES)
    this.walk = { state: 0, note: 60 }

    this.learnPrevious1 = -1
    this.learnPrevious2 = -1
    this.salt = 0
    this.resetPlayback()
    this.port.onmessage = event => this.handle(event.data)
  }

  resetPlayback () {
    this.activeNote = -1
    this.activeChannel = 1
    this.offQuarter = 0
    this.lastStep = -1
    this.havePosition = false
    this.previousEnd = 0
    this.lastBar = -1
    this.restartPending = false
    this.restartStep = 0
  }

  handle (message) {
    switch (message?.type) {
      case 'init': return this.onInit(message)
      case 'events': if (this.ready) this.enqueue(message.events); return
      case 'transport': this.transport = message; return
      case 'stateRequest':
        if (this.ready) this.port.postMessage({ type: 'state', token: message.token, state: { model: serializeModel(this.model) } })
        return
      case 'dispose': this.ready = false; return
      default:
    }
  }

  onInit (message) {
    if (message.state?.model !== undefined) {
      const restored = deserializeModel(message.state.model)
      if (restored) {
        this.model = restored
        this.appliedStyle = -1
      } else {
        // A save from an incompatible version restores as the default matrix, reported, rather
        // than as a broken one.
        this.port.postMessage({ type: 'error', phase: 'state', fatal: false, message: 'saved model is not usable; starting from the default matrix' })
      }
    }
    this.ready = true
    this.port.postMessage({ type: 'ready', latencyFrames: 0, tailFrames: null })
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

  setFromCc (index, value) {
    const spec = PARAMS[index]
    const v = spec.min + (Math.min(value, 127) / 127) * (spec.max - spec.min)
    this.override[index] = v
    // This block's parameters were read before its MIDI was applied; the CC is in force from this block on.
    this.values[index] = spec.real ? v : Math.round(v)
  }

  /** The three ports that act on the model when they change, not continuously. */
  applyModelEdits () {
    const v = this.values
    if (this.appliedStyle === -1) this.appliedStyle = v[P.style]
    else if (v[P.style] !== this.appliedStyle) {
      this.appliedStyle = v[P.style]
      loadStyle(this.model.base, v[P.style]) // the learned data is kept
    }
    if (this.previousRandomise === -1) this.previousRandomise = v[P.randomise]
    else {
      if (v[P.randomise] === 1 && this.previousRandomise === 0) randomiseBase(this.model.base, v[P.seed])
      this.previousRandomise = v[P.randomise]
    }
    if (this.previousClear === -1) this.previousClear = v[P.clear_learned]
    else {
      if (v[P.clear_learned] === 1 && this.previousClear === 0) {
        this.model.learned1.fill(0)
        this.model.learned2.fill(0)
        this.model.learnedTotal = 0
        this.learnPrevious1 = this.learnPrevious2 = -1
      }
      this.previousClear = v[P.clear_learned]
    }
  }

  /** Apply the block's incoming MIDI: learning, and the Conductor CCs. */
  handleMidi (blockEnd) {
    const v = this.values
    const learning = v[P.learn] === 1
    if (!learning) this.learnPrevious1 = this.learnPrevious2 = -1 // turning Learn off forgets the line
    const rootPc = ((v[P.root] % 12) + 12) % 12
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
      if (this.queueLengths[i] < 3) continue
      const kind = this.queueBytes[i * 3] & 0xf0
      const channel = (this.queueBytes[i * 3] & 0x0f) + 1
      const d1 = this.queueBytes[i * 3 + 1] & 0x7f
      const d2 = this.queueBytes[i * 3 + 2] & 0x7f
      const learnChannel = v[P.learn_channel]
      if (kind === 0x90 && d2 > 0 && learning && (learnChannel === 0 || channel === learnChannel)) {
        const state = (((d1 - rootPc) % 12) + 12) % 12
        if (this.learnPrevious1 >= 0) {
          bumpCount(this.model.learned1, this.learnPrevious1 * STATES + state)
          if (this.learnPrevious2 >= 0) {
            bumpCount(this.model.learned2, (this.learnPrevious2 * STATES + this.learnPrevious1) * STATES + state)
          }
          this.model.learnedTotal += 1
        }
        this.learnPrevious2 = this.learnPrevious1
        this.learnPrevious1 = state
      } else if (kind === 0xb0 && v[P.conductor_ch] > 0 && channel === v[P.conductor_ch]) {
        if (d1 === 21) this.setFromCc(P.density, d2)
        else if (d1 === 22) this.setFromCc(P.velocity, d2)
        else if (d1 === 23) this.setFromCc(P.chaos, d2)
        else if (d1 === 24 && d2 === 127) this.restartPending = true
      }
    }
    this.queueCount = kept
  }

  /**
   * The weights actually used, in place: the learned data blended in, notes outside the scale
   * masked out (an empty row falls back to every allowed note), and Chaos applied as an exponent.
   * Below 0.5 it sharpens the favourites, above it flattens them; 0.5 leaves the weights as drawn.
   */
  computeMatrix () {
    const v = this.values
    const mask = SCALE_MASKS[v[P.scale]]
    const mix = v[P.learned_mix]
    const exponent = Math.pow(2, 1 - 2 * v[P.chaos])
    const { base, learned1 } = this.model
    const row = this.row
    for (let from = 0; from < STATES; from++) {
      let maxCount = 0
      for (let to = 0; to < STATES; to++) maxCount = Math.max(maxCount, learned1[from * STATES + to])
      let total = 0
      for (let to = 0; to < STATES; to++) {
        let weight = base[from * STATES + to]
        if (mix > 0 && maxCount > 0) {
          weight = (1 - mix) * weight + mix * (MAX_WEIGHT * learned1[from * STATES + to]) / maxCount
        }
        row[to] = (mask >> to) & 1 ? weight : 0
        total += row[to]
      }
      if (total <= 0) for (let to = 0; to < STATES; to++) row[to] = (mask >> to) & 1 ? 1 : 0
      for (let to = 0; to < STATES; to++) this.matrix[from * STATES + to] = row[to] > 0 ? Math.pow(row[to], exponent) : 0
    }
  }

  /** The weights for the next state given the last two; order 2 uses learned second-order data where it has any. */
  nextRow (previous2, previous1, row) {
    const v = this.values
    const from = Math.min(STATES - 1, Math.max(0, previous1))
    for (let to = 0; to < STATES; to++) row[to] = this.matrix[from * STATES + to]
    if (v[P.order] < 2 || previous2 < 0 || previous2 >= STATES) return
    const offset = (previous2 * STATES + from) * STATES
    const { learned2 } = this.model
    let maxCount = 0
    let total = 0
    for (let to = 0; to < STATES; to++) {
      maxCount = Math.max(maxCount, learned2[offset + to])
      total += learned2[offset + to]
    }
    if (total < 2) return
    const mask = SCALE_MASKS[v[P.scale]]
    const exponent = Math.pow(2, 1 - 2 * v[P.chaos])
    const second = this.second
    let sum = 0
    for (let to = 0; to < STATES; to++) {
      const c = learned2[offset + to]
      const w = (mask >> to) & 1 && c > 0 ? (MAX_WEIGHT * c) / maxCount : 0
      second[to] = w > 0 ? Math.pow(w, exponent) : 0
      sum += second[to]
    }
    if (sum > 0) for (let to = 0; to < STATES; to++) row[to] = second[to]
  }

  sampleRow (row, unit) {
    let total = 0
    for (let i = 0; i < STATES; i++) total += row[i]
    if (total <= 0) return 0
    const target = Math.min(0.999999, Math.max(0, unit)) * total
    let cumulative = 0
    let last = 0
    for (let i = 0; i < STATES; i++) {
      if (row[i] <= 0) continue
      cumulative += row[i]
      last = i
      if (target < cumulative) return i
    }
    return last
  }

  /** Note k of a phrase: a walk from the phrase start, depending only on (seed, phrase) and the model. */
  walkNote (seed, phrase, k) {
    const v = this.values
    const rootPc = ((v[P.root] % 12) + 12) % 12
    const low = v[P.low]
    const octaves = v[P.octaves]
    const high = low + octaves * 12 - 1
    const centre = low + octaves * 6
    const phraseSeed = mix32((seed + mix32((phrase + 1) >>> 0)) >>> 0)

    let previous2 = -1
    let previous1 = 0 // each phrase starts as if the last note was the tonic
    let previousNote = -1
    const result = this.walk
    for (let i = 0; i <= Math.max(0, k); i++) {
      this.nextRow(previous2, previous1, this.row)
      const state = this.sampleRow(this.row, randomUnit(phraseSeed, i))

      // Place it in the register: the octave nearest the last note, or the middle of the range for the first.
      const target = previousNote >= 0 ? previousNote : centre
      const absolutePc = (rootPc + state) % 12
      let best = -1
      let bestDistance = 1 << 20
      for (let n = low; n <= high; n++) {
        if (n % 12 !== absolutePc) continue
        const distance = Math.abs(n - target)
        if (distance < bestDistance) { best = n; bestDistance = distance }
      }
      if (best < 0) best = Math.min(127, Math.max(0, centre))

      result.state = state
      result.note = Math.min(127, Math.max(0, best))
      previous2 = previous1
      previous1 = state
      previousNote = result.note
    }
    return result
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
    this.applyModelEdits()
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
    } else {
      this.playBlock(clock, blockStart, out)
    }
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

    this.computeMatrix()
    const phraseSteps = Math.max(1, Math.round((v[P.phrase_bars] * barQ) / grid))
    const channel = v[P.channel]
    const baseVelocity = v[P.velocity]
    const density = v[P.density]
    const gate = v[P.gate]
    const seedParam = v[P.seed]

    while (boundary < end - 1e-8) {
      const frame = this.frameAt(boundary, start, qpf)
      this.release(blockStart + frame, out)

      // A Conductor reset waits for a bar line, then the phrase count starts again and the melody is re-rolled.
      const bar = Math.floor((boundary + 1e-8) / barQ)
      if (bar !== this.lastBar) {
        this.lastBar = bar
        if (this.restartPending) {
          this.restartStep = step
          this.salt += 1
          this.restartPending = false
        }
      }

      const relative = step - this.restartStep
      const phrase = floorDiv(relative, phraseSteps)
      const k = relative - phrase * phraseSteps
      const walkSeed = (seedParam * 7919 + this.salt * 104729) >>> 0
      const walk = this.walkNote(walkSeed, phrase, k)

      if (randomUnit((seedParam * 131 + this.salt) >>> 0, step) < density) {
        const onBeat = Math.abs(boundary - Math.round(boundary)) < 1e-6
        const velocity = Math.min(127, Math.max(1, baseVelocity + (k === 0 ? 12 : 0) + (onBeat ? 6 : 0)))
        out.push({ frame: blockStart + frame, bytes: Uint8Array.of(0x90 | (channel - 1), walk.note, velocity) })
        this.activeNote = walk.note
        this.activeChannel = channel
        this.offQuarter = boundary + grid * gate
        if (this.offQuarter < end) this.release(blockStart + this.frameAt(this.offQuarter, start, qpf), out)
      }

      this.lastStep = step
      step += 1
      boundary = step * grid
    }
    this.havePosition = true
    this.previousEnd = end
  }
}

registerProcessor('markov', MarkovProcessor)
