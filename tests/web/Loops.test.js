// tests/web/Loops.test.js
//
// The Loops dialog against stand-ins: where a loop goes (the selected track with an instrument, or a new track with a sound to suit it), what is one
// undo, and what is said when something cannot be done. As in the page there is no dispatcher until the first thing that needs sound asks for one,
// and the stand-ins refuse what the real ones refuse: a clip the model would reject is rejected here.
import { describe, it, expect, afterEach } from 'vitest'
import { parseHTML } from 'linkedom'
import { createLoops } from '../../web/app/Loops.js'

const index = {
  loops: [
    { id: 'rock', label: 'Rock', kind: 'drums', lengthBeats: 4, about: 'A beat.', licence: 'CC0-1.0', notes: [{ startBeat: 0, lengthBeats: 0.25, pitch: 36, velocity: 100 }, { startBeat: 2, lengthBeats: 0.25, pitch: 38, velocity: 100 }] },
    { id: 'walk', label: 'Walk', kind: 'bass', gain: 1.5, lengthBeats: 8, about: 'A line.', licence: 'CC0-1.0', notes: [{ startBeat: 0, lengthBeats: 1, pitch: 36, velocity: 96 }] }
  ],
  sets: [{ id: 'starter', label: 'Starter', about: 'Two parts.', licence: 'CC0-1.0', bpm: 100, key: 'A minor', loops: ['rock', 'walk'] }]
}
const instruments = [
  { iri: 'https://example.test/plugins/drumkit/', homepage: 'https://example.test/kit/', label: 'DrumKit', comment: 'Drums.', roles: ['Instrument', 'DrumInstrument'], web: true },
  { iri: 'https://example.test/plugins/pulse/', homepage: 'https://example.test/pulse/', label: 'Pulse', comment: 'A synth.', roles: ['Instrument'], web: true }
]

const realFetch = globalThis.fetch
afterEach(() => { globalThis.fetch = realFetch })

function setup ({ selectedTrack = null, tracks = {}, nodeRoles: roles = {}, failAfter = null, fetchResult = { ok: true, status: 200, json: async () => index }, applyFails = null, loadFails = false, search } = {}) {
  const { document } = parseHTML('<!doctype html><body></body>')
  Object.defineProperty(document, 'baseURI', { value: 'http://test.local/' })
  const create = document.createElement.bind(document)
  document.createElement = tag => {
    const el = create(tag)
    if (tag === 'dialog') { el.showModal = () => { el.open = true }; el.close = () => { el.open = false } }
    return el
  }
  globalThis.fetch = async url => { fetched.push(String(url)); return fetchResult }
  const fetched = []
  const trackMap = new Map(Object.entries(tracks))
  const nodeRoles = new Map(Object.entries(roles))
  const sent = []
  const groups = []
  const applied = []
  const loaded = []
  const selected = []
  const logs = []
  let running = false
  let counter = 0
  const dispatcher = {
    engineNode: id => (nodeRoles.has(id) ? { profile: { roles: nodeRoles.get(id) } } : { profile: { roles: [] } }),
    project: { get tracks () { return [...trackMap.values()] }, track: id => trackMap.get(id) ?? null, transport: { tempoPoints: [{ atBeat: 0, bpm: 120 }], beatsPerBar: 4 } },
    async grouped (fn, options) { groups.push(options.label); return fn() },
    apply (changes) {
      applied.push(...changes)
      if (applyFails) return { ok: false, message: applyFails }
      return { ok: true, results: changes.map(() => `clip-${++counter}`) }
    },
    sendEvents (id, events) { sent.push({ id, events }) }
  }
  const selection = { kind: selectedTrack ? 'track' : null, ids: selectedTrack ? [selectedTrack] : [], set: (kind, ids) => selected.push([kind, ids]) }
  const ctx = {
    document,
    log: (message, kind) => logs.push({ message, kind }),
    runtime: { ensureRunning: async () => { running = true; return dispatcher } },
    get dispatcher () { return running ? dispatcher : (selectedTrack ? dispatcher : null) },
    engine: { context: { currentTime: 1, sampleRate: 48000 } },
    transport: { position: () => ({ beat: 5.4 }) },
    selection,
    loading: {
      loadPlugin: async (url, options) => {
        loaded.push({ url, options })
        if (loadFails || (failAfter !== null && loaded.length > failAfter)) return undefined
        const trackId = loaded.length === 1 ? 'new-track' : `new-track-${loaded.length}`
        trackMap.set(trackId, { id: trackId, midiInput: 'n1' })
        return { trackId, nodeId: 'n1' }
      }
    },
    browser: { catalogue: () => ({ search: async query => (search ? search(query) : { results: instruments }) }) }
  }
  return { ctx, document, sent, groups, applied, loaded, selected, logs, fetched, loops: createLoops(ctx) }
}

const buttonNamed = (document, name) => [...document.querySelectorAll('button')].find(b => b.getAttribute('aria-label') === name || b.textContent === name)
const click = (document, name) => buttonNamed(document, name).dispatchEvent(new document.defaultView.Event('click', { bubbles: true }))
const settle = () => new Promise(resolve => setTimeout(resolve, 0))
const clips = applied => applied.filter(c => c.op === 'addClip')

describe('opening the dialog', () => {
  it('reads the library once and lists the loops under their kinds', async () => {
    const { loops, document, fetched } = setup()
    await loops.open()
    expect(fetched).toEqual(['http://test.local/loops/index.json'])
    expect([...document.querySelectorAll('h3')].map(h => h.textContent)).toEqual(['Starter sets', 'Drums', 'Bass'])
    await loops.open()
    expect(document.querySelectorAll('dialog')).toHaveLength(1)
  })

  it('offers no Hear when no track with an instrument is selected', async () => {
    const { loops, document } = setup()
    await loops.open()
    expect(buttonNamed(document, 'Hear Rock')).toBeUndefined()
    expect(buttonNamed(document, 'Add Rock')).toBeDefined()
  })

  it('offers no Hear for a selected track that has no instrument to play into', async () => {
    const { loops, document } = setup({ selectedTrack: 't1', tracks: { t1: { id: 't1', midiInput: null } } })
    await loops.open()
    expect(buttonNamed(document, 'Hear Rock')).toBeUndefined()
  })

  it('offers Hear for a pitched loop on a selected track with an instrument, and not for a drum loop on it', async () => {
    const { loops, document } = setup({ selectedTrack: 't1', tracks: { t1: { id: 't1', midiInput: 'n9' } } })
    await loops.open()
    expect(buttonNamed(document, 'Hear Walk')).toBeDefined()
    expect(buttonNamed(document, 'Hear Rock')).toBeUndefined()
  })

  it('offers Hear for a drum loop on a selected drum kit, and not for a pitched loop on it', async () => {
    const { loops, document } = setup({ selectedTrack: 't1', tracks: { t1: { id: 't1', midiInput: 'n9' } }, nodeRoles: { n9: ['http://purl.org/stuff/transmissions/Instrument', 'http://purl.org/stuff/transmissions/DrumInstrument'] } })
    await loops.open()
    expect(buttonNamed(document, 'Hear Rock')).toBeDefined()
    expect(buttonNamed(document, 'Hear Walk')).toBeUndefined()
  })

  it('says why when the library cannot be read, and still opens so it can be closed', async () => {
    const { loops, document, logs } = setup({ fetchResult: { ok: false, status: 404 } })
    await loops.open()
    expect(document.querySelector('[role="status"]').textContent).toMatch(/could not be read: the loop library answered 404/)
    expect(logs.at(-1).kind).toBe('error')
    expect(buttonNamed(document, 'Close')).toBeDefined()
  })

  it('says why when the library is malformed, with the loop and the reason', async () => {
    const { loops, document } = setup({ fetchResult: { ok: true, status: 200, json: async () => ({ loops: [{ ...index.loops[0], notes: [] }] }) } })
    await loops.open()
    expect(document.querySelector('[role="status"]').textContent).toMatch(/loop rock: needs at least one note/)
  })
})

describe('hearing a loop', () => {
  it('plays it through the instrument of the selected track, at the tempo of the project, a little ahead of the clock', async () => {
    const { loops, document, sent } = setup({ selectedTrack: 't1', tracks: { t1: { id: 't1', label: 'Keys', midiInput: 'n9' } } })
    await loops.open()
    click(document, 'Hear Walk')
    await settle()
    expect(sent).toHaveLength(1)
    expect(sent[0].id).toBe('n9')
    expect(sent[0].events).toHaveLength(2)
    expect(sent[0].events[0].frame).toBe(Math.round(1.05 * 48000))
    // One beat long at 120 bpm is half a second: 24000 frames.
    expect(sent[0].events[1].frame - sent[0].events[0].frame).toBe(24000)
    expect(document.querySelector('[role="status"]').textContent).toBe('Playing Walk through Keys.')
  })
})

describe('adding a loop to the selected track', () => {
  it('puts a clip at the playhead on it, as one group, and loads nothing', async () => {
    const { loops, document, applied, loaded, groups, selected } = setup({ selectedTrack: 't1', tracks: { t1: { id: 't1', midiInput: 'n9' } } })
    await loops.open()
    click(document, 'Add Walk')
    await settle()
    expect(clips(applied)).toHaveLength(1)
    expect(clips(applied)[0]).toMatchObject({ op: 'addClip', track: 't1', kind: 'midi', startBeat: 5, lengthBeats: 8 })
    expect(loaded).toEqual([])
    expect(groups).toEqual(['Add a loop'])
    expect(selected).toEqual([['track', ['t1']]])
    expect(document.querySelectorAll('dialog')).toHaveLength(0)
  })
})

describe('adding a loop with no track for it', () => {
  it('makes a track with the sound that suits the kind, and puts the clip at the start, as one group', async () => {
    const { loops, document, applied, loaded, groups, selected } = setup()
    await loops.open()
    click(document, 'Add Rock')
    await settle()
    expect(loaded).toEqual([{ url: 'https://example.test/kit/', options: { newTrack: true } }])
    expect(clips(applied)[0]).toMatchObject({ track: 'new-track', startBeat: 0 })
    expect(groups).toEqual(['Add a loop'])
    expect(selected).toEqual([['track', ['new-track']]])
  })

  it('uses a different sound for a different kind', async () => {
    const { loops, document, loaded } = setup()
    await loops.open()
    click(document, 'Add Walk')
    await settle()
    expect(loaded[0].url).toBe('https://example.test/pulse/')
  })

  it('gives a track made for a loop the level the loop suggests, and a loop with no suggestion no change to the fader', async () => {
    const walk = setup()
    await walk.loops.open()
    click(walk.document, 'Add Walk')
    await settle()
    expect(walk.applied.filter(c => c.op === 'setTrackChannel')).toEqual([{ op: 'setTrackChannel', track: 'new-track', gain: 1.5 }])
    const rock = setup()
    await rock.loops.open()
    click(rock.document, 'Add Rock')
    await settle()
    expect(rock.applied.filter(c => c.op === 'setTrackChannel')).toEqual([])
  })

  it('leaves the fader of a track the person already has alone, whatever the loop suggests', async () => {
    const { loops, document, applied } = setup({ selectedTrack: 't1', tracks: { t1: { id: 't1', midiInput: 'n9' } } })
    await loops.open()
    click(document, 'Add Walk')
    await settle()
    expect(applied.filter(c => c.op === 'setTrackChannel')).toEqual([])
  })

  it('does the same for a drum loop when the selected track is not a drum kit, and for a pitched loop when it is', async () => {
    const synth = setup({ selectedTrack: 't1', tracks: { t1: { id: 't1', midiInput: 'n9' } } })
    await synth.loops.open()
    click(synth.document, 'Add Rock')
    await settle()
    expect(synth.loaded.map(l => l.url)).toEqual(['https://example.test/kit/'])
    const kit = setup({ selectedTrack: 't1', tracks: { t1: { id: 't1', midiInput: 'n9' } }, nodeRoles: { n9: ['http://purl.org/stuff/transmissions/DrumInstrument'] } })
    await kit.loops.open()
    click(kit.document, 'Add Walk')
    await settle()
    expect(kit.loaded.map(l => l.url)).toEqual(['https://example.test/pulse/'])
  })

  it('does the same for a selected track that has no instrument, rather than a clip that plays into nothing', async () => {
    const { loops, document, loaded } = setup({ selectedTrack: 't1', tracks: { t1: { id: 't1', midiInput: null } } })
    await loops.open()
    click(document, 'Add Rock')
    await settle()
    expect(loaded).toHaveLength(1)
  })

  it('starts the engine first, since there may be no dispatcher before the first sound', async () => {
    const { loops, document, groups } = setup()
    await loops.open()
    click(document, 'Add Rock')
    await settle()
    expect(groups).toEqual(['Add a loop'])
  })
})

describe('when a loop cannot be added', () => {
  const open = async options => {
    const made = setup(options)
    await made.loops.open()
    return made
  }

  it('says there is no instrument for it when none of the right kind can be run, and adds nothing', async () => {
    const { document, applied, loops } = await open({ search: async () => ({ results: [instruments[1]] }) })
    click(document, 'Add Rock')
    await settle()
    expect(document.querySelector('[role="status"]').textContent).toMatch(/there is no drumkit here to play a drums loop/)
    expect(applied).toEqual([])
    expect(loops.isOpen()).toBe(true)
  })

  it('says so when the instrument does not load, and adds no clip', async () => {
    const { document, applied, loops } = await open({ loadFails: true })
    click(document, 'Add Rock')
    await settle()
    expect(document.querySelector('[role="status"]').textContent).toMatch(/DrumKit did not load/)
    expect(applied).toEqual([])
    expect(loops.isOpen()).toBe(true)
  })

  it('says what the model said when it refuses the clip, and stays open so another can be chosen', async () => {
    const { document, loops, logs } = await open({ selectedTrack: 't1', tracks: { t1: { id: 't1', midiInput: 'n9' } }, applyFails: 'the clip overlaps clip-1' })
    click(document, 'Add Walk')
    await settle()
    expect(document.querySelector('[role="status"]').textContent).toBe('the clip overlaps clip-1')
    expect(logs.at(-1)).toEqual({ message: 'the clip overlaps clip-1', kind: 'error' })
    expect(loops.isOpen()).toBe(true)
  })
})

describe('closing', () => {
  it('Close and Escape end the dialog and add nothing', async () => {
    const { loops, document, applied } = setup()
    await loops.open()
    click(document, 'Close')
    expect(loops.isOpen()).toBe(false)
    await loops.open()
    document.querySelector('dialog').dispatchEvent(new document.defaultView.Event('cancel'))
    expect(loops.isOpen()).toBe(false)
    expect(applied).toEqual([])
  })
})


describe('adding a set', () => {
  const addSet = async options => {
    const made = setup(options)
    await made.loops.open()
    click(made.document, 'Add all of Starter')
    await settle()
    return made
  }

  it('is offered at the top of the dialog with the loops it holds', async () => {
    const { loops, document } = setup()
    await loops.open()
    expect([...document.querySelectorAll('h3')].map(h => h.textContent)).toEqual(['Starter sets', 'Drums', 'Bass'])
  })

  it('makes a track for each loop with the sound that suits it, named for the loop, each with its clip at the start, as one group', async () => {
    const { applied, loaded, groups, selected, document } = await addSet()
    expect(loaded.map(l => l.url)).toEqual(['https://example.test/kit/', 'https://example.test/pulse/'])
    expect(applied.filter(c => c.op === 'setTrack')).toEqual([{ op: 'setTrack', id: 'new-track', label: 'Rock' }, { op: 'setTrack', id: 'new-track-2', label: 'Walk' }])
    // Only the loop that suggests a level gets one, and only on a track made for it.
    expect(applied.filter(c => c.op === 'setTrackChannel')).toEqual([{ op: 'setTrackChannel', track: 'new-track-2', gain: 1.5 }])
    expect(clips(applied).map(c => [c.track, c.startBeat, c.lengthBeats])).toEqual([['new-track', 0, 4], ['new-track-2', 0, 8]])
    expect(groups).toEqual(['Add Starter'])
    expect(selected).toEqual([['track', ['new-track']]])
    expect(document.querySelectorAll('dialog')).toHaveLength(0)
  })

  it('sets the tempo of the set when the project has no tracks, and in the same group', async () => {
    const { applied } = await addSet()
    expect(applied[0]).toEqual({ op: 'setTransport', tempoPoints: [{ atBeat: 0, bpm: 100 }] })
  })

  it('leaves the tempo alone when there is already a track, and says so, since changing it would move the person\'s own work', async () => {
    const { applied, logs } = await addSet({ tracks: { t1: { id: 't1', midiInput: 'n9' } } })
    expect(applied.some(c => c.op === 'setTransport')).toBe(false)
    expect(logs.some(l => /kept the tempo you have: Starter is written for 100 BPM/.test(l.message))).toBe(true)
  })

  it('says why when a part does not load, stays open, and what was made is still one group to undo', async () => {
    const { groups, loops, document } = await addSet({ failAfter: 1 })
    expect(document.querySelector('[role="status"]').textContent).toMatch(/Pulse did not load/)
    expect(loops.isOpen()).toBe(true)
    expect(groups).toEqual(['Add Starter'])
  })
})
