// src/host/ForeignLoader.js
//
// Contract section 12.3: fetch one container, verify it, and make its contents
// the only thing the plugin can reach.
//
// A native plugin declares every file it fetches and each one is verified. A
// foreign format has no manifest, so there is nothing to enumerate. The answer
// is not to give up the guarantee but to move it: verify the container, then
// serve everything from the bytes that were verified and refuse anything that
// resolves outside them. Both answer the same question, which is whether the
// code about to run is the code that was published.
//
// What this does NOT do, and must not be read as doing: it does not sandbox
// anything. A foreign plugin's entry point is a module the host imports into
// its own document. Section 12.1 says what that means and the consent in
// ForeignTrust.js is what makes it a decision rather than a surprise.
//
// The unpacked container is served to the plugin through a virtual origin. That
// part needs a browser and is not exercised by this repository's tests; the
// verification, the unpacking and the boundary checks are, and they are the
// parts that carry the guarantee.
import { verifyIntegrity } from './Integrity.js'
import { LoadError, STEPS } from './LoadError.js'
import { ForeignTrust } from './ForeignTrust.js'

/** Formats an adapter in this repository can start. */
export const ADAPTERS = Object.freeze({
  'http://purl.org/stuff/jigdaw/WebAudioModule': 'wam'
})

/**
 * Read a zip from bytes, in a browser or in node.
 *
 * The same central-directory walk as bin/bundle.js, over DataView rather than
 * node Buffer so it runs in a page. Inflate is DecompressionStream, which every
 * current browser and node 18 onwards have; a container stored without
 * compression needs neither.
 */
export async function unpackContainer (bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const u16 = at => view.getUint16(at, true)
  const u32 = at => view.getUint32(at, true)

  let end = -1
  for (let at = bytes.length - 22; at >= 0; at--) {
    if (u32(at) === 0x06054b50) { end = at; break }
  }
  if (end < 0) throw new LoadError(STEPS.fetchResource, 'the container is not a zip: no end of central directory record')

  const count = u16(end + 10)
  let at = u32(end + 16)
  const files = new Map()

  for (let i = 0; i < count; i++) {
    if (u32(at) !== 0x02014b50) throw new LoadError(STEPS.fetchResource, 'the container\'s central directory is malformed')
    const method = u16(at + 10)
    const compressed = u32(at + 20)
    const nameLength = u16(at + 28)
    const extraLength = u16(at + 30)
    const commentLength = u16(at + 32)
    const offset = u32(at + 42)
    const name = new TextDecoder().decode(bytes.subarray(at + 46, at + 46 + nameLength))

    const localNameLength = u16(offset + 26)
    const localExtraLength = u16(offset + 28)
    const start = offset + 30 + localNameLength + localExtraLength
    const body = bytes.subarray(start, start + compressed)

    // A name that escapes the container would write outside it once unpacked,
    // and would make "everything resolves inside the verified bytes" false. The
    // path is checked here rather than at use, because a caller that forgets is
    // the whole failure.
    if (!isContained(name)) {
      throw new LoadError(STEPS.fetchResource,
        `the container holds "${name}", which resolves outside it. Contract section 12.3.`)
    }

    files.set(name, method === 0 ? body : await inflate(body))
    at += 46 + nameLength + extraLength + commentLength
  }
  return files
}

async function inflate (bytes) {
  if (typeof DecompressionStream !== 'function') {
    throw new LoadError(STEPS.fetchResource,
      'the container is deflated and this environment has no DecompressionStream')
  }
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

/**
 * True for a path that stays inside the container.
 *
 * Rejects absolute paths, drive letters, anything with a `..` segment, and
 * anything with a backslash, which some zip writers emit and which several
 * filesystems treat as a separator.
 */
export function isContained (path) {
  if (typeof path !== 'string' || path.length === 0) return false
  if (path.startsWith('/') || path.includes('\\') || /^[A-Za-z]:/.test(path)) return false
  return path.split('/').every(segment => segment !== '' && segment !== '.' && segment !== '..')
}

const MEDIA_TYPES = Object.freeze({
  js: 'text/javascript', mjs: 'text/javascript', json: 'application/json',
  wasm: 'application/wasm', html: 'text/html', css: 'text/css',
  svg: 'image/svg+xml', png: 'image/png', wav: 'audio/wav', flac: 'audio/flac',
  woff2: 'font/woff2', ttf: 'font/ttf'
})

const mediaTypeFor = name =>
  MEDIA_TYPES[name.slice(name.lastIndexOf('.') + 1).toLowerCase()] ?? 'application/octet-stream'

/**
 * A verified container, and the only thing a foreign plugin may read.
 *
 * `resolve` is what a virtual origin asks for every request the plugin makes.
 * It answers from the verified bytes or refuses; there is no path by which it
 * reaches the network, which is what makes section 12.3 true rather than
 * intended.
 */
export class ContainerOrigin {
  #files
  #refusals

  constructor (files, { base = 'jigdaw-foreign:/' } = {}) {
    this.#files = files
    this.#refusals = []
    this.base = base
  }

  get names () { return [...this.#files.keys()] }
  get refusals () { return [...this.#refusals] }

  /** Answer one request, or refuse it. Never fetches. */
  resolve (path) {
    const wanted = path.startsWith(this.base) ? path.slice(this.base.length) : path
    const clean = wanted.split('?')[0].split('#')[0]
    if (!isContained(clean) || !this.#files.has(clean)) {
      // Recorded rather than only thrown, so a host can tell a person that a
      // plugin tried to reach outside itself. That is worth knowing even when
      // the plugin carries on working without whatever it wanted.
      this.#refusals.push(clean)
      return null
    }
    return { path: clean, bytes: this.#files.get(clean), mediaType: mediaTypeFor(clean) }
  }
}

/**
 * Fetch, verify and unpack a foreign plugin's container.
 *
 * Consent is required first and is checked here rather than trusted to have
 * happened, because this is the last place before bytes exist. A caller that
 * forgot gets a ConsentRequired carrying everything needed to ask.
 */
export async function openForeign (profile, {
  trust,
  fetch: fetchImpl = (...args) => globalThis.fetch(...args)
} = {}) {
  if (profile?.kind !== 'foreign') {
    throw new LoadError(STEPS.fetchResource, 'not a foreign plugin profile')
  }
  const adapter = ADAPTERS[profile.foreignFormat]
  if (!adapter) {
    throw new LoadError(STEPS.fetchResource,
      `no adapter for ${profile.foreignFormat ?? 'an unstated format'}. ` +
      'A host must refuse a format it cannot start rather than guess at it.')
  }
  if (!profile.container?.integrity) {
    throw new LoadError(STEPS.integrity,
      `${profile.iri} declares no digest for its container, which is the only thing verified about a foreign plugin`)
  }

  // Section 12.4, before anything is fetched.
  const gate = trust ?? new ForeignTrust()
  gate.require({
    iri: profile.iri,
    label: profile.label,
    format: profile.foreignFormat,
    digest: profile.container.integrity
  })

  let response
  try {
    response = await fetchImpl(profile.container.location)
  } catch (cause) {
    throw new LoadError(STEPS.fetchResource,
      `could not fetch the container at ${profile.container.location}: ${cause?.message ?? cause}. ` +
      'If it is on another origin, it must be served with Access-Control-Allow-Origin.', { cause })
  }
  if (!response.ok) {
    throw new LoadError(STEPS.fetchResource,
      `the container at ${profile.container.location} returned ${response.status}`)
  }

  const bytes = new Uint8Array(await response.arrayBuffer())
  try {
    await verifyIntegrity(bytes, profile.container.integrity)
  } catch (cause) {
    throw new LoadError(STEPS.integrity,
      `the container at ${profile.container.location} failed verification: ${cause.message}`, { cause })
  }

  const files = await unpackContainer(bytes)
  const origin = new ContainerOrigin(files)

  if (!origin.resolve(profile.entryPoint)) {
    throw new LoadError(STEPS.fetchResource,
      `the container holds no ${profile.entryPoint}. It has: ${origin.names.slice(0, 8).join(', ')}`)
  }

  return { adapter, origin, entryPoint: profile.entryPoint, digest: profile.container.integrity }
}
