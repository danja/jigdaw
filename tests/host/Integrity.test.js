// tests/host/Integrity.test.js
import { describe, it, expect } from 'vitest'
import { parseIntegrity, digestOf, verifyIntegrity } from '../../src/host/Integrity.js'

const bytes = new TextEncoder().encode('const x = 1')

describe('parseIntegrity', () => {
  it('accepts the three SRI hash algorithms', () => {
    for (const alg of ['sha256', 'sha384', 'sha512']) {
      expect(parseIntegrity(`${alg}-abc+/ZQ==`).algorithm).toBe(alg)
    }
  })

  it('refuses anything else, including a bare hex digest', () => {
    for (const bad of ['', 'md5-abcdef', 'sha1-abc', 'deadbeef', 'sha384-not base64!']) {
      expect(() => parseIntegrity(bad), `accepted ${JSON.stringify(bad)}`).toThrow()
    }
  })

  it('refuses a missing digest with a message saying why it matters', () => {
    expect(() => parseIntegrity(undefined)).toThrow(/cannot be loaded/)
  })
})

describe('verifyIntegrity', () => {
  it('accepts bytes matching their digest', async () => {
    await expect(verifyIntegrity(bytes, await digestOf(bytes))).resolves.toMatch(/^sha384-/)
  })

  it('works for each algorithm', async () => {
    for (const alg of ['sha256', 'sha384', 'sha512']) {
      await expect(verifyIntegrity(bytes, await digestOf(bytes, alg))).resolves.toContain(alg)
    }
  })

  it('throws when a single byte differs', async () => {
    const digest = await digestOf(bytes)
    const tampered = new TextEncoder().encode('const x = 2')
    await expect(verifyIntegrity(tampered, digest)).rejects.toThrow(/integrity mismatch/)
  })

  it('throws rather than returning false, so the result cannot be ignored', async () => {
    // A verify that returns a boolean is a verify a caller forgets to check.
    const result = verifyIntegrity(new TextEncoder().encode('x'), await digestOf(bytes))
    await expect(result).rejects.toThrow()
  })
})
