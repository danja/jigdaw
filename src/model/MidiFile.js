// src/model/MidiFile.js
//
// A Standard MIDI File (format 1) from a project's MIDI clips, so a piece made here opens in any other DAW or notation tool.
//
// One conductor track holds the tempo and time signature changes, then one track per project track that has MIDI clips,
// in the arrangement's order. A project beat is one beat of the time signature's note value, as the transport counts it, so a
// beat is a quarter note in 4/4 and an eighth in 6/8; ticks are written at 480 to the quarter and the tempo is converted to
// match, which keeps every note on the same bar line in the other program.
//
// Controller and pitch bend events go in with the notes, on the same channel. What is left out, and why: audio clips (this is a
// note format), muted clips (they are silent here), notes and events that start at or after the end of their clip (the clip
// never plays them), and anything about plugins or mixing. Channels are given in
// turn from 1, skipping 10, which General MIDI keeps for drums; past 15 tracks they wrap.

const TICKS_PER_QUARTER = 480
const ENCODER = new TextEncoder()

/** MIDI's variable-length number: seven bits at a time, high first, every byte but the last with its top bit set. */
export function vlq (value) {
  if (!Number.isInteger(value) || value < 0 || value > 0x0fffffff) throw new Error(`a MIDI delta time is a whole number up to 268435455: ${value}`)
  const bytes = [value & 0x7f]
  for (let rest = value >>> 7; rest > 0; rest >>>= 7) bytes.unshift((rest & 0x7f) | 0x80)
  return bytes
}

const u32 = n => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]
const u16 = n => [(n >>> 8) & 255, n & 255]

/** Where each signature region starts in ticks, so a beat can be turned into a tick whatever the note value there. */
function tickMap (transport) {
  const regions = [{ atBeat: 0, beatsPerBar: transport.beatsPerBar, beatUnit: transport.beatUnit }, ...(transport.signaturePoints ?? [])]
    .sort((a, b) => a.atBeat - b.atBeat)
  let base = 0
  for (let i = 0; i < regions.length; i++) {
    regions[i].baseTicks = base
    if (i + 1 < regions.length) base += (regions[i + 1].atBeat - regions[i].atBeat) * TICKS_PER_QUARTER * 4 / regions[i].beatUnit
  }
  const regionAt = beat => regions.findLast(r => r.atBeat <= beat) ?? regions[0]
  return {
    regions,
    regionAt,
    tick: beat => { const r = regionAt(beat); return Math.round(r.baseTicks + (beat - r.atBeat) * TICKS_PER_QUARTER * 4 / r.beatUnit) }
  }
}

function track (events) {
  // Events are [tick, order, bytes]: at one tick a note ends before the next begins, so a repeated note retriggers.
  const sorted = [...events].sort((a, b) => a[0] - b[0] || a[1] - b[1])
  const body = []
  let last = 0
  for (const [tick, , bytes] of sorted) {
    body.push(...vlq(tick - last), ...bytes)
    last = tick
  }
  body.push(0, 0xff, 0x2f, 0)
  return [...ENCODER.encode('MTrk'), ...u32(body.length), ...body]
}

const meta = (type, data) => [0xff, type, ...vlq(data.length), ...data]
const nameEvent = text => [0, 0, meta(0x03, [...ENCODER.encode(text)])]

/** Whether a track has anything a MIDI file would hold: an unmuted MIDI clip with notes or controller events. */
export function trackHasMidi (project, trackId) {
  return project.clips.some(c => c.track === trackId && c.kind === 'midi' && !c.muted && (c.notes.length > 0 || (c.controllers ?? []).length > 0))
}

/**
 * The file for `project` as bytes, with how many tracks and notes went into it, or for only the tracks in `trackIds` (the
 * tempo and time signature map is always written). Throws an Error when there is nothing to write, a time signature cannot be
 * written, or a track asked for does not exist.
 */
export function writeMidiFile (project, { trackIds = null } = {}) {
  if (trackIds !== null) for (const id of trackIds) if (!project.track(id)) throw new Error(`no such track: ${id}`)
  const { transport } = project
  const map = tickMap(transport)

  const conductor = [nameEvent(project.label ?? 'Jiggy')]
  for (const region of map.regions) {
    const dd = Math.log2(region.beatUnit)
    if (!Number.isInteger(dd)) throw new Error(`a beat unit of ${region.beatUnit} cannot be written to a MIDI file; use a power of two`)
    conductor.push([map.tick(region.atBeat), 1, meta(0x58, [region.beatsPerBar, dd, 24, 8])])
  }
  for (const point of [...transport.tempoPoints].sort((a, b) => a.atBeat - b.atBeat)) {
    const quartersPerMinute = point.bpm * 4 / map.regionAt(point.atBeat).beatUnit
    const micros = Math.round(60e6 / quartersPerMinute)
    if (micros > 0xffffff) throw new Error(`a tempo of ${point.bpm} is too slow for a MIDI file`)
    conductor.push([map.tick(point.atBeat), 2, meta(0x51, [(micros >> 16) & 255, (micros >> 8) & 255, micros & 255])])
  }

  const tracks = []
  let notes = 0
  let controllers = 0
  let channel = 0
  for (const t of project.orderedTracks) {
    if (trackIds !== null && !trackIds.includes(t.id)) continue
    const clips = project.clips.filter(c => c.track === t.id && c.kind === 'midi' && !c.muted)
    const events = []
    for (const clip of clips) {
      for (const n of clip.notes) {
        if (!(n.startBeat < clip.lengthBeats)) continue
        const on = map.tick(clip.startBeat + n.startBeat)
        const off = Math.max(on + 1, map.tick(clip.startBeat + Math.min(n.startBeat + n.lengthBeats, clip.lengthBeats)))
        const velocity = Math.min(127, Math.max(1, Math.round(n.velocity)))
        events.push([on, 1, [0x90 | channel, n.pitch, velocity]], [off, 0, [0x80 | channel, n.pitch, 0]])
        notes++
      }
      for (const e of clip.controllers ?? []) {
        if (!(e.atBeat < clip.lengthBeats)) continue
        const at = map.tick(clip.startBeat + e.atBeat)
        // At one tick a controller comes after a note ends and before the next begins, as it is played.
        events.push([at, 0.5, e.controller === 'pitchBend'
          ? [0xe0 | channel, (e.value + 8192) & 0x7f, (e.value + 8192) >> 7]
          : [0xb0 | channel, e.controller, e.value]])
        controllers++
      }
    }
    if (events.length === 0) continue
    tracks.push(track([nameEvent(t.label ?? t.id), ...events]))
    channel = (channel + 1) % 16
    if (channel === 9) channel = 10
  }
  if (tracks.length === 0) throw new Error('there are no MIDI notes to export')

  const header = [...ENCODER.encode('MThd'), ...u32(6), ...u16(1), ...u16(tracks.length + 1), ...u16(TICKS_PER_QUARTER)]
  const bytes = new Uint8Array([...header, ...track(conductor), ...tracks.flat()])
  return { bytes, tracks: tracks.length, notes, controllers }
}
