// tests/host/bundle.test.js
//
// docs/plugin-bundles.md claims two things that would be easy to assert and
// wrong: that a flattened profile is already a legal profile no host needs
// changing to read, and that an archive unpacked into a directory is a working
// plugin origin. Both are checked here against the real loader, not a stand-in.
//
// The lesson from phase 8 was that a normative format with no writer is a claim
// about a file nobody produces. This is the other half of it: a format with a
// writer and no reader is a claim about a file nobody opens.
import { describe, it, expect, beforeAll } from 'vitest'
import { resolve } from 'node:path'
import { existsSync } from 'node:fs'
import { readFile, writeFile, mkdtemp, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { bundle } from '../../bin/bundle.js'
import { PluginLoader } from '../../src/host/PluginLoader.js'
import { shapeValidatorFromFile } from '../../src/validate/files.js'
import { parseText } from '../../src/rdf/parse.js'
import { detectCapabilities } from '../../src/host/Capabilities.js'
import { directoryFetch } from '../../src/testing/OfflineHost.js'

const root = resolve(import.meta.dirname, '../..')
const pluginDir = resolve(root, 'plugins/pulse')
const CANONICAL = 'https://strandz.it/jigdaw/plugins/pulse/'

const built = existsSync(resolve(pluginDir, 'pulse.wasm'))
const suite = built ? describe : describe.skip
if (!built) console.warn('run plugins/pulse/build.sh first')

/** A fetch that serves one document at the canonical IRI, and data: itself. */
const serving = text => async url => {
  if (url.startsWith('data:')) return globalThis.fetch(url)
  if (url === CANONICAL) {
    return {
      ok: true,
      status: 200,
      text: async () => text,
      arrayBuffer: async () => new TextEncoder().encode(text).buffer
    }
  }
  throw new TypeError('Failed to fetch')
}

suite('a bundle', () => {
  let validator
  let made
  beforeAll(async () => {
    validator = await shapeValidatorFromFile(resolve(root, 'vocabs/shapes.ttl'))
    made = await bundle(pluginDir)
  }, 30000)

  describe('the flattened profile', () => {
    it('keeps the plugin it is a copy of', () => {
      expect(made.iri).toBe(CANONICAL)
      expect(made.flat).toContain(`@base <${CANONICAL}>`)
    })

    it('inlines every declared file and leaves nothing relative', () => {
      for (const file of made.files) {
        expect(made.flat, `${file.name} should be inlined`).not.toContain(`<${file.name}>`)
      }
      expect(made.flat).toContain('data:application/wasm;base64,')
      expect(made.flat).toContain('data:text/javascript;base64,')
    })

    it('is still a profile the shapes accept', async () => {
      const report = await validator.validate(await parseText(made.flat, CANONICAL))
      const seen = report.violations.map(v => `${v.focusNode} ${v.path ?? '(node)'}`)
      expect(seen, `violations:\n  ${seen.join('\n  ')}`).toEqual([])
    })

    it('loads through the real loader, with the digests verifying over the inlined bytes', async () => {
      // The whole point of the form: no code knows it is a bundle. If this needs
      // a special case anywhere in PluginLoader, the claim in section 2.1 is
      // false and the format is not what the document says it is.
      const loader = new PluginLoader({
        fetch: serving(made.flat), parse: parseText, validator,
        capabilities: detectCapabilities({})
      })
      const { profile, granted } = await loader.loadProfile(CANONICAL)
      expect(profile.label).toBe('Pulse')
      expect(profile.iri).toBe(CANONICAL)
      expect(profile.module.location.startsWith('data:')).toBe(true)
      expect(granted).toBeTruthy()
    })

    it('fails verification if an inlined byte is changed', async () => {
      // Tamper-evidence is the property that makes a file arriving by email
      // usable at all. A digest that passes whatever it is given is not one.
      const tampered = made.flat.replace('data:application/wasm;base64,AGFzbQ', 'data:application/wasm;base64,AGFzbR')
      expect(tampered).not.toBe(made.flat)
      const loader = new PluginLoader({
        fetch: serving(tampered), parse: parseText, validator,
        capabilities: detectCapabilities({})
      })
      const { profile, granted } = await loader.loadProfile(CANONICAL)
      await expect(loader.fetchVerified(profile.module, { kind: 'module' }))
        .rejects.toThrow(/integrity|digest/i)
    })
  })

  describe('the archive', () => {
    it('is a zip with the profile at the root', () => {
      const bytes = made.archive
      // Local file header, then the first name, which section 2.2 requires to be
      // profile.ttl so that finding it does not require guessing.
      expect(bytes.readUInt32LE(0)).toBe(0x04034b50)
      const nameLength = bytes.readUInt16LE(26)
      expect(bytes.subarray(30, 30 + nameLength).toString('utf8')).toBe('profile.ttl')
    })

    it('is byte identical when made twice', async () => {
      // Same reason the profile writer is deterministic: a diff should show what
      // changed rather than when it was made. A timestamp from the clock would
      // make every rebuild a different file.
      const again = await bundle(pluginDir)
      expect(again.archive.equals(made.archive)).toBe(true)
    })

    it('unpacks into a directory the loader treats as an origin', async () => {
      // Section 2.2: an archive unpacked into a web root is a working plugin
      // origin. Unpacked here with the host's own reader rather than a shell,
      // so the test covers the bytes and not unzip.
      const dir = await mkdtemp(join(tmpdir(), 'jig-bundle-'))
      for (const file of await unzip(made.archive)) {
        const at = join(dir, file.name)
        await mkdir(join(at, '..'), { recursive: true })
        await writeFile(at, file.bytes)
      }

      const loader = new PluginLoader({
        fetch: directoryFetch({ [CANONICAL]: dir }),
        parse: parseText, validator, capabilities: detectCapabilities({}),
        processorUrl: () => pathToFileURL(join(dir, 'pulse-processor.js')).href
      })
      const { profile } = await loader.loadProfile(CANONICAL)
      expect(profile.label).toBe('Pulse')
      // Relative again, resolved onto where it was actually read from.
      expect(profile.module.location).toBe(`${CANONICAL}pulse.wasm`)
      const bytes = await loader.fetchVerified(profile.module, { kind: 'module' })
      expect(bytes.byteLength).toBe((await readFile(resolve(pluginDir, 'pulse.wasm'))).length)
    })
  })

  describe('what it refuses', () => {
    it('refuses a plugin whose profile and files disagree', async () => {
      // The failure a bundle would otherwise carry to another machine: it works
      // here, because here is where the bytes came from.
      const dir = await mkdtemp(join(tmpdir(), 'jig-stale-'))
      const text = await readFile(resolve(pluginDir, 'profile.ttl'), 'utf8')
      await writeFile(join(dir, 'profile.ttl'), text)
      await writeFile(join(dir, 'pulse.wasm'), Buffer.from('not the wasm'))
      await writeFile(join(dir, 'pulse-processor.js'),
        await readFile(resolve(pluginDir, 'pulse-processor.js')))
      await expect(bundle(dir)).rejects.toThrow(/does not match its declared digest/)
    })

    it('refuses a plugin missing a file it declares', async () => {
      const dir = await mkdtemp(join(tmpdir(), 'jig-missing-'))
      await writeFile(join(dir, 'profile.ttl'),
        await readFile(resolve(pluginDir, 'profile.ttl'), 'utf8'))
      await expect(bundle(dir)).rejects.toThrow(/not in the directory/)
    })
  })
})

/** A minimal zip reader, over the central directory. */
async function unzip (buffer) {
  const end = buffer.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]))
  const count = buffer.readUInt16LE(end + 10)
  let at = buffer.readUInt32LE(end + 16)
  const files = []
  for (let i = 0; i < count; i++) {
    const method = buffer.readUInt16LE(at + 10)
    const compressed = buffer.readUInt32LE(at + 20)
    const nameLength = buffer.readUInt16LE(at + 28)
    const extraLength = buffer.readUInt16LE(at + 30)
    const commentLength = buffer.readUInt16LE(at + 32)
    const offset = buffer.readUInt32LE(at + 42)
    const name = buffer.subarray(at + 46, at + 46 + nameLength).toString('utf8')

    const localNameLength = buffer.readUInt16LE(offset + 26)
    const localExtraLength = buffer.readUInt16LE(offset + 28)
    const start = offset + 30 + localNameLength + localExtraLength
    const body = buffer.subarray(start, start + compressed)

    const { inflateRawSync } = await import('node:zlib')
    files.push({ name, bytes: method === 0 ? body : inflateRawSync(body) })
    at += 46 + nameLength + extraLength + commentLength
  }
  return files
}
