// bin/verify.js
//
// Open a bundle and say what is actually known about it.
//
// docs/plugin-bundles.md section 6. The answer has three independent parts and
// running them together would be a lie by arrangement, so they are printed as
// three:
//
//   the files, against the digests the profile states
//   the profile, against the canonical digest the provenance record states
//   the provenance record, against a signature, if there is one
//
// A valid signature by a key nobody has heard of proves that one holder of that
// key made this bundle and says nothing whatever about who that is. This prints
// that distinction rather than collapsing it into a tick, because collapsing it
// is how a person comes to believe a bundle is safe when what they were told is
// that it is internally consistent.
import { readFile } from 'node:fs/promises'
import { statSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { parseText } from '../src/rdf/parse.js'
import { readProfile } from '../src/rdf/ProfileReader.js'
import { readProvenance } from '../src/rdf/ProvenanceDocument.js'
import { verifyProfile } from '../src/host/Signature.js'
import { verifyIntegrity } from '../src/host/Integrity.js'
import { vocabulary } from '../src/rdf/Vocabulary.js'
import { unzip } from './bundle.js'

/**
 * Everything a bundle is, whichever of the three shapes it arrived in.
 *
 * A directory and an unpacked archive are the same case on purpose: section 2.2
 * says an archive unpacked into a web root is a working plugin origin, and a
 * reader that treats them differently would be evidence against that.
 */
export async function openBundle (path) {
  const at = resolve(path)
  const stat = statSync(at)

  if (stat.isDirectory()) {
    const files = new Map()
    const profileText = await readFile(join(at, 'profile.ttl'), 'utf8')
    let provenanceText = null
    try { provenanceText = await readFile(join(at, 'provenance.ttl'), 'utf8') } catch { }
    return { kind: 'directory', profileText, provenanceText, read: name => readFile(join(at, name)) }
  }

  if (at.endsWith('.jig')) {
    const entries = new Map(unzip(await readFile(at)).map(f => [f.name, f.bytes]))
    const profile = entries.get('profile.ttl')
    if (!profile) throw new Error(`${at} has no profile.ttl at its root, so it is not a bundle`)
    return {
      kind: 'archive',
      profileText: profile.toString('utf8'),
      provenanceText: entries.get('provenance.ttl')?.toString('utf8') ?? null,
      read: async name => entries.get(name) ?? null
    }
  }

  // A flattened profile, or a served one. Both carry their resources by
  // reference only, and in the flattened case the reference is the bytes.
  return {
    kind: 'profile',
    profileText: await readFile(at, 'utf8'),
    provenanceText: null,
    read: async () => null
  }
}

/** The three answers, as data. */
export async function inspect (path, { resolveKey = null } = {}) {
  const opened = await openBundle(path)

  const profileDataset = await parseText(opened.profileText, 'urn:jigdaw:bundle')
  const profile = readProfile(profileDataset)

  const provenanceDataset = opened.provenanceText
    ? await parseText(opened.provenanceText, `${profile.iri}provenance.ttl`)
    : []

  // A plain array, because everything that reads a graph here only iterates.
  const graph = [...profileDataset, ...provenanceDataset]

  const resources = []
  for (const [what, resource] of [
    ['jig:module', profile.module],
    ['jig:processor', profile.processor],
    ['jig:ui', profile.ui],
    ...(profile.assets ?? []).map(a => ['jig:asset', a])
  ]) {
    if (!resource) continue
    const name = resource.location.startsWith('data:')
      ? null
      : resource.location.replace(profile.iri, '')
    let bytes = null
    if (resource.location.startsWith('data:')) {
      bytes = new Uint8Array(await (await fetch(resource.location)).arrayBuffer())
    } else if (name) {
      const read = await opened.read(name)
      bytes = read ? new Uint8Array(read) : null
    }
    if (!bytes) { resources.push({ what, name, state: 'absent' }); continue }
    try {
      await verifyIntegrity(bytes, resource.integrity)
      resources.push({ what, name, state: 'verified', bytes: bytes.length })
    } catch (error) {
      resources.push({ what, name, state: 'failed', reason: error.message })
    }
  }

  return {
    kind: opened.kind,
    profile,
    provenance: readProvenance(graph),
    signature: await verifyProfile(graph, profile.iri, { resolveKey }),
    resources
  }
}

/** Dereference a verification method over https, for an online check. */
export async function publishedKey (iri) {
  const response = await fetch(iri, { headers: { accept: 'text/turtle' } })
  if (!response.ok) return null
  const dataset = await parseText(await response.text(), iri)
  for (const quad of dataset) {
    if (quad.subject.value === iri && quad.predicate.value === vocabulary.sec.publicKeyMultibase) {
      return quad.object.value
    }
  }
  return null
}

const FORM = {
  [vocabulary.jig.Archive]: 'archive',
  [vocabulary.jig.FlattenedProfile]: 'flattened profile'
}

/** The report a person reads. Deliberately three paragraphs, not one verdict. */
export function report (found) {
  const out = []
  out.push(`${found.profile.label}  ${found.profile.iri}`)
  out.push(`opened as a ${found.kind}`)
  out.push('')

  out.push('Files')
  for (const resource of found.resources) {
    const where = resource.name ?? 'inlined'
    if (resource.state === 'verified') out.push(`  ok       ${resource.what} ${where}, ${resource.bytes} bytes`)
    else if (resource.state === 'absent') out.push(`  absent   ${resource.what} ${where}, not carried by this bundle`)
    else out.push(`  FAILED   ${resource.what} ${where}: ${resource.reason}`)
  }
  out.push('')

  out.push('Profile')
  const { signature, provenance } = found
  out.push(`  ${signature.digest}`)
  if (signature.digestMatches === null) {
    out.push('  no bundle states a canonical digest for this profile, so nothing here is tamper evident')
  } else if (signature.digestMatches) {
    out.push('  matches the digest the provenance record states')
  } else {
    out.push(`  DOES NOT MATCH the declared ${signature.declared}. The profile has been changed since it was bundled.`)
  }
  out.push('')

  out.push('Provenance')
  if (!provenance) {
    out.push('  none. Nothing says who made this copy or when.')
  } else {
    out.push(`  form         ${FORM[provenance.form] ?? provenance.form}`)
    out.push(`  made         ${provenance.endedAtTime ?? 'at an unstated time'}`)
    out.push(`  by           ${provenance.attributedTo ?? 'nobody: this bundle is anonymous'}`)
    out.push(`  with         ${provenance.tool ?? 'an unstated tool'}`)
    if (provenance.atLocation) out.push(`  read from    ${provenance.atLocation}`)
  }
  out.push('')

  out.push('Signature')
  if (!signature.signed) {
    out.push('  none. Everything above is a claim by whoever handed you this file.')
  }
  for (const proof of signature.proofs) {
    if (!proof.valid) {
      out.push(`  INVALID  ${proof.verificationMethod ?? proof.iri}: ${proof.reason}`)
      continue
    }
    out.push(`  valid    ${proof.verificationMethod}`)
    out.push(`           made ${proof.created}`)
    out.push(proof.keySource === 'dereferenced'
      ? '           checked against the key published at that IRI'
      : '           checked against the key inside the bundle, which proves only that one ' +
        'holder of that key made this and nothing about who they are')
    out.push(proof.sameAuthority
      ? '           the key is on the same origin as the plugin, so this is the origin signing its own work'
      : '           the key is on a different origin from the plugin, so this is a third party vouching for it')
  }
  out.push('')

  const bad = found.resources.some(r => r.state === 'failed') ||
    signature.digestMatches === false ||
    signature.proofs.some(p => !p.valid)
  out.push(bad
    ? 'Refuse this bundle. Something in it does not match what it says about itself.'
    : 'Nothing here contradicts itself. Whether to run it is a question about who made it.')
  return out.join('\n')
}

// ── Command line ───────────────────────────────────────────────────────────

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2)
  const online = args.includes('--online')
  const [path] = args.filter(a => !a.startsWith('--'))
  if (!path) {
    console.error([
      'usage: node bin/verify.js <bundle.jig | bundle.ttl | plugin-directory> [--online]',
      '',
      '  --online  dereference each verification method and check the key in the',
      '            bundle against the key its IRI actually publishes'
    ].join('\n'))
    process.exit(2)
  }
  try {
    const found = await inspect(path, { resolveKey: online ? publishedKey : null })
    console.log(report(found))
    const bad = found.resources.some(r => r.state === 'failed') ||
      found.signature.digestMatches === false ||
      found.signature.proofs.some(p => !p.valid)
    process.exit(bad ? 1 : 0)
  } catch (error) {
    console.error(error.message)
    process.exit(1)
  }
}
