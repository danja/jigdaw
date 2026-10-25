// tests/web/MidiIn.test.js
//
// The MIDI in button and the list of controllers beside it. With one controller there is nothing to choose and no list is
// drawn. With two there is a checkbox for each, labelled with its name, the state line says what is on and what is off, and
// the choice is kept in this browser and nowhere else. Storage that is blocked or holds rubbish must not stop MIDI in working.
import { describe, it, expect, beforeEach } from 'vitest'
import { parseHTML } from 'linkedom'
import { createMidiIn } from '../../web/app/MidiIn.js'

let document
let window
const freshPage = () => { ({ document, window } = parseHTML('<!doctype html><body><button id="midi-in"></button><span id="midi-state"></span></body>')) }
beforeEach(freshPage)

const fakeAccess = list => ({ inputs: new Map(list.map(i => [i.id, { state: 'connected', onmidimessage: null, ...i }])), onstatechange: null })
const settle = () => new Promise(resolve => setTimeout(resolve, 0))

function build ({ devices, storage = new Map(), failStorage = false, rubbish = null }) {
  const access = fakeAccess(devices)
  const store = {
    getItem: key => { if (failStorage) throw new Error('blocked'); return rubbish ?? storage.get(key) ?? null },
    setItem: (key, value) => { if (failStorage) throw new Error('blocked'); storage.set(key, value) }
  }
  // A plain object for the page's window: a DOM's own has a navigator that cannot be replaced.
  const page = { localStorage: store, navigator: { requestMIDIAccess: async () => access } }
  const sent = []
  const ctx = {
    document, window: page, $: id => document.getElementById(id), log () {},
    runtime: { ensureRunning: async () => {} },
    engine: { context: { currentTime: 0, sampleRate: 48000 } },
    dispatcher: { project: { track: id => ({ id, midiInput: `node-${id}` }) }, sendEvents: (node, events) => sent.push([node, [...events[0].bytes]]) },
    selection: { kind: 'track', ids: ['t1'] },
    midiRecord: { capture () {} }
  }
  const midiIn = createMidiIn(ctx)
  midiIn.mount()
  return { access, storage, sent, click: async () => { document.getElementById('midi-in').dispatchEvent(new window.Event('click', { bubbles: true })); await settle() } }
}
const boxes = () => [...document.querySelectorAll('#midi-devices input[type=checkbox]')]
const state = () => document.getElementById('midi-state').textContent
const play = (input, ...bytes) => input.onmidimessage({ data: Uint8Array.from(bytes) })

describe('the list of MIDI controllers', () => {
  it('is not drawn for one controller, which leaves nothing to choose', async () => {
    const { click } = build({ devices: [{ id: 'a', name: 'Keys' }] })
    await click()
    expect(document.getElementById('midi-devices').hidden).toBe(true)
    expect(state()).toBe('MIDI in: Keys.')
  })

  it('is drawn for two, a labelled checkbox each, all on', async () => {
    const { click } = build({ devices: [{ id: 'a', name: 'Keys' }, { id: 'b', name: 'Pads' }] })
    await click()
    expect(document.getElementById('midi-devices').hidden).toBe(false)
    expect(boxes().map(b => [b.checked, b.closest('label').textContent.trim()])).toEqual([[true, 'Keys'], [true, 'Pads']])
    expect(document.querySelector('#midi-devices legend').textContent).toBe('Play from')
    expect(state()).toBe('MIDI in: Keys, Pads.')
  })

  it('turns a controller off from its checkbox: its notes stop reaching the track, and the state line says so', async () => {
    const { click, access, sent } = build({ devices: [{ id: 'a', name: 'Keys' }, { id: 'b', name: 'Pads' }] })
    await click()
    const [keys] = boxes()
    keys.checked = false
    keys.dispatchEvent(new window.Event('change', { bubbles: true }))
    expect(state()).toBe('MIDI in: Pads, 1 turned off.')
    play(access.inputs.get('a'), 0x90, 60, 100)
    expect(sent).toEqual([])
    play(access.inputs.get('b'), 0x90, 61, 100)
    expect(sent).toEqual([['node-t1', [0x90, 61, 100]]])
  })

  it('says when every controller is turned off, in words', async () => {
    const { click } = build({ devices: [{ id: 'a', name: 'Keys' }, { id: 'b', name: 'Pads' }] })
    await click()
    for (const box of boxes()) { box.checked = false; box.dispatchEvent(new window.Event('change', { bubbles: true })) }
    expect(state()).toBe('MIDI in: every controller is turned off, 2 turned off.')
  })

  it('keeps the choice in this browser, and starts the next visit with it', async () => {
    const storage = new Map()
    const first = build({ devices: [{ id: 'a', name: 'Keys' }, { id: 'b', name: 'Pads' }], storage })
    await first.click()
    boxes()[1].checked = false
    boxes()[1].dispatchEvent(new window.Event('change', { bubbles: true }))
    expect(JSON.parse(storage.get('jigdaw.midi.off'))).toEqual(['b'])

    freshPage()
    const second = build({ devices: [{ id: 'a', name: 'Keys' }, { id: 'b', name: 'Pads' }], storage })
    await second.click()
    expect(boxes().map(b => b.checked)).toEqual([true, false])
  })

  it('works when storage is blocked: the choice holds for the visit and nothing throws', async () => {
    const { click, access, sent } = build({ devices: [{ id: 'a', name: 'Keys' }, { id: 'b', name: 'Pads' }], failStorage: true })
    await click()
    boxes()[0].checked = false
    boxes()[0].dispatchEvent(new window.Event('change', { bubbles: true }))
    play(access.inputs.get('a'), 0x90, 60, 100)
    expect(sent).toEqual([])
  })

  it('ignores what it cannot read from storage', async () => {
    for (const rubbish of ['not json', '{"a":1}', '[1,2]']) {
      freshPage()
      const { click } = build({ devices: [{ id: 'a', name: 'Keys' }, { id: 'b', name: 'Pads' }], rubbish })
      await click()
      expect(boxes().map(b => b.checked), rubbish).toEqual([true, true])
    }
  })

  it('disappears when MIDI in is turned off', async () => {
    const { click } = build({ devices: [{ id: 'a', name: 'Keys' }, { id: 'b', name: 'Pads' }] })
    await click()
    await click()
    expect(document.getElementById('midi-devices').hidden).toBe(true)
    expect(state()).toBe('MIDI in is off.')
  })
})
