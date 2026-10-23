// tests/model/MidiFile.test.js
import { describe, it, expect } from 'vitest'
import { Project } from '../../src/model/Project.js'
import { vlq, writeMidiFile, trackHasMidi } from '../../src/model/MidiFile.js'

const SRC = 'https://example.org/a.wav'
const note = (startBeat, pitch = 60, lengthBeats = 1, velocity = 100) => ({ startBeat, lengthBeats, pitch, velocity })

function build (tracks, extra = []) {
  const project = new Project()
  project.apply([...tracks.map(t => ({ op: 'addTrack', label: t.label ?? null })), ...tracks.flatMap((t, i) => (t.clips ?? []).map(c => ({ op: 'addClip', track: `track-${i + 1}`, kind: 'midi', ...c }))), ...extra])
  return project
}

/** A reader for what the writer makes, so the tests check the file and not the writer's own idea of it. */
function read (bytes) {
  const text = (at, n) => String.fromCharCode(...bytes.slice(at, at + n))
  const u32 = at => ((bytes[at] << 24) | (bytes[at + 1] << 16) | (bytes[at + 2] << 8) | bytes[at + 3]) >>> 0
  const header = { chunk: text(0, 4), length: u32(4), format: (bytes[8] << 8) | bytes[9], tracks: (bytes[10] << 8) | bytes[11], division: (bytes[12] << 8) | bytes[13] }
  const tracks = []
  let at = 14
  while (at < bytes.length) {
    expect(text(at, 4)).toBe('MTrk')
    const end = at + 8 + u32(at + 4)
    at += 8
    const events = []
    let tick = 0
    while (at < end) {
      let delta = 0
      while (bytes[at] & 0x80) delta = (delta << 7) | (bytes[at++] & 0x7f)
      tick += (delta << 7) | bytes[at++]
      const status = bytes[at++]
      if (status === 0xff) {
        const type = bytes[at++]
        const length = bytes[at++]
        events.push({ tick, meta: type, data: [...bytes.slice(at, at + length)] })
        at += length
      } else {
        events.push({ tick, kind: status & 0xf0, channel: status & 15, pitch: bytes[at], velocity: bytes[at + 1] })
        at += 2
      }
    }
    expect(at).toBe(end)
    tracks.push(events)
  }
  return { header, tracks }
}
const notesOf = events => events.filter(e => e.kind)
const named = events => String.fromCharCode(...events.find(e => e.meta === 3).data)

describe('vlq', () => {
  it('writes the values the MIDI specification lists', () => {
    expect(vlq(0)).toEqual([0x00])
    expect(vlq(0x7f)).toEqual([0x7f])
    expect(vlq(0x80)).toEqual([0x81, 0x00])
    expect(vlq(0x2000)).toEqual([0xc0, 0x00])
    expect(vlq(0x3fff)).toEqual([0xff, 0x7f])
    expect(vlq(0x4000)).toEqual([0x81, 0x80, 0x00])
    expect(vlq(0x0fffffff)).toEqual([0xff, 0xff, 0xff, 0x7f])
  })

  it('refuses what cannot be written', () => {
    for (const bad of [-1, 1.5, 0x10000000, NaN]) expect(() => vlq(bad)).toThrow(/delta time/)
  })
})

describe('writeMidiFile', () => {
  const one = () => build([{ label: 'Lead', clips: [{ startBeat: 4, lengthBeats: 4, notes: [note(1, 60, 2, 90)] }] }])

  it('writes a format 1 file at 480 to the quarter with a conductor and one track per track with notes', () => {
    const { bytes, tracks, notes } = writeMidiFile(one())
    const { header, tracks: chunks } = read(bytes)
    expect(header).toEqual({ chunk: 'MThd', length: 6, format: 1, tracks: 2, division: 480 })
    expect(chunks).toHaveLength(2)
    expect([tracks, notes]).toEqual([1, 1])
    expect(named(chunks[1])).toBe('Lead')
  })

  it('places a note by its clip and its own start, with its length and velocity, and ends every track', () => {
    const { tracks } = read(writeMidiFile(one()).bytes)
    expect(notesOf(tracks[1])).toEqual([
      { tick: 2400, kind: 0x90, channel: 0, pitch: 60, velocity: 90 },
      { tick: 3360, kind: 0x80, channel: 0, pitch: 60, velocity: 0 }
    ])
    for (const events of tracks) expect(events.at(-1)).toMatchObject({ meta: 0x2f, data: [] })
  })

  it('writes 120 bpm as 500000 microseconds and 4/4 as 4, 2, 24, 8, at tick zero', () => {
    const conductor = read(writeMidiFile(one()).bytes).tracks[0]
    expect(conductor.find(e => e.meta === 0x51)).toEqual({ tick: 0, meta: 0x51, data: [0x07, 0xa1, 0x20] })
    expect(conductor.find(e => e.meta === 0x58)).toEqual({ tick: 0, meta: 0x58, data: [4, 2, 24, 8] })
  })

  it('writes each tempo change at its own tick, in order', () => {
    const project = one()
    project.apply([{ op: 'setTransport', tempoPoints: [{ atBeat: 8, bpm: 60 }, { atBeat: 0, bpm: 120 }] }])
    const tempos = read(writeMidiFile(project).bytes).tracks[0].filter(e => e.meta === 0x51)
    expect(tempos.map(e => [e.tick, e.data])).toEqual([[0, [0x07, 0xa1, 0x20]], [3840, [0x0f, 0x42, 0x40]]])
  })

  it('counts a beat as the time signature says: eighths in 6/8, with the tempo converted to quarters', () => {
    const project = build([{ clips: [{ startBeat: 0, lengthBeats: 6, notes: [note(2)] }] }], [{ op: 'setTransport', beatsPerBar: 6, beatUnit: 8, tempoPoints: [{ atBeat: 0, bpm: 90 }] }])
    const { tracks } = read(writeMidiFile(project).bytes)
    expect(tracks[0].find(e => e.meta === 0x58).data).toEqual([6, 3, 24, 8])
    // 90 eighths a minute is 45 quarters a minute: 1333333 microseconds to the quarter.
    expect(tracks[0].find(e => e.meta === 0x51).data).toEqual([0x14, 0x58, 0x55])
    expect(notesOf(tracks[1])[0].tick).toBe(480)
  })

  it('keeps notes on their bar lines across a change of signature', () => {
    const project = build([{ clips: [{ startBeat: 0, lengthBeats: 16, notes: [note(6)] }] }], [{ op: 'setTransport', signaturePoints: [{ atBeat: 4, beatsPerBar: 6, beatUnit: 8 }] }])
    const { tracks } = read(writeMidiFile(project).bytes)
    // Four quarters, then two eighths.
    expect(notesOf(tracks[1])[0].tick).toBe(4 * 480 + 2 * 240)
    expect(tracks[0].filter(e => e.meta === 0x58).map(e => [e.tick, e.data[0], e.data[1]])).toEqual([[0, 4, 2], [1920, 6, 3]])
  })

  it('leaves out muted clips, audio clips, tracks with no notes, and notes a clip never reaches', () => {
    const project = build([
      { label: 'A', clips: [{ startBeat: 0, lengthBeats: 4, notes: [note(0), note(3, 62, 4), note(4, 64)] }, { startBeat: 8, lengthBeats: 4, muted: true, notes: [note(0, 70)] }] },
      { label: 'Empty' }
    ], [{ op: 'addClip', track: 'track-2', kind: 'audio', startBeat: 0, lengthBeats: 4, source: SRC, offsetSeconds: 0 }])
    const { tracks, notes } = writeMidiFile(project)
    expect([tracks, notes]).toEqual([1, 2])
    const heard = notesOf(read(writeMidiFile(project).bytes).tracks[1])
    expect(heard.filter(e => e.kind === 0x90).map(e => e.pitch)).toEqual([60, 62])
    // The second note asked for four beats and the clip ends one beat after it starts.
    expect(heard.find(e => e.kind === 0x80 && e.pitch === 62).tick).toBe(4 * 480)
  })

  it('ends a note before the next one starts at the same tick, so a repeated note retriggers', () => {
    const project = build([{ clips: [{ startBeat: 0, lengthBeats: 4, notes: [note(0, 60, 1), note(1, 60, 1)] }] }])
    const events = notesOf(read(writeMidiFile(project).bytes).tracks[1]).filter(e => e.tick === 480)
    expect(events.map(e => e.kind)).toEqual([0x80, 0x90])
  })

  it('gives each track its own channel from 1, skipping 10 for drums, and wraps past 15', () => {
    const clips = [{ startBeat: 0, lengthBeats: 1, notes: [note(0)] }]
    const project = build(Array.from({ length: 17 }, (_, i) => ({ label: `T${i + 1}`, clips })))
    const channels = read(writeMidiFile(project).bytes).tracks.slice(1).map(t => notesOf(t)[0].channel)
    expect(channels.slice(0, 10)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 10])
    expect(channels).not.toContain(9)
    expect(channels.slice(-2)).toEqual([0, 1])
  })

  it('writes a note of no length as one tick', () => {
    const project = build([{ clips: [{ startBeat: 0, lengthBeats: 4, notes: [note(0, 60, 0.0001, 100)] }] }])
    const [on, off] = notesOf(read(writeMidiFile(project).bytes).tracks[1])
    expect(off.tick - on.tick).toBe(1)
  })

  it('writes controller and pitch bend events on the track channel, at their ticks, after a note ends and before the next begins', () => {
    const project = build([{ clips: [{ startBeat: 4, lengthBeats: 4, notes: [note(0, 60, 1), note(1, 62, 1)], controllers: [
      { atBeat: 1, controller: 7, value: 90 }, { atBeat: 2, controller: 'pitchBend', value: -8192 }, { atBeat: 3, controller: 'pitchBend', value: 8191 }, { atBeat: 4, controller: 1, value: 5 }
    ] }] }, { clips: [{ startBeat: 0, lengthBeats: 4, notes: [note(0)] }] }])
    const { tracks, controllers } = writeMidiFile(project)
    expect(controllers).toBe(3)
    const events = read(writeMidiFile(project).bytes).tracks[1]
    const at = tick => events.filter(e => e.tick === tick && e.kind).map(e => [e.kind, e.pitch, e.velocity])
    // Tick 2400 is beat 5: the first note ends, the controller is set, the second note begins.
    expect(at(2400)).toEqual([[0x80, 60, 0], [0xb0, 7, 90], [0x90, 62, 100]])
    expect(at(2880)).toEqual([[0x80, 62, 0], [0xe0, 0x00, 0x00]])
    expect(at(3360)).toEqual([[0xe0, 0x7f, 0x7f]])
    // The one at beat 4 of a four beat clip is never played, so it is not written.
    expect(events.some(e => e.kind === 0xb0 && e.pitch === 1)).toBe(false)
    expect(tracks).toBe(2)
  })

  it('writes a track that has only controller events', () => {
    const project = build([{ clips: [{ startBeat: 0, lengthBeats: 4, notes: [], controllers: [{ atBeat: 0, controller: 1, value: 64 }] }] }])
    const { tracks, notes, controllers } = writeMidiFile(project)
    expect([tracks, notes, controllers]).toEqual([1, 0, 1])
  })

  it('writes only the tracks asked for, keeping the tempo map, and refuses a track that is not there', () => {
    const clips = [{ startBeat: 0, lengthBeats: 4, notes: [note(0)] }]
    const project = build([{ label: 'A', clips }, { label: 'B', clips }, { label: 'C', clips }])
    const { tracks, notes, bytes } = writeMidiFile(project, { trackIds: ['track-1', 'track-3'] })
    expect([tracks, notes]).toEqual([2, 2])
    const parts = read(bytes).tracks
    expect(parts.slice(1).map(named)).toEqual(['A', 'C'])
    expect(parts[0].some(e => e.meta === 0x51)).toBe(true)
    // The channels are given in turn to the tracks that are written, so the first of them is on channel 1 as ever.
    expect(parts.slice(1).map(t => notesOf(t)[0].channel)).toEqual([0, 1])
    expect(() => writeMidiFile(project, { trackIds: ['track-9'] })).toThrow(/no such track: track-9/)
    expect(() => writeMidiFile(build([{ clips: [] }, { clips }]), { trackIds: ['track-1'] })).toThrow(/no MIDI notes/)
  })

  it('says which tracks have something to write', () => {
    const project = build([{ clips: [{ startBeat: 0, lengthBeats: 4, notes: [note(0)] }] }, { clips: [{ startBeat: 0, lengthBeats: 4, notes: [] }] }, { clips: [{ startBeat: 0, lengthBeats: 4, notes: [], controllers: [{ atBeat: 0, controller: 1, value: 1 }] }] }, { clips: [{ startBeat: 0, lengthBeats: 4, notes: [note(0)], muted: true }] }])
    expect(['track-1', 'track-2', 'track-3', 'track-4'].map(id => trackHasMidi(project, id))).toEqual([true, false, true, false])
  })

  it('says why when there is nothing to write', () => {
    expect(() => writeMidiFile(new Project())).toThrow(/no MIDI notes/)
    expect(() => writeMidiFile(build([{ clips: [{ startBeat: 0, lengthBeats: 4, notes: [] }] }]))).toThrow(/no MIDI notes/)
  })

  it('refuses a beat unit that is not a power of two, saying so', () => {
    const project = build([{ clips: [{ startBeat: 0, lengthBeats: 4, notes: [note(0)] }] }], [{ op: 'setTransport', beatUnit: 3 }])
    expect(() => writeMidiFile(project)).toThrow(/beat unit of 3/)
  })

  it('names a track without a label by its id, and writes non-ASCII names as UTF-8', () => {
    const clips = [{ startBeat: 0, lengthBeats: 1, notes: [note(0)] }]
    const project = build([{ clips }, { label: 'Bässe', clips }])
    const { tracks } = read(writeMidiFile(project).bytes)
    expect(named(tracks[1])).toBe('track-1')
    expect(new TextDecoder().decode(new Uint8Array(tracks[2].find(e => e.meta === 3).data))).toBe('Bässe')
  })
})
