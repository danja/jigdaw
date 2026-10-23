// tests/model/MidiImport.test.js
import { describe, it, expect } from 'vitest'
import { Project } from '../../src/model/Project.js'
import { writeMidiFile } from '../../src/model/MidiFile.js'
import { readMidiFile } from '../../src/model/MidiRead.js'
import { describeMidiImport } from '../../src/model/MidiImport.js'

/** A file from parts: `tracks` are arrays of bytes, each already ending in its own end-of-track if it wants one. */
function smf (tracks, { format = 1, division = 480 } = {}) {
  const u16 = n => [(n >> 8) & 255, n & 255]
  const u32 = n => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]
  const chunk = body => [0x4d, 0x54, 0x72, 0x6b, ...u32(body.length), ...body]
  return new Uint8Array([0x4d, 0x54, 0x68, 0x64, ...u32(6), ...u16(format), ...u16(tracks.length), ...u16(division), ...tracks.flatMap(chunk)])
}
const END = [0, 0xff, 0x2f, 0]
const text = s => [...new TextEncoder().encode(s)]
const nameOf = s => [0, 0xff, 0x03, s.length, ...text(s)]

describe('readMidiFile', () => {
  it('reads notes with their ticks, lengths, velocities and channels, in order', () => {
    const file = smf([[...nameOf('Lead'), 0, 0x90, 60, 100, 0x83, 0x60, 0x80, 60, 0, 0, 0x91, 64, 80, 0x60, 0x81, 64, 0, ...END]])
    const midi = readMidiFile(file)
    expect(midi).toMatchObject({ format: 1, division: 480 })
    expect(midi.tracks).toEqual([{
      name: 'Lead',
      notes: [{ tick: 0, ticks: 480, pitch: 60, velocity: 100, channel: 0 }, { tick: 480, ticks: 96, pitch: 64, velocity: 80, channel: 1 }],
      controllers: []
    }])
  })

  it('takes a note on with velocity zero as a note off, and uses running status', () => {
    // Status 0x90 once, then data pairs: on, on-with-zero (the off), on, on-with-zero.
    const file = smf([[0, 0x90, 60, 100, 0x60, 60, 0, 0, 62, 90, 0x60, 62, 0, ...END]])
    expect(readMidiFile(file).tracks[0].notes).toEqual([
      { tick: 0, ticks: 96, pitch: 60, velocity: 100, channel: 0 },
      { tick: 96, ticks: 96, pitch: 62, velocity: 90, channel: 0 }
    ])
  })

  it('ends a note the track leaves sounding at the end of the track, and gives a zero-length note one tick', () => {
    const file = smf([[0, 0x90, 60, 100, 0, 0x80, 60, 0, 0x60, 0x90, 62, 90, 0x60, 0xff, 0x2f, 0]])
    expect(readMidiFile(file).tracks[0].notes).toEqual([
      { tick: 0, ticks: 1, pitch: 60, velocity: 100, channel: 0 },
      { tick: 96, ticks: 96, pitch: 62, velocity: 90, channel: 0 }
    ])
  })

  it('pairs overlapping notes of one pitch first in, first out', () => {
    const file = smf([[0, 0x90, 60, 100, 0x30, 0x90, 60, 90, 0x30, 0x80, 60, 0, 0x30, 0x80, 60, 0, ...END]])
    expect(readMidiFile(file).tracks[0].notes.map(n => [n.tick, n.ticks, n.velocity])).toEqual([[0, 96, 100], [48, 96, 90]])
  })

  it('skips sysex and program changes (one data byte) without losing its place', () => {
    const file = smf([[0, 0xc0, 5, 0, 0xf0, 3, 1, 2, 0xf7, 0, 0x90, 60, 100, 0x60, 0x80, 60, 0, ...END]])
    expect(readMidiFile(file).tracks[0].notes).toHaveLength(1)
  })

  it('collects tempo and signature changes from any track, in tick order', () => {
    const conductor = [0, 0xff, 0x58, 4, 6, 3, 24, 8, 0, 0xff, 0x51, 3, 0x07, 0xa1, 0x20, ...END]
    const part = [0x83, 0x60, 0xff, 0x51, 3, 0x03, 0xd0, 0x90, 0, 0x90, 60, 100, 0x60, 0x80, 60, 0, ...END]
    const midi = readMidiFile(smf([conductor, part]))
    expect(midi.signatures).toEqual([{ tick: 0, numerator: 6, denominator: 8 }])
    expect(midi.tempos).toEqual([{ tick: 0, microsPerQuarter: 500000 }, { tick: 480, microsPerQuarter: 250000 }])
    // The conductor has no notes and is left out.
    expect(midi.tracks).toHaveLength(1)
  })

  it('splits a format 0 file into a part for each channel it uses', () => {
    const file = smf([[0, 0x90, 60, 100, 0, 0x93, 48, 90, 0x60, 0x80, 60, 0, 0, 0x83, 48, 0, ...END]], { format: 0 })
    const midi = readMidiFile(file)
    expect(midi.tracks.map(t => [t.name, t.notes.map(n => n.pitch)])).toEqual([['Channel 1', [60]], ['Channel 4', [48]]])
  })

  it('refuses what it cannot read, saying why', () => {
    expect(() => readMidiFile(new Uint8Array([1, 2, 3]))).toThrow(/not a MIDI file/)
    expect(() => readMidiFile(new Uint8Array(20))).toThrow(/not a MIDI file/)
    expect(() => readMidiFile(smf([END], { format: 2 }))).toThrow(/format 2/)
    expect(() => readMidiFile(smf([END], { division: 0xe728 }))).toThrow(/frames/)
    expect(() => readMidiFile(smf([END], { division: 0 }))).toThrow(/no ticks/)
    const whole = smf([[0, 0x90, 60, 100, 0x60, 0x80, 60, 0, ...END]])
    expect(() => readMidiFile(whole.slice(0, whole.length - 6))).toThrow(/ends inside/)
    expect(() => readMidiFile(smf([[0, 0x90, 60]]))).toThrow(/ends inside/)
    expect(() => readMidiFile(smf([[0x60, 60, 100]]))).toThrow(/status byte/)
    expect(() => readMidiFile(smf([[0x80, 0x80, 0x80, 0x80, 0x80, 0x01, ...END]]))).toThrow(/four bytes/)
  })
})

describe('controllers and pitch bend in a file', () => {
  it('reads control changes and pitch bends, with the bend centred on zero and its two halves joined', () => {
    // CC 7 to 100 at tick 0; at tick 96 a bend at rest (0x2000: low 0x00, high 0x40), then the top (0x3fff: 0x7f, 0x7f), then the bottom.
    const file = smf([[0, 0xb1, 7, 100, 0x60, 0xe1, 0x00, 0x40, 0, 0xe1, 0x7f, 0x7f, 0x60, 0xe1, 0x00, 0x00, 0, 0x91, 60, 100, 0x60, 0x81, 60, 0, ...END]])
    const [part] = readMidiFile(file).tracks
    expect(part.controllers).toEqual([
      { tick: 0, channel: 1, controller: 7, value: 100 },
      { tick: 96, channel: 1, controller: 'pitchBend', value: 0 },
      { tick: 96, channel: 1, controller: 'pitchBend', value: 8191 },
      { tick: 192, channel: 1, controller: 'pitchBend', value: -8192 }
    ])
    expect(part.notes).toHaveLength(1)
  })

  it('keeps a track that has only controller events, and splits a format 0 file by channel for them too', () => {
    const only = smf([[0, 0xb0, 1, 64, ...END]])
    expect(readMidiFile(only).tracks).toEqual([{ name: null, notes: [], controllers: [{ tick: 0, channel: 0, controller: 1, value: 64 }] }])
    const zero = smf([[0, 0x90, 60, 100, 0, 0xb4, 7, 90, 0x60, 0x80, 60, 0, ...END]], { format: 0 })
    expect(readMidiFile(zero).tracks.map(t => [t.name, t.notes.length, t.controllers.length])).toEqual([['Channel 1', 1, 0], ['Channel 5', 0, 1]])
  })

  it('puts them in the clip at their beats, keeps the later of two for one controller on one tick, and counts them', () => {
    const project = new Project()
    const part = { name: 'P', notes: [{ tick: 0, ticks: 480, pitch: 60, velocity: 100, channel: 0 }], controllers: [
      { tick: 0, channel: 0, controller: 7, value: 10 },
      { tick: 0, channel: 0, controller: 7, value: 20 },
      { tick: 240, channel: 0, controller: 'pitchBend', value: -500 },
      { tick: 480 * 6, channel: 0, controller: 1, value: 127 }
    ] }
    const result = describeMidiImport(project, { format: 1, division: 480, tracks: [part], tempos: [], signatures: [] })
    expect(result.controllers).toBe(3)
    project.apply(result.changes)
    expect(project.clips[0].controllers).toEqual([
      { atBeat: 0, controller: 7, value: 20 },
      { atBeat: 0.5, controller: 'pitchBend', value: -500 },
      { atBeat: 6, controller: 1, value: 127 }
    ])
    // The last event is at beat 6, past the note's end, so the clip is two bars long to hold it.
    expect(project.clips[0].lengthBeats).toBe(8)
  })
})

describe('describeMidiImport', () => {
  const part = (...notes) => ({ name: 'Part', notes: notes.map(([tick, ticks, pitch, velocity = 100]) => ({ tick, ticks, pitch, velocity, channel: 0 })) })
  const midi = (tracks, extra = {}) => ({ format: 1, division: 480, tracks, tempos: [], signatures: [], ...extra })

  it('makes a track and a clip from beat zero for each part, with notes in beats, and applies to a project', () => {
    const project = new Project()
    const { changes, tracks, notes } = describeMidiImport(project, midi([part([0, 480, 60], [960, 240, 64, 80])]))
    expect([tracks, notes]).toEqual([1, 2])
    project.apply(changes)
    const [track] = project.tracks
    expect(track.label).toBe('Part')
    const [clip] = project.clips
    expect([clip.track, clip.startBeat, clip.lengthBeats]).toEqual([track.id, 0, 4])
    expect(clip.notes).toEqual([{ startBeat: 0, lengthBeats: 1, pitch: 60, velocity: 100 }, { startBeat: 2, lengthBeats: 0.5, pitch: 64, velocity: 80 }])
  })

  it('rounds the clip up to a whole bar, with at least one', () => {
    const project = new Project()
    const { changes } = describeMidiImport(project, midi([part([0, 480 * 5, 60])]))
    expect(changes.find(c => c.op === 'addClip').lengthBeats).toBe(8)
  })

  it('names unnamed parts by their place, and numbers new tracks after the ones that exist', () => {
    const project = new Project()
    project.apply([{ op: 'addTrack' }, { op: 'addTrack' }])
    const { changes } = describeMidiImport(project, midi([{ ...part([0, 480, 60]), name: null }, { ...part([0, 480, 62]), name: '  ' }]))
    expect(changes.filter(c => c.op === 'addTrack')).toEqual([{ op: 'addTrack', id: 'track-3', label: 'MIDI track 1' }, { op: 'addTrack', id: 'track-4', label: 'MIDI track 2' }])
    project.apply(changes)
    expect(project.clips.map(c => c.track)).toEqual(['track-3', 'track-4'])
  })

  it('takes the file tempo and signature into a project with no MIDI clips, with 120 before the first change', () => {
    const project = new Project()
    const file = midi([part([0, 480, 60])], { tempos: [{ tick: 960, microsPerQuarter: 250000 }], signatures: [{ tick: 0, numerator: 3, denominator: 4 }] })
    const result = describeMidiImport(project, file)
    expect(result.appliedTiming).toBe(true)
    project.apply(result.changes)
    expect(project.transport.beatsPerBar).toBe(3)
    expect(project.transport.tempoPoints).toEqual([{ atBeat: 0, bpm: 120 }, { atBeat: 2, bpm: 240 }])
    expect(project.clips[0].lengthBeats).toBe(3)
  })

  it('counts beats in 6/8 as eighths, and converts the tempo to eighths a minute', () => {
    const project = new Project()
    const file = midi([part([480, 240, 60])], { tempos: [{ tick: 0, microsPerQuarter: 1333333 }], signatures: [{ tick: 0, numerator: 6, denominator: 8 }] })
    project.apply(describeMidiImport(project, file).changes)
    expect(project.transport).toMatchObject({ beatsPerBar: 6, beatUnit: 8 })
    expect(project.transport.tempoPoints).toEqual([{ atBeat: 0, bpm: 90 }])
    // A quarter is two eighths in; the note is one eighth long.
    expect(project.clips[0].notes).toEqual([{ startBeat: 2, lengthBeats: 1, pitch: 60, velocity: 100 }])
  })

  it('puts a later signature change at the beat it falls on', () => {
    const project = new Project()
    const file = midi([part([2400, 240, 60])], { signatures: [{ tick: 0, numerator: 4, denominator: 4 }, { tick: 1920, numerator: 6, denominator: 8 }] })
    project.apply(describeMidiImport(project, file).changes)
    expect(project.transport.signaturePoints).toEqual([{ atBeat: 4, beatsPerBar: 6, beatUnit: 8 }])
    // Four quarters, then two eighths past the change: beat 4 + 2.
    expect(project.clips[0].notes[0].startBeat).toBe(6)
  })

  it('leaves out a later signature change that is not on a bar line, and says so', () => {
    const project = new Project()
    const file = midi([part([0, 240, 60])], { signatures: [{ tick: 0, numerator: 4, denominator: 4 }, { tick: 720, numerator: 3, denominator: 4 }] })
    const result = describeMidiImport(project, file)
    expect(result.warnings.join(' ')).toMatch(/later time signature changes were left out/)
    expect(() => project.apply(result.changes)).not.toThrow()
    expect(project.transport.signaturePoints).toEqual([])
  })

  it('keeps the tempo and signature of a project that already has MIDI clips, and says so', () => {
    const project = new Project()
    project.apply([{ op: 'addTrack' }, { op: 'addClip', track: 'track-1', kind: 'midi', startBeat: 0, lengthBeats: 4, notes: [] }, { op: 'setTransport', tempoPoints: [{ atBeat: 0, bpm: 90 }] }])
    const file = midi([part([0, 480, 60])], { tempos: [{ tick: 0, microsPerQuarter: 250000 }], signatures: [{ tick: 0, numerator: 3, denominator: 4 }] })
    const result = describeMidiImport(project, file)
    expect(result.appliedTiming).toBe(false)
    expect(result.warnings.join(' ')).toMatch(/not applied/)
    expect(result.changes.some(c => c.op === 'setTransport')).toBe(false)
    project.apply(result.changes)
    expect(project.transport.tempoPoints).toEqual([{ atBeat: 0, bpm: 90 }])
    expect(project.transport.beatsPerBar).toBe(4)
  })

  it('can be told to take the timing or leave it, whatever the project holds', () => {
    const project = new Project()
    const file = midi([part([0, 480, 60])], { tempos: [{ tick: 0, microsPerQuarter: 250000 }] })
    expect(describeMidiImport(project, file, { applyTiming: false }).appliedTiming).toBe(false)
    const musical = new Project()
    musical.apply([{ op: 'addTrack' }, { op: 'addClip', track: 'track-1', kind: 'midi', startBeat: 0, lengthBeats: 4, notes: [] }])
    expect(describeMidiImport(musical, file, { applyTiming: true }).changes.some(c => c.op === 'setTransport')).toBe(true)
  })

  it('refuses a file with no notes and no controller events', () => {
    expect(() => describeMidiImport(new Project(), midi([]))).toThrow(/no notes or controller events/)
  })
})

describe('writing then reading', () => {
  it('brings back what it wrote: the notes, the tempo changes, the signature and the track names', () => {
    const source = new Project()
    source.apply([
      { op: 'addTrack', label: 'Lead' }, { op: 'addTrack', label: 'Bass' },
      { op: 'addClip', track: 'track-1', kind: 'midi', startBeat: 4, lengthBeats: 4, notes: [{ startBeat: 0, lengthBeats: 1, pitch: 60, velocity: 100 }, { startBeat: 1.5, lengthBeats: 0.5, pitch: 64, velocity: 70 }] },
      { op: 'addClip', track: 'track-2', kind: 'midi', startBeat: 0, lengthBeats: 4, notes: [{ startBeat: 2, lengthBeats: 2, pitch: 36, velocity: 110 }] },
      { op: 'setTransport', beatsPerBar: 6, beatUnit: 8, tempoPoints: [{ atBeat: 0, bpm: 100 }, { atBeat: 12, bpm: 140 }] }
    ])
    source.apply([{ op: 'setClipControllers', id: 'clip-1', controllers: [{ atBeat: 0.5, controller: 'pitchBend', value: -300 }, { atBeat: 2, controller: 7, value: 64 }] }])
    const target = new Project()
    const result = describeMidiImport(target, readMidiFile(writeMidiFile(source).bytes))
    target.apply(result.changes)
    expect(target.tracks.map(t => t.label)).toEqual(['Lead', 'Bass'])
    expect(target.transport).toMatchObject({ beatsPerBar: 6, beatUnit: 8 })
    expect(target.transport.tempoPoints).toEqual([{ atBeat: 0, bpm: 100 }, { atBeat: 12, bpm: 140 }])
    // The imported clips start at beat zero, so the lead's notes keep their place by being in the clip at 4 + start.
    const lead = target.clips.find(c => c.track === 'track-1')
    expect(lead.notes.map(n => [n.startBeat, n.lengthBeats, n.pitch, n.velocity])).toEqual([[4, 1, 60, 100], [5.5, 0.5, 64, 70]])
    expect(target.clips.find(c => c.track === 'track-2').notes).toEqual([{ startBeat: 2, lengthBeats: 2, pitch: 36, velocity: 110 }])
    // The lead's events were at 0.5 and 2 of a clip that starts at beat 4.
    expect(lead.controllers).toEqual([{ atBeat: 4.5, controller: 'pitchBend', value: -300 }, { atBeat: 6, controller: 7, value: 64 }])
  })
})
