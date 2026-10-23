// tests/engine/SchedulerControllers.test.js
//
// Controller and pitch bend events played from a clip: which messages, at which frames, in which order, and what stopping
// leaves behind. Driven by an injected clock like Scheduler.test.js, so every assertion is about exact frames.
import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { Project } from '../../src/model/Project.js'
import { Transport } from '../../src/engine/Transport.js'
import { Scheduler, clipNotes, clipControllers } from '../../src/engine/Scheduler.js'

const RATE = 48000
const transport = () => new Transport({ sampleRate: RATE })
const cc = (atBeat, controller, value) => ({ atBeat, controller, value })

function projectWith (controllers, { notes = [], clipStart = 0, clipLength = 16, muted = false, midiInput = true } = {}) {
  const p = new Project()
  p.apply([
    { op: 'addTrack', id: 't' },
    { op: 'addNode', id: 'synth', track: 't', pluginIri: 'https://example.org/p/' },
    ...(midiInput ? [{ op: 'setTrack', id: 't', midiInput: 'synth' }] : []),
    { op: 'addClip', id: 'c', track: 't', kind: 'midi', startBeat: clipStart, lengthBeats: clipLength, notes, controllers, muted }
  ])
  return p
}

function rig (project, t = transport()) {
  let clock = 0
  const sent = []
  const scheduler = new Scheduler({
    now: () => clock,
    sampleRate: RATE,
    lookahead: 0.1,
    notes: () => clipNotes(project),
    controllers: () => clipControllers(project),
    transport: () => t,
    send: (nodeId, events) => sent.push(...events.map(e => ({ nodeId, frame: e.frame, bytes: [...e.bytes] })))
  })
  return { scheduler, sent, advance: seconds => { const end = clock + seconds; while (clock < end) { clock += 0.025; scheduler.tick() } }, at: s => { clock = s } }
}

describe('what the clips would send', () => {
  it('turns a controller into a control change and a bend into a pitch bend, at absolute beats', () => {
    const events = clipControllers(projectWith([cc(0, 7, 100), cc(2, 'pitchBend', 0), cc(3, 'pitchBend', 8191), cc(4, 'pitchBend', -8192)], { clipStart: 8 })).get('synth')
    expect(events.map(e => [e.on, [...e.bytes]])).toEqual([
      [8, [0xb0, 7, 100]],
      [10, [0xe0, 0x00, 0x40]],
      [11, [0xe0, 0x7f, 0x7f]],
      [12, [0xe0, 0x00, 0x00]]
    ])
  })

  it('leaves out events at or past the end of the clip, a muted clip, and a track with no MIDI input', () => {
    expect(clipControllers(projectWith([cc(1, 7, 1), cc(4, 7, 2), cc(5, 7, 3)], { clipLength: 4 })).get('synth')).toHaveLength(1)
    expect(clipControllers(projectWith([cc(0, 7, 1)], { muted: true })).size).toBe(0)
    expect(clipControllers(projectWith([cc(0, 7, 1)], { midiInput: false })).size).toBe(0)
  })
})

describe('placing them in time', () => {
  it('plays each at the frame of its beat, once', () => {
    const r = rig(projectWith([cc(1, 1, 64), cc(2, 'pitchBend', 100)]))
    r.scheduler.start(0)
    r.advance(1.2)
    // 120 bpm is half a second a beat: beat 1 is 24000 frames and beat 2 is 48000.
    expect(r.sent).toEqual([
      { nodeId: 'synth', frame: 24000, bytes: [0xb0, 1, 64] },
      { nodeId: 'synth', frame: 48000, bytes: [0xe0, (100 + 8192) & 0x7f, (100 + 8192) >> 7] }
    ])
  })

  it('puts a controller after the previous note ends and before the next begins at one frame', () => {
    const r = rig(projectWith([cc(1, 7, 90)], { notes: [{ startBeat: 0, lengthBeats: 1, pitch: 60, velocity: 100 }, { startBeat: 1, lengthBeats: 1, pitch: 62, velocity: 100 }] }))
    r.scheduler.start(0)
    r.advance(0.8)
    const atBeatOne = r.sent.filter(e => e.frame === 24000).map(e => e.bytes[0])
    expect(atBeatOne).toEqual([0x80, 0xb0, 0x90])
  })

  it('brings the pitch bend wheel back to rest on stop, only for a node that was bent, once', () => {
    const r = rig(projectWith([cc(0, 'pitchBend', 4000), cc(0, 7, 100)]))
    r.scheduler.start(0)
    r.advance(0.2)
    r.sent.length = 0
    r.scheduler.stop()
    expect(r.sent.map(e => e.bytes)).toEqual([[0xe0, 0x00, 0x40]])
    r.scheduler.start(1)
    r.scheduler.stop()
    expect(r.sent.map(e => e.bytes)).toEqual([[0xe0, 0x00, 0x40]])
  })

  it('does not touch the wheel on stop when only controllers were played', () => {
    const r = rig(projectWith([cc(0, 7, 100)]))
    r.scheduler.start(0)
    r.advance(0.2)
    r.sent.length = 0
    r.scheduler.stop()
    expect(r.sent).toEqual([])
  })
})

describe('where a pass begins part way through the song', () => {
  const looped = () => new Transport({ sampleRate: RATE, loopStart: 4, loopEnd: 8, loopEnabled: true })
  // 120 bpm: half a second a beat. The loop is beats 4 to 8, two seconds long, and its second pass begins at elapsed 4 s.
  const passStart = 4 * RATE
  const at = (sent, frame) => sent.filter(e => e.frame === frame).map(e => e.bytes)

  it('sets each controller to what it held at the loop start, as a loop comes round', () => {
    const r = rig(projectWith([cc(0, 7, 90), cc(1, 7, 40), cc(3, 1, 20), cc(5, 7, 10)]), looped())
    r.scheduler.start(0)
    r.advance(4.2)
    // Before beat 4, volume went 90 then 40 and modulation was never set; the loop is beats 4 to 8.
    expect(at(r.sent, passStart)).toEqual(expect.arrayContaining([[0xb0, 7, 40], [0xb0, 1, 20]]))
    expect(at(r.sent, passStart)).toHaveLength(2)
  })

  it('does not chase anything for the first pass, which begins at the start of the song', () => {
    const r = rig(projectWith([cc(0, 7, 90)]), looped())
    r.scheduler.start(0)
    r.advance(0.2)
    expect(at(r.sent, 0)).toEqual([[0xb0, 7, 90]])
  })

  it('brings a wheel left up by the last pass back to rest when the loop start has no bend before it', () => {
    const r = rig(projectWith([cc(5, 'pitchBend', 6000)]), looped())
    r.scheduler.start(0)
    r.advance(4.2)
    expect(at(r.sent, passStart)).toEqual([[0xe0, 0x00, 0x40]])
  })

  it('holds a bend that was set before the loop start, rather than resetting it', () => {
    const r = rig(projectWith([cc(1, 'pitchBend', 1000), cc(5, 'pitchBend', 6000)]), looped())
    r.scheduler.start(0)
    r.advance(4.2)
    expect(at(r.sent, passStart)).toEqual([[0xe0, (1000 + 8192) & 0x7f, (1000 + 8192) >> 7]])
  })

  it('takes the later of two events for one controller, whatever order the clips are in', () => {
    const p = projectWith([cc(3, 7, 70)])
    p.apply([{ op: 'addClip', id: 'early', track: 't', kind: 'midi', startBeat: 0, lengthBeats: 2, controllers: [cc(0, 7, 11)] }])
    const r = rig(p, looped())
    r.scheduler.start(0)
    r.advance(4.2)
    expect(at(r.sent, passStart)).toEqual([[0xb0, 7, 70]])
  })

  it('sets what each held when playing starts part way in, and nothing from before is struck late', () => {
    const r = rig(projectWith([cc(0, 7, 90), cc(1, 7, 40), cc(8, 7, 5)]))
    // Playing from three seconds in: beat zero was heard three seconds ago, so now (0) is where the song is at 3 s.
    r.scheduler.start(-3, { from: 3 })
    r.advance(0.2)
    // Beat 6 is three seconds in: volume held 40 there, and the earlier events are not sent.
    expect(r.sent).toEqual([{ nodeId: 'synth', frame: 0, bytes: [0xb0, 7, 40] }])
  })
})

describe('every Scheduler the page and the renderers build is given the controllers', () => {
  // Three places build one (the live transport, the bounce and the chain render). A fourth that forgot would play a piece
  // with its pitch bends and controllers missing, and no test of the scheduler would say so.
  const root = resolve(import.meta.dirname, '../..')
  const walk = dir => readdirSync(dir).flatMap(name => {
    const path = join(dir, name)
    return statSync(path).isDirectory() ? walk(path) : path.endsWith('.js') && !path.endsWith('.bundle.js') ? [path] : []
  })

  it('names controllers in the options of each construction in src and web', () => {
    const found = []
    for (const file of [...walk(join(root, 'src')), ...walk(join(root, 'web/app'))]) {
      const text = readFileSync(file, 'utf8')
      for (const match of text.matchAll(/new Scheduler\(\{([\s\S]*?)\n\s*\}\)/g)) found.push([file.slice(root.length + 1), match[1].includes('controllers:')])
    }
    expect(found.length).toBeGreaterThanOrEqual(3)
    expect(found.filter(([, has]) => !has).map(([f]) => f)).toEqual([])
  })
})
