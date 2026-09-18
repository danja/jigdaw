// src/host/Multibase.js
//
// base58btc and Multikey, the two encodings the W3C security vocabulary uses
// for a public key and for a proof value.
//
// Written out rather than depended on. It is sixty lines, it has to run in a
// browser as well as in node, and a bundle that arrives on a machine with no
// network is a poor moment to discover a missing package.
//
// The encoding matters as much as the key does: sec:publicKeyMultibase is
// multibase base58btc of a multicodec prefixed key, so the two bytes in front
// of the key say which kind of key it is. Dropping them would produce a string
// that looks right, is accepted by nothing else, and cannot be told from an
// Ed25519 key by anybody who did not write it.

const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
const INDEX = new Map([...ALPHABET].map((c, i) => [c, i]))

/** The multicodec prefix for an Ed25519 public key: varint 0xed. */
export const ED25519_PUBLIC_PREFIX = Object.freeze([0xed, 0x01])

export function base58Encode (bytes) {
  const input = [...bytes]
  // A leading zero byte carries no magnitude, so base 58 arithmetic loses it.
  // It is counted off the front and put back as a leading `1`, which is what
  // makes the encoding length preserving for a 64 byte signature that happens
  // to begin with a zero. One signature in 256 does.
  let zeros = 0
  while (zeros < input.length && input[zeros] === 0) zeros++

  const digits = []
  for (const byte of input.slice(zeros)) {
    let carry = byte
    for (let i = 0; i < digits.length; i++) {
      carry += digits[i] << 8
      digits[i] = carry % 58
      carry = (carry / 58) | 0
    }
    while (carry > 0) { digits.push(carry % 58); carry = (carry / 58) | 0 }
  }
  return ALPHABET[0].repeat(zeros) + digits.reverse().map(d => ALPHABET[d]).join('')
}

export function base58Decode (text) {
  let zeros = 0
  while (zeros < text.length && text[zeros] === ALPHABET[0]) zeros++

  const bytes = []
  for (const char of text.slice(zeros)) {
    const value = INDEX.get(char)
    if (value === undefined) throw new Error(`not base58btc: ${JSON.stringify(char)} is outside the alphabet`)
    let carry = value
    for (let i = 0; i < bytes.length; i++) {
      carry += bytes[i] * 58
      bytes[i] = carry & 0xff
      carry >>= 8
    }
    while (carry > 0) { bytes.push(carry & 0xff); carry >>= 8 }
  }
  return new Uint8Array([...new Array(zeros).fill(0), ...bytes.reverse()])
}

/** Multibase base58btc: the payload, with a `z` in front saying which base. */
export const multibaseEncode = bytes => `z${base58Encode(bytes)}`

export function multibaseDecode (text) {
  if (typeof text !== 'string' || text[0] !== 'z') {
    throw new Error(`expected a multibase base58btc string beginning with z, got ${JSON.stringify(text)}`)
  }
  return base58Decode(text.slice(1))
}

/** A raw 32 byte Ed25519 public key as a sec:publicKeyMultibase value. */
export function encodeMultikey (publicKey) {
  const raw = new Uint8Array(publicKey)
  if (raw.length !== 32) throw new Error(`an Ed25519 public key is 32 bytes, got ${raw.length}`)
  return multibaseEncode(new Uint8Array([...ED25519_PUBLIC_PREFIX, ...raw]))
}

/** The reverse, refusing any key type but Ed25519 rather than guessing. */
export function decodeMultikey (multibase) {
  const bytes = multibaseDecode(multibase)
  const [first, second] = bytes
  if (first !== ED25519_PUBLIC_PREFIX[0] || second !== ED25519_PUBLIC_PREFIX[1]) {
    throw new Error(
      `not an Ed25519 public key: the multicodec prefix is 0x${(first ?? 0).toString(16)}` +
      `${(second ?? 0).toString(16)}, and JigDAW signatures are Ed25519 only`
    )
  }
  const key = bytes.slice(2)
  if (key.length !== 32) throw new Error(`an Ed25519 public key is 32 bytes, got ${key.length}`)
  return key
}
