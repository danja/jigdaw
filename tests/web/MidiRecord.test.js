// tests/web/MidiRecord.test.js
//
// What the Rec MIDI button does: when a take runs, which messages it keeps and for which track, and what it hands the
// dispatcher. How messages become notes is tested in tests/model/MidiTake.test.js.
import { describe, it, expect, beforeEach } from 'vitest'
import { parseHTML } from 'linkedom'
import { createMidiRecord } from '../../web/app/MidiRecord.js'
import { Project } from '../../src/model/Project.js'

let document
beforeEach(() => {
  ({ document } = parseHTML('<!doctype html><body><button id="record-midi" aria-pressed="false">Rec MIDI</button></body>'))
})

function setup ({ instruments = true, playing = false } = {}) {
  const project = new Project()
  project.apply([
    { op: 'addTrack', label: 'Keys' },
    { op: 'addNode', id: 'synth', track: 'track-1', pluginIri: 'https://example.org/p/' },
    ...(instruments ? [{ op: 'setTrack', id: 'track-1', midiInput: 'synth' }] : []),
    { op: 'addNode', id: 'other', track: 'track-1', pluginIri: 'https://example.org/q/' }
  ])
  const logs = []
  const applied = []
  let beat = 0
  let isPlaying = playing
  const ctx = {
    document,
    $: id => document.getElementById(id),
    log: (...a) => logs.push(a),
    runtime: { ensureRunning: async () => {} },
    dispatcher: { project, apply: changes => { applied.push(changes); return project.apply(changes) && { ok: true } } },
    transport: { playing: () => isPlaying, play: async () => { isPlaying = true }, untilStart: async () => {}, position: () => ({ beat }) }
  }
  return { ctx, project, logs, applied, record: createMidiRecord(ctx), at: b => { beat = b } }
}
const button = () => document.getElementById('record-midi')

describe('the MIDI take', () => {
  it('keeps what is sent to the plugin a track plays into, and makes a clip from where it began', async () => {
    const { record, at, project, logs, applied } = setup()
    at(4)
    await record.toggle()
    expect(button().getAttribute('aria-pressed')).toBe('true')
    at(4.5); record.capture('synth', [0x90, 60, 100])
    at(5.5); record.capture('synth', [0x80, 60, 0])
    at(8)
    await record.toggle()
    expect(button().getAttribute('aria-pressed')).toBe('false')
    expect(applied).toHaveLength(1)
    const [clip] = project.clips
    expect([clip.track, clip.startBeat, clip.lengthBeats]).toEqual(['track-1', 4, 4])
    expect(clip.notes).toEqual([{ startBeat: 0.5, lengthBeats: 1, pitch: 60, velocity: 100 }])
    expect(logs.at(-1)).toEqual(['kept 1 note and 0 controller events on 1 track from beat 4.00', 'ok'])
  })

  it('starts the transport if it is stopped, and leaves it alone if it is already playing', async () => {
    const stopped = setup()
    await stopped.record.toggle()
    expect(stopped.ctx.transport.playing()).toBe(true)
    const running = setup({ playing: true })
    let played = 0
    running.ctx.transport.play = async () => { played++ }
    await running.record.toggle()
    expect(played).toBe(0)
  })

  it('ignores messages sent while no take is running, and to a plugin no track plays into', async () => {
    const { record, project, applied } = setup()
    record.capture('synth', [0x90, 60, 100])
    await record.toggle()
    record.capture('other', [0x90, 62, 100])
    record.capture('nowhere', [0x90, 64, 100])
    await record.toggle()
    expect(applied).toEqual([])
    expect(project.clips).toEqual([])
  })

  it('says so, and keeps no clip, when nothing was played', async () => {
    const { record, logs, applied } = setup()
    await record.toggle()
    await record.toggle()
    expect(applied).toEqual([])
    expect(logs.at(-1)).toEqual(['no MIDI was played, so no clip was kept', 'info'])
  })

  it('will not start with no instrument to play, saying why', async () => {
    const { record, logs } = setup({ instruments: false })
    await record.toggle()
    expect(record.isRecording()).toBe(false)
    expect(button().getAttribute('aria-pressed')).toBe('false')
    expect(logs.at(-1)[1]).toBe('error')
    expect(logs.at(-1)[0]).toMatch(/no track has an instrument/)
  })

  it('can be finished from Stop when idle, with nothing happening', async () => {
    const { record, applied } = setup()
    await record.finishTake()
    expect(applied).toEqual([])
  })

  it('keeps the wheel and controllers as events, and is one edit', async () => {
    const { record, at, project, applied } = setup()
    await record.toggle()
    at(1); record.capture('synth', [0xe0, 0x00, 0x60]); record.capture('synth', [0xb0, 1, 90])
    at(2)
    await record.toggle()
    expect(applied).toHaveLength(1)
    expect(project.clips[0].controllers).toEqual([{ atBeat: 1, controller: 1, value: 90 }, { atBeat: 1, controller: 'pitchBend', value: 4096 }])
  })
})

describe('the places a person plays from', () => {
  // A note played live is sent to a plugin from two places. A third that forgot to tell Rec MIDI would play and not be kept,
  // and nothing else would notice.
  it('each tell Rec MIDI what they send', async () => {
    const { readFileSync } = await import('node:fs')
    const { resolve } = await import('node:path')
    const root = resolve(import.meta.dirname, '../..')
    for (const file of ['web/app/MidiIn.js', 'web/app/Rack.js']) {
      expect(readFileSync(resolve(root, file), 'utf8'), file).toContain('ctx.midiRecord.capture(')
    }
  })
})
