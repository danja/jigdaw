// tests/host/MidiInput.test.js
//
// The fake refuses what the real access refuses: a rejected request, an input
// that has gone, and messages that are not channel messages.
import { describe, it, expect } from 'vitest'
import { createMidiInput, channelMessage, MIDI_STATUS } from '../../src/host/MidiInput.js'

function fakeAccess (inputs) {
  const map = new Map(inputs.map(i => [i.id, { state: 'connected', onmidimessage: null, ...i }]))
  return { inputs: map, onstatechange: null }
}
const play = (input, ...bytes) => input.onmidimessage({ data: Uint8Array.from(bytes) })

function build ({ access = fakeAccess([{ id: 'a', name: 'Keys' }]), reject = false, supported = true } = {}) {
  const messages = []
  const changes = []
  const midi = createMidiInput({
    requestAccess: supported ? async () => { if (reject) throw new Error('denied'); return access } : null,
    onMessage: (bytes, name) => messages.push([[...bytes], name]),
    onChange: c => changes.push(c)
  })
  return { midi, access, messages, changes }
}

describe('channelMessage', () => {
  it('keeps note, controller and bend messages, and refuses clock, sensing, sysex and stray data bytes', () => {
    expect([...channelMessage([0x90, 60, 100])]).toEqual([0x90, 60, 100])
    expect(channelMessage([0xb3, 1, 64])).not.toBeNull()
    expect(channelMessage([0xe0, 0, 64])).not.toBeNull()
    for (const bad of [[0xf8], [0xfe], [0xf0, 1, 2, 0xf7], [0x40, 1], [], null]) expect(channelMessage(bad)).toBeNull()
  })

  it('copies the bytes, so the browser reusing its buffer changes nothing', () => {
    const data = Uint8Array.from([0x90, 60, 100])
    const copy = channelMessage(data)
    data[1] = 0
    expect(copy[1]).toBe(60)
  })
})

describe('createMidiInput', () => {
  it('is off until asked, and unsupported where the browser has no MIDI', () => {
    expect(build().midi.status).toBe(MIDI_STATUS.off)
    expect(build({ supported: false }).midi.status).toBe(MIDI_STATUS.unsupported)
  })

  it('delivers channel messages from every input once enabled, with the input named', async () => {
    const { midi, access, messages } = build({ access: fakeAccess([{ id: 'a', name: 'Keys' }, { id: 'b', name: 'Pads' }]) })
    expect(await midi.enable()).toBe(MIDI_STATUS.on)
    play(access.inputs.get('a'), 0x90, 60, 100)
    play(access.inputs.get('b'), 0x99, 36, 90)
    play(access.inputs.get('a'), 0xf8)
    expect(messages).toEqual([[[0x90, 60, 100], 'Keys'], [[0x99, 36, 90], 'Pads']])
  })

  it('says it was refused, and does not throw, when the browser rejects the request', async () => {
    const { midi, changes } = build({ reject: true })
    expect(await midi.enable()).toBe(MIDI_STATUS.denied)
    expect(changes.at(-1)).toEqual({ status: 'denied', inputs: [] })
  })

  it('says it is unsupported and does not ask', async () => {
    const { midi, changes } = build({ supported: false })
    expect(await midi.enable()).toBe(MIDI_STATUS.unsupported)
    expect(changes.at(-1).status).toBe('unsupported')
  })

  it('picks up an input plugged in later, and names only those connected', async () => {
    const { midi, access, messages, changes } = build()
    await midi.enable()
    access.inputs.set('c', { id: 'c', name: 'Late', state: 'connected', onmidimessage: null })
    access.onstatechange()
    play(access.inputs.get('c'), 0x90, 64, 80)
    expect(messages.at(-1)).toEqual([[0x90, 64, 80], 'Late'])
    access.inputs.get('a').state = 'disconnected'
    access.onstatechange()
    expect(changes.at(-1).inputs).toEqual(['Late'])
  })

  it('stops delivering when turned off, and can be turned on again', async () => {
    const { midi, access, messages } = build()
    await midi.enable()
    midi.disable()
    expect(midi.status).toBe(MIDI_STATUS.off)
    expect(access.inputs.get('a').onmidimessage).toBeNull()
    expect(await midi.enable()).toBe(MIDI_STATUS.on)
    play(access.inputs.get('a'), 0x80, 60, 0)
    expect(messages).toHaveLength(1)
  })

  it('enabling twice is one subscription, not two', async () => {
    const { midi, access, messages } = build()
    await midi.enable()
    await midi.enable()
    play(access.inputs.get('a'), 0x90, 60, 100)
    expect(messages).toHaveLength(1)
  })

  it('will not be built without its handlers', () => {
    expect(() => createMidiInput({ requestAccess: null, onMessage () {} })).toThrow(/onChange/)
  })
})
