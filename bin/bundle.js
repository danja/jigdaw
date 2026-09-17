// bin/bundle.js
//
// Make a shareable bundle of a plugin, in both the forms docs/plugin-bundles.md
// defines: a flattened profile to send to someone, and a .jig archive to publish
// or mirror.
//
// It verifies before it packs. A profile whose declared digest does not match the
// file beside it is the failure the generated-profile rule exists to prevent, and
// a bundle is where it would stop being local: the plugin still works here,
// because here is where the bytes came from, and fails on the machine it was sent
// to. So a mismatch refuses the bundle rather than shipping it.
//
// No dependency. The zip container is written by hand over node:zlib, which is
// eighty lines and keeps this runnable in a checkout with nothing installed.
import { readFile, writeFile, readdir } from 'node:fs/promises'
import { resolve, join, basename, dirname, relative } from 'node:path'
import { deflateRawSync, crc32 } from 'node:zlib'
import { parseText } from '../src/rdf/parse.js'
import { readProfile } from '../src/rdf/ProfileReader.js'
import { digestOf } from '../src/host/Integrity.js'

const MEDIA_TYPES = {
  '.wasm': 'application/wasm',
  '.js': 'text/javascript',
  '.html': 'text/html',
  '.css': 'text/css',
  '.json': 'application/json',
  '.ttl': 'text/turtle',
  '.wav': 'audio/wav',
  '.flac': 'audio/flac',
  '.ogg': 'audio/ogg',
  '.woff2': 'font/woff2',
  '.png': 'image/png',
  '.svg': 'image/svg+xml'
}

const mediaTypeFor = (name, declared) =>
  declared ?? MEDIA_TYPES[name.slice(name.lastIndexOf('.'))] ?? 'application/octet-stream'

/**
 * Every file the plugin declares, in the order the spec lists them.
 *
 * Section 1: a bundle can only contain what the profile enumerates, so this is
 * also the definition of complete. A resource reached any other way is not in
 * here and will not be in the bundle.
 */
function declaredResources (profile) {
  const found = []
  if (profile.module) found.push({ what: 'jig:module', resource: profile.module })
  if (profile.processor) found.push({ what: 'jig:processor', resource: profile.processor })
  if (profile.ui) found.push({ what: 'jig:ui', resource: profile.ui })
  for (const asset of profile.assets ?? []) found.push({ what: 'jig:asset', resource: asset })
  return found
}

/**
 * The file a resource names, as a path inside the plugin directory.
 *
 * A location that leaves the directory cannot be bundled: the archive has no
 * outside. An absolute IRI on another origin is the same problem and is refused
 * for the same reason, rather than silently fetched at bundle time and quietly
 * turned into a copy nobody asked for.
 */
function localPath (resource, profileIri, dir) {
  const location = resource.location
  if (location.startsWith('data:')) return { error: 'is already inlined' }
  if (!location.startsWith(profileIri)) {
    return { error: `is on another origin (${location}), which a bundle cannot contain` }
  }
  const rest = location.slice(profileIri.length)
  if (rest === '' || rest.startsWith('/') || rest.includes('..')) {
    return { error: `resolves outside the plugin directory (${location})` }
  }
  return { path: join(dir, rest), name: rest }
}

// ── The zip container ──────────────────────────────────────────────────────

/** A little-endian buffer writer, because a zip is a pile of small integers. */
const u16 = n => { const b = Buffer.alloc(2); b.writeUInt16LE(n); return b }
const u32 = n => { const b = Buffer.alloc(4); b.writeUInt32LE(n >>> 0); return b }

/**
 * Write a zip.
 *
 * Deflate, or stored when deflate makes it bigger, which happens for anything
 * already compressed such as a FLAC impulse response. The date is fixed rather
 * than taken from the clock so that bundling the same plugin twice produces the
 * same bytes, for the same reason the profile writer is deterministic: a diff
 * should show what changed rather than when it was made.
 */
function zip (entries) {
  const locals = []
  const central = []
  let offset = 0

  for (const { name, bytes } of entries) {
    const deflated = deflateRawSync(bytes, { level: 9 })
    const stored = deflated.length >= bytes.length
    const body = stored ? bytes : deflated
    const method = stored ? 0 : 8
    const nameBytes = Buffer.from(name, 'utf8')
    const sum = crc32(bytes)

    const local = Buffer.concat([
      u32(0x04034b50), u16(20), u16(0), u16(method),
      u16(0), u16(0x21),                       // 1980-01-01, a fixed date
      u32(sum), u32(body.length), u32(bytes.length),
      u16(nameBytes.length), u16(0), nameBytes, body
    ])
    locals.push(local)

    central.push(Buffer.concat([
      u32(0x02014b50), u16(20), u16(20), u16(0), u16(method),
      u16(0), u16(0x21),
      u32(sum), u32(body.length), u32(bytes.length),
      u16(nameBytes.length), u16(0), u16(0), u16(0), u16(0),
      u32(0), u32(offset), nameBytes
    ]))
    offset += local.length
  }

  const directory = Buffer.concat(central)
  return Buffer.concat([
    ...locals, directory,
    Buffer.concat([
      u32(0x06054b50), u16(0), u16(0),
      u16(entries.length), u16(entries.length),
      u32(directory.length), u32(offset), u16(0)
    ])
  ])
}

// ── Making the two forms ───────────────────────────────────────────────────

export async function bundle (dir) {
  const profileText = await readFile(join(dir, 'profile.ttl'), 'utf8')
  // The profile IRI is its own subject, so the document says where it belongs
  // and nothing here has to be told.
  const dataset = await parseText(profileText, 'urn:jigdaw:bundle')
  const profile = readProfile(dataset)
  const iri = profile.iri

  const resources = declaredResources(profile)
  if (resources.length === 0) throw new Error(`${iri} declares no files, so there is nothing to bundle`)

  const files = []
  const problems = []

  for (const { what, resource } of resources) {
    const at = localPath(resource, iri, dir)
    if (at.error) { problems.push(`${what} ${at.error}`); continue }

    let bytes
    try { bytes = await readFile(at.path) } catch {
      problems.push(`${what} names ${at.name}, which is not in the directory`)
      continue
    }

    // The check that makes a bundle worth sending.
    const actual = await digestOf(new Uint8Array(bytes))
    if (actual !== resource.integrity) {
      problems.push(`${what} (${at.name}) does not match its declared digest. ` +
        `The profile says ${resource.integrity.slice(0, 24)}… and the file is ${actual.slice(0, 24)}…. ` +
        'Rebuild the plugin so the profile is regenerated.')
      continue
    }

    files.push({ name: at.name, bytes, mediaType: mediaTypeFor(at.name, resource.mediaType) })
  }

  if (problems.length > 0) {
    throw new Error(`${iri} cannot be bundled:\n  - ` + problems.join('\n  - '))
  }

  // Flattened: every location becomes the bytes themselves. A legal profile,
  // which is why this needs no reader of its own.
  let flat = profileText
  for (const file of files) {
    const inline = `data:${file.mediaType};base64,${file.bytes.toString('base64')}`
    const before = flat
    flat = flat.replace(`<${file.name}>`, `<${inline}>`)
    if (flat === before) {
      throw new Error(`could not inline ${file.name}: the profile does not name it relatively. ` +
        'A bundle needs relative locations, per docs/plugin-bundles.md section 2.2.')
    }
  }

  const archive = zip([
    { name: 'profile.ttl', bytes: Buffer.from(profileText, 'utf8') },
    ...files.map(f => ({ name: f.name, bytes: f.bytes }))
  ])

  return { iri, label: profile.label, files, flat, archive }
}

// ── Command line ───────────────────────────────────────────────────────────

if (import.meta.url === `file://${process.argv[1]}`) {
  const dir = process.argv[2]
  if (!dir) {
    console.error('usage: node bin/bundle.js <plugin-directory> [output-directory]')
    process.exit(2)
  }
  const out = process.argv[3] ?? dir
  try {
    const made = await bundle(resolve(dir))
    const name = basename(resolve(dir))
    await writeFile(join(out, `${name}.ttl`), made.flat)
    await writeFile(join(out, `${name}.jig`), made.archive)
    console.log(`${made.label}  ${made.iri}`)
    for (const file of made.files) console.log(`  ${file.name}  ${file.bytes.length} bytes`)
    console.log(`  ${name}.ttl   ${made.flat.length} bytes, one file that any host already reads`)
    console.log(`  ${name}.jig   ${made.archive.length} bytes, unpacks into a working plugin origin`)
  } catch (error) {
    console.error(error.message)
    process.exit(1)
  }
}
