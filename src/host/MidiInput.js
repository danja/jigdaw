// src/host/MidiInput.js
//
// Web MIDI input: what a controller plays, as messages for the host to route.
//
// Permission-gated by the browser and asked for only when a person turns it on,
// which is also the user activation the request needs. The access object is
// injected, so a test hands in one that refuses what the real one refuses: a
// request that is rejected, an input that goes away, a message that is not a
// channel message.
//
// Only channel voice messages go on (status 0x80 to 0xEF). Timing clock and
// active sensing arrive many times a second, are not notes, and a plugin taking
// them as such would be wrong; system exclusive is left out because nothing in
// the host consumes it yet.

/** States a person is told about: never asked, working, refused, or not in this browser. */
export const MIDI_STATUS = Object.freeze({ off: 'off', on: 'on', denied: 'denied', unsupported: 'unsupported' })

/** A copy of the message's bytes if it is a channel voice message, else null. */
export function channelMessage (data) {
  if (!data || data.length === 0) return null
  const status = data[0]
  if (status < 0x80 || status >= 0xf0) return null
  return Uint8Array.from(data)
}

/**
 * `requestAccess()` is `navigator.requestMIDIAccess` bound to `navigator`
 * (calling it detached throws Illegal invocation in a browser), or null where
 * the browser has none. `onMessage(bytes, inputName)` gets each channel message.
 * `onChange({ status, inputs, devices })` hears every state change, `inputs` being the names of what is connected and `devices` each one
 * as `{ id, name, enabled }`. A controller can be turned off without unplugging it, which is how one of several is chosen: its
 * messages are dropped here, so nothing past this point has to know. `disabled` is the ids that start turned off, and the caller
 * keeps them from one visit to the next, since the browser keeps a controller's id the same.
 */
export function createMidiInput ({ requestAccess, onMessage, onChange, disabled = [] }) {
  for (const [name, fn] of Object.entries({ onMessage, onChange })) {
    if (typeof fn !== 'function') throw new Error(`createMidiInput needs ${name}`)
  }
  let access = null
  let status = requestAccess ? MIDI_STATUS.off : MIDI_STATUS.unsupported
  const hooked = new Set()
  const off = new Set(disabled)

  const names = () => (access ? [...access.inputs.values()].filter(i => i.state !== 'disconnected').map(i => i.name ?? i.id) : [])
  const devices = () => (access ? [...access.inputs.values()].filter(i => i.state !== 'disconnected').map(i => ({ id: i.id, name: i.name ?? i.id, enabled: !off.has(i.id) })) : [])
  const tell = () => onChange({ status, inputs: names(), devices: devices() })

  function hook () {
    if (!access) return
    for (const input of access.inputs.values()) {
      if (hooked.has(input.id)) continue
      hooked.add(input.id)
      input.onmidimessage = event => {
        if (off.has(input.id)) return
        const bytes = channelMessage(event.data)
        if (bytes) onMessage(bytes, input.name ?? input.id)
      }
    }
  }

  return {
    get status () { return status },
    get inputs () { return names() },
    get devices () { return devices() },
    /** The ids turned off, for the caller to keep. */
    get disabled () { return [...off] },

    /** Listen to a controller again, or stop listening to it. Heard by `onChange`, and kept while MIDI in is turned off and on. */
    setEnabled (id, on) {
      if (on) off.delete(id); else off.add(id)
      tell()
    },

    /** Ask the browser, and start listening to every input, including ones plugged in later. */
    async enable () {
      if (status === MIDI_STATUS.unsupported || status === MIDI_STATUS.on) { tell(); return status }
      try {
        access = await requestAccess({ sysex: false })
      } catch {
        status = MIDI_STATUS.denied
        tell()
        return status
      }
      status = MIDI_STATUS.on
      hook()
      access.onstatechange = () => { hook(); tell() }
      tell()
      return status
    },

    /** Stop listening. The permission stays granted; the next enable does not ask again. */
    disable () {
      if (status !== MIDI_STATUS.on) return
      for (const input of access.inputs.values()) input.onmidimessage = null
      hooked.clear()
      access.onstatechange = null
      access = null
      status = MIDI_STATUS.off
      tell()
    }
  }
}
