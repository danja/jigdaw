// plugins/conductor/conductor-processor.js
//
// The AudioWorklet processor for Conductor, and the whole plugin: there is no
// WebAssembly module (Dice, MIDI Filter).
//
// Ported from the Downspout VST3 of the same name. It cuts the transport into
// sections of whole bars, intro, development, break, reprise and coda, either as
// a form set by its step ports or by weighted random choice, and at each section boundary sends
// one note (base note plus the section number, held until the next section) and
// five CCs: scene, density, energy, mutation and reset. Beyond the VST3, the form, each
// section's length limits and its density, energy and mutation values are ports; their
// defaults are the VST3's. It never touches the
// host graph; whatever listens to those CCs on its channel does the arranging.
//
// The schedule is a pure function of the seed and the bar, rebuilt from bar 0 on
// a start, a seek or a loop, so any position gives the same section after any
// route to it. Boundaries are placed by the transport's beat position, never by
// counting blocks (contract section 7), and by stream position (CLAUDE.md).
//
// The random draw is the VST3's 64-bit mix, held as pairs of 32-bit halves because
// 64-bit integers in JavaScript are BigInt and allocate (tests/host/mix64.test.js
// holds it to a BigInt reference). The same seed gives the same form every time.

const RENDER_QUANTUM = 128
const SECTION_COUNT = 5
// A schedule rebuilt from bar 0 is capped, as a guard against a transport position no form reaches.
const REBUILD_GUARD = 4096
const NOTE_VELOCITY = 100

// The parameter list is the only definition of ranges and defaults here. It is the same list
// as profile.json's ports, and tests/host/conductor.test.js fails if they disagree.
const PARAMS = [
  { name: 'mode', min: 0, max: 1, def: 0 },
  { name: 'min_bars', min: 1, max: 32, def: 4 },
  { name: 'max_bars', min: 1, max: 64, def: 12 },
  { name: 'intro_weight', min: 0, max: 1, def: 0.35, real: true },
  { name: 'develop_weight', min: 0, max: 1, def: 0.9, real: true },
  { name: 'break_weight', min: 0, max: 1, def: 0.4, real: true },
  { name: 'reprise_weight', min: 0, max: 1, def: 0.65, real: true },
  { name: 'coda_weight', min: 0, max: 1, def: 0.2, real: true },
  { name: 'base_note', min: 0, max: 119, def: 24 },
  { name: 'channel', min: 1, max: 16, def: 16 },
  { name: 'scene_cc', min: 0, max: 127, def: 20 },
  { name: 'density_cc', min: 0, max: 127, def: 21 },
  { name: 'energy_cc', min: 0, max: 127, def: 22 },
  { name: 'mutation_cc', min: 0, max: 127, def: 23 },
  { name: 'reset_cc', min: 0, max: 127, def: 24 },
  { name: 'seed', min: 1, max: 65535, def: 2909 },
  { name: 'jump_to', min: 0, max: 5, def: 0 }
]
// Per section, in the order intro, development, break, reprise, coda. A section length of 0 uses the
// general Minimum bars or Maximum bars. The defaults reproduce the VST3's form and values.
const SECTION_NAMES = ['intro', 'develop', 'break', 'reprise', 'coda']
const DEFAULT_DENSITY = [30, 74, 18, 62, 20]
const DEFAULT_ENERGY = [28, 68, 20, 58, 42]
const DEFAULT_MUTATION = [12, 54, 38, 32, 8]
const DEFAULT_SCENE = [0, 32, 64, 96, 127]
const DEFAULT_RESET = [1, 0, 0, 0, 1] // whether the section sends CC 24 at 127, which restarts what listens
// The form: up to 12 steps, each a section from 1 to 5, ending at the first 0. The default is the
// VST3's fixed form, intro, development twice around a break, development, reprise, development, coda.
const FORM_STEPS = 12
const DEFAULT_FORM = [1, 2, 2, 3, 2, 4, 2, 5]
for (let k = 0; k < FORM_STEPS; k++) PARAMS.push({ name: `form_${k + 1}`, min: k === 0 ? 1 : 0, max: 5, def: DEFAULT_FORM[k] ?? 0 })
for (const name of SECTION_NAMES) PARAMS.push({ name: `${name}_min_bars`, min: 0, max: 32, def: 0 }, { name: `${name}_max_bars`, min: 0, max: 64, def: 0 })
SECTION_NAMES.forEach((name, i) => {
  PARAMS.push({ name: `${name}_density`, min: 0, max: 127, def: DEFAULT_DENSITY[i] })
  PARAMS.push({ name: `${name}_energy`, min: 0, max: 127, def: DEFAULT_ENERGY[i] })
  PARAMS.push({ name: `${name}_mutation`, min: 0, max: 127, def: DEFAULT_MUTATION[i] })
  PARAMS.push({ name: `${name}_scene`, min: 0, max: 127, def: DEFAULT_SCENE[i] })
  PARAMS.push({ name: `${name}_reset`, min: 0, max: 1, def: DEFAULT_RESET[i] })
})
const P = Object.freeze(Object.fromEntries(PARAMS.map((p, i) => [p.name, i])))
const WEIGHTS = [P.intro_weight, P.develop_weight, P.break_weight, P.reprise_weight, P.coda_weight]
const CC_PORTS = [P.scene_cc, P.density_cc, P.energy_cc, P.mutation_cc, P.reset_cc]
const MIN_BARS = SECTION_NAMES.map(n => P[`${n}_min_bars`])
const MAX_BARS = SECTION_NAMES.map(n => P[`${n}_max_bars`])
const FORM_PORTS = Array.from({ length: FORM_STEPS }, (_, k) => P[`form_${k + 1}`])
// What each section sends, in the order of CC_PORTS.
const SECTION_CC_PORTS = SECTION_NAMES.map(n => [P[`${n}_scene`], P[`${n}_density`], P[`${n}_energy`], P[`${n}_mutation`], P[`${n}_reset`]])

// The VST3's 64-bit mix (splitmix64 finaliser) as pairs of 32-bit halves. 64-bit integers are
// BigInt in JavaScript and allocate, so the halves are held in MIX_HI and MIX_LO instead.
let MIX_HI = 0
let MIX_LO = 0

/** The low 64 bits of (hi, lo) times (bHi, bLo), left in MIX_HI and MIX_LO. */
function mul64 (hi, lo, bHi, bLo) {
  const a0 = lo & 0xffff
  const a1 = lo >>> 16
  const b0 = bLo & 0xffff
  const b1 = bLo >>> 16
  const p00 = a0 * b0
  const mid = a0 * b1 + a1 * b0 + (p00 >>> 16)
  MIX_LO = (((mid & 0xffff) << 16) | (p00 & 0xffff)) >>> 0
  MIX_HI = (a1 * b1 + Math.floor(mid / 65536) + Math.imul(hi, bLo) + Math.imul(lo, bHi)) >>> 0
}

/** mix64 of the 64-bit value (hi, lo), left in MIX_HI and MIX_LO. */
function mix64 (hi, lo) {
  const sum = lo + 0x7f4a7c15
  hi = (hi + 0x9e3779b9 + (sum > 0xffffffff ? 1 : 0)) >>> 0
  lo = sum >>> 0
  mul64(hi ^ (hi >>> 30), lo ^ ((lo >>> 30) | (hi << 2)), 0xbf58476d, 0x1ce4e5b9)
  hi = MIX_HI
  lo = MIX_LO
  mul64(hi ^ (hi >>> 27), lo ^ ((lo >>> 27) | (hi << 5)), 0x94d049bb, 0x133111eb)
  MIX_LO = (MIX_LO ^ ((MIX_LO >>> 31) | (MIX_HI << 1))) >>> 0
  MIX_HI = (MIX_HI ^ (MIX_HI >>> 31)) >>> 0
}

/** The 64-bit draw mix64(seed ^ mix64(index)), the seed being a small integer, left in MIX_HI and MIX_LO. */
function draw (seed, index) {
  mix64(Math.floor(index / 4294967296) >>> 0, index >>> 0)
  mix64(MIX_HI, (seed ^ MIX_LO) >>> 0)
}

/** A unit-interval draw fixed by (seed, index), as the VST3 makes it: the top 24 bits of the 64-bit draw. */
function randomUnit (seed, index) {
  draw(seed, index)
  return (MIX_HI >>> 8) / 16777216
}

/** An integer in [min, max], the 64-bit draw taken modulo the span (the halves are reduced separately, so no 64-bit integer is formed). */
function randomInt (seed, index, min, max) {
  if (max <= min) return min
  const span = max - min + 1
  draw(seed, index)
  return min + (((MIX_HI % span) * (4294967296 % span)) + (MIX_LO % span)) % span
}

class ConductorProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors () {
    return PARAMS.map(p => ({ name: p.name, defaultValue: p.def, minValue: p.min, maxValue: p.max, automationRate: 'k-rate' }))
  }

  constructor (options) {
    super(options)
    this.ready = false
    this.transport = null
    this.values = new Float64Array(PARAMS.length)
    this.weights = new Float64Array(SECTION_COUNT)
    this.lastJump = -1 // the first value seen is adopted, so a reopened session does not jump again
    this.reset()
    this.port.onmessage = event => this.handle(event.data)
  }

  reset () {
    this.wasPlaying = false
    this.havePosition = false
    this.previousEnd = 0
    this.section = -1
    this.nextSectionBar = 0
    this.sectionSerial = 0
    this.activeNote = -1
    this.pendingSection = -1
  }

  handle (message) {
    switch (message?.type) {
      case 'init':
        this.ready = true
        this.port.postMessage({ type: 'ready', latencyFrames: 0, tailFrames: null })
        return
      case 'transport': this.transport = message; return
      case 'dispose': this.ready = false; return
      default:
    }
  }

  readParameters (parameters) {
    for (let i = 0; i < PARAMS.length; i++) {
      const spec = PARAMS[i]
      const raw = parameters[spec.name][0]
      const v = Math.min(spec.max, Math.max(spec.min, Number.isFinite(raw) ? raw : spec.def))
      this.values[i] = spec.real ? v : Math.round(v)
    }
  }

  chooseSection (previous, serial) {
    const v = this.values
    if (v[P.mode] === 0) return v[FORM_PORTS[serial % this.formLength()]] - 1
    const w = this.weights
    let total = 0
    for (let i = 0; i < SECTION_COUNT; i++) { w[i] = v[WEIGHTS[i]]; if (i === previous) w[i] *= 0.18 }
    // Having just played an intro or a break leans toward development or reprise.
    if (previous === 0) w[1] += 0.5
    if (previous === 2) w[3] += 0.45
    for (let i = 0; i < SECTION_COUNT; i++) total += w[i]
    let target = randomUnit(v[P.seed], serial) * Math.max(0.001, total)
    for (let i = 0; i < SECTION_COUNT; i++) { target -= w[i]; if (target <= 0) return i }
    return 1
  }

  /** Steps in the form: up to the first 0, and at least one since the first step cannot be 0. */
  formLength () {
    const v = this.values
    let n = 1
    while (n < FORM_STEPS && v[FORM_PORTS[n]] > 0) n++
    return n
  }

  /** Bars in the section just chosen, between its own limits where it has them and the general ones where it does not. */
  duration (serial) {
    const v = this.values
    const own = v[MIN_BARS[this.section]]
    const min = own > 0 ? own : v[P.min_bars]
    const ownMax = v[MAX_BARS[this.section]]
    return randomInt(v[P.seed], serial + 901, min, Math.max(min, ownMax > 0 ? ownMax : v[P.max_bars]))
  }

  /** The value of the i-th CC for a section, in the order of CC_PORTS. */
  ccValue (section, i) {
    const value = this.values[SECTION_CC_PORTS[section][i]]
    return i === 4 ? (value > 0 ? 127 : 0) : value
  }

  /** Walk the schedule from bar 0 until the section holding `targetBar` is current. */
  rebuild (targetBar) {
    this.section = -1
    this.nextSectionBar = 0
    this.sectionSerial = 0
    for (let guard = 0; guard < REBUILD_GUARD && this.nextSectionBar <= targetBar; guard++) {
      this.section = this.chooseSection(this.section, this.sectionSerial)
      this.nextSectionBar += this.duration(this.sectionSerial)
      this.sectionSerial += 1
    }
  }

  release (frame, out) {
    if (this.activeNote < 0) return
    out.push({ frame, bytes: Uint8Array.of(0x80 | (this.values[P.channel] - 1), this.activeNote, 0) })
    this.activeNote = -1
  }

  /** The section's note, then its five CCs, all at one frame; the previous note is released first. */
  emitSection (frame, out) {
    const v = this.values
    const channel = v[P.channel] - 1
    this.release(frame, out)
    this.activeNote = Math.min(127, v[P.base_note] + this.section)
    out.push({ frame, bytes: Uint8Array.of(0x90 | channel, this.activeNote, NOTE_VELOCITY) })
    for (let i = 0; i < CC_PORTS.length; i++) {
      out.push({ frame, bytes: Uint8Array.of(0xb0 | channel, v[CC_PORTS[i]], this.ccValue(this.section, i)) })
    }
  }

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
    this.readParameters(parameters)
    const v = this.values

    // A jump request: the section the next boundary starts, in place of the scheduled one. It acts when
    // the port changes to a section (1 to 5), so a saved session does not jump again on reopening.
    if (this.lastJump === -1) this.lastJump = v[P.jump_to]
    else if (v[P.jump_to] !== this.lastJump) {
      this.pendingSection = v[P.jump_to] > 0 ? v[P.jump_to] - 1 : -1
      this.lastJump = v[P.jump_to]
    }

    const out = []
    const clock = this.blockClock(blockStart)
    if (!clock) {
      this.release(blockStart, out)
      this.wasPlaying = false
      this.havePosition = false
    } else {
      const { start, qpf, barQ } = clock
      const end = start + RENDER_QUANTUM * qpf
      const startBar = Math.floor((start + 1e-8) / barQ)
      const jumped = !this.wasPlaying ||
        (this.havePosition && (start + 1e-5 < this.previousEnd || Math.abs(start - this.previousEnd) > 0.05))
      if (jumped) {
        this.release(blockStart, out)
        this.rebuild(startBar)
        this.emitSection(blockStart, out)
      }
      while (this.nextSectionBar * barQ < end - 1e-8) {
        const boundary = this.nextSectionBar * barQ
        if (boundary < start - 1e-8) break
        if (this.pendingSection >= 0) {
          this.section = this.pendingSection
          this.pendingSection = -1
        } else {
          this.section = this.chooseSection(this.section, this.sectionSerial)
        }
        this.nextSectionBar += this.duration(this.sectionSerial)
        this.sectionSerial += 1
        this.emitSection(blockStart + this.frameAt(boundary, start, qpf), out)
      }
      this.wasPlaying = true
      this.havePosition = true
      this.previousEnd = end
    }
    if (out.length > 0) this.port.postMessage({ type: 'events', events: out })
    return true
  }
}

registerProcessor('conductor', ConductorProcessor)
