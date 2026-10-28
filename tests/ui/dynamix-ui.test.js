// tests/ui/dynamix-ui.test.js
//
// Dynamix's own editor (plugins/dynamix/ui/index.html, built from src.html by bin/inline-ui.js) run in Node
// against a linkedom document, with the real Dynamix profile as the host would send it.
//
// The curve it draws is held to the module that makes the sound: the same settings are given to the
// wasm and to the page's transferDb, and the levels must agree. A curve that shows a law the compressor
// does not apply is worse than no curve.
import { describe, it, expect, beforeAll } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { parseHTML } from 'linkedom'
import { profileAsJsonLd } from '../../src/rdf/ProfileJsonLd.js'
import { readProfile } from '../../src/rdf/ProfileReader.js'
import { parseTurtleFile } from '../../src/validate/files.js'

const dir = resolve(import.meta.dirname, '../../plugins/dynamix')
const html = readFileSync(resolve(dir, 'ui/index.html'), 'utf8')
const profileJson = JSON.parse(readFileSync(resolve(dir, 'profile.json'), 'utf8'))
const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]).join('\n')
const markup = html.replace(/<script>[\s\S]*?<\/script>/g, '')
let ld

beforeAll(async () => {
  ld = profileAsJsonLd(await readProfile(await parseTurtleFile(resolve(dir, 'profile.ttl')), profileJson.iri))
})

async function start () {
  const { document, window } = parseHTML(markup)
  const posted = []
  const parent = { postMessage: (message, origin) => posted.push({ message, origin }) }
  const listeners = []
  const env = { addEventListener: (type, fn) => listeners.push(fn), console }
  const { transferDb } = new Function('document', 'window', 'parent', `${scripts}\nreturn { transferDb }`)(document, env, parent)
  const deliver = data => { for (const fn of listeners) fn({ source: parent, origin: 'https://host.example', data }) }
  deliver({ type: 'init', profile: ld, parameters: {} })
  // The page registers its listeners when ready resolves, a microtask later.
  await Promise.resolve()
  return { document, deliver, posted, transferDb }
}

describe('dynamix, its own editor', () => {
  it('reaches every port the profile declares', async () => {
    const { document } = await start()
    const bound = new Set([...document.querySelectorAll('[data-param]')].map(el => el.getAttribute('data-param')))
    expect(profileJson.ports.map(p => p.symbol).filter(s => !bound.has(s))).toEqual([])
  })

  it('binds only ports the profile declares', async () => {
    const { document } = await start()
    const declared = new Set(profileJson.ports.map(p => p.symbol))
    const unknown = [...document.querySelectorAll('[data-param]')].map(el => el.getAttribute('data-param')).filter(s => !declared.has(s))
    expect(unknown).toEqual([])
  })

  it('shows the gain reduction in words and moves the dot when the processor reports it', async () => {
    const { document, deliver } = await start()
    deliver({ type: 'plugin', payload: { reduction: 6.04, level: -12 } })
    expect(document.getElementById('reduction-text').textContent).toBe('Gain reduction 6.0 dB')
    expect(document.getElementById('dot').getAttribute('cx')).not.toBe('-10')
  })

  it('puts the dot away when the stage is silent or off', async () => {
    const { document, deliver } = await start()
    deliver({ type: 'plugin', payload: { reduction: 0, level: -120 } })
    expect(document.getElementById('dot').getAttribute('cx')).toBe('-10')
  })

  it('caps an absurd reduction in words, as an expander on silence reports', async () => {
    const { document, deliver } = await start()
    deliver({ type: 'plugin', payload: { reduction: 411.3, level: -180 } })
    expect(document.getElementById('reduction-text').textContent).toBe('Gain reduction over 60 dB')
    expect(document.getElementById('reduction-bar').style.width).toBe('100%')
    expect(document.getElementById('dot').getAttribute('cx')).toBe('-10')
  })

  it('ignores a payload that is not a pair of numbers', async () => {
    const { document, deliver } = await start()
    deliver({ type: 'plugin', payload: { reduction: 'x', level: null } })
    expect(document.getElementById('reduction-text').textContent).toBe('Gain reduction 0.0 dB')
  })

  it('redraws the curve when the threshold moves', async () => {
    const { document, deliver } = await start()
    const before = document.getElementById('transfer').getAttribute('d')
    deliver({ type: 'parameter', symbol: 'threshold', value: -40 })
    expect(document.getElementById('transfer').getAttribute('d')).not.toBe(before)
  })
})

const wasmPath = resolve(dir, 'dynamix.wasm')
const describeBuilt = existsSync(wasmPath) ? describe : describe.skip

describeBuilt('the curve and the module agree', () => {
  const INDEX = { comp_enable: 0, comp_mode: 1, threshold: 2, ratio: 3, attack: 4, release: 5, knee: 6, makeup: 7, limit_enable: 8, clip_enable: 11 }

  async function run (settings, levelDb) {
    const { instance } = await WebAssembly.instantiate(readFileSync(wasmPath), {})
    const e = instance.exports
    e.jig_init(48000)
    const full = { comp_enable: 1, limit_enable: 0, clip_enable: 0, attack: 0.1, release: 5, ...settings }
    for (const [symbol, value] of Object.entries(full)) e.jig_set_param(INDEX[symbol], value)
    const frames = e.jig_max_frames()
    const input = [0, 1].map(c => new Float32Array(e.memory.buffer, e.jig_input_ptr(c), frames))
    const output = new Float32Array(e.memory.buffer, e.jig_output_ptr(0), frames)
    const lin = 10 ** (levelDb / 20)
    for (let block = 0; block < 200; block++) {
      input[0].fill(lin); input[1].fill(lin)
      e.jig_process(frames)
    }
    return { e, outDb: 20 * Math.log10(Math.abs(output[frames - 1])) }
  }

  const cases = [
    { name: 'a compressor above its knee', settings: { comp_mode: 0, threshold: -30, ratio: 4, knee: 0, makeup: 0 }, level: -12 },
    { name: 'a compressor inside a soft knee', settings: { comp_mode: 0, threshold: -20, ratio: 8, knee: 12, makeup: 0 }, level: -17 },
    { name: 'a compressor below its threshold, with make-up gain', settings: { comp_mode: 0, threshold: -20, ratio: 4, knee: 6, makeup: 6 }, level: -40 },
    { name: 'an expander below its threshold', settings: { comp_mode: 1, threshold: -30, ratio: 3, knee: 0, makeup: 0 }, level: -42 },
    { name: 'an expander above its threshold', settings: { comp_mode: 1, threshold: -30, ratio: 3, knee: 6, makeup: 0 }, level: -10 }
  ]

  for (const c of cases) {
    it(`draws ${c.name} where the module puts it`, async () => {
      const { transferDb } = await start()
      const { outDb } = await run(c.settings, c.level)
      const drawn = transferDb(c.level, { mode: c.settings.comp_mode, ...c.settings })
      // Loose by the module's own bound: it computes gain with a bit-pattern log and exp, good to about 0.03 dB.
      expect(outDb).toBeCloseTo(drawn, 0)
      expect(Math.abs(outDb - drawn)).toBeLessThan(0.3)
    })
  }

  it('reports the gain reduction and detector level the editor draws from', async () => {
    const { e, outDb } = await run({ comp_mode: 0, threshold: -30, ratio: 4, knee: 0, makeup: 0 }, -12)
    expect(e.jig_gain_reduction_db()).toBeCloseTo(-12 - outDb, 0)
    expect(e.jig_gain_reduction_db()).toBeGreaterThan(10)
    expect(e.jig_detector_db()).toBeCloseTo(-12, 0)
  })

  it('reports no reduction and no level with the stage off', async () => {
    const { e } = await run({ comp_enable: 0 }, -12)
    expect(e.jig_gain_reduction_db()).toBe(0)
    expect(e.jig_detector_db()).toBe(-120)
  })
})
