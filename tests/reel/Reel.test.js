// tests/reel/Reel.test.js
//
// Reel as the player meets it: scripts replaced while the music plays. Driven by a real ReelClock on an
// injected clock and a real Transport, so "at the next bar line" is checked against positions and not
// against a promise that it happens. Through the real tools and the real dispatcher.
import { describe, it, expect, beforeEach } from 'vitest'
import { Transport } from '../../src/engine/Transport.js'
import { ReelClock } from '../../src/reel/Clock.js'
import { createReel, describePlan } from '../../src/reel/Reel.js'
import { createTools } from '../../src/mcp/tools.js'
import { OpDispatcher } from '../../src/ops/OpDispatcher.js'

const PORTS = [
  { symbol: 'mix', unit: null, minimum: 0, maximum: 1 },
  { symbol: 'cutoff', unit: 'hz', minimum: 20, maximum: 20000 }
]
const IRI = 'https://example.org/plugins/filter/'
const START = 10

const flush = () => new Promise(resolve => setTimeout(resolve, 0))

let rig
beforeEach(() => {
  const dispatcher = new OpDispatcher()
  let counter = 0
  const loadPlugin = async iri => {
    counter++
    dispatcher.apply([{ op: 'addTrack', id: `t${counter}` }, { op: 'addNode', id: `n${counter}`, track: `t${counter}`, pluginIri: iri }])
    return { ok: true, nodeId: `n${counter}`, trackId: `t${counter}`, revision: dispatcher.revision, entry: { profile: { label: 'Filter', ports: PORTS }, ready: { latencyFrames: 0 } } }
  }
  const tools = Object.fromEntries(createTools({ dispatcher, loadPlugin }).map(t => [t.name, t.handler]))
  let seconds = START
  const transport = new Transport({ sampleRate: 48000 }) // 120 bpm: a beat is half a second, a bar two
  const clock = new ReelClock({ now: () => seconds, transport: () => transport })
  // The dispatcher has no engine here, so the plugins' ports come from a facade, as the page's engine gives them.
  const facade = {
    get project () { return dispatcher.project },
    engineNode: () => ({ profile: { label: 'Filter', ports: PORTS } }),
    grouped: fn => dispatcher.grouped(fn),
    withoutRecording: fn => dispatcher.withoutRecording(fn)
  }
  const errors = []
  const phases = []
  const reel = createReel({
    dispatcher: facade, tools, clock,
    resolvePlugin: async () => ({ ok: true, ports: PORTS }),
    beatsPerBar: () => 4,
    currentBeat: () => (seconds - START) * 2,
    onError: e => errors.push(e),
    onPhase: phase => phases.push(phase)
  })
  rig = {
    dispatcher, reel, clock, errors, tools, phases,
    mix: id => dispatcher.project.nodes.find(n => n.id === id)?.settings.get('mix'),
    async tick (secondsAfterStart) { seconds = START + secondsAfterStart; clock.tick(); await flush() },
    begin () { clock.start(START) }
  }
})

const load = `load a = ${IRI}\n`

describe('the first script', () => {
  it('takes over at once when nothing is playing, and records the plugin under its name', async () => {
    const r = await rig.reel.run(`${load}a.mix = 0.5`)
    expect(r).toMatchObject({ ok: true, swapped: 'now' })
    expect(rig.mix('n1')).toBe(0.5)
    expect(rig.reel.session.names.get('a')).toBe('n1')
    expect(rig.reel.running).toBe(true)
  })

  it('changes nothing for a script that does not parse, and says where', async () => {
    const r = await rig.reel.run('a.mix =')
    expect(r).toMatchObject({ ok: false, stage: 'parse' })
    expect(r.errors[0].line).toBe(1)
    expect(rig.dispatcher.project.nodes).toHaveLength(0)
    expect(rig.reel.running).toBe(false)
  })

  it('changes nothing for a script that does not plan', async () => {
    const r = await rig.reel.run(`${load}a.nope = 1`)
    expect(r).toMatchObject({ ok: false, stage: 'plan' })
    expect(rig.dispatcher.project.nodes).toHaveLength(0)
  })

  it('is one undo step, however much it did', async () => {
    await rig.reel.run(`${load}a.mix = 0.5\na.cutoff = 1kHz`)
    await rig.dispatcher.undo()
    expect(rig.dispatcher.project.nodes).toHaveLength(0)
    expect(rig.dispatcher.canUndo()).toBe(false)
  })
})

describe('replacing a script during playback', () => {
  const firstScript = `${load}every 1 beat: a.mix = 0.1`

  async function playing () {
    await rig.reel.run(firstScript)
    rig.begin()
    await rig.tick(0.1) // beat 0 fires
    expect(rig.mix('n1')).toBe(0.1)
  }

  it('waits for the bar line, and the old script plays until then', async () => {
    await playing()
    const pending = rig.reel.run('every 1 beat: a.mix = 0.9')
    await flush()
    expect(rig.reel.waiting).toBe(true)
    await rig.tick(0.6) // beat 1 of the old script
    await rig.tick(1.6) // beat 3
    expect(rig.mix('n1')).toBe(0.1)
    expect(rig.reel.waiting).toBe(true)

    await rig.tick(2.1) // the bar line at 2.0 s has passed
    expect(await pending).toMatchObject({ ok: true, swapped: 'at-bar' })
    expect(rig.reel.waiting).toBe(false)
    await rig.tick(2.6) // the next beat, now the new script's
    expect(rig.mix('n1')).toBe(0.9)
  })

  it('lets the new script act on the downbeat of the bar it took over on', async () => {
    await playing()
    const pending = rig.reel.run('every 1 beat: a.mix = 0.9')
    await flush()
    await rig.tick(2.05) // the bar line at 2.0 s: the old script's last firing, and the swap
    await pending
    expect(rig.mix('n1')).toBe(0.1)
    await rig.tick(2.15) // well before the next beat at 2.5 s
    expect(rig.mix('n1')).toBe(0.9)
  })

  it('stops the old script at the swap, so nothing doubles', async () => {
    await playing()
    const pending = rig.reel.run('every 1 beat: a.cutoff = 1kHz')
    await flush() // the script is checked, and waiting for its bar line
    await rig.tick(2.1)
    await pending
    const settings = () => rig.dispatcher.project.nodes.find(n => n.id === 'n1').settings
    settings().delete('mix')
    await rig.tick(2.6)
    await rig.tick(3.1)
    // The old script set mix every beat; after the swap it must not.
    expect(settings().has('mix')).toBe(false)
    expect(settings().get('cutoff')).toBe(1000)
  })

  it('leaves the old script playing when the new one does not plan', async () => {
    await playing()
    const r = await rig.reel.run('every 1 beat: a.mix = 7') // outside the range
    expect(r).toMatchObject({ ok: false, stage: 'plan' })
    expect(rig.reel.waiting).toBe(false)
    rig.dispatcher.project.nodes.find(n => n.id === 'n1').settings.delete('mix')
    await rig.tick(0.6)
    expect(rig.mix('n1')).toBe(0.1)
  })

  it('lets the latest of several waiting scripts win, and tells the others they were superseded', async () => {
    await playing()
    const first = rig.reel.run('every 1 beat: a.mix = 0.3')
    await flush()
    const second = rig.reel.run('every 1 beat: a.mix = 0.6')
    await flush()
    expect(await first).toMatchObject({ ok: true, swapped: 'superseded' })
    await rig.tick(2.1)
    expect(await second).toMatchObject({ swapped: 'at-bar' })
    await rig.tick(2.6)
    expect(rig.mix('n1')).toBe(0.6)
  })

  it('swaps at once with now, mid-bar', async () => {
    await playing()
    const r = await rig.reel.run('every 1 beat: a.mix = 0.7', { now: true })
    expect(r).toMatchObject({ ok: true, swapped: 'now' })
    await rig.tick(0.6)
    expect(rig.mix('n1')).toBe(0.7)
  })

  it('takes over at once when the transport is stopped, with no music to stutter', async () => {
    await playing()
    rig.clock.stop()
    expect(await rig.reel.run('a.mix = 0.2')).toMatchObject({ swapped: 'now' })
    expect(rig.mix('n1')).toBe(0.2)
  })

  it('does not make a firing an undo step, so a performance does not fill the history', async () => {
    await playing()
    for (let i = 1; i <= 30; i++) await rig.tick(0.1 + i * 0.5)
    await rig.dispatcher.undo() // the run, in one step
    expect(rig.dispatcher.project.nodes).toHaveLength(0)
    expect(rig.dispatcher.canUndo()).toBe(false)
  })
})

describe('what it says while it works', () => {
  it('says checking as a run begins, and nothing more when it takes over at once', async () => {
    await rig.reel.run(`${load}a.mix = 0.5`)
    expect(rig.phases).toEqual(['checking'])
  })

  it('says waiting when a checked script is holding for its bar line', async () => {
    await rig.reel.run(`${load}every 1 beat: a.mix = 0.1`)
    rig.begin()
    await rig.tick(0.1)
    rig.phases.length = 0
    const pending = rig.reel.run('every 1 beat: a.mix = 0.9')
    await flush()
    expect(rig.phases).toEqual(['checking', 'waiting'])
    await rig.tick(2.1)
    await pending
  })

  it('does not say waiting for a script that does not plan', async () => {
    await rig.reel.run('a.nope = 1')
    expect(rig.phases).toEqual(['checking'])
  })
})

describe('stopping', () => {
  it('stops the playing script, and a waiting one', async () => {
    await rig.reel.run(`${load}every 1 beat: a.mix = 0.1`)
    rig.begin()
    await rig.tick(0.1)
    const waiting = rig.reel.run('every 1 beat: a.mix = 0.9')
    await flush()
    rig.reel.stop()
    expect(await waiting).toMatchObject({ swapped: 'superseded' })
    expect(rig.reel.running).toBe(false)
    rig.dispatcher.project.nodes.find(n => n.id === 'n1').settings.delete('mix')
    await rig.tick(3)
    expect(rig.mix('n1')).toBeUndefined()
  })
})

describe('names across scripts', () => {
  it('lets a later script use a plugin an earlier one loaded', async () => {
    await rig.reel.run(`${load}a.mix = 0.5`)
    const r = await rig.reel.run('a.cutoff = 2kHz')
    expect(r.ok).toBe(true)
    expect(rig.dispatcher.project.nodes.find(n => n.id === 'n1').settings.get('cutoff')).toBe(2000)
  })

  it('refuses a name that is neither loaded nor in the project', async () => {
    const r = await rig.reel.run('ghost.mix = 0.5')
    expect(r.errors[0].message).toMatch(/no plugin called "ghost"/)
  })
})

describe('the dry run', () => {
  it('plans without touching anything, so an agent can see what a script would do', async () => {
    const r = await rig.reel.check(`${load}a.mix = 0.5\nevery 1 bar: a.cutoff = pick(1kHz, 2kHz)`)
    expect(r.ok).toBe(true)
    expect(rig.dispatcher.project.nodes).toHaveLength(0)
    expect(rig.reel.running).toBe(false)
  })

  it('describes a plan as plain data, without expressions', async () => {
    const r = await rig.reel.check(`${load}a.mix = 0.5\nat 2:1 a.cutoff = 1kHz\nevery 1 bar: a.mix = rand(0, 1)\nramp a.cutoff 100Hz -> 1kHz over 1 bar`)
    expect(describePlan(r.plan)).toEqual({
      seed: 1,
      loads: [{ name: 'a', iri: IRI, line: 1 }],
      steps: [
        { line: 2, when: 'now', do: 'set a.mix' },
        { line: 3, when: 'at beat 4', do: 'set a.cutoff' },
        { line: 4, when: 'every 4 beats', do: 'set a.mix' },
        { line: 5, when: 'now', do: 'ramp a.cutoff' }
      ]
    })
    expect(JSON.stringify(describePlan(r.plan))).not.toContain('"expr"')
  })
})

describe('through the script_run tool', () => {
  const asTool = () => {
    // The reel already holds the tools that load, so this set needs only the tool that runs a script.
    const { reel, dispatcher } = rig
    return createTools({ dispatcher, reel }).find(t => t.name === 'script_run').handler
  }

  it('checks a script and describes it, then runs it, with the reel the page builds', async () => {
    const run = asTool()
    const dry = await run({ source: `${load}a.mix = 0.4`, dryRun: true })
    expect(dry.ok).toBe(true)
    expect(dry.plan.steps).toEqual([{ line: 2, when: 'now', do: 'set a.mix' }])
    expect(rig.dispatcher.project.nodes).toHaveLength(0)

    const done = await run({ source: `${load}a.mix = 0.4` })
    expect(done).toEqual({ ok: true, swapped: 'now' })
    expect(rig.mix('n1')).toBe(0.4)
  })

  it('returns the planner\'s errors, with lines, through the tool', async () => {
    const r = await asTool()({ source: `${load}a.nope = 1` })
    expect(r.ok).toBe(false)
    expect(r.errors[0]).toMatchObject({ line: 2 })
    expect(r.errors[0].message).toMatch(/no parameter "nope"/)
  })
})
