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
// Every bundle carries a provenance record, because a bundle arrives by hand
// rather than from the origin that minted the IRI inside it and where it has
// been is the one thing the profile does not already say. Given a key it also
// carries a signature over the profile and that record together. See
// docs/plugin-bundles.md sections 5 and 6.
//
// The provenance record is the one part of a bundle that is not reproducible,
// because it states when the bundle was made. `now` is an argument rather than
// a call to the clock so that a caller can pin it, and so that the test for
// byte identical output still has something to assert. Everything else, the
// archive's fixed date included, is unchanged: two bundles of one plugin made
// at the same stated time are the same bytes.
//
// No dependency. The zip container is written by hand over node:zlib, which is
// eighty lines and keeps this runnable in a checkout with nothing installed.
import { readFile, writeFile, readdir } from 'node:fs/promises'
import { resolve, join, basename, dirname, relative } from 'node:path'
import { deflateRawSync, inflateRawSync, crc32 } from 'node:zlib'
import { parseText } from '../src/rdf/parse.js'
import { readProfile } from '../src/rdf/ProfileReader.js'
import { digestOf } from '../src/host/Integrity.js'
import { vocabulary, JIG } from '../src/rdf/Vocabulary.js'
import {
  writeProvenance, provenanceIriFor, provenanceNodes
} from '../src/rdf/ProvenanceDocument.js'
import {
  canonicalDigest, signProfile, importPrivateKey, CRYPTOSUITE
} from '../src/host/Signature.js'

/**
 * The software agent every bundle names, minted under the PURL for the same
 * reason every other JigDAW IRI is: the repository that happens to host the
 * tool is an implementation detail and the identity is not.
 */
const TOOL = `${JIG}tool/bundle`
const TOOL_NAME = 'bin/bundle.js'

/** The two root names an archive reserves. Section 2.2. */
export const RESERVED = Object.freeze(['profile.ttl', 'provenance.ttl'])

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

/**
 * Read a zip, over its central directory.
 *
 * The reader half of the format. It lives beside the writer so that the two
 * cannot drift, and so that bin/verify.js and the tests open an archive with
 * the same code rather than each carrying a copy.
 */
export function unzip (buffer) {
  const end = buffer.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]))
  if (end < 0) throw new Error('not a zip: no end of central directory record')
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

    files.push({ name, bytes: method === 0 ? body : inflateRawSync(body) })
    at += 46 + nameLength + extraLength + commentLength
  }
  return files
}

// ── Making the two forms ───────────────────────────────────────────────────

export async function bundle (dir, {
  now = new Date(),
  attributedTo = null,
  atLocation = null,
  documentIri = null,
  signer = null
} = {}) {
  const profileText = await readFile(join(dir, 'profile.ttl'), 'utf8')
  // The profile IRI is its own subject, so the document says where it belongs
  // and nothing here has to be told.
  const dataset = await parseText(profileText, 'urn:jigdaw:bundle')
  const profile = readProfile(dataset)
  const iri = profile.iri

  // A profile that does not state its own IRI would canonicalise under the
  // placeholder base above, which would make its digest a fact about this
  // directory rather than about the plugin. Section 3.
  if (!/^https?:\/\//.test(iri)) {
    throw new Error(
      `${iri} is not an absolute http IRI. A profile carries its own identity through ` +
      '@base and <>, and a bundle cannot mint one for it. See docs/plugin-bundles.md section 3.'
    )
  }

  const resources = declaredResources(profile)
  if (resources.length === 0) throw new Error(`${iri} declares no files, so there is nothing to bundle`)

  const files = []
  const problems = []

  for (const { what, resource } of resources) {
    const at = localPath(resource, iri, dir)
    if (at.error) { problems.push(`${what} ${at.error}`); continue }

    if (RESERVED.includes(at.name)) {
      problems.push(`${what} is named ${at.name}, which an archive reserves for the profile and its provenance`)
      continue
    }

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

  // One digest for both forms, because it is taken over the graph with
  // jig:location omitted and the two forms differ in nothing else. That is the
  // property that makes it a name for the plugin rather than for the copy.
  const digest = await canonicalDigest(dataset)

  const provenanceFor = form => provenance({
    dataset, profileIri: iri, form, digest, now, attributedTo, atLocation, documentIri, signer
  })

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

  // The flattened form is one file, so its provenance goes in that file. The
  // record names its nodes absolutely, so appending it changes nothing about
  // what it says. Its subjects are omitted from the canonical digest by rule
  // rather than by which file they are in, which is what makes that work.
  const flatProvenance = await provenanceFor(vocabulary.jig.FlattenedProfile)
  flat = `${flat.replace(/\n*$/, '')}\n\n${SEPARATOR}\n${flatProvenance}`

  const archiveProvenance = await provenanceFor(vocabulary.jig.Archive)
  const archive = zip([
    { name: 'profile.ttl', bytes: Buffer.from(profileText, 'utf8') },
    { name: 'provenance.ttl', bytes: Buffer.from(archiveProvenance, 'utf8') },
    ...files.map(f => ({ name: f.name, bytes: f.bytes }))
  ])

  return {
    iri,
    label: profile.label,
    files,
    flat,
    archive,
    digest,
    provenance: archiveProvenance,
    signed: signer != null
  }
}

const SEPARATOR =
  '# ── Provenance ─────────────────────────────────────────────────────────────'

/**
 * The provenance record for one form, signed when a signer was given.
 *
 * Signing is two passes over the same writer. The first emits everything but
 * the signature so that the created time, the verification method and the whole
 * provenance record are in the graph being signed; the second puts the
 * signature into that graph. A record written the other way round would verify
 * and cover less than it looks like it covers.
 *
 * The union of the two graphs is a plain array of quads, because everything
 * that reads it only iterates.
 */
async function provenance ({
  dataset, profileIri, form, digest, now, attributedTo, atLocation, documentIri, signer
}) {
  const at = documentIri ?? provenanceIriFor(profileIri)
  const record = {
    profileIri,
    documentIri: at,
    form,
    canonicalDigest: digest,
    endedAtTime: now,
    tool: TOOL,
    toolName: TOOL_NAME,
    attributedTo,
    atLocation
  }
  if (!signer) return writeProvenance(record)

  record.proof = {
    cryptosuite: CRYPTOSUITE,
    verificationMethod: signer.verificationMethod,
    publicKeyMultibase: signer.publicKeyMultibase,
    created: now,
    proofValue: null
  }
  const unsigned = await parseText(writeProvenance(record), at)
  const proofIri = provenanceNodes(at).proof
  record.proof.proofValue = await signProfile(
    [...dataset, ...unsigned], proofIri, signer.privateKey
  )
  return writeProvenance(record)
}

// ── Command line ───────────────────────────────────────────────────────────

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2)
  const options = {}
  const positional = []
  for (let i = 0; i < args.length; i++) {
    const flag = /^--(by|key|at|date)$/.exec(args[i])
    if (flag) { options[flag[1]] = args[++i]; continue }
    positional.push(args[i])
  }

  const [dir, given] = positional
  if (!dir) {
    console.error([
      'usage: node bin/bundle.js <plugin-directory> [output-directory] [options]',
      '',
      '  --by <iri>    who to attribute the bundle to, in its provenance record',
      '  --key <file>  a key file from bin/keys.js, to sign the bundle with',
      '  --at <iri>    where the provenance record itself will be published',
      '  --date <iso>  the bundling time, for a reproducible record'
    ].join('\n'))
    process.exit(2)
  }
  const out = given ?? dir

  try {
    const { loadSigner } = await import('./keys.js')
    const made = await bundle(resolve(dir), {
      attributedTo: options.by ?? null,
      documentIri: options.at ?? null,
      now: options.date ? new Date(options.date) : new Date(),
      signer: options.key ? await loadSigner(options.key) : null
    })
    const name = basename(resolve(dir))
    await writeFile(join(out, `${name}.ttl`), made.flat)
    await writeFile(join(out, `${name}.jig`), made.archive)
    console.log(`${made.label}  ${made.iri}`)
    for (const file of made.files) console.log(`  ${file.name}  ${file.bytes.length} bytes`)
    console.log(`  ${name}.ttl   ${made.flat.length} bytes, one file that any host already reads`)
    console.log(`  ${name}.jig   ${made.archive.length} bytes, unpacks into a working plugin origin`)
    console.log(`  ${made.digest}`)
    console.log(made.signed
      ? '  signed. A recipient can check it with node bin/verify.js'
      : '  not signed. The provenance record says who made this and nothing proves it; ' +
        'pass --key to sign.')
    if (!options.by) {
      console.log('  attributed to nobody. Pass --by <iri> to say who made it.')
    }
  } catch (error) {
    console.error(error.message)
    process.exit(1)
  }
}
