// tests/reel/Runner.test.js
//
// The runner against a fake tool set and a scheduler the test drives by hand, then against the real
// dispatcher through the real tools, which is the only proof that a script has no capability the tools lack.
import { describe, it, expect } from 'vitest'
import { parse } from '../../src/reel/Parser.js'
import { plan } from '../../src/reel/Planner.js'
import { createRunner, TICK_BUDGET } from '../../src/reel/Runner.js'
import { createTools } from '../../src/mcp/tools.js'
import { OpDispatcher } from '../../src/ops/OpDispatcher.js'

const PORTS = [
  { symbol: 'cutoff', unit: 'hz', minimum: 20, maximum: 20000 },
  { symbol: 'mix', unit: null, minimum: 0, maximum: 1 },
  { symbol: 'freq', unit: 'khz', minimum: 0.02, maximum: 20 }
]
const IRI = 'https://example.org/plugins/filter/'

function fakeScheduler () {
  const jobs = []
  return {
    jobs,
    at (beat, fn) { const j = { kind: 'at', beat, fn, live: true }; jobs.push(j); return () => { j.live = false } },
    every (beats, fn) { const j = { kind: 'every', beats, fn, live: true }; jobs.push(j); return () => { j.live = false } },
    /** Fire every live job of a kind, `times` times, as the transport would. */
    async fire (kind, times = 1) {
      for (let i = 0; i < times; i++) for (const j of jobs) if (j.kind === kind && j.live) await j.fn()
    }
  }
}

function fakeTools (over = {}) {
  const calls = []
  const record = name => async args => { calls.push({ tool: name, args }); return { ok: true } }
  const tools = {
    plugin_load: async args => { calls.push({ tool: 'plugin_load', args }); return { ok: true, nodeId: `node-${calls.length}` } },
    parameter_set: record('parameter_set'),
    envelope_add: record('envelope_add'),
    connection_add: record('connection_add'),
    ...over
  }
  return { tools, calls }
}

async function setup (source, { tools: toolOver, ports = PORTS, currentBeat = () => 0, existing = new Map(), session } = {}) {
  const parsed = parse(source)
  expect(parsed.errors).toEqual([])
  const planned = await plan(parsed.statements, { beatsPerBar: 4, existing, resolvePlugin: async () => ({ ok: true, ports }) })
  expect(planned.errors ?? []).toEqual([])
  const { tools, calls } = fakeTools(toolOver)
  const scheduler = fakeScheduler()
  const runner = createRunner({ tools, scheduler, session: session ?? { names: new Map() }, beatsPerBar: 4, currentBeat })
  return { plan: planned.plan, runner, calls, scheduler, tools }
}

const header = `load f = ${IRI}\n`
const values = calls => calls.filter(c => c.tool === 'parameter_set').map(c => c.args.value)

describe('running a plan', () => {
  it('loads first, then sets what is to be set now, and records the names', async () => {
    const { plan, runner, calls } = await setup(`${header}f.cutoff = 8kHz\nf.mix = 0.5`)
    const result = await runner.run(plan)
    expect(result.ok).toBe(true)
    expect(calls.map(c => c.tool)).toEqual(['plugin_load', 'parameter_set', 'parameter_set'])
    expect(calls[0].args).toEqual({ iri: IRI })
    expect(calls[1].args).toMatchObject({ symbol: 'cutoff', value: 8000 })
    expect(result.names.get('f')).toBe(calls[1].args.node)
  })

  it('converts into the port\'s own unit', async () => {
    const { plan, runner, calls } = await setup(`${header}f.freq = 8kHz`)
    await runner.run(plan)
    expect(values(calls)).toEqual([8])
  })

  it('holds a statement placed in time until the transport reaches it, then does it', async () => {
    const { plan, runner, calls, scheduler } = await setup(`${header}at 3:1 f.mix = 0.9`)
    await runner.run(plan)
    expect(calls.map(c => c.tool)).toEqual(['plugin_load'])
    expect(scheduler.jobs).toHaveLength(1)
    expect(scheduler.jobs[0]).toMatchObject({ kind: 'at', beat: 8 })
    await scheduler.fire('at')
    expect(values(calls)).toEqual([0.9])
  })

  it('repeats an every on each beat it is given, and stop cancels it', async () => {
    const { plan, runner, calls, scheduler } = await setup(`${header}every 1 bar: f.mix = 0.5`)
    const run = await runner.run(plan)
    expect(scheduler.jobs[0]).toMatchObject({ kind: 'every', beats: 4 })
    await scheduler.fire('every', 3)
    expect(values(calls)).toHaveLength(3)
    run.stop()
    await scheduler.fire('every', 3)
    expect(values(calls)).toHaveLength(3)
  })

  it('evaluates a let once, so an every that uses it repeats the same value', async () => {
    const { plan, runner, calls, scheduler } = await setup(`${header}let c = rand(100Hz, 9kHz)\nevery 1 beat: f.cutoff = c`)
    await runner.run(plan)
    await scheduler.fire('every', 4)
    expect(new Set(values(calls)).size).toBe(1)
  })

  it('gives two lets that draw at random different values, because they share one generator', async () => {
    const { plan, runner, calls } = await setup(`${header}let a = rand(1, 2)\nlet b = rand(1, 2)\nf.mix = a - 1\nf.mix = b - 1`)
    await runner.run(plan)
    const [first, second] = values(calls)
    expect(first).not.toBe(second)
  })

  it('draws a new value on each firing of a pick, and repeats exactly for the same seed', async () => {
    const draws = async seed => {
      const { plan, runner, calls, scheduler } = await setup(`${header}seed ${seed}\nevery 1 beat: f.cutoff = pick(100Hz, 200Hz, 400Hz, 800Hz, 1600Hz)`)
      await runner.run(plan)
      await scheduler.fire('every', 12)
      return values(calls)
    }
    const a = await draws(7)
    expect(await draws(7)).toEqual(a)
    expect(await draws(8)).not.toEqual(a)
    expect(new Set(a).size).toBeGreaterThan(1)
  })
})

describe('ramps', () => {
  it('places a ramp that has its own start as an envelope at that beat', async () => {
    const { plan, runner, calls } = await setup(`${header}at 2:1 ramp f.cutoff 200Hz -> 8kHz over 2 bars`)
    await runner.run(plan)
    const e = calls.find(c => c.tool === 'envelope_add').args
    expect(e.symbol).toBe('cutoff')
    expect(e.points).toEqual([
      { atBeat: 4, value: 200, curve: 'linear' },
      { atBeat: 12, value: 8000 }
    ])
  })

  it('starts an unplaced ramp on the next bar line, never in the middle of one', async () => {
    const { plan, runner, calls } = await setup(`${header}ramp f.cutoff 200Hz -> 8kHz over 1 bar`, { currentBeat: () => 5.5 })
    await runner.run(plan)
    expect(calls.find(c => c.tool === 'envelope_add').args.points.map(p => p.atBeat)).toEqual([8, 12])
  })

  it('starts on this beat when the transport is exactly on a bar line', async () => {
    const { plan, runner, calls } = await setup(`${header}ramp f.cutoff 200Hz -> 8kHz over 1 bar`, { currentBeat: () => 8 })
    await runner.run(plan)
    expect(calls.find(c => c.tool === 'envelope_add').args.points[0].atBeat).toBe(8)
  })
})

describe('when the world changes under a validated plan, the music goes on', () => {
  it('reports a failed statement and carries on with the rest', async () => {
    const done = []
    const { plan, runner } = await setup(`${header}f.cutoff = 1kHz\nf.mix = 0.5`, {
      tools: { parameter_set: async args => { if (args.symbol === 'cutoff') return { ok: false, error: 'plugin gone' }; done.push(args.symbol); return { ok: true } } }
    })
    const result = await runner.run(plan)
    expect(result.ok).toBe(false)
    expect(result.errors).toEqual([{ line: 2, message: 'plugin gone' }])
    expect(done).toEqual(['mix'])
  })

  it('calls onError as it happens, so a person sees it while playing', async () => {
    const seen = []
    const { plan, runner } = await setup(`${header}f.cutoff = 1kHz`, { tools: { parameter_set: async () => ({ ok: false, error: 'nope' }) } })
    await runner.run(plan, { onError: e => seen.push(e) })
    expect(seen).toEqual([{ line: 2, message: 'nope' }])
  })

  it('cancels a repeating statement that fails, so it is not retried every beat', async () => {
    let attempts = 0
    const { plan, runner, scheduler } = await setup(`${header}every 1 beat: f.mix = 0.5`, {
      tools: { parameter_set: async () => { attempts++; return { ok: false, error: 'gone' } } }
    })
    const result = await runner.run(plan)
    await scheduler.fire('every', 5)
    expect(attempts).toBe(1)
    expect(result.errors).toHaveLength(1)
    expect(scheduler.jobs[0].live).toBe(false)
  })

  it('leaves the other schedules running when one is cancelled', async () => {
    let bad = 0
    const good = []
    const { plan, runner, scheduler } = await setup(`${header}every 1 beat: f.cutoff = 1kHz\nevery 1 beat: f.mix = 0.5`, {
      tools: { parameter_set: async args => { if (args.symbol === 'cutoff') { bad++; return { ok: false, error: 'x' } } good.push(args.symbol); return { ok: true } } }
    })
    await runner.run(plan)
    await scheduler.fire('every', 4)
    expect(bad).toBe(1)
    expect(good).toEqual(['mix', 'mix', 'mix', 'mix'])
  })

  it('reports a statement whose plugin could not be loaded, and does not throw', async () => {
    const { plan, runner } = await setup(`${header}f.cutoff = 1kHz`, { tools: { plugin_load: async () => ({ ok: false, error: 'offline' }) } })
    const result = await runner.run(plan)
    expect(result.ok).toBe(false)
    expect(result.errors.map(e => e.message)).toEqual(['cannot load f: offline', 'f is not loaded'])
  })

  it('stops an expression too big for a tick, reports it, and cancels that statement', async () => {
    const huge = Array.from({ length: TICK_BUDGET + 50 }, () => '1').join(' + ')
    const { plan, runner, scheduler } = await setup(`${header}every 1 beat: f.mix = (${huge}) - (${huge})`)
    const result = await runner.run(plan)
    await scheduler.fire('every', 3)
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0].message).toMatch(/too large to run inside a tick/)
    expect(scheduler.jobs[0].live).toBe(false)
  })

  it('never writes a value outside the port\'s range, whatever the expression came to', async () => {
    const { plan, runner, calls } = await setup(`${header}f.mix = 0.5`)
    plan.steps[0].action.port = { ...plan.steps[0].action.port, maximum: 0.25 }
    await runner.run(plan)
    expect(values(calls)).toEqual([0.25])
  })
})

describe('the runner needs what a script needs', () => {
  it('refuses to be made without a tool a statement depends on', () => {
    const { tools } = fakeTools()
    delete tools.envelope_add
    expect(() => createRunner({ tools, scheduler: fakeScheduler(), session: { names: new Map() }, beatsPerBar: 4 })).toThrow(/no envelope_add tool/)
  })

  it('knows names from a previous run in the same session', async () => {
    const session = { names: new Map([['bass', 'node-bass']]) }
    const existing = new Map([['bass', { ports: PORTS }]])
    const { plan, runner, calls } = await setup('bass.mix = 0.3', { session, existing })
    await runner.run(plan)
    expect(calls[0].args).toMatchObject({ node: 'node-bass', value: 0.3 })
  })
})

describe('through the real dispatcher and the real tools', () => {
  async function real (source) {
    const dispatcher = new OpDispatcher()
    let counter = 0
    const loadPlugin = async iri => {
      counter++
      const track = `t${counter}`
      const node = `n${counter}`
      dispatcher.apply([{ op: 'addTrack', id: track }, { op: 'addNode', id: node, track, pluginIri: iri }])
      return {
        ok: true, nodeId: node, trackId: track, revision: dispatcher.revision,
        entry: { profile: { label: 'Filter', ports: PORTS.map(p => ({ ...p, name: p.symbol, defaultValue: p.minimum })) }, ready: { latencyFrames: 0 } }
      }
    }
    const list = createTools({ dispatcher, loadPlugin })
    const tools = Object.fromEntries(list.map(t => [t.name, t.handler]))
    const parsed = parse(source)
    const planned = await plan(parsed.statements, { beatsPerBar: 4, existing: new Map(), resolvePlugin: async () => ({ ok: true, ports: PORTS }) })
    expect(planned.errors ?? []).toEqual([])
    const scheduler = fakeScheduler()
    const runner = createRunner({ tools, scheduler, session: { names: new Map() }, beatsPerBar: 4 })
    return { dispatcher, runner, plan: planned.plan, scheduler }
  }

  it('sets a parameter, connects two plugins and places an envelope, in the project', async () => {
    const { dispatcher, runner, plan: p } = await real(`load a = ${IRI}\nload b = ${IRI}\na.cutoff = 2kHz\nconnect a -> b\nat 1:1 ramp b.cutoff 200Hz -> 4kHz over 1 bar`)
    const result = await runner.run(p)
    expect(result.errors).toEqual([])
    expect(dispatcher.project.nodes.find(n => n.id === 'n1').settings.get('cutoff')).toBe(2000)
    expect(dispatcher.project.connections).toHaveLength(1)
    expect(dispatcher.project.connections[0]).toMatchObject({ from: { node: 'n1' }, to: { node: 'n2' } })
    expect(dispatcher.project.envelopes?.length ?? dispatcher.project.snapshot().envelopes?.length).toBe(1)
  })

  it('does a timed set through the same dispatcher when the transport gets there', async () => {
    const { dispatcher, runner, plan: p, scheduler } = await real(`load a = ${IRI}\nevery 1 bar: a.mix = pick(0.2, 0.4)`)
    await runner.run(p)
    expect(dispatcher.project.nodes.find(n => n.id === 'n1').settings.has('mix')).toBe(false)
    await scheduler.fire('every', 2)
    expect([0.2, 0.4]).toContain(dispatcher.project.nodes.find(n => n.id === 'n1').settings.get('mix'))
  })

  it('is one undo step for the run, and the timed firings after it are not steps', async () => {
    const dispatcher = new OpDispatcher()
    const loadPlugin = async iri => {
      dispatcher.apply([{ op: 'addTrack', id: 't1' }, { op: 'addNode', id: 'n1', track: 't1', pluginIri: iri }])
      return { ok: true, nodeId: 'n1', trackId: 't1', revision: dispatcher.revision, entry: { profile: { label: 'F', ports: [] }, ready: { latencyFrames: 0 } } }
    }
    const tools = Object.fromEntries(createTools({ dispatcher, loadPlugin }).map(t => [t.name, t.handler]))
    const planned = await plan(parse(`load a = ${IRI}\na.mix = 0.7\na.cutoff = 1kHz\nevery 1 beat: a.mix = rand(0, 1)`).statements,
      { beatsPerBar: 4, existing: new Map(), resolvePlugin: async () => ({ ok: true, ports: PORTS }) })
    const scheduler = fakeScheduler()
    const runner = createRunner({ tools, scheduler, session: { names: new Map() }, beatsPerBar: 4, unrecorded: fn => dispatcher.withoutRecording(fn) })

    await dispatcher.grouped(() => runner.run(planned.plan))
    const settings = () => dispatcher.project.nodes.find(n => n.id === 'n1')?.settings
    expect(settings().get('cutoff')).toBe(1000)

    await scheduler.fire('every', 150) // far more firings than the history can hold
    const performed = settings().get('mix')
    expect(performed).not.toBe(0.7)

    await dispatcher.undo() // the whole run, at once
    expect(dispatcher.project.nodes.find(n => n.id === 'n1')).toBeUndefined()
    expect(dispatcher.canUndo()).toBe(false)
  })

  it('is undoable, because it goes through apply like any edit', async () => {
    const { dispatcher, runner, plan: p } = await real(`load a = ${IRI}\na.mix = 0.7`)
    await runner.run(p)
    expect(dispatcher.project.nodes.find(n => n.id === 'n1').settings.get('mix')).toBe(0.7)
    await dispatcher.undo()
    expect(dispatcher.project.nodes.find(n => n.id === 'n1').settings.has('mix')).toBe(false)
  })
})
