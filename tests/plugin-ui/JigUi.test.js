// tests/plugin-ui/JigUi.test.js
//
// The page-side bridge a plugin's own editor is built with (src/plugin-ui/JigUi.js), run against a linkedom
// document and a stand-in for the parent window. The profile it is given is the real thing, made by the
// host's own profileAsJsonLd from the real Dynamix profile, so the two ends are held to each other.
import { describe, it, expect, beforeAll } from 'vitest'
import { resolve } from 'node:path'
import { readFileSync } from 'node:fs'
import { parseHTML } from 'linkedom'
import { createBridge } from '../../src/plugin-ui/JigUi.js'
import { profileAsJsonLd } from '../../src/rdf/ProfileJsonLd.js'
import { readProfile } from '../../src/rdf/ProfileReader.js'
import { parseTurtleFile } from '../../src/validate/files.js'

const root = resolve(import.meta.dirname, '../..')
const HOST = 'https://host.example'
let ld

beforeAll(async () => {
  const iri = JSON.parse(readFileSync(resolve(root, 'plugins/dynamix/profile.json'), 'utf8')).iri
  ld = profileAsJsonLd(await readProfile(await parseTurtleFile(resolve(root, 'plugins/dynamix/profile.ttl')), iri))
})

const MARKUP = `<body>
  <label for="t" data-param-name="threshold"></label>
  <input id="t" type="range" data-param="threshold">
  <output data-param-text="threshold"></output>
  <input id="on" type="checkbox" data-param="comp_enable">
  <select id="mode" data-param="comp_mode"></select>
  <input id="ghost" type="range" data-param="no_such_port">
</body>`

function start () {
  const { document, window } = parseHTML(MARKUP)
  const posted = []
  const parent = { postMessage: (message, origin) => posted.push({ message, origin }) }
  const listeners = []
  const errors = []
  const env = { addEventListener: (type, fn) => listeners.push(fn), console: { error: m => errors.push(String(m)) } }
  const bridge = createBridge({ window: env, document, parent })
  const deliver = (data, { source = parent, origin = HOST } = {}) => { for (const fn of listeners) fn({ source, origin, data }) }
  const fire = (el, type) => el.dispatchEvent(new window.Event(type))
  const sent = () => posted.slice(1).map(p => p.message)
  return { bridge, document, posted, sent, deliver, fire, errors, parent }
}

const init = (parameters = {}) => ({ type: 'init', profile: ld, parameters })

describe('the handshake', () => {
  it('says ready to any origin and nothing else until the host initialises it', () => {
    const { posted } = start()
    expect(posted).toEqual([{ message: { type: 'ready' }, origin: '*' }])
  })

  it('ignores a message that is not from the parent window, or arrives before init', () => {
    const { bridge, deliver, sent, document } = start()
    deliver({ type: 'parameter', symbol: 'threshold', value: -3 })
    deliver(init(), { source: {} })
    expect(bridge.ports.size).toBe(0)
    document.getElementById('t').dispatchEvent(new document.defaultView.Event('input'))
    expect(sent()).toEqual([])
  })

  it('pins the host origin from init and addresses every message to it', () => {
    const { deliver, sent, posted, fire, document } = start()
    deliver(init())
    const input = document.getElementById('t')
    fire(input, 'input')
    expect(posted.slice(1).every(p => p.origin === HOST)).toBe(true)
    expect(sent().length).toBeGreaterThan(0)
  })

  it('ignores a later message from another origin', () => {
    const { bridge, deliver } = start()
    deliver(init({ threshold: -20 }))
    deliver({ type: 'parameter', symbol: 'threshold', value: 0 }, { origin: 'https://evil.example' })
    expect(bridge.value('threshold')).toBe(-20)
  })

  it('resolves ready with the ports once init arrives', async () => {
    const { bridge, deliver } = start()
    deliver(init())
    const { ports, parameters } = await bridge.ready
    expect(ports.size).toBe(ld.port.length)
    expect(parameters.threshold).toBe(-18)
  })
})

describe('binding', () => {
  it('takes range, step and name from the port', () => {
    const { deliver, document } = start()
    deliver(init())
    const t = document.getElementById('t')
    expect(t.min).toBe('-60')
    expect(t.max).toBe('0')
    expect(Number(t.step)).toBeCloseTo(0.3)
    expect(document.querySelector('[data-param-name]').textContent).toBe('Threshold')
  })

  it('writes the value with its unit, and says it in words for assistive technology', () => {
    const { deliver, document } = start()
    deliver(init({ threshold: -18 }))
    expect(document.querySelector('output').textContent).toBe('-18 dB')
    expect(document.getElementById('t').getAttribute('aria-valuetext')).toBe('-18 decibels')
  })

  it('fills a select from the port\'s scale points and shows the current one', () => {
    const { deliver, document } = start()
    deliver(init({ comp_mode: 1 }))
    const options = [...document.getElementById('mode').options]
    expect(options.map(o => o.textContent)).toEqual(['Compressor', 'Expander'])
    expect(options.find(o => o.selected).value).toBe('1')
  })

  it('shows a switch as checked from its value', () => {
    const { deliver, document } = start()
    deliver(init({ comp_enable: 0 }))
    expect(document.getElementById('on').checked).toBe(false)
    deliver({ type: 'parameter', symbol: 'comp_enable', value: 1 })
    expect(document.getElementById('on').checked).toBe(true)
  })

  it('hides a control bound to a port the plugin does not declare, and says so', () => {
    const { deliver, document, errors } = start()
    deliver(init())
    expect(document.getElementById('ghost').hidden).toBe(true)
    expect(errors.some(e => e.includes('no_such_port'))).toBe(true)
  })

  it('names a control that has no label of its own after its port', () => {
    const { deliver, document } = start()
    deliver(init())
    expect(document.getElementById('on').getAttribute('aria-label')).toBe('Comp/Exp On')
  })

  it('does not bind an element twice when bind runs again', () => {
    const { bridge, deliver, document, fire, sent } = start()
    deliver(init())
    bridge.bind(document)
    bridge.bind(document)
    fire(document.getElementById('on'), 'change')
    expect(sent().filter(m => m.type === 'parameter')).toHaveLength(1)
  })
})

describe('sending', () => {
  it('brackets a drag as one gesture and sends each move as a request', () => {
    const { deliver, document, fire, sent } = start()
    deliver(init())
    const t = document.getElementById('t')
    fire(t, 'pointerdown')
    t.value = '-30'; fire(t, 'input')
    t.value = '-25'; fire(t, 'input')
    fire(t, 'pointerup')
    expect(sent()).toEqual([
      { type: 'gesture', symbol: 'threshold', phase: 'begin' },
      { type: 'parameter', symbol: 'threshold', value: -30 },
      { type: 'parameter', symbol: 'threshold', value: -25 },
      { type: 'gesture', symbol: 'threshold', phase: 'end' }
    ])
  })

  it('makes a key press with no drag a whole gesture of its own', () => {
    const { deliver, document, fire, sent } = start()
    deliver(init())
    const t = document.getElementById('t')
    t.value = '-17.7'; fire(t, 'input')
    expect(sent().map(m => m.type === 'gesture' ? m.phase : m.value)).toEqual(['begin', -17.7, 'end'])
  })

  it('ends a gesture that a pointer cancel interrupts', () => {
    const { deliver, document, fire, sent } = start()
    deliver(init())
    const t = document.getElementById('t')
    fire(t, 'pointerdown'); fire(t, 'pointercancel'); fire(t, 'pointerup')
    expect(sent().filter(m => m.phase === 'end')).toHaveLength(1)
  })

  it('sends a switch as its range limits and a select as the chosen value', () => {
    const { deliver, document, fire, sent } = start()
    deliver(init({ comp_enable: 0 }))
    const on = document.getElementById('on')
    on.checked = true; fire(on, 'change')
    expect(sent().find(m => m.type === 'parameter')).toEqual({ type: 'parameter', symbol: 'comp_enable', value: 1 })
  })

  it('draws the value the host sends back, not the one it asked for', () => {
    const { deliver, document, fire, bridge } = start()
    deliver(init())
    const t = document.getElementById('t')
    t.value = '-5'; fire(t, 'input')
    expect(bridge.value('threshold')).toBe(-18)
    deliver({ type: 'parameter', symbol: 'threshold', value: -12 })
    expect(t.value).toBe('-12')
  })

  it('ignores a parameter message for a symbol the plugin does not declare', () => {
    const { deliver, bridge } = start()
    deliver(init())
    deliver({ type: 'parameter', symbol: 'nope', value: 1 })
    expect(bridge.value('nope')).toBeUndefined()
  })
})

describe('the plugin relay', () => {
  it('hands a processor payload to the page and sends the page\'s payload to the host', () => {
    const { bridge, deliver, sent } = start()
    const seen = []
    bridge.onPlugin(payload => seen.push(payload))
    deliver(init())
    deliver({ type: 'plugin', payload: { reduction: 3 } })
    bridge.sendPlugin({ ask: 1 })
    expect(seen).toEqual([{ reduction: 3 }])
    expect(sent()).toEqual([{ type: 'plugin', payload: { ask: 1 } }])
  })

  it('keeps going after a listener throws', () => {
    const { bridge, deliver } = start()
    const seen = []
    bridge.onPlugin(() => { throw new Error('page bug') })
    bridge.onPlugin(p => seen.push(p))
    deliver(init())
    deliver({ type: 'plugin', payload: 1 })
    expect(seen).toEqual([1])
  })
})
