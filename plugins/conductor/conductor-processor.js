// plugins/conductor/conductor-processor.js
//
// The AudioWorklet processor for Conductor, and the whole plugin: there is no
// WebAssembly module (Dice, MIDI Filter).
//
// Ported from the Downspout VST3 of the same name. It cuts the transport into
// sections of whole bars, intro, development, break, reprise and coda, either as
// a fixed form or by weighted random choice, and at each section boundary sends
// one note (base note plus the section number, held until the next section) and
// five CCs: scene, density, energy, mutation and reset. It never touches the
// host graph; whatever listens to those CCs on its channel does the arranging.
//
// The schedule is a pure function of the seed and the bar, rebuilt from bar 0 on
// a start, a seek or a loop, so any position gives the same section after any
// route to it. Boundaries are placed by the transport's beat position, never by
// counting blocks (contract section 7), and by stream position (CLAUDE.md).
//
// One departure from the VST3: its random draw is a 64-bit mix, and this one is
// a 32-bit mix, because 64-bit integers in JavaScript are BigInt and allocate.
// The same seed gives the same form every time, but not the same form as the
// VST3 gave.

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
const P = Object.freeze(Object.fromEntries(PARAMS.map((p, i) => [p.name, i])))
const WEIGHTS = [P.intro_weight, P.develop_weight, P.break_weight, P.reprise_weight, P.coda_weight]
const CC_PORTS = [P.scene_cc, P.density_cc, P.energy_cc, P.mutation_cc, P.reset_cc]

// The fixed form: intro, development twice around a break, development, reprise, development, coda.
const FORM = [0, 1, 1, 2, 1, 3, 1, 4]

// What each section sends: scene, density, energy, mutation, reset, in the order of CC_PORTS.
const SECTION_VALUES = [
  [0, 30, 28, 12, 127],
  [32, 74, 68, 54, 0],
  [64, 18, 20, 38, 0],
  [96, 62, 58, 32, 0],
  [127, 20, 42, 8, 127]
]

/** A 32-bit integer finaliser, the stand-in for the VST3's 64-bit mix. */
function mix32 (x) {
  x = Math.imul(x ^ (x >>> 16), 0x7feb352d)
  x = Math.imul(x ^ (x >>> 15), 0x846ca68b)
  return (x ^ (x >>> 16)) >>> 0
}

function randomUnit (seed, index) {
  return (mix32((seed ^ mix32(index >>> 0)) >>> 0) >>> 8) / 16777216
}

function randomInt (seed, index, min, max) {
  if (max <= min) return min
  return min + (mix32((seed ^ mix32(index >>> 0)) >>> 0) % (max - min + 1))
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
    if (v[P.mode] === 0) return FORM[serial % FORM.length]
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

  duration (serial) {
    const v = this.values
    return randomInt(v[P.seed], serial + 901, v[P.min_bars], Math.max(v[P.min_bars], v[P.max_bars]))
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
      out.push({ frame, bytes: Uint8Array.of(0xb0 | channel, v[CC_PORTS[i]], SECTION_VALUES[this.section][i]) })
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
