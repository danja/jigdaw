// src/model/MidiImport.js
//
// A MIDI file (read by src/model/MidiRead.js) as one changeset: a new track for each part, each with one MIDI clip from beat
// zero. One changeset, so one undo takes the whole import back.
//
// Time: a project beat is one beat of the time signature's note value (src/model/MidiFile.js). A fresh project, one with no
// MIDI clips yet, takes the file's tempo and time signature changes too, so the piece plays as it was written. A project that
// already has music keeps its own tempo and signature and only gains the notes, counted in its own beat unit; the result says
// which happened.

import { checkSignaturePoints } from './ArrangementOps.js'

const round = (value, places = 6) => Math.round(value * 10 ** places) / 10 ** places

/** Piecewise map from the file's ticks to project beats, whatever note value each region counts in. */
function beatMap (division, regions) {
  let base = 0
  for (let i = 0; i < regions.length; i++) {
    regions[i].baseBeats = base
    if (i + 1 < regions.length) base += (regions[i + 1].tick - regions[i].tick) / (division * 4 / regions[i].beatUnit)
  }
  const regionAt = tick => regions.findLast(r => r.tick <= tick) ?? regions[0]
  return { regionAt, beat: tick => { const r = regionAt(tick); return round(r.baseBeats + (tick - r.tick) / (division * 4 / r.beatUnit)) } }
}

/**
 * `{ changes, tracks, notes, appliedTiming, warnings }`. `applyTiming` is true or false to decide whether the file's tempo and
 * signature are taken, or null to take them when the project has no MIDI clips. Throws an Error when the file has no notes.
 */
export function describeMidiImport (project, midi, { applyTiming = null } = {}) {
  if (midi.tracks.length === 0) throw new Error('this MIDI file has no notes or controller events to import')
  const warnings = []
  const takeTiming = applyTiming ?? !project.clips.some(c => c.kind === 'midi')
  const changes = []
  let beatsPerBar = project.transport.beatsPerBar

  let map
  if (takeTiming) {
    const first = midi.signatures.find(s => s.tick === 0) ?? { tick: 0, numerator: 4, denominator: 4 }
    const regions = [{ tick: 0, beatsPerBar: first.numerator, beatUnit: first.denominator }]
    for (const s of midi.signatures) if (s.tick > 0) regions.push({ tick: s.tick, beatsPerBar: s.numerator, beatUnit: s.denominator })
    map = beatMap(midi.division, regions)
    beatsPerBar = regions[0].beatsPerBar
    const transport = { op: 'setTransport', beatsPerBar: regions[0].beatsPerBar, beatUnit: regions[0].beatUnit }
    const points = regions.slice(1).map(r => ({ atBeat: map.beat(r.tick), beatsPerBar: r.beatsPerBar, beatUnit: r.beatUnit }))
    try {
      transport.signaturePoints = checkSignaturePoints(beatsPerBar, points)
    } catch (error) {
      transport.signaturePoints = []
      warnings.push(`the file's later time signature changes were left out: ${error.message}`)
    }
    // The tempo before the first change is 120 quarter notes a minute, as the MIDI specification says.
    const tempos = midi.tempos.length === 0 || midi.tempos[0].tick > 0 ? [{ tick: 0, microsPerQuarter: 500000 }, ...midi.tempos] : midi.tempos
    const byBeat = new Map()
    for (const t of tempos) {
      const unit = map.regionAt(t.tick).beatUnit
      byBeat.set(map.beat(t.tick), { atBeat: map.beat(t.tick), bpm: round(60e6 / t.microsPerQuarter * unit / 4, 3) })
    }
    transport.tempoPoints = [...byBeat.values()].sort((a, b) => a.atBeat - b.atBeat)
    changes.push(transport)
  } else {
    // Counted in the project's own beat unit: a quarter note is `unit / 4` beats.
    const unit = project.transport.beatUnit
    map = { beat: tick => round(tick / midi.division * unit / 4) }
    warnings.push("the project already has MIDI clips, so the file's tempo and time signature were not applied")
  }

  const nextTrack = Number(project.nextId('track').split('-')[1])
  let notes = 0
  let controllerEvents = 0
  midi.tracks.forEach((part, i) => {
    const track = `track-${nextTrack + i}`
    const label = part.name?.trim() ? part.name.trim() : `MIDI track ${i + 1}`
    const placed = (part.notes ?? []).map(n => {
      const startBeat = map.beat(n.tick)
      return { startBeat, lengthBeats: Math.max(round(map.beat(n.tick + n.ticks) - startBeat), 1e-6), pitch: n.pitch, velocity: Math.min(127, Math.max(1, n.velocity)) }
    })
    // Two events for one controller on one tick, from a file written carelessly, keep the later: it is what the player heard last.
    const last = new Map()
    for (const e of part.controllers ?? []) last.set(`${e.controller}@${e.tick}`, e)
    const events = [...last.values()].map(e => ({ atBeat: map.beat(e.tick), controller: e.controller, value: e.value }))
    const end = Math.max(0, ...placed.map(n => n.startBeat + n.lengthBeats), ...events.map(e => e.atBeat))
    changes.push(
      { op: 'addTrack', id: track, label },
      { op: 'addClip', track, kind: 'midi', startBeat: 0, lengthBeats: Math.max(1, Math.ceil(end / beatsPerBar)) * beatsPerBar, notes: placed, controllers: events }
    )
    notes += placed.length
    controllerEvents += events.length
  })
  return { changes, tracks: midi.tracks.length, notes, controllers: controllerEvents, appliedTiming: takeTiming, warnings }
}
