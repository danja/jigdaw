// tests/web/MicIn.test.js
//
// The Mic in button and the list of microphones beside it. The selected track is what is fed; the list is drawn only when
// there is a choice, after the browser has given names; a refusal says what to do; and a track that goes takes the input
// with it and the button must say so. The stand-in stream and engine refuse what the real ones refuse: a stream is stopped
// when it cannot be used, and an engine will not open an input on a track it does not have.
import { describe, it, expect, beforeEach } from 'vitest'
import { parseHTML } from 'linkedom'
import { createMicIn } from '../../web/app/MicIn.js'

let document
let window
const freshPage = () => { ({ document, window } = parseHTML('<!doctype html><body><button id="mic-in" aria-pressed="false" hidden></button><span id="mic-state"></span></body>')) }
beforeEach(freshPage)

const settle = () => new Promise(resolve => setTimeout(resolve, 0))
const stream = deviceId => {
  const made = { stopped: 0, getAudioTracks: () => [{ getSettings: () => ({ deviceId }) }] }
  made.getTracks = () => [{ stop: () => { made.stopped += 1 } }]
  return made
}

function build ({ inputs = [{ id: 'a', name: 'Desk mic' }], select = { kind: 'track', ids: ['t1'] }, refuse = null, refuseDevice = null, available = true, tracks = ['t1', 't2'] } = {}) {
  const asked = []
  const streams = []
  const opened = new Map()
  const closed = []
  const engine = {
    openInput: (id, s) => {
      if (!tracks.includes(id)) throw new Error(`no such track strip: ${id}`)
      opened.set(id, s)
    },
    closeInput: id => { closed.push(id); opened.delete(id) },
    inputTrackIds: () => [...opened.keys()]
  }
  const mediaDevices = {
    enumerateDevices: async () => inputs.map(i => ({ kind: 'audioinput', deviceId: i.id, label: i.name }))
  }
  const ctx = {
    document, $: id => document.getElementById(id), log () {},
    runtime: { ensureRunning: async () => {} },
    engine,
    dispatcher: { project: { track: id => (tracks.includes(id) ? { id, label: id === 't1' ? 'Bass' : 'Lead' } : null) } },
    selection: select
  }
  const micIn = createMicIn(ctx, {
    getUserMedia: async constraints => {
      asked.push(constraints.audio.deviceId?.exact ?? null)
      if (refuse || (refuseDevice && constraints.audio.deviceId?.exact === refuseDevice)) {
        throw Object.assign(new Error('browser'), { name: refuse ?? 'NotFoundError' })
      }
      const made = stream(constraints.audio.deviceId?.exact ?? inputs[0].id)
      streams.push(made)
      return made
    },
    mediaDevices,
    available
  })
  micIn.mount()
  return {
    micIn, engine, asked, opened, closed, ctx, streams,
    click: async () => { document.getElementById('mic-in').dispatchEvent(new window.Event('click', { bubbles: true })); await settle() }
  }
}
const state = () => document.getElementById('mic-state').textContent
const pressed = () => document.getElementById('mic-in').getAttribute('aria-pressed')
const selectedId = () => [...document.getElementById('mic-device').options].find(o => o.selected)?.value
const choose = async value => {
  const s = document.getElementById('mic-device')
  ;[...s.options].find(o => o.value === value).selected = true
  s.dispatchEvent(new window.Event('change', { bubbles: true }))
  await settle()
}

describe('the Mic in button', () => {
  it('is left out when the browser cannot be asked for a microphone', () => {
    build({ available: false })
    expect(document.getElementById('mic-in').hidden).toBe(true)
  })

  it('is shown when it can', () => {
    build()
    expect(document.getElementById('mic-in').hidden).toBe(false)
  })

  it('feeds the selected track and says which, then lets go on a second press', async () => {
    const { click, opened, closed } = build()
    await click()
    expect([...opened.keys()]).toEqual(['t1'])
    expect(state()).toBe('Mic in: Desk mic, into Bass.')
    expect(pressed()).toBe('true')
    await click()
    expect(closed).toEqual(['t1'])
    expect(state()).toBe('Mic in is off.')
    expect(pressed()).toBe('false')
  })

  it('asks for a track first when none is selected, and opens nothing', async () => {
    const { click, asked, opened } = build({ select: { kind: 'node', ids: ['n1'] } })
    await click()
    expect(state()).toBe('Select a track first, then press Mic in.')
    expect(asked).toEqual([])
    expect(opened.size).toBe(0)
  })

  it('says what to do when the browser refuses, and stays off', async () => {
    const { click, opened } = build({ refuse: 'NotAllowedError' })
    await click()
    expect(state()).toMatch(/site settings/)
    expect(pressed()).toBe('false')
    expect(opened.size).toBe(0)
  })

  it('lets go of the stream when the engine will not take it, so the recording light goes out', async () => {
    const { click, streams } = build({ tracks: [] })
    await click()
    expect(state()).toMatch(/no such track strip/)
    expect(pressed()).toBe('false')
    expect(streams.map(x => x.stopped)).toEqual([1])
  })

  it('moves to another track when pressed with a different one selected, letting go of the first', async () => {
    const { click, ctx, opened, closed } = build()
    await click()
    ctx.selection = { kind: 'track', ids: ['t2'] }
    // The button is a toggle: off, then on for the new track.
    await click()
    await click()
    expect(closed).toEqual(['t1'])
    expect([...opened.keys()]).toEqual(['t2'])
    expect(state()).toBe('Mic in: Desk mic, into Lead.')
  })
})

describe('the list of microphones', () => {
  const two = [{ id: 'a', name: 'Desk mic' }, { id: 'b', name: 'Headset' }]

  it('is not drawn for one microphone, which leaves nothing to choose', async () => {
    const { click } = build()
    await click()
    expect(document.querySelector('.mic-devices').hidden).toBe(true)
  })

  it('is drawn for two, named, with the one in use chosen', async () => {
    const { click } = build({ inputs: two })
    await click()
    expect(document.querySelector('.mic-devices').hidden).toBe(false)
    const select = document.getElementById('mic-device')
    expect([...select.options].map(o => o.textContent)).toEqual(['Desk mic', 'Headset'])
    expect(selectedId()).toBe('a')
    expect(document.querySelector('.mic-devices').textContent).toContain('Microphone')
  })

  it('switches the track to the microphone chosen, asking for that device exactly', async () => {
    const { click, asked, opened } = build({ inputs: two })
    await click()
    await choose('b')
    expect(asked).toEqual([null, 'b'])
    expect([...opened.keys()]).toEqual(['t1'])
    expect(state()).toBe('Mic in: Headset, into Bass.')
  })

  it('keeps the old microphone, and says why, when the chosen one cannot be opened', async () => {
    const { click, opened, streams } = build({ inputs: two, refuseDevice: 'b' })
    await click()
    const before = opened.get('t1')
    await choose('b')
    expect(state()).toMatch(/No microphone was found\. .*previous microphone is still in use/)
    expect(opened.get('t1')).toBe(before)
    expect(streams.map(x => x.stopped)).toEqual([0])
    expect(selectedId()).toBe('a')
    expect(pressed()).toBe('true')
  })
})

describe('when the track goes', () => {
  it('says the input is off once the engine no longer holds it', async () => {
    const { click, micIn, engine } = build()
    await click()
    expect(micIn.active()).toBe(true)
    engine.closeInput('t1')
    micIn.refresh()
    expect(micIn.active()).toBe(false)
    expect(pressed()).toBe('false')
    expect(state()).toBe('Mic in is off: the track it was feeding is gone.')
  })

  it('says nothing when the input is still there', async () => {
    const { click, micIn } = build()
    await click()
    micIn.refresh()
    expect(micIn.active()).toBe(true)
    expect(state()).toBe('Mic in: Desk mic, into Bass.')
  })
})
