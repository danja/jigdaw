// tests/host/ForeignLoader.test.js
//
// Contract section 12.3. The container is the only thing verified about a
// foreign plugin, so the interesting assertions are all about what does not get
// through: a wrong digest, a path that escapes, a format with no adapter, and a
// load that nobody consented to.
//
// The containers here are built with the same zip writer bin/bundle.js uses, so
// the reader is tested against bytes this repository actually produces rather
// than against bytes written to suit the reader.
import { describe, it, expect, beforeAll } from 'vitest'
import { deflateRawSync, crc32 } from 'node:zlib'
import { unpackContainer, isContained, ContainerOrigin, openForeign, ADAPTERS } from '../../src/host/ForeignLoader.js'
import { ForeignTrust, ConsentRequired } from '../../src/host/ForeignTrust.js'
import { digestOf } from '../../src/host/Integrity.js'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { resolve, join } from 'node:path'

const WAM = 'http://purl.org/stuff/jigdaw/WebAudioModule'
const AT = 'https://example.org/wam/pingpong/pingpong-2.1.0.wam'

// A zip, written the way bin/bundle.js writes one.
const u16 = n => { const b = Buffer.alloc(2); b.writeUInt16LE(n); return b }
const u32 = n => { const b = Buffer.alloc(4); b.writeUInt32LE(n >>> 0); return b }

function zip (entries) {
  const locals = []; const central = []; let offset = 0
  for (const { name, bytes } of entries) {
    const deflated = deflateRawSync(bytes, { level: 9 })
    const stored = deflated.length >= bytes.length
    const body = stored ? bytes : deflated
    const method = stored ? 0 : 8
    const nameBytes = Buffer.from(name, 'utf8')
    const sum = crc32(bytes)
    const local = Buffer.concat([
      u32(0x04034b50), u16(20), u16(0), u16(method), u16(0), u16(0x21),
      u32(sum), u32(body.length), u32(bytes.length),
      u16(nameBytes.length), u16(0), nameBytes, body
    ])
    locals.push(local)
    central.push(Buffer.concat([
      u32(0x02014b50), u16(20), u16(20), u16(0), u16(method), u16(0), u16(0x21),
      u32(sum), u32(body.length), u32(bytes.length),
      u16(nameBytes.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(offset), nameBytes
    ]))
    offset += local.length
  }
  const directory = Buffer.concat(central)
  return Buffer.concat([...locals, directory, Buffer.concat([
    u32(0x06054b50), u16(0), u16(0), u16(entries.length), u16(entries.length),
    u32(directory.length), u32(offset), u16(0)
  ])])
}

const ENTRY = 'export default class { static isWebAudioModuleConstructor = true }\n'
const container = zip([
  { name: 'index.js', bytes: Buffer.from(ENTRY, 'utf8') },
  { name: 'dsp/kernel.wasm', bytes: Buffer.from([0x00, 0x61, 0x73, 0x6d, 1, 0, 0, 0]) },
  { name: 'gui/panel.html', bytes: Buffer.from('<!doctype html><p>hello'.repeat(40), 'utf8') }
])

const served = (bytes, ok = true) => async () => ({
  ok, status: ok ? 200 : 404,
  arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
})

describe('unpacking a container', () => {
  it('reads every entry, deflated or stored', async () => {
    const files = await unpackContainer(new Uint8Array(container))
    expect([...files.keys()].sort()).toEqual(['dsp/kernel.wasm', 'gui/panel.html', 'index.js'])
    expect(new TextDecoder().decode(files.get('index.js'))).toBe(ENTRY)
    // panel.html is big enough to have been deflated, so this exercises inflate.
    expect(new TextDecoder().decode(files.get('gui/panel.html'))).toContain('hello')
  })

  it('refuses an entry whose name escapes the container', async () => {
    const escaping = zip([{ name: '../outside.js', bytes: Buffer.from('x') }])
    await expect(unpackContainer(new Uint8Array(escaping))).rejects.toThrow(/resolves outside/)
  })

  it('refuses something that is not a zip', async () => {
    await expect(unpackContainer(new Uint8Array(Buffer.from('not a zip at all'))))
      .rejects.toThrow(/not a zip/)
  })
})

describe('the containment rule', () => {
  it('accepts an ordinary relative path', () => {
    for (const path of ['index.js', 'dsp/kernel.wasm', 'a/b/c.json']) {
      expect(isContained(path), path).toBe(true)
    }
  })

  it('rejects every way out of the container', () => {
    // Each of these has been a real escape in some unzip implementation.
    for (const path of ['../x', 'a/../../x', '/etc/passwd', 'C:/x', 'a\\..\\b', './x', '', 'a//b']) {
      expect(isContained(path), JSON.stringify(path)).toBe(false)
    }
  })
})

describe('the container origin', () => {
  let origin
  beforeAll(async () => { origin = new ContainerOrigin(await unpackContainer(new Uint8Array(container))) })

  it('answers from the verified bytes', () => {
    const answer = origin.resolve('index.js')
    expect(new TextDecoder().decode(answer.bytes)).toBe(ENTRY)
    expect(answer.mediaType).toBe('text/javascript')
    expect(origin.resolve('dsp/kernel.wasm').mediaType).toBe('application/wasm')
  })

  it('ignores a query string and a fragment, as a server would', () => {
    expect(origin.resolve('index.js?v=2#top')).not.toBeNull()
  })

  it('refuses anything it does not hold, and remembers that it did', () => {
    // Section 12.3: everything resolves inside the container or is refused.
    // Recorded as well as refused, because a plugin reaching outside itself is
    // worth telling a person about even when it carries on working.
    expect(origin.resolve('https://evil.example/payload.js')).toBeNull()
    expect(origin.resolve('../../etc/passwd')).toBeNull()
    expect(origin.resolve('not-here.js')).toBeNull()
    expect(origin.refusals).toContain('not-here.js')
    expect(origin.refusals.length).toBe(3)
  })

  it('has no way to reach the network', () => {
    // The property that makes the boundary real rather than intended. If a
    // fetch ever appears in this class, section 12.3 stops being true.
    expect(ContainerOrigin.prototype.resolve.constructor.name).toBe('Function')
    expect(String(ContainerOrigin.prototype.resolve)).not.toMatch(/fetch|import\(|XMLHttpRequest/)
  })
})

describe('opening a foreign plugin', () => {
  let profile
  beforeAll(async () => {
    profile = {
      kind: 'foreign',
      iri: 'https://example.org/wam/pingpong/',
      label: 'Ping Pong Delay',
      foreignFormat: WAM,
      entryPoint: 'index.js',
      container: { location: AT, integrity: await digestOf(new Uint8Array(container)) }
    }
  })

  const consenting = p => {
    const trust = new ForeignTrust()
    trust.consent(p.iri, p.container.integrity)
    return trust
  }

  it('refuses before consent, and says how to ask', async () => {
    // Checked here and not only in the UI, because this is the last place
    // before bytes exist. A caller that forgot still cannot proceed.
    await expect(openForeign(profile, { fetch: served(container) })).rejects.toThrow(ConsentRequired)
  })

  it('verifies, unpacks and hands back only the container', async () => {
    const opened = await openForeign(profile, { trust: consenting(profile), fetch: served(container) })
    expect(opened.adapter).toBe('wam')
    expect(opened.origin.names).toContain('index.js')
    expect(opened.origin.resolve('https://evil.example/x.js')).toBeNull()
  })

  it('refuses a container whose digest does not match', async () => {
    // The threat section 3.2 names, answered for a format with no manifest:
    // the bytes are not the bytes that were published.
    const wrong = { ...profile, container: { ...profile.container, integrity: 'sha384-' + 'A'.repeat(64) } }
    const trust = new ForeignTrust()
    trust.consent(wrong.iri, wrong.container.integrity)
    await expect(openForeign(wrong, { trust, fetch: served(container) }))
      .rejects.toThrow(/failed verification/)
  })

  it('refuses a plugin with no container digest at all', async () => {
    const undeclared = { ...profile, container: { location: AT, integrity: null } }
    await expect(openForeign(undeclared, { trust: new ForeignTrust() }))
      .rejects.toThrow(/only thing verified/)
  })

  it('refuses a format no adapter speaks', async () => {
    const unknown = { ...profile, foreignFormat: 'https://example.org/SomeOtherFormat' }
    await expect(openForeign(unknown, { trust: consenting(unknown), fetch: served(container) }))
      .rejects.toThrow(/no adapter for/)
    expect(Object.keys(ADAPTERS)).toEqual([WAM])
  })

  it('refuses a container missing its own entry point', async () => {
    const wrongEntry = { ...profile, entryPoint: 'main.js' }
    await expect(openForeign(wrongEntry, { trust: consenting(wrongEntry), fetch: served(container) }))
      .rejects.toThrow(/holds no main\.js/)
  })

  it('refuses a native profile, so the two paths cannot be confused', async () => {
    await expect(openForeign({ kind: 'native' }, { trust: new ForeignTrust() }))
      .rejects.toThrow(/not a foreign plugin/)
  })
})

// ── Against the real WAM examples ──────────────────────────────────────────
//
// Everything above uses a synthetic container. These use the actual
// webaudiomodules/wam-examples plugins, because the design of contract section
// 12.3 rests on claims about how real WAMs are built, and those claims were
// guesses until this checkout existed.
//
// Skips loudly when it is absent, and reads it without copying anything in: the
// examples are MIT and somebody else's, and a fixture vendored here would go
// stale silently.
const EXAMPLES = resolve(process.env.HOME ?? '', 'wam-examples/packages')
const haveExamples = existsSync(EXAMPLES)

const describeExamples = haveExamples ? describe : describe.skip
if (!haveExamples) console.warn('~/wam-examples not present; the real-plugin checks did not run')

describeExamples('a container built from a real WAM', () => {
  const PLUGIN = join(EXAMPLES, 'pingpongdelay/src')

  const filesUnder = dir => {
    const out = []
    const walk = (at, prefix) => {
      for (const entry of readdirSync(at, { withFileTypes: true })) {
        const path = prefix ? `${prefix}/${entry.name}` : entry.name
        if (entry.isDirectory()) walk(join(at, entry.name), path)
        else out.push(path)
      }
    }
    walk(dir, '')
    return out
  }

  let real
  let paths
  beforeAll(() => {
    paths = filesUnder(PLUGIN)
    real = zip(paths.map(name => ({ name, bytes: readFileSync(join(PLUGIN, name)) })))
  })

  it('unpacks every file, including nested directories and binary assets', async () => {
    const files = await unpackContainer(new Uint8Array(real))
    expect(files.size).toBe(paths.length)
    expect(files.size).toBeGreaterThan(8)
    // Real layouts have subdirectories and images; the synthetic fixture only
    // has them because this one does.
    expect([...files.keys()]).toContain('Gui/Gui.css')
    expect([...files.keys()].some(n => n.endsWith('.png'))).toBe(true)
    const png = files.get([...files.keys()].find(n => n.endsWith('.png')))
    expect([...png.subarray(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47])
  })

  it('holds every path a real plugin uses inside the boundary', () => {
    // If a real plugin's own layout failed the containment rule, the rule would
    // be wrong rather than the plugin.
    const outside = paths.filter(p => !isContained(p))
    expect(outside, `real paths rejected by isContained: ${outside.join(', ')}`).toEqual([])
  })

  it('serves the descriptor the plugin fetches of itself at run time', async () => {
    // pingpongdelay does `fetch(`${baseURL}/descriptor.json`)` inside
    // initialize(). That fetch is the reason a container is verified rather
    // than a file list enumerated: nothing in the profile could have predicted
    // it, and it resolves inside the container, so the boundary holds.
    const origin = new ContainerOrigin(await unpackContainer(new Uint8Array(real)))
    const descriptor = origin.resolve('descriptor.json')
    expect(descriptor).not.toBeNull()
    expect(JSON.parse(new TextDecoder().decode(descriptor.bytes)).name).toBe('PingPongDelay')
  })

  it('opens end to end, with the digest checked over real bytes', async () => {
    const profile = {
      kind: 'foreign',
      iri: 'https://example.org/wam/pingpongdelay/',
      label: 'PingPongDelay',
      foreignFormat: WAM,
      entryPoint: 'index.js',
      container: { location: AT, integrity: await digestOf(new Uint8Array(real)) }
    }
    const trust = new ForeignTrust()
    trust.consent(profile.iri, profile.container.integrity)
    const opened = await openForeign(profile, { trust, fetch: served(real) })
    expect(opened.origin.names).toContain('index.js')
    expect(opened.origin.resolve('https://cdn.example/anything.js')).toBeNull()
  })
})

describeExamples('what the real examples prove about the design', () => {
  const packages = () => readdirSync(EXAMPLES, { withFileTypes: true })
    .filter(e => e.isDirectory() && existsSync(join(EXAMPLES, e.name, 'src')))
    .map(e => e.name)

  const sourcesOf = name => {
    const out = []
    const walk = at => {
      for (const entry of readdirSync(at, { withFileTypes: true })) {
        if (entry.isDirectory()) walk(join(at, entry.name))
        else if (/\.(js|ts)$/.test(entry.name)) out.push(readFileSync(join(at, entry.name), 'utf8'))
      }
    }
    walk(join(EXAMPLES, name, 'src'))
    return out
  }

  it('shows that a WAM locates itself with import.meta.url', () => {
    // This is why the container cannot be served as blob URLs, which was the
    // cheap option. A blob URL has no directory, so `new URL('.',
    // import.meta.url)` gives a plugin nothing it can build a path from, and
    // every plugin below breaks. A Service Worker virtual origin is therefore
    // required rather than preferred. Asserted here so the decision is tied to
    // the evidence rather than to a paragraph in docs/wam.md.
    const using = packages().filter(name => sourcesOf(name).some(text => text.includes('import.meta.url')))
    expect(using.length, 'no example used import.meta.url, so this checked nothing').toBeGreaterThan(5)
  })

  it('shows that runtime fetching is ordinary, not exceptional', () => {
    // The reason section 12.3 verifies a container instead of enumerating
    // files: these fetch descriptors, templates, patches and preset banks that
    // no manifest written beforehand would have listed.
    const fetching = packages().filter(name => sourcesOf(name).some(text => /\bfetch\(/.test(text)))
    expect(fetching.length, 'no example fetched at run time').toBeGreaterThan(5)
  })
})
