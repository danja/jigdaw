// src/host/Integrity.js
//
// Subresource Integrity verification.
//
// Contract section 3.2: a host MUST verify every fetched resource against the
// digest in the profile before executing or instantiating it, and MUST NOT
// offer an option to skip. The profile and the code it names need not share an
// origin, so an unverified profile is an instruction to execute whatever
// currently sits at a URL.

const ALGORITHMS = Object.freeze({
  sha256: 'SHA-256',
  sha384: 'SHA-384',
  sha512: 'SHA-512'
})

/** Parse `sha384-<base64>` into its parts. Throws on anything else. */
export function parseIntegrity (integrity) {
  if (typeof integrity !== 'string' || integrity.length === 0) {
    throw new Error('no integrity digest; a resource without one cannot be loaded')
  }
  const match = /^(sha256|sha384|sha512)-([A-Za-z0-9+/]+={0,2})$/.exec(integrity.trim())
  if (!match) {
    throw new Error(`malformed integrity digest: ${integrity}. Expected sha384-<base64>.`)
  }
  return { algorithm: match[1], subtleName: ALGORITHMS[match[1]], expected: match[2] }
}

function toBase64 (buffer) {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary)
}

/** The digest a byte sequence would need to declare, in SRI form. */
export async function digestOf (bytes, algorithm = 'sha384', { subtle = crypto.subtle } = {}) {
  const subtleName = ALGORITHMS[algorithm]
  if (!subtleName) throw new Error(`unsupported digest algorithm: ${algorithm}`)
  const hash = await subtle.digest(subtleName, bytes)
  return `${algorithm}-${toBase64(hash)}`
}

/**
 * Throws unless the bytes match the declared digest.
 *
 * Throws rather than returning false so that a caller cannot ignore the result
 * by forgetting to check it. There is no verify-and-continue path.
 */
export async function verifyIntegrity (bytes, integrity, { subtle = crypto.subtle } = {}) {
  const { algorithm, subtleName, expected } = parseIntegrity(integrity)
  const hash = await subtle.digest(subtleName, bytes)
  const actual = toBase64(hash)
  if (actual !== expected) {
    throw new Error(
      `integrity mismatch: declared ${algorithm}-${expected}, got ${algorithm}-${actual}`
    )
  }
  return `${algorithm}-${actual}`
}
