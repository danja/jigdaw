// tests/web/AddTrack.test.js
//
// The Add a track chooser's lifecycle against a stand-in dispatcher and loader: what is loaded, in what order, what is removed, and what is
// left behind. The property that matters is that no trial track outlives the dialog, whichever way the dialog ends, including while a load
// is still under way, and that a sound of several plugins is made and taken away whole. The stand-ins refuse what the real ones refuse:
// removing a track or a plugin that is not there is an error here, as it is there.
import { describe, it, expect } from 'vitest'
import { parseHTML } from 'linkedom'
import { createAddTrack } from '../../web/app/AddTrack.js'

const instruments = [
  { iri: 'jig:pulse', homepage: 'https://example.test/pulse/', label: 'Pulse', comment: 'A square wave synth. Nine voices.', roles: ['Instrument'], web: true },
  { iri: 'jig:kit', homepage: 'https://example.test/kit/', label: 'Kit', comment: 'Drums.', roles: ['Instrument', 'DrumInstrument'], web: true },
  { iri: 'jig:boost', label: 'Boost', comment: 'Louder.', roles: ['AudioEffect'], web: true }
]
const generators = [
  { iri: 'jig:beat', homepage: 'https://example.test/beat/', label: 'Beat', comment: 'Writes a beat.', roles: ['MidiGenerator'], produces: ['Midi', 'DrumMidi'], web: true }
]

function setup ({ search, loadPlugin } = {}) {
  const { document } = parseHTML('<!doctype html><body></body>')
  const create = document.createElement.bind(document)
  document.createElement = tag => {
    const el = create(tag)
    if (tag === 'dialog') { el.showModal = () => { el.open = true }; el.close = () => { el.open = false } }
    return el
  }
  const tracks = new Map()
  const nodes = new Map()
  // How deep inside withoutRecording each edit ran, and which edits were made as one group: a trial made at depth 0 would be an undo step.
  let depth = 0
  const events = []
  const groups = []
  const midiInputs = []
  const sent = []
  const logs = []
  const searches = []
  const tabs = []
  let counter = 0
  let nodeCounter = 0
  const dispatcher = {
    async withoutRecording (fn) { depth += 1; try { return await fn() } finally { depth -= 1 } },
    async grouped (fn, options) { groups.push(options.label); depth += 0; return fn() },
    apply (changes) {
      for (const change of changes) {
        events.push(`${change.op} ${depth}`)
        if (change.op === 'removeNode') {
          if (!nodes.has(change.id)) return { ok: false, message: `no such node: ${change.id}` }
          nodes.delete(change.id)
        } else if (change.op === 'removeTrack') {
          if (!tracks.has(change.id)) return { ok: false, message: `no such track: ${change.id}` }
          if ([...nodes.values()].some(n => n === change.id)) return { ok: false, message: `${change.id} still has plugins` }
          tracks.delete(change.id)
        } else if (change.op === 'setTrack') {
          midiInputs.push([change.id, change.midiInput])
        }
      }
      return { ok: true }
    },
    sendEvents (id, list) { sent.push({ id, events: list }) }
  }
  const loaded = []
  const loader = async (url, options = {}) => {
    loaded.push({ url, options, depth })
    if (loadPlugin) return loadPlugin(url, options)
    counter += options.newTrack ? 1 : 0
    const trackId = options.newTrack ? `t${counter}` : options.onto
    if (options.newTrack) tracks.set(trackId, true)
    nodeCounter += 1
    nodes.set(`n${nodeCounter}`, trackId)
    return { trackId, nodeId: `n${nodeCounter}` }
  }
  const selected = []
  const emptied = []
  let allowed = true
  const ctx = {
    document,
    log: (message, kind) => logs.push({ message, kind }),
    runtime: { ensureRunning: async () => dispatcher },
    dispatcher,
    engine: { context: { currentTime: 1, sampleRate: 48000 } },
    rack: { forgetNode () {}, draw () {} },
    expose () {},
    loading: { loadPlugin: loader },
    selection: { set: (kind, ids) => selected.push([kind, ids]) },
    browser: {
      catalogue: () => ({
        search: async query => {
          searches.push(query)
          if (search) return search(query)
          return { results: query.role === 'Instrument' ? instruments : generators }
        }
      })
    },
    arrangement: { addTrack: async () => { emptied.push(true) } },
    show: { allowsTab: () => allowed },
    tabs: { select: id => tabs.push(id) }
  }
  return { ctx, document, tracks, nodes, sent, logs, loaded, selected, emptied, events, groups, midiInputs, searches, tabs, deny: () => { allowed = false }, chooser: createAddTrack(ctx) }
}

const buttonNamed = (document, name) => [...document.querySelectorAll('button')].find(b => b.getAttribute('aria-label') === name || b.textContent === name)
const click = (document, name) => buttonNamed(document, name).dispatchEvent(new document.defaultView.Event('click', { bubbles: true }))
const settle = () => new Promise(resolve => setTimeout(resolve, 0))

describe('opening the chooser', () => {
  it('asks for the instruments and for the beat generators, by role, and lists them under their kinds', async () => {
    const { chooser, document, searches } = setup()
    await chooser.open()
    expect(searches).toContainEqual(expect.objectContaining({ role: 'Instrument' }))
    expect(searches).toContainEqual(expect.objectContaining({ role: 'MidiGenerator', produces: 'DrumMidi' }))
    expect([...document.querySelectorAll('h3')].map(h => h.textContent)).toEqual(['Instruments', 'Drums'])
    expect([...document.querySelectorAll('.sound-list strong')].map(e => e.textContent)).toEqual(['Pulse', 'Kit with Beat', 'Kit'])
    expect(chooser.isOpen()).toBe(true)
  })

  it('says why when the list could not be had, and still offers an empty track and Cancel', async () => {
    const { chooser, document, logs } = setup({ search: async () => { throw new Error('the catalogue answered 502') } })
    await chooser.open()
    expect(document.querySelector('[role="status"]').textContent).toMatch(/could not be listed: the catalogue answered 502/)
    expect(logs.at(-1).kind).toBe('error')
    expect(buttonNamed(document, 'An empty track')).toBeDefined()
    expect(buttonNamed(document, 'Cancel')).toBeDefined()
  })

  it('puts the focus on the first button, which is a Hear, and not on the list', async () => {
    const { chooser, document } = setup()
    let focused = null
    const original = document.createElement.bind(document)
    document.createElement = tag => { const el = original(tag); if (tag === 'button') el.focus = () => { focused ??= el }; return el }
    await chooser.open()
    expect(focused?.getAttribute('aria-label')).toBe('Hear Pulse')
  })

  it('is opened once, however many times it is asked', async () => {
    const { chooser, document } = setup()
    await chooser.open()
    await chooser.open()
    expect(document.querySelectorAll('dialog')).toHaveLength(1)
  })
})

describe('hearing a sound', () => {
  it('loads an instrument onto a trial track with recording off and plays notes through it, each note off after its note on', async () => {
    const { chooser, document, loaded, sent, tracks } = setup()
    await chooser.open()
    click(document, 'Hear Pulse')
    await settle()
    expect(loaded).toEqual([{ url: 'https://example.test/pulse/', options: { newTrack: true }, depth: 1 }])
    expect([...tracks.keys()]).toEqual(['t1'])
    const { id, events } = sent[0]
    expect(id).toBe('n1')
    expect(events).toHaveLength(8)
    expect(events.every(e => e.frame >= 48000)).toBe(true)
    const on = events.filter(e => e.bytes[0] === 0x90)
    const off = events.filter(e => e.bytes[0] === 0x80)
    expect(on.map(e => e.bytes[1])).toEqual([60, 64, 67, 72])
    on.forEach((e, i) => expect(off[i].frame).toBeGreaterThan(e.frame))
    expect([...document.querySelectorAll('.sound-mark')].map(m => m.textContent).filter(Boolean)).toEqual([' (on the trial track)'])
  })

  it('loads a generated drum sound as the generator, then the kit onto the same track, and plays the kit by hand', async () => {
    const { chooser, document, loaded, sent, midiInputs, tracks } = setup()
    await chooser.open()
    click(document, 'Hear Kit with Beat')
    await settle()
    expect(loaded.map(l => [l.url, l.options])).toEqual([
      ['https://example.test/beat/', { newTrack: true }],
      ['https://example.test/kit/', { onto: 't1' }]
    ])
    expect(loaded.every(l => l.depth === 1)).toBe(true)
    expect([...tracks.keys()]).toEqual(['t1'])
    // The kit, the second plugin, is the one that plays notes: it is the track's MIDI input and where the notes go.
    expect(midiInputs).toEqual([['t1', 'n2']])
    expect(sent[0].id).toBe('n2')
    expect(sent[0].events.filter(e => e.bytes[0] === 0x90).map(e => e.bytes[1])).toEqual([36, 42, 38, 42])
    expect(document.querySelector('[role="status"]').textContent).toMatch(/by hand.*Play then runs the beat/)
  })

  it('plays a kit alone with the same drum notes, and leaves its MIDI input as the loader made it', async () => {
    const { chooser, document, sent, midiInputs } = setup()
    await chooser.open()
    click(document, 'Hear Kit')
    await settle()
    expect(sent[0].events.filter(e => e.bytes[0] === 0x90).map(e => e.bytes[1])).toEqual([36, 42, 38, 42])
    expect(midiInputs).toEqual([])
  })

  it('takes the last trial track away, every plugin on it, before it makes the next, so there is never more than one', async () => {
    const { chooser, document, tracks, nodes } = setup()
    await chooser.open()
    click(document, 'Hear Kit with Beat')
    await settle()
    click(document, 'Hear Pulse')
    await settle()
    expect([...tracks.keys()]).toEqual(['t2'])
    expect([...nodes.keys()]).toEqual(['n3'])
  })

  it('makes and removes the trial with recording off, so it is never a step to undo', async () => {
    const { chooser, document, events, loaded } = setup()
    await chooser.open()
    click(document, 'Hear Kit with Beat')
    await settle()
    click(document, 'Cancel')
    await settle()
    expect(loaded.every(l => l.depth === 1)).toBe(true)
    // The track's MIDI input is moved to the kit, then both plugins and the track are taken away, every edit with recording off.
    expect(events).toEqual(['setTrack 1', 'removeNode 1', 'removeNode 1', 'removeTrack 1'])
  })

  it('leaves nothing behind when the second plugin does not load, and says so', async () => {
    let calls = 0
    const { chooser, document, tracks, nodes, ctx } = setup()
    const real = ctx.loading.loadPlugin
    ctx.loading.loadPlugin = async (url, options) => (++calls === 2 ? undefined : real(url, options))
    await chooser.open()
    click(document, 'Hear Kit with Beat')
    await settle()
    expect(tracks.size).toBe(0)
    expect(nodes.size).toBe(0)
    expect(document.querySelector('[role="status"]').textContent).toMatch(/did not load/)
  })

  it('ignores a second press while a load is under way, rather than loading two', async () => {
    let release
    let calls = 0
    const { chooser, document } = setup({ loadPlugin: () => { calls += 1; return new Promise(resolve => { release = () => resolve({ trackId: 't1', nodeId: 'n1' }) }) } })
    await chooser.open()
    click(document, 'Hear Pulse')
    click(document, 'Hear Kit')
    await settle()
    expect(calls).toBe(1)
    release()
    await settle()
  })
})

describe('ending the chooser leaves no trial track', () => {
  const hearThen = async (end) => {
    const made = setup()
    await made.chooser.open()
    click(made.document, 'Hear Kit with Beat')
    await settle()
    expect(made.tracks.size).toBe(1)
    await end(made)
    await settle()
    return made
  }

  it('Cancel takes the trial track and both its plugins away and closes the dialog', async () => {
    const { tracks, nodes, chooser, document } = await hearThen(({ document }) => click(document, 'Cancel'))
    expect(tracks.size).toBe(0)
    expect(nodes.size).toBe(0)
    expect(chooser.isOpen()).toBe(false)
    expect(document.querySelectorAll('dialog')).toHaveLength(0)
  })

  it('Escape does the same as Cancel', async () => {
    const { tracks, nodes, chooser } = await hearThen(({ document }) => document.querySelector('dialog').dispatchEvent(new document.defaultView.Event('cancel')))
    expect(tracks.size + nodes.size).toBe(0)
    expect(chooser.isOpen()).toBe(false)
  })

  it('dismissed while the sound is still loading, removes the trial track as soon as it exists', async () => {
    let release
    const made = setup()
    const real = made.ctx.loading.loadPlugin
    made.ctx.loading.loadPlugin = (url, options) => new Promise(resolve => { release = () => resolve(real(url, options)) })
    await made.chooser.open()
    click(made.document, 'Hear Pulse')
    await settle()
    click(made.document, 'Cancel')
    await settle()
    release()
    await settle()
    expect(made.tracks.size + made.nodes.size).toBe(0)
  })

  it('An empty track takes the trial away, closes, and makes an empty track', async () => {
    const { tracks, nodes, emptied, chooser } = await hearThen(({ document }) => click(document, 'An empty track'))
    expect(tracks.size + nodes.size).toBe(0)
    expect(emptied).toHaveLength(1)
    expect(chooser.isOpen()).toBe(false)
  })
})

describe('adding a sound', () => {
  it('takes the trial away, loads an instrument onto a new track as one group, selects the track and closes', async () => {
    const { chooser, document, tracks, loaded, selected, groups, tabs } = setup()
    await chooser.open()
    click(document, 'Hear Pulse')
    await settle()
    click(document, 'Add Pulse')
    await settle()
    expect(loaded.at(-1)).toEqual({ url: 'https://example.test/pulse/', options: { newTrack: true }, depth: 0 })
    expect([...tracks.keys()]).toEqual(['t2'])
    expect(selected).toEqual([['track', ['t2']]])
    expect(groups).toEqual(['Add a track'])
    expect(chooser.isOpen()).toBe(false)
    expect(tabs).toEqual([])
  })

  it('adds a generated drum sound as one group, with the kit as the input of the track, and puts the controls of the track in front', async () => {
    const { chooser, document, loaded, midiInputs, groups, tabs, tracks } = setup()
    await chooser.open()
    click(document, 'Add Kit with Beat')
    await settle()
    expect(loaded.map(l => l.options)).toEqual([{ newTrack: true }, { onto: 't1' }])
    expect(midiInputs).toEqual([['t1', 'n2']])
    expect(groups).toEqual(['Add a track'])
    expect(tabs).toEqual(['tracks'])
    expect([...tracks.keys()]).toEqual(['t1'])
  })

  it('does not switch tabs when the step does not draw the plugins tab, rather than being refused with a note', async () => {
    const { chooser, document, tabs, deny } = setup()
    deny()
    await chooser.open()
    click(document, 'Add Kit with Beat')
    await settle()
    expect(tabs).toEqual([])
  })

  it('does not put the controls in front for a kit played by hand', async () => {
    const { chooser, document, tabs } = setup()
    await chooser.open()
    click(document, 'Add Kit')
    await settle()
    expect(tabs).toEqual([])
  })

  it('adds without having heard it, and then there is no trial to remove', async () => {
    const { chooser, document, loaded, events } = setup()
    await chooser.open()
    click(document, 'Add Kit')
    await settle()
    expect(loaded).toHaveLength(1)
    expect(events).toEqual([])
    expect(chooser.isOpen()).toBe(false)
  })

  it('stays open and says so when the sound did not load, so another can be chosen', async () => {
    const { chooser, document, ctx } = setup()
    ctx.loading.loadPlugin = async () => undefined
    await chooser.open()
    click(document, 'Add Pulse')
    await settle()
    expect(chooser.isOpen()).toBe(true)
    expect(document.querySelector('[role="status"]').textContent).toMatch(/did not load/)
  })
})
