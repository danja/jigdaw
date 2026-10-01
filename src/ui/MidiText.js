// src/ui/MidiText.js
//
// A MIDI message in words, for the monitor on a connection: what a person
// watching the traffic needs to read, not a hex dump. Anything it does not know
// is given as hex, never dropped, since an unnamed message is the one worth seeing.

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']

/** A note number as a name, 60 being C4. */
export const noteName = pitch => `${NOTE_NAMES[pitch % 12]}${Math.floor(pitch / 12) - 1}`

const hex = bytes => [...bytes].map(b => b.toString(16).padStart(2, '0')).join(' ')

export function describeMidi (bytes) {
  const [status = 0, a = 0, b = 0] = bytes
  if (status >= 0xf0) return status === 0xf8 ? 'Clock' : `System message ${hex(bytes)}`
  const kind = status & 0xf0
  const channel = (status & 0x0f) + 1
  switch (kind) {
    case 0x90: return b > 0 ? `Note on ${noteName(a)}, velocity ${b}, channel ${channel}` : `Note off ${noteName(a)}, channel ${channel}`
    case 0x80: return `Note off ${noteName(a)}, channel ${channel}`
    case 0xb0: return `Control ${a} = ${b}, channel ${channel}`
    case 0xe0: return `Pitch bend ${((b << 7) | a) - 8192}, channel ${channel}`
    case 0xc0: return `Program ${a}, channel ${channel}`
    case 0xa0: return `Key pressure ${noteName(a)} = ${b}, channel ${channel}`
    case 0xd0: return `Channel pressure ${a}, channel ${channel}`
    default: return `Message ${hex(bytes)}`
  }
}
