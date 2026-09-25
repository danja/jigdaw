// tests/engine/Scheduler.test.js
//
// Driven by an injected clock, so every assertion is about exact frames. The
// two failures CLAUDE.md names for anything located in time are both here:
// a note exactly on a block boundary, and one between two, must each fire.
import { describe, it, expect } from 'vitest'
import { Project } from '../../src/model/Project.js'
import { Transport } from '../../src/engine/Transport.js'
import { Scheduler, clipNotes, clipAudio, notesBetween } from '../../src/engine/Scheduler.js'

const RATE = 48000
const QUANTUM = 128
// 120 bpm: half a second a beat, 24000 frames.
const transport = (over = {}) => new Transport({ sampleRate: RATE, ...over })
const note = (startBeat, pitch, lengthBeats = 1, velocity = 100) => ({ startBeat, lengthBeats, pitch, velocity })

function projectWith (notes, { clipStart = 0, clipLength = 16, midiInput = true } = {}) {
  const p = new Project()
  p.apply([
    { op: 'addTrack', id: 't' },
    { op: 'addNode', id: 'synth', track: 't', pluginIri: 'https://example.org/p/' },
    ...(midiInput ? [{ op: 'setTrack', id: 't', midiInput: 'synth' }] : []),
    { op: 'addClip', id: 'c', track: 't', kind: 'midi', startBeat: clipStart, lengthBeats: clipLength, notes }
  ])
  return p
}

/** A scheduler on a clock the test moves, recording what it sends. */
function rig (project, { lookahead = 0.1, t = transport() } = {}) {
  let clock = 0
  const sent = []
  const scheduler = new Scheduler({
    now: () => clock,
    sampleRate: RATE,
    lookahead,
    notes: () => clipNotes(project),
    transport: () => t,
    send: (nodeId, events) => sent.push(...events.map(e => ({ nodeId, frame: e.frame, kind: e.bytes[0] === 0x90 ? 'on' : 'off', pitch: e.bytes[1] })))
  })
  return { scheduler, sent, at: seconds => { clock = seconds }, advance: (seconds, step = 0.025) => { const end = clock + seconds; while (clock < end) { clock += step; scheduler.tick() } } }
}

describe('what the clips would play', () => {
  it('plays each track\'s clips into its MIDI input, at absolute beats, cut at the clip end', () => {
    const notes = clipNotes(projectWith([note(0, 60), note(3, 62, 4), note(20, 64)], { clipStart: 8, clipLength: 5 }))
    expect(notes.get('synth')).toEqual([
      { on: 8, off: 9, pitch: 60, velocity: 100 },
      { on: 11, off: 13, pitch: 62, velocity: 100 }
    ])
  })

  it('plays nothing from a track with no MIDI input', () => {
    expect(clipNotes(projectWith([note(0, 60)], { midiInput: false })).size).toBe(0)
  })
})

describe('placing notes in time', () => {
  it('fires a note exactly on a block boundary, and one between two', () => {
    // Beat 0.064 is 0.032s, 1536 frames, exactly 12 quanta; beat 0.065 is
    // 1560 frames, 24 into the thirteenth.
    const { scheduler, sent, advance } = rig(projectWith([note(0.064, 60), note(0.065, 62)]))
    scheduler.start(0)
    advance(0.5)
    const ons = sent.filter(e => e.kind === 'on').map(e => e.frame)
    expect(ons).toEqual([1536, 1560])
    expect(ons[0] % QUANTUM).toBe(0)
    expect(ons[1] % QUANTUM).not.toBe(0)
  })

  it('locates by the stream position the transport started at, not from zero', () => {
    const { scheduler, sent, at, advance } = rig(projectWith([note(1, 60)]))
    at(10)
    scheduler.start(10)
    advance(1)
    expect(sent.find(e => e.kind === 'on').frame).toBe((10 + 0.5) * RATE)
  })

  it('sends each note once, however many ticks cover it', () => {
    const { scheduler, sent, advance } = rig(projectWith([note(0, 60), note(1, 62)]), { lookahead: 0.3 })
    scheduler.start(0)
    advance(2, 0.01)
    expect(sent.filter(e => e.kind === 'on')).toHaveLength(2)
    expect(sent.filter(e => e.kind === 'off')).toHaveLength(2)
  })

  it('follows a tempo change', () => {
    // 120 bpm to beat 2, then 60: beat 3 is at one second plus one second.
    const t = transport({ tempoPoints: [{ atBeat: 0, bpm: 120 }, { atBeat: 2, bpm: 60 }] })
    const { scheduler, sent, advance } = rig(projectWith([note(3, 60)]), { t })
    scheduler.start(0)
    advance(3)
    expect(sent.find(e => e.kind === 'on').frame).toBe(2 * RATE)
  })
})

describe('looping', () => {
  const looped = transport({ loopStart: 0, loopEnd: 4, loopEnabled: true })

  it('plays the loop again, from the loop start, each pass', () => {
    const { scheduler, sent, advance } = rig(projectWith([note(1, 60)]), { t: looped })
    scheduler.start(0)
    advance(6.1)
    // Beat 1 is 0.5s; the loop is 2s long.
    expect(sent.filter(e => e.kind === 'on').map(e => e.frame / RATE)).toEqual([0.5, 2.5, 4.5])
  })

  it('cuts a note that runs past the loop end, at the loop end', () => {
    const notes = [{ on: 3, off: 6, pitch: 60, velocity: 100 }]
    expect(notesBetween(looped, notes, 0, 3)).toEqual([{ on: 1.5, off: 2, pitch: 60, velocity: 100 }])
  })

  it('starts inside a later pass without walking every pass before it', () => {
    const notes = [{ on: 1, off: 2, pitch: 60, velocity: 100 }]
    // An hour in: pass k starts at 2k seconds, and its beat 1 is 0.5s in.
    expect(notesBetween(looped, notes, 3600, 3601).map(n => n.on)).toEqual([3600.5])
  })

  it('plays a note before the loop start only on the way in', () => {
    const t = transport({ loopStart: 4, loopEnd: 8, loopEnabled: true })
    const notes = [{ on: 1, off: 2, pitch: 60, velocity: 100 }, { on: 5, off: 6, pitch: 62, velocity: 100 }]
    expect(notesBetween(t, notes, 0, 10).map(n => [n.pitch, n.on])).toEqual([[60, 0.5], [62, 2.5], [62, 4.5], [62, 6.5], [62, 8.5]])
  })
})

describe('never leaving a note held', () => {
  it('ends everything sounding when stopped, at the stop', () => {
    const { scheduler, sent, at, advance } = rig(projectWith([note(0, 60, 8)]))
    scheduler.start(0)
    advance(1)
    at(1.25)
    scheduler.stop()
    const off = sent.filter(e => e.kind === 'off')
    expect(off).toEqual([{ nodeId: 'synth', frame: 1.25 * RATE, kind: 'off', pitch: 60 }])
    expect(scheduler.running).toBe(false)
  })

  it('ends a note scheduled but not yet begun no earlier than it begins', () => {
    const { scheduler, sent, at } = rig(projectWith([note(0.1, 60, 8)]), { lookahead: 0.2 })
    scheduler.start(0)
    scheduler.tick()
    at(0.01)
    scheduler.stop()
    const on = sent.find(e => e.kind === 'on')
    const off = sent.find(e => e.kind === 'off')
    expect(off.frame).toBe(on.frame)
  })

  it('still ends a note deleted while it sounds, at the time it was given', () => {
    const project = projectWith([note(0, 60, 2)])
    const { scheduler, sent, advance } = rig(project)
    scheduler.start(0)
    advance(0.2)
    project.apply([{ op: 'setClipNotes', id: 'c', notes: [] }])
    advance(1.5)
    expect(sent.filter(e => e.kind === 'off')).toEqual([{ nodeId: 'synth', frame: 1 * RATE, kind: 'off', pitch: 60 }])
  })

  it('sends an off before an on at the same frame, so a repeated note retriggers', () => {
    const { scheduler, sent, advance } = rig(projectWith([note(0, 60, 1), note(1, 60, 1)]), { lookahead: 1 })
    scheduler.start(0)
    advance(0.1)
    const atHalf = sent.filter(e => e.frame === 0.5 * RATE).map(e => e.kind)
    expect(atHalf).toEqual(['off', 'on'])
  })
})

describe('configuration', () => {
  it('needs its lookahead given rather than defaulted', () => {
    expect(() => new Scheduler({ now: () => 0, sampleRate: RATE, notes: () => new Map(), transport: () => transport(), send: () => {} }))
      .toThrow(/lookahead/)
  })
})

describe('audio clips', () => {
  function audioRig ({ t = transport(), clips }) {
    let clock = 0
    const started = []
    let stopped = 0
    const project = new Project()
    project.apply([{ op: 'addTrack', id: 't' }, ...clips.map((c, i) => ({ op: 'addClip', id: `a${i}`, track: 't', kind: 'audio', source: 'https://example.org/a.wav', ...c }))])
    const scheduler = new Scheduler({
      now: () => clock, sampleRate: RATE, lookahead: 0.1,
      notes: () => new Map(), transport: () => t, send: () => {},
      audio: () => clipAudio(project),
      playAudio: (clip, at) => started.push({ id: clip.id, ...at }),
      stopAudio: () => { stopped += 1 }
    })
    return { scheduler, started, stopped: () => stopped, advance: seconds => { const end = clock + seconds; while (clock < end) { clock += 0.025; scheduler.tick() } } }
  }

  it('starts each clip once, at its beat, from its offset, for its length', () => {
    const { scheduler, started, advance } = audioRig({ clips: [{ startBeat: 2, lengthBeats: 4, offsetSeconds: 0.25 }] })
    scheduler.start(3)
    advance(4)
    expect(started).toEqual([{ id: 'a0', when: 4, offset: 0.25, duration: 2 }])
  })

  it('starts a looped clip again each pass, cut at the loop end', () => {
    const t = transport({ loopStart: 0, loopEnd: 4, loopEnabled: true })
    const { scheduler, started, advance } = audioRig({ t, clips: [{ startBeat: 2, lengthBeats: 4 }] })
    scheduler.start(0)
    advance(4.2)
    expect(started.map(s => [s.when, s.duration])).toEqual([[1, 1], [3, 1]])
  })

  it('stops them all when stopped', () => {
    const { scheduler, stopped, advance } = audioRig({ clips: [{ startBeat: 0, lengthBeats: 8 }] })
    scheduler.start(0)
    advance(0.5)
    scheduler.stop()
    expect(stopped()).toBe(1)
  })

  it('needs all of the audio handlers or none', () => {
    expect(() => new Scheduler({
      now: () => 0, sampleRate: RATE, lookahead: 0.1, notes: () => new Map(), transport: () => transport(), send: () => {},
      audio: () => []
    })).toThrow(/all of audio/)
  })
})
