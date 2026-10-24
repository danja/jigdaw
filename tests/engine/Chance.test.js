// tests/engine/Chance.test.js
//
// A note's chance of playing: a draw that is the same every time for the same moment, differs between moments, and is spread evenly; and the
// scheduler, the offline render and a looping transport all agree on it.
import { describe, it, expect } from 'vitest'
import { Project } from '../../src/model/Project.js'
import { Transport } from '../../src/engine/Transport.js'
import { Scheduler, clipNotes } from '../../src/engine/Scheduler.js'
import { drawFor, sounds } from '../../src/engine/Chance.js'

const RATE = 48000
const note = (startBeat, chance) => ({ startBeat, lengthBeats: 0.25, pitch: 60, velocity: 100, ...(chance === undefined ? {} : { chance }) })

describe('the draw', () => {
  it('is the same for the same key, and in [0, 1)', () => {
    expect(drawFor('n|60|1.000000')).toBe(drawFor('n|60|1.000000'))
    for (let i = 0; i < 1000; i++) { const d = drawFor(`n|60|${i}`); expect(d).toBeGreaterThanOrEqual(0); expect(d).toBeLessThan(1) }
  })

  it('differs between moments, and is spread evenly enough that a chance means about that many', () => {
    let heard = 0
    const n = 20000
    for (let i = 0; i < n; i++) if (sounds(0.25, `node-1|60|${(i * 0.125).toFixed(6)}`)) heard++
    expect(heard / n).toBeGreaterThan(0.23)
    expect(heard / n).toBeLessThan(0.27)
    expect(drawFor('n|60|1.000000')).not.toBe(drawFor('n|60|1.125000'))
  })

  it('always sounds without a chance, or with a chance of one, and never with the draw above it', () => {
    expect(sounds(undefined, 'k')).toBe(true)
    expect(sounds(1, 'k')).toBe(true)
    expect(sounds(1e-9, 'a key that is not zero')).toBe(false)
  })
})

function render (project, seconds, { loop = null } = {}) {
  const transport = new Transport({ sampleRate: RATE, ...(loop ? { loopStart: loop[0], loopEnd: loop[1], loopEnabled: true } : {}) })
  let clock = 0
  const sent = []
  const scheduler = new Scheduler({
    now: () => clock, sampleRate: RATE, lookahead: 0.1, notes: () => clipNotes(project), transport: () => transport,
    send: (nodeId, events) => sent.push(...events.filter(e => e.bytes[0] === 0x90).map(e => e.frame))
  })
  scheduler.start(0)
  while (clock < seconds) { clock += 0.025; scheduler.tick() }
  return sent
}

function projectWith (notes, lengthBeats = 64) {
  const p = new Project()
  p.apply([
    { op: 'addTrack', id: 't' }, { op: 'addNode', id: 'synth', track: 't', pluginIri: 'https://example.org/p/' }, { op: 'setTrack', id: 't', midiInput: 'synth' },
    { op: 'addClip', id: 'c', track: 't', kind: 'midi', startBeat: 0, lengthBeats, notes }
  ])
  return p
}

describe('a note with a chance, through the scheduler', () => {
  const many = Array.from({ length: 64 }, (_, i) => note(i, 0.5))

  it('plays some of its notes and not all, and the same ones every time it is rendered', () => {
    const project = projectWith(many)
    const first = render(project, 32.5)
    const second = render(project, 32.5)
    expect(first.length).toBeGreaterThan(10)
    expect(first.length).toBeLessThan(54)
    expect(second).toEqual(first)
  })

  it('plays every note of a note list without a chance, and none of a note too unlikely to be drawn', () => {
    expect(render(projectWith(Array.from({ length: 16 }, (_, i) => note(i))), 8.5)).toHaveLength(16)
    const rare = projectWith(Array.from({ length: 16 }, (_, i) => note(i, 1e-12)))
    expect(render(rare, 8.5)).toHaveLength(0)
  })

  it('draws again on each pass of a loop, so a looped note is not the same choice every time round', () => {
    const project = projectWith([note(0, 0.5), note(1, 0.5), note(2, 0.5), note(3, 0.5)], 4)
    const frames = render(project, 40, { loop: [0, 4] })
    const perPass = new Map()
    for (const f of frames) { const pass = Math.floor(f / RATE / 2); perPass.set(pass, (perPass.get(pass) ?? 0) + 1) }
    const counts = [...perPass.values()]
    expect(new Set(counts).size).toBeGreaterThan(1)
  })
})
