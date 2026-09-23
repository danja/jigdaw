// src/host/StateCodec.js
//
// A plugin's state (messaging.md section 1.2/1.3, contract section 8) is any
// structured-cloneable JavaScript value, and `jig:nodeState` is a string
// literal because that is what RDF has to put it in. This is the one
// conversion between the two, so a plugin author's state round-trips
// through a saved session exactly once, in one place, rather than every
// stateful plugin managing its own binary encoding.
//
// ArrayBuffer is the one structured-cloneable type JSON cannot carry
// directly; everything else JSON.stringify and JSON.parse already handle.
// Marked and restored by a replacer/reviver pair rather than assumed
// absent, because a plugin with binary state, a loaded sample or a loaded
// neural model, is exactly the kind of state this exists for.
const MARKER = '__jigdawArrayBuffer'

function toBase64 (buffer) {
  let binary = ''
  const bytes = new Uint8Array(buffer)
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
  return btoa(binary)
}

function fromBase64 (base64) {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes.buffer
}

/** A processor's state, as the string `jig:nodeState` holds. `null` for a
 * plugin with nothing to say, which is the ordinary case and not an error:
 * most plugins here have no state beyond their parameters, which are never
 * part of it (contract section 8.2). */
export function encodeState (state) {
  if (state === null || state === undefined) return null
  return JSON.stringify(state, (_key, value) =>
    value instanceof ArrayBuffer ? { [MARKER]: toBase64(value) } : value)
}

/** The inverse of encodeState. `null` in, `null` out, for a node that was
 * never given a state to save. */
export function decodeState (text) {
  if (text === null || text === undefined) return null
  return JSON.parse(text, (_key, value) =>
    value && typeof value === 'object' && MARKER in value ? fromBase64(value[MARKER]) : value)
}
