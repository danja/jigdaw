// tests/reel/Planner.test.js
import { describe, it, expect } from 'vitest'
import { parse } from '../../src/reel/Parser.js'
import { plan, nearest, MAX_STATEMENTS } from '../../src/reel/Planner.js'

const FILTER = [
  { symbol: 'cutoff', unit: 'hz', minimum: 20, maximum: 20000 },
  { symbol: 'resonance', unit: null, minimum: 0, maximum: 1 },
  { symbol: 'gain', unit: 'db', minimum: -24, maximum: 12 },
  { symbol: 'time', unit: 'ms', minimum: 1, maximum: 2000 },
  { symbol: 'depth', unit: 'pc', minimum: 0, maximum: 200 },
  { symbol: 'shift', unit: 'semitone12TET', minimum: -24, maximum: 24 },
  { symbol: 'rate', unit: 'bpm', minimum: 20, maximum: 300 }
]
const IRI = 'https://example.org/plugins/filter/'

const context = (over = {}) => ({
  beatsPerBar: 4,
  existing: new Map(),
  resolvePlugin: async () => ({ ok: true, ports: FILTER }),
  ...over
})

async function planOf (source, over) {
  const parsed = parse(source)
  expect(parsed.errors).toEqual([])
  return plan(parsed.statements, context(over))
}

const header = `load f = ${IRI}\n`
const fails = async (body, pattern, over) => {
  const r = await planOf(header + body, over)
  expect(r.ok, body).toBe(false)
  expect(r.errors.map(e => e.message).join(' | '), body).toMatch(pattern)
  return r.errors
}

describe('a script that plans', () => {
  it('produces loads, lets and steps with beats worked out from the signature', async () => {
    const r = await planOf(`${header}let c = 800Hz
f.cutoff = c * 2
at 3:2 f.resonance = 0.5
every 1 bar: f.gain = pick(-6dB, 0dB)
every 2 beats: f.shift = 7st
ramp f.cutoff 200Hz -> 8kHz over 2 bars
`)
    expect(r.ok).toBe(true)
    expect(r.plan.loads).toEqual([{ name: 'f', iri: IRI, line: 1 }])
    expect(r.plan.lets.map(l => l.name)).toEqual(['c'])
    expect(r.plan.steps.map(s => s.when)).toEqual([
      { kind: 'now' }, { kind: 'at', beat: 9 }, { kind: 'every', beats: 4 }, { kind: 'every', beats: 2 }, { kind: 'now' }
    ])
    expect(r.plan.steps[4].action).toMatchObject({ type: 'ramp', lengthBeats: 8 })
  })

  it('follows the signature: a bar is three beats in 3/4', async () => {
    const r = await planOf(`${header}at 2:1 f.resonance = 0.1\nevery 1 bar: f.resonance = 0.2`, { beatsPerBar: 3 })
    expect(r.plan.steps.map(s => s.when)).toEqual([{ kind: 'at', beat: 3 }, { kind: 'every', beats: 3 }])
  })

  it('takes the seed, and leaves one by default', async () => {
    expect((await planOf(`${header}seed 42`)).plan.seed).toBe(42)
    expect((await planOf(header)).plan.seed).toBe(1)
  })

  it('knows plugins already in the project by their names', async () => {
    const existing = new Map([['bass', { ports: FILTER }]])
    const r = await planOf('bass.cutoff = 1kHz\nconnect bass -> bass', { existing })
    expect(r.ok).toBe(true)
  })

  it('carries each port\'s own scale into the step, so the runner converts', async () => {
    const khz = [{ symbol: 'freq', unit: 'khz', minimum: 0.02, maximum: 20 }]
    const r = await planOf(`load k = ${IRI}\nk.freq = 8kHz`, { resolvePlugin: async () => ({ ok: true, ports: khz }) })
    expect(r.plan.steps[0].action.port).toMatchObject({ factor: 1 / 1000, minimum: 0.02, maximum: 20 })
  })
})

describe('a script that does not plan, and why', () => {
  it('names a plugin that is not there, with the nearest names', async () => {
    const e = await fails('flter.cutoff = 1kHz', /no plugin called "flter"; nearest: f/)
    expect(e[0].line).toBe(2)
  })

  it('names a parameter that is not there, with the nearest symbols', async () => {
    await fails('f.cutof = 1kHz', /f has no parameter "cutof"; nearest: cutoff/)
  })

  it('refuses a unit the parameter is not in', async () => {
    await fails('f.cutoff = 6dB', /f\.cutoff is in hz, and this value is db/)
    await fails('f.gain = 8kHz', /f\.gain is in db, and this value is hz/)
    await fails('f.resonance = 8kHz', /takes a plain number|not a hz/)
    await fails('f.rate = 4Hz', /f\.rate takes bpm, not a hz quantity/)
  })

  it('refuses a constant outside the range', async () => {
    await fails('f.cutoff = 40kHz', /can be set to 40000, outside its range 20 to 20000/)
    await fails('f.gain = -40dB', /outside its range -24 to 12/)
  })

  it('refuses a rand or a pick that could leave the range, though most draws would not', async () => {
    await fails('f.cutoff = rand(100Hz, 30kHz)', /100 to 30000, outside/)
    await fails('f.cutoff = pick(400Hz, 800Hz, 99kHz)', /outside its range/)
    await fails('every 1 bar: f.gain = pick(-6dB, 0dB, 18dB)', /outside its range/)
  })

  it('converts units before it compares ranges', async () => {
    expect((await planOf(`${header}f.time = 2s`)).ok).toBe(true)
    await fails('f.time = 3s', /3000, outside its range 1 to 2000/)
    expect((await planOf(`${header}f.depth = 150%`)).ok).toBe(true)
    await fails('f.depth = 250%', /outside/)
  })

  it('refuses an undefined variable and a duplicate let', async () => {
    await fails('f.cutoff = x', /"x" is not defined/)
    await fails('let a = 1\nlet a = 2', /"a" is already defined/)
  })

  it('uses what a let was bounded to, so a bad value is caught through a variable', async () => {
    await fails('let big = 30kHz\nf.cutoff = big', /30000, outside/)
  })

  it('refuses a ramp inside every, and checks both ends of a ramp', async () => {
    await fails('every 1 bar: ramp f.cutoff 200Hz -> 8kHz over 1 bar', /cannot be repeated/)
    await fails('ramp f.cutoff 200Hz -> 90kHz over 1 bar', /outside its range/)
    await fails('ramp f.cutoff 1Hz -> 8kHz over 1 bar', /outside its range/)
  })

  it('refuses a duplicate plugin name, and a name already in the project', async () => {
    await fails(`load f = ${IRI}`, /"f" is already a plugin name/)
    const existing = new Map([['bass', { ports: FILTER }]])
    await fails(`load bass = ${IRI}`, /"bass" is already a plugin name/, { existing })
  })

  it('reports a plugin that fails validation, with the reason and the step', async () => {
    const resolvePlugin = async () => ({ ok: false, message: 'digest does not match', step: 'integrity' })
    const e = await fails('f.cutoff = 1kHz', /cannot load f from .*: digest does not match \(at integrity\)/, { resolvePlugin })
    // The failed plugin is reported once, and its uses are not reported as unknown names.
    expect(e).toHaveLength(1)
  })

  it('reports a plugin whose validation throws, as a refusal and not a crash', async () => {
    const resolvePlugin = async () => { throw new Error('network down') }
    await fails('f.cutoff = 1kHz', /network down/, { resolvePlugin })
  })

  it('reports every error in the script together', async () => {
    const r = await planOf(`${header}f.cutoff = 6dB\nf.nope = 1\nflter.cutoff = 1\nf.gain = 99dB`)
    expect(r.errors.map(e => e.line)).toEqual([2, 3, 4, 5])
  })

  it('refuses a script over the statement limit', async () => {
    const statements = parse(Array.from({ length: MAX_STATEMENTS + 1 }, () => 'seed 1').join('\n')).statements
    const r = await plan(statements, context())
    expect(r.ok).toBe(false)
    expect(r.errors[0].message).toMatch(/limited to 500 statements/)
  })

  it('refuses a connect to a plugin that is not there', async () => {
    await fails('connect f -> nowhere', /no plugin called "nowhere"/)
  })
})

describe('loading a plugin is validated before anything else', () => {
  it('asks the host to validate every plugin the script loads, once per address, all before awaiting any', async () => {
    const calls = []
    let release
    const gate = new Promise(r => { release = r })
    const resolvePlugin = async iri => {
      calls.push(iri)
      await gate
      return { ok: true, ports: FILTER }
    }
    const parsed = parse(`load a = ${IRI}\nload b = https://example.org/plugins/other/\nload c = ${IRI}`)
    const pending = plan(parsed.statements, context({ resolvePlugin }))
    // Let the planner start; no fetch has finished, and all distinct ones have begun.
    await new Promise(r => setTimeout(r, 10))
    expect(calls).toEqual([IRI, 'https://example.org/plugins/other/'])
    release()
    expect((await pending).ok).toBe(true)
  })

  it('does not plan a statement that uses a plugin which failed to validate', async () => {
    const resolvePlugin = async iri => (iri === IRI ? { ok: false, message: 'refused' } : { ok: true, ports: FILTER })
    const r = await planOf(`${header}load g = https://example.org/plugins/other/\ng.cutoff = 1kHz\nf.cutoff = 1kHz`, { resolvePlugin })
    expect(r.ok).toBe(false)
    expect(r.plan).toBeUndefined()
  })
})

describe('nearest', () => {
  it('orders by edit distance', () => {
    expect(nearest('cutof', ['gain', 'cutoff', 'cut', 'resonance'])[0]).toBe('cutoff')
  })
})
