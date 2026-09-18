// tests/host/Multibase.test.js
//
// An encoding is the kind of thing that looks right while being wrong, and the
// symptom is a key nothing else on earth can read. So this checks against a
// published vector rather than against itself, and pins the two properties a
// round trip test would pass while losing: a leading zero byte, and the
// multicodec prefix that says what kind of key a key is.
import { describe, it, expect } from 'vitest'
import {
  base58Encode, base58Decode, multibaseEncode, multibaseDecode,
  encodeMultikey, decodeMultikey, ED25519_PUBLIC_PREFIX
} from '../../src/host/Multibase.js'

describe('base58btc', () => {
  it('agrees with the published vector', () => {
    // From the Bitcoin base58 test vectors, which is where this alphabet and
    // this leading-zero rule come from.
    expect(base58Encode(new TextEncoder().encode('Hello World!'))).toBe('2NEpo7TZRRrLZSi2U')
  })

  it('keeps a leading zero byte, which the arithmetic loses', () => {
    // One signature in 256 begins with a zero byte. Without this the encoding
    // is not length preserving and that signature decodes to 63 bytes, which
    // WebCrypto rejects with a message about the key rather than the value.
    for (const bytes of [[0], [0, 0, 1], [0, 255, 0], [1, 2, 3], []]) {
      expect([...base58Decode(base58Encode(new Uint8Array(bytes)))]).toEqual(bytes)
    }
  })

  it('refuses a character outside the alphabet', () => {
    // 0, O, I and l are excluded so that a key read off a screen cannot be
    // mistyped into a different valid key.
    expect(() => base58Decode('abc0def')).toThrow(/outside the alphabet/)
  })

  it('says which base a multibase string is in', () => {
    expect(multibaseEncode(new Uint8Array([1, 2, 3]))[0]).toBe('z')
    expect(() => multibaseDecode('Ldp')).toThrow(/beginning with z/)
  })
})

describe('Multikey', () => {
  const key = new Uint8Array(32).fill(7)

  it('is recognisable as an Ed25519 key without being decoded', () => {
    // The z6Mk prefix is not decoration: it is what the multicodec bytes
    // encode to, and it is how a reader tells this from a key of another kind.
    expect(encodeMultikey(key)).toMatch(/^z6Mk/)
    expect([...decodeMultikey(encodeMultikey(key))]).toEqual([...key])
  })

  it('refuses a key of another kind rather than treating it as Ed25519', () => {
    const wrongPrefix = multibaseEncode(new Uint8Array([0xec, 0x01, ...key]))
    expect(() => decodeMultikey(wrongPrefix)).toThrow(/Ed25519 only/)
    expect(ED25519_PUBLIC_PREFIX).toEqual([0xed, 0x01])
  })

  it('refuses a key of the wrong length', () => {
    expect(() => encodeMultikey(new Uint8Array(31))).toThrow(/32 bytes/)
    expect(() => decodeMultikey(multibaseEncode(new Uint8Array([...ED25519_PUBLIC_PREFIX, 1, 2]))))
      .toThrow(/32 bytes/)
  })
})
