// tests/engine/SchedulerLauncher.test.js
//
// The launcher's plays through the scheduler: a pattern repeating from a launch boundary until its stop, the arrangement silent
// under it, and a note cut where its pass or its stop ends. Exact frames, on an injected clock, as Scheduler.test.js does.
import { describe, it, expect } from 'vitest'
import { Project } from '../../src/model/Project.js'
import { LauncherState } from '../../src/model/LauncherState.js'
import { Transport } from '../../src/engine/Transport.js'
import { Scheduler, clipNotes, launcherBetween } from '../../src/engine/Scheduler.js'
import { launcherPlays } from '../../src/engine/LauncherPlays.js'

const RATE = 48000
// 120 bpm: half a second a beat, 24000 frames.
const BEAT = 24000
const note = (startBeat, pitch, lengthBeats = 1) => ({ startBeat, lengthBeats, pitch, velocity: 100 })

function setup ({ arrangement = [] } = {}) {
  const project = new Project()
  project.apply([
    { op: 'addTrack', id: 't' },
    { op: 'addNode', id: 'synth', track: 't', pluginIri: 'https://example.org/p/' },
    { op: 'setTrack', id: 't', midiInput: 'synth' },
    { op: 'addClip', id: 'slot', track: 't', kind: 'midi', startBeat: 0, lengthBeats: 2, scene: 0, notes: [note(0, 60, 1), note(1, 62, 4)] },
    { op: 'addClip', id: 'song', track: 't', kind: 'midi', startBeat: 0, lengthBeats: 16, notes: arrangement }
  ])
  const state = new LauncherState()
  const transport = new Transport({ sampleRate: RATE })
  let clock = 0
  const sent = []
  const scheduler = new Scheduler({
    now: () => clock, sampleRate: RATE, lookahead: 0.1,
    notes: () => clipNotes(project), transport: () => transport,
    launcher: () => launcherPlays(project, state),
    send: (nodeId, events) => sent.push(...events.map(e => ({ frame: e.frame, kind: e.bytes[0] === 0x90 ? 'on' : 'off', pitch: e.bytes[1] })))
  })
  const advance = seconds => { const end = clock + seconds; while (clock < end - 1e-9) { clock += 0.025; scheduler.tick() } }
  return { project, state, scheduler, sent, advance }
}

const ons = sent => sent.filter(e => e.kind === 'on').map(e => [e.frame / BEAT, e.pitch])
const offs = sent => sent.filter(e => e.kind === 'off').map(e => [e.frame / BEAT, e.pitch])

describe('a launched slot', () => {
  it('plays its pattern from the boundary, repeating every clip length, and not before', () => {
    const { state, scheduler, sent, advance, project } = setup()
    scheduler.start(0)
    state.launch(project.clip('slot'), 0.5, 4)
    advance(6)
    // Queued to beat 4; the arrangement is empty, so the first note is at beat 4, then every two beats.
    expect(ons(sent).slice(0, 4)).toEqual([[4, 60], [5, 62], [6, 60], [7, 62]])
  })

  it('cuts a note at the end of its pass, so no repeat overlaps the next', () => {
    const { state, scheduler, sent, advance, project } = setup()
    scheduler.start(0)
    state.quantise = 'none'
    state.launch(project.clip('slot'), 0, 4)
    advance(3)
    // The second note is four beats long but its pass ends at beat 2.
    expect(offs(sent)).toContainEqual([2, 62])
  })

  it('stops at the stop boundary, ending a note that sounds then', () => {
    const { state, scheduler, sent, advance, project } = setup()
    scheduler.start(0)
    state.quantise = 'none'
    state.launch(project.clip('slot'), 0, 4)
    advance(0.3)
    state.quantise = 'beat'
    state.stopTrack('t', 3.2, 4)
    advance(3)
    expect(ons(sent).filter(([beat]) => beat >= 4)).toEqual([])
    expect(ons(sent).at(-1)).toEqual([3, 62])
    expect(offs(sent)).toContainEqual([4, 62])
  })

  it('silences the arrangement on its track while it plays, and lets it back after the stop', () => {
    const { state, scheduler, sent, advance, project } = setup({ arrangement: [note(0, 40), note(2, 41), note(4, 42), note(6, 43)] })
    scheduler.start(0)
    state.launch(project.clip('slot'), 0.5, 4)
    state.stopTrack('t', 4.5, 4)
    advance(5)
    // The slot covers beats 4 to 8 (queued to the bar, stopped at the next one): notes 40 and 41 are before it, 42 and 43 under it.
    expect(ons(sent).map(([, p]) => p).filter(p => p < 50)).toEqual([40, 41])
  })

  it('plays nothing from a slot whose track plays into nothing', () => {
    const { project, state } = setup()
    project.apply([{ op: 'setTrack', id: 't', midiInput: null }])
    state.launch(project.clip('slot'), 0, 4)
    expect(launcherPlays(project, state)).toEqual([])
  })

  it('is not heard from a muted slot', () => {
    const { project, state } = setup()
    project.apply([{ op: 'setClip', id: 'slot', muted: true }])
    state.launch(project.clip('slot'), 0, 4)
    expect(launcherPlays(project, state)).toEqual([])
  })
})

describe('launcherBetween', () => {
  const transport = new Transport({ sampleRate: RATE })
  const play = { nodeId: 'n', from: 4, to: null, length: 2, notes: [note(0, 60)], controllers: [{ atBeat: 1, controller: 7, value: 64 }] }

  it('finds the notes and events of the passes that start in the window, in seconds', () => {
    const found = launcherBetween(transport, [play], 2, 5)
    // Seconds 2 to 5 are beats 4 to 10: passes start at beats 4, 6 and 8.
    expect(found.notes.get('n').map(n => [n.on, n.off])).toEqual([[2, 2.5], [3, 3.5], [4, 4.5]])
    expect(found.controllers.get('n').map(e => e.on)).toEqual([2.5, 3.5, 4.5])
  })

  it('finds nothing before the start or after the stop', () => {
    expect(launcherBetween(transport, [play], 0, 1.9).notes.size).toBe(0)
    expect(launcherBetween(transport, [{ ...play, to: 6 }], 2, 9).notes.get('n')).toHaveLength(1)
  })

  it('does not start a pass in the past: a window far in finds the pass it is in', () => {
    const found = launcherBetween(transport, [play], 10, 11)
    expect(found.notes.get('n').map(n => n.on)).toEqual([10])
  })
})
