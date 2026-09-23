// tests/host/StateCodec.test.js
import { describe, it, expect } from 'vitest'
import { encodeState, decodeState } from '../../src/host/StateCodec.js'

describe('StateCodec', () => {
  it('round-trips null, the ordinary case for a plugin with no state', () => {
    expect(encodeState(null)).toBeNull()
    expect(decodeState(null)).toBeNull()
    expect(decodeState(encodeState(null))).toBeNull()
  })

  it('round-trips a plain JSON-shaped state unchanged', () => {
    const state = { mode: 'plate', freeze: true, count: 3 }
    const text = encodeState(state)
    expect(typeof text).toBe('string')
    expect(decodeState(text)).toEqual(state)
  })

  it('round-trips an ArrayBuffer, byte for byte', () => {
    const bytes = new Uint8Array([0, 1, 2, 253, 254, 255, 42])
    const state = { nam: bytes.buffer, ir: null }
    const decoded = decodeState(encodeState(state))
    expect(decoded.ir).toBeNull()
    expect(new Uint8Array(decoded.nam)).toEqual(bytes)
  })

  it('round-trips more than one ArrayBuffer in the same state', () => {
    const a = new Uint8Array([1, 2, 3]).buffer
    const b = new Uint8Array([9, 8, 7, 6]).buffer
    const decoded = decodeState(encodeState({ a, b }))
    expect(new Uint8Array(decoded.a)).toEqual(new Uint8Array(a))
    expect(new Uint8Array(decoded.b)).toEqual(new Uint8Array(b))
  })

  it('does not mistake an ordinary object for the ArrayBuffer marker', () => {
    const state = { __jigdawArrayBufferLookAlike: { nested: true } }
    expect(decodeState(encodeState(state))).toEqual(state)
  })
})
