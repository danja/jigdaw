// tests/host/Zip.test.js
//
// The writer is checked by a zip tool that is not this code, unzip -t, and
// the reader against an archive the system zip made, deflated. A zip that only
// this module can read would pass every round trip and open nowhere else.
import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { writeZip, readZip, crc32 } from '../../src/host/Zip.js'

const has = tool => { try { execFileSync('which', [tool], { stdio: 'ignore' }); return true } catch { return false } }
const bytes = text => new TextEncoder().encode(text)
const text = b => new TextDecoder().decode(b)

describe('the checksum', () => {
  it('is the zip CRC-32', () => {
    expect(crc32(bytes('123456789')).toString(16)).toBe('cbf43926')
  })
})

describe('writing', () => {
  const entries = [
    { name: 'session.ttl', bytes: bytes('<> a <x> .\n') },
    { name: 'media/abc.wav', bytes: new Uint8Array([1, 2, 3, 4, 5]) }
  ]

  it('reads back what it wrote, names and bytes', async () => {
    const files = await readZip(writeZip(entries))
    expect([...files.keys()]).toEqual(['session.ttl', 'media/abc.wav'])
    expect(text(files.get('session.ttl'))).toBe('<> a <x> .\n')
    expect([...files.get('media/abc.wav')]).toEqual([1, 2, 3, 4, 5])
  })

  it('writes the same bytes twice', () => {
    expect(writeZip(entries)).toEqual(writeZip(entries))
  })

  it('refuses a name that escapes the archive', () => {
    for (const name of ['/etc/passwd', '../up.wav', 'media/../../x', 'C:/x', 'a\\b']) {
      expect(() => writeZip([{ name, bytes: new Uint8Array() }]), name).toThrow(/relative|step out/)
    }
  })

  const unzip = has('unzip') ? it : it.skip
  unzip('writes a zip that unzip itself accepts', () => {
    const dir = mkdtempSync(join(tmpdir(), 'jigdaw-zip-'))
    const file = join(dir, 'session.zip')
    writeFileSync(file, writeZip(entries))
    const report = execFileSync('unzip', ['-t', file], { encoding: 'utf8' })
    expect(report).toMatch(/No errors detected/)
    execFileSync('unzip', ['-o', '-q', file, '-d', join(dir, 'out')])
    expect(readFileSync(join(dir, 'out', 'session.ttl'), 'utf8')).toBe('<> a <x> .\n')
  })
})

describe('reading', () => {
  const zip = has('zip') ? it : it.skip
  zip('reads a deflated zip the system zip made, skipping its directories', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'jigdaw-zip-'))
    mkdirSync(join(dir, 'media'))
    writeFileSync(join(dir, 'session.ttl'), 'repeat '.repeat(500))
    writeFileSync(join(dir, 'media', 'a.wav'), Buffer.alloc(2000, 7))
    execFileSync('zip', ['-q', '-r', '-9', 'out.zip', 'session.ttl', 'media'], { cwd: dir })
    expect(existsSync(join(dir, 'out.zip'))).toBe(true)
    const files = await readZip(readFileSync(join(dir, 'out.zip')))
    expect([...files.keys()].sort()).toEqual(['media/a.wav', 'session.ttl'])
    expect(text(files.get('session.ttl'))).toBe('repeat '.repeat(500))
    expect(files.get('media/a.wav').every(b => b === 7)).toBe(true)
  })

  it('refuses something that is not a zip', async () => {
    await expect(readZip(bytes('not a zip at all, just words'))).rejects.toThrow(/not a zip/)
  })

  it('refuses a damaged entry by name', async () => {
    const zip = writeZip([{ name: 'session.ttl', bytes: bytes('hello') }])
    zip[30 + 'session.ttl'.length] ^= 0xff
    await expect(readZip(zip)).rejects.toThrow(/session\.ttl is damaged/)
  })
})
