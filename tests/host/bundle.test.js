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
import { bundle, unzip } from '../../bin/bundle.js'
import { PluginLoader } from '../../src/host/PluginLoader.js'
import { shapeValidatorFromFile } from '../../src/validate/files.js'
import { parseText } from '../../src/rdf/parse.js'
import { detectCapabilities } from '../../src/host/Capabilities.js'
import { directoryFetch } from '../../src/testing/OfflineHost.js'
import { vocabulary } from '../../src/rdf/Vocabulary.js'

const root = resolve(import.meta.dirname, '../..')
const pluginDir = resolve(root, 'plugins/pulse')
const CANONICAL = 'https://strandz.it/jigdaw/plugins/pulse/'

// Pinned so the archive is reproducible; see bin/bundle.js on the one
// part of a bundle that carries a time.
const WHEN = new Date('2026-09-18T11:00:00Z')

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
    made = await bundle(pluginDir, { now: WHEN })
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

    it('is byte identical when made twice at the same stated time', async () => {
      // Same reason the profile writer is deterministic: a diff should show what
      // changed rather than when it was made.
      const again = await bundle(pluginDir, { now: WHEN })
      expect(again.archive.equals(made.archive)).toBe(true)
    })

    it('differs between two times in the provenance record and nowhere else', async () => {
      // The one part of a bundle that cannot be reproducible is the part that
      // says when it was made. Asserting that the difference is confined to it
      // is the stronger claim, and the one that would catch a clock leaking
      // into the archive's own entries the way it did before the date was fixed.
      const later = await bundle(pluginDir, { now: new Date('2027-01-01T00:00:00Z') })
      expect(later.archive.equals(made.archive)).toBe(false)

      const before = new Map((unzip(made.archive)).map(f => [f.name, f.bytes]))
      const after = new Map((unzip(later.archive)).map(f => [f.name, f.bytes]))
      expect([...after.keys()]).toEqual([...before.keys()])
      const differing = [...before.keys()].filter(name => !before.get(name).equals(after.get(name)))
      expect(differing).toEqual(['provenance.ttl'])
    })

    it('carries a provenance record at its root, beside the profile', async () => {
      // Section 2.2 reserves exactly two root names and section 1 says an
      // archive holds nothing a resource does not name. The record is the
      // exception, and reserving the name is how the two rules coexist.
      const names = unzip(made.archive).map(f => f.name)
      expect(names.slice(0, 2)).toEqual(['profile.ttl', 'provenance.ttl'])
    })

    it('unpacks into a directory the loader treats as an origin', async () => {
      // Section 2.2: an archive unpacked into a web root is a working plugin
      // origin. Unpacked here with the host's own reader rather than a shell,
      // so the test covers the bytes and not unzip.
      const dir = await mkdtemp(join(tmpdir(), 'jig-bundle-'))
      for (const file of unzip(made.archive)) {
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

suite('a signed bundle', () => {
  // The whole path, from a key that does not exist yet to a report a person
  // reads. Unit testing the verifier proves the verifier; this is the only
  // thing that proves the two forms a bundle actually ships in carry a
  // signature that survives the trip.
  let key
  let made
  beforeAll(async () => {
    const { generateKeyPair } = await import('../../src/host/Signature.js')
    key = await generateKeyPair()
    made = await bundle(pluginDir, {
      now: WHEN,
      attributedTo: 'https://example.org/people/test#me',
      signer: {
        verificationMethod: 'https://example.org/keys/test#ed25519',
        publicKeyMultibase: key.publicKeyMultibase,
        privateKey: key.privateKey
      }
    })
  }, 30000)

  it('states one canonical digest for both forms', async () => {
    // The property that makes the digest a name for the plugin rather than for
    // the copy, and the reason jig:location is outside the canonical form.
    const { inspect } = await import('../../bin/verify.js')
    const dir = await mkdtemp(join(tmpdir(), 'jig-signed-'))
    await writeFile(join(dir, 'pulse.ttl'), made.flat)
    await writeFile(join(dir, 'pulse.jig'), made.archive)

    const flat = await inspect(join(dir, 'pulse.ttl'))
    const archive = await inspect(join(dir, 'pulse.jig'))
    expect(flat.signature.digest).toBe(made.digest)
    expect(archive.signature.digest).toBe(made.digest)
    expect(flat.signature.digestMatches).toBe(true)
    expect(archive.signature.digestMatches).toBe(true)
  })

  it('verifies in both forms, and says who it is attributed to', async () => {
    const { inspect } = await import('../../bin/verify.js')
    const dir = await mkdtemp(join(tmpdir(), 'jig-signed-'))
    await writeFile(join(dir, 'pulse.ttl'), made.flat)
    await writeFile(join(dir, 'pulse.jig'), made.archive)

    for (const file of ['pulse.ttl', 'pulse.jig']) {
      const found = await inspect(join(dir, file))
      expect(found.signature.valid, file).toBe(true)
      expect(found.provenance.attributedTo, file).toBe('https://example.org/people/test#me')
      expect(found.resources.every(r => r.state === 'verified'), file).toBe(true)
    }
  })

  it('is refused when a byte of the archive is changed', async () => {
    // Tamper evidence has to hold over the bytes that actually travel, not
    // only over a graph in memory. Changing the processor inside the archive
    // leaves the profile and its signature intact and breaks the file digest,
    // which is the layer that is supposed to catch it.
    const dir = await mkdtemp(join(tmpdir(), 'jig-tampered-'))
    const entries = unzip(made.archive)
    for (const file of entries) {
      await writeFile(join(dir, file.name),
        file.name === 'pulse-processor.js'
          ? Buffer.concat([file.bytes, Buffer.from('\n// and one more thing\n')])
          : file.bytes)
    }
    const { inspect, report } = await import('../../bin/verify.js')
    const found = await inspect(dir)
    expect(found.signature.valid).toBe(true)
    expect(found.resources.find(r => r.name === 'pulse-processor.js').state).toBe('failed')
    expect(report(found)).toContain('Refuse this bundle')
  })

  it('reads a directory and an unpacked archive as the same thing', async () => {
    // Section 2.2 says an archive unpacked into a web root is a working plugin
    // origin. A reader that treated the two differently would be evidence
    // against that claim rather than a convenience.
    const dir = await mkdtemp(join(tmpdir(), 'jig-unpacked-'))
    for (const file of unzip(made.archive)) await writeFile(join(dir, file.name), file.bytes)
    const { inspect } = await import('../../bin/verify.js')
    const found = await inspect(dir)
    expect(found.kind).toBe('directory')
    expect(found.signature.valid).toBe(true)
    expect(found.provenance.form).toBe(vocabulary.jig.Archive)
  })

  it('says a plain served profile makes no claim, rather than failing', async () => {
    // A plugin directory with no provenance.ttl is the normal case today and
    // must not read as a tampered bundle.
    const { inspect, report } = await import('../../bin/verify.js')
    const found = await inspect(pluginDir)
    expect(found.provenance).toBeNull()
    expect(found.signature.digestMatches).toBeNull()
    expect(report(found)).toContain('nothing here is tamper evident')
  })
})

suite('what signing refuses', () => {
  it('refuses to write a private key anywhere a commit could reach it', async () => {
    // The rule in AGENTS.md is that a scanner cannot tell an invented fixture
    // from a live credential, so the safest key file is one that was never
    // written inside a repository. Enforced rather than documented.
    const { createKeyFile, insideGitTree } = await import('../../bin/keys.js')
    expect(insideGitTree(root)).toBe(root)
    await expect(createKeyFile(join(root, 'signing.json'), 'https://example.org/k#1'))
      .rejects.toThrow(/inside the git working tree/)
  })

  it('refuses a profile that does not state its own IRI', async () => {
    // Without @base the profile canonicalises under whatever placeholder the
    // parser was given, which would make its digest a fact about the machine it
    // was bundled on.
    const dir = await mkdtemp(join(tmpdir(), 'jig-baseless-'))
    const text = (await readFile(resolve(pluginDir, 'profile.ttl'), 'utf8'))
      .replace(/@base <[^>]*> \./, '')
    await writeFile(join(dir, 'profile.ttl'), text)
    await expect(bundle(dir)).rejects.toThrow(/not an absolute http IRI/)
  })
})
