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
 * `onChange({ status, inputs })` hears every state change, `inputs` being names.
 */
export function createMidiInput ({ requestAccess, onMessage, onChange }) {
  for (const [name, fn] of Object.entries({ onMessage, onChange })) {
    if (typeof fn !== 'function') throw new Error(`createMidiInput needs ${name}`)
  }
  let access = null
  let status = requestAccess ? MIDI_STATUS.off : MIDI_STATUS.unsupported
  const hooked = new Set()

  const names = () => (access ? [...access.inputs.values()].filter(i => i.state !== 'disconnected').map(i => i.name ?? i.id) : [])
  const tell = () => onChange({ status, inputs: names() })

  function hook () {
    if (!access) return
    for (const input of access.inputs.values()) {
      if (hooked.has(input.id)) continue
      hooked.add(input.id)
      input.onmidimessage = event => {
        const bytes = channelMessage(event.data)
        if (bytes) onMessage(bytes, input.name ?? input.id)
      }
    }
  }

  return {
    get status () { return status },
    get inputs () { return names() },

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
