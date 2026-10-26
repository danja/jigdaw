// tests/web/AddTrack.test.js
//
// The Add a track chooser's lifecycle against a stand-in dispatcher: what is loaded, what is removed, and what is left behind. The
// property that matters is that no trial track outlives the dialog, whichever way the dialog ends, including while a load is still
// under way. The stand-in refuses what the real one refuses: removing a track that is not there is an error here, as it is there.
import { describe, it, expect } from 'vitest'
import { parseHTML } from 'linkedom'
import { createAddTrack } from '../../web/app/AddTrack.js'

const results = [
  { iri: 'jig:pulse', homepage: 'https://example.test/pulse/', label: 'Pulse', comment: 'A square wave synth. Nine voices.', roles: ['Instrument'], web: true },
  { iri: 'jig:kit', label: 'Kit', comment: 'Drums.', roles: ['Instrument', 'DrumInstrument'], web: true },
  { iri: 'jig:boost', label: 'Boost', comment: 'Louder.', roles: ['AudioEffect'], web: true }
]

function setup ({ search = async () => ({ results }), addPlugin } = {}) {
  const { document } = parseHTML('<!doctype html><body></body>')
  const create = document.createElement.bind(document)
  document.createElement = tag => {
    const el = create(tag)
    if (tag === 'dialog') { el.showModal = () => { el.open = true }; el.close = () => { el.open = false } }
    return el
  }
  const tracks = new Set()
  // How deep inside withoutRecording each edit ran: a trial track made or removed at depth 0 would be an undo step.
  let depth = 0
  const depths = []
  const sent = []
  const logs = []
  let counter = 0
  const dispatcher = {
    async withoutRecording (fn) { depth += 1; try { return await fn() } finally { depth -= 1 } },
    async addPlugin (iri) {
      depths.push(`add ${depth}`)
      if (addPlugin) return addPlugin(iri)
      counter += 1
      tracks.add(`t${counter}`)
      return { ok: true, nodeId: `n${counter}`, trackId: `t${counter}` }
    },
    apply (changes) {
      depths.push(`remove ${depth}`)
      const track = changes.find(c => c.op === 'removeTrack')
      if (!tracks.has(track.id)) return { ok: false, message: `no such track: ${track.id}` }
      tracks.delete(track.id)
      return { ok: true }
    },
    sendEvents (id, events) { sent.push({ id, events }) }
  }
  const loaded = []
  const selected = []
  const emptied = []
  const ctx = {
    document,
    log: (message, kind) => logs.push({ message, kind }),
    runtime: { ensureRunning: async () => dispatcher },
    dispatcher,
    engine: { context: { currentTime: 1, sampleRate: 48000 } },
    rack: { forgetNode () {}, draw () {} },
    expose () {},
    loading: { loadPlugin: async (iri, options) => { loaded.push({ iri, options }); counter += 1; tracks.add(`t${counter}`); return `t${counter}` } },
    selection: { set: (kind, ids) => selected.push([kind, ids]) },
    browser: { catalogue: () => ({ search }) },
    arrangement: { addTrack: async () => { emptied.push(true) } }
  }
  return { ctx, document, tracks, sent, logs, loaded, selected, emptied, depths, chooser: createAddTrack(ctx) }
}

const buttonNamed = (document, name) => [...document.querySelectorAll('button')].find(b => b.getAttribute('aria-label') === name || b.textContent === name)
const click = (document, name) => buttonNamed(document, name).dispatchEvent(new document.defaultView.Event('click', { bubbles: true }))
const settle = () => new Promise(resolve => setTimeout(resolve, 0))

describe('opening the chooser', () => {
  it('lists the instruments the host can run, asked for by role, and no effect', async () => {
    let asked
    const { chooser, document } = setup({ search: async query => { asked = query; return { results } } })
    await chooser.open()
    expect(asked.role).toBe('Instrument')
    expect([...document.querySelectorAll('.sound-list strong')].map(e => e.textContent)).toEqual(['Kit', 'Pulse'])
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
    expect(focused?.getAttribute('aria-label')).toBe('Hear Kit')
  })

  it('is opened once, however many times it is asked', async () => {
    const { chooser, document } = setup()
    await chooser.open()
    await chooser.open()
    expect(document.querySelectorAll('dialog')).toHaveLength(1)
  })
})

describe('hearing a sound', () => {
  it('loads it onto a trial track and plays notes through that track, in time order, with each note off after its note on', async () => {
    const { chooser, document, tracks, sent } = setup()
    await chooser.open()
    click(document, 'Hear Pulse')
    await settle()
    expect([...tracks]).toEqual(['t1'])
    const { id, events } = sent[0]
    expect(id).toBe('n1')
    expect(events).toHaveLength(8)
    expect(events.every(e => e.frame >= 48000)).toBe(true)
    const on = events.filter(e => e.bytes[0] === 0x90)
    const off = events.filter(e => e.bytes[0] === 0x80)
    expect(on.map(e => e.bytes[1])).toEqual([60, 64, 67, 72])
    on.forEach((e, i) => expect(off[i].frame).toBeGreaterThan(e.frame))
    expect(document.querySelector('.sound-mark').textContent + document.querySelectorAll('.sound-mark')[1].textContent).toMatch(/trial track/)
  })

  it('makes and removes the trial track with recording off, so it is never a step to undo', async () => {
    const { chooser, document, depths } = setup()
    await chooser.open()
    click(document, 'Hear Pulse')
    await settle()
    click(document, 'Hear Kit')
    await settle()
    click(document, 'Cancel')
    await settle()
    expect(depths).toEqual(['add 1', 'remove 1', 'add 1', 'remove 1'])
  })

  it('plays drum notes for a drum kit', async () => {
    const { chooser, document, sent } = setup()
    await chooser.open()
    click(document, 'Hear Kit')
    await settle()
    expect(sent[0].events.filter(e => e.bytes[0] === 0x90).map(e => e.bytes[1])).toEqual([36, 42, 38, 42])
  })

  it('takes the last trial track away before it makes the next, so there is never more than one', async () => {
    const { chooser, document, tracks } = setup()
    await chooser.open()
    click(document, 'Hear Pulse')
    await settle()
    click(document, 'Hear Kit')
    await settle()
    expect([...tracks]).toEqual(['t2'])
  })

  it('says why a sound did not load and leaves no trial track', async () => {
    const { chooser, document, tracks, logs } = setup({ addPlugin: async () => ({ ok: false, step: 'digest', message: 'the module does not match its digest' }) })
    await chooser.open()
    click(document, 'Hear Pulse')
    await settle()
    expect(tracks.size).toBe(0)
    expect(document.querySelector('[role="status"]').textContent).toMatch(/did not load: the module does not match its digest/)
    expect(logs.at(-1).message).toMatch(/\[digest\]/)
  })

  it('ignores a second press while a load is under way, rather than loading two', async () => {
    let release
    let calls = 0
    const { chooser, document } = setup({ addPlugin: () => { calls += 1; return new Promise(resolve => { release = () => resolve({ ok: true, nodeId: 'n1', trackId: 't1' }) }) } })
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
  it('Cancel takes the trial track away and closes the dialog', async () => {
    const { chooser, document, tracks } = setup()
    await chooser.open()
    click(document, 'Hear Pulse')
    await settle()
    click(document, 'Cancel')
    await settle()
    expect(tracks.size).toBe(0)
    expect(chooser.isOpen()).toBe(false)
    expect(document.querySelectorAll('dialog')).toHaveLength(0)
  })

  it('Escape does the same as Cancel', async () => {
    const { chooser, document, tracks } = setup()
    await chooser.open()
    click(document, 'Hear Pulse')
    await settle()
    document.querySelector('dialog').dispatchEvent(new document.defaultView.Event('cancel'))
    await settle()
    expect(tracks.size).toBe(0)
    expect(chooser.isOpen()).toBe(false)
  })

  it('dismissed while the sound is still loading, removes the trial track as soon as it exists', async () => {
    let release
    const { chooser, document, tracks } = setup({ addPlugin: () => new Promise(resolve => { release = () => { tracks.add('t9'); resolve({ ok: true, nodeId: 'n9', trackId: 't9' }) } }) })
    await chooser.open()
    click(document, 'Hear Pulse')
    await settle()
    click(document, 'Cancel')
    await settle()
    release()
    await settle()
    expect(tracks.size).toBe(0)
  })

  it('An empty track takes the trial away, closes, and makes an empty track', async () => {
    const { chooser, document, tracks, emptied } = setup()
    await chooser.open()
    click(document, 'Hear Pulse')
    await settle()
    click(document, 'An empty track')
    await settle()
    expect(tracks.size).toBe(0)
    expect(emptied).toHaveLength(1)
    expect(chooser.isOpen()).toBe(false)
  })
})

describe('adding a sound', () => {
  it('takes the trial away, loads the sound onto a new track of its own, selects it and closes', async () => {
    const { chooser, document, tracks, loaded, selected } = setup()
    await chooser.open()
    click(document, 'Hear Pulse')
    await settle()
    click(document, 'Add Pulse')
    await settle()
    expect(loaded).toEqual([{ iri: 'https://example.test/pulse/', options: { newTrack: true } }])
    expect([...tracks]).toEqual(['t2'])
    expect(selected).toEqual([['track', ['t2']]])
    expect(chooser.isOpen()).toBe(false)
  })

  it('adds without having heard it, and then there is no trial to remove', async () => {
    const { chooser, document, loaded } = setup()
    await chooser.open()
    click(document, 'Add Kit')
    await settle()
    expect(loaded).toHaveLength(1)
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
