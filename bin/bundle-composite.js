// bin/bundle-composite.js
//
// Bundle a composite plugin: its profile and, recursively, every member, in both the
// forms docs/plugin-bundles.md defines. Section 9.
//
// A composite declares no files of its own, so the check that makes a bundle worth
// sending is a different one: every member must be pinned, and each pin must match
// the profile of the member being packed. An unpinned member would make the
// signature cover the composite and say nothing about what it runs, so it refuses
// the bundle rather than shipping a signature that reads as stronger than it is.
// The pin cannot be added here: it must be in the published profile, because the
// canonical digest names one plugin whichever way it was delivered.
//
// Members are found on disk by `resolveMember(iri)`, which names a plugin directory.
// The command line looks for a directory named by the last segment of the member's
// IRI under --members, which is how plugins/ is laid out.
import { readFile, access } from 'node:fs/promises'
import { join, resolve, basename } from 'node:path'
import { parseText } from '../src/rdf/parse.js'
import { readComposite, isComposite } from '../src/rdf/CompositeReader.js'
import { pluginForm } from '../src/rdf/Canonical.js'
import { digestOf } from '../src/host/Integrity.js'
import { vocabulary } from '../src/rdf/Vocabulary.js'
import { canonicalDigest } from '../src/host/Signature.js'
import { collectPlugin, inlineFiles, zip, provenance, SEPARATOR } from './bundle.js'

const encoder = new TextEncoder()

/**
 * Everything the closure of a composite needs, read and checked, or one error naming every problem.
 * Members are keyed by IRI, so a plugin used twice, or by two composites, is packed once.
 */
async function collectClosure (dir, resolveMember) {
  const members = new Map()
  const problems = []

  async function composite (compositeDir, chain) {
    const profileText = await readFile(join(compositeDir, 'profile.ttl'), 'utf8')
    const dataset = await parseText(profileText, 'urn:jigdaw:bundle')
    const read = readComposite(dataset)
    if (!/^https?:\/\//.test(read.iri)) {
      throw new Error(`${read.iri} is not an absolute http IRI. A profile carries its own identity through @base and <>.`)
    }
    if (chain.includes(read.iri)) throw new Error(`${read.iri} contains itself: ${[...chain, read.iri].join(' > ')}`)

    for (const member of read.members) {
      if (member.pinnedDigest === null) {
        problems.push(`${read.iri}: member ${member.id} (${member.plugin}) has no jig:pinnedDigest. ` +
          'A composite whose members are not all pinned can be published but not bundled, because a signature on it would not reach them.')
        continue
      }
      if (!members.has(member.plugin)) {
        let memberDir
        try { memberDir = await resolveMember(member.plugin) } catch (cause) {
          problems.push(`${read.iri}: member ${member.plugin} was not found: ${cause.message}`)
          continue
        }
        const text = await readFile(join(memberDir, 'profile.ttl'), 'utf8')
        const memberDataset = await parseText(text, 'urn:jigdaw:bundle')
        const found = isComposite(memberDataset)
          ? await composite(memberDir, [...chain, read.iri])
          : await collectPlugin(memberDir)
        members.set(member.plugin, found)
      }
      const found = members.get(member.plugin)
      if (found.iri !== member.plugin) {
        problems.push(`${read.iri}: member ${member.plugin} is a directory whose profile is for ${found.iri}`)
        continue
      }
      const actual = await digestOf(encoder.encode(pluginForm(found.dataset, found.iri)), 'sha384')
      if (actual !== member.pinnedDigest) {
        problems.push(`${read.iri}: member ${member.plugin} is pinned as ${member.pinnedDigest.slice(0, 24)}… ` +
          `and the profile on disk is ${actual.slice(0, 24)}…. Re-pin the composite, or restore the member.`)
      }
    }
    return { iri: read.iri, label: read.label, profileText, dataset, files: [], composite: true }
  }

  const root = await composite(dir, [])
  if (problems.length > 0) throw new Error(`${root.iri} cannot be bundled:\n  - ` + problems.join('\n  - '))
  return { root, members }
}

/** A directory name for each member inside `members/`, from the last segment of its IRI, made unique. */
function directoryNames (iris) {
  const taken = new Set()
  const names = new Map()
  for (const iri of [...iris].sort()) {
    const base = iri.replace(/\/+$/, '').split('/').pop().replace(/[^A-Za-z0-9._-]/g, '-') || 'member'
    let name = base
    for (let n = 2; taken.has(name); n++) name = `${base}-${n}`
    taken.add(name)
    names.set(iri, name)
  }
  return names
}

export async function bundleComposite (dir, {
  resolveMember,
  now = new Date(),
  attributedTo = null,
  atLocation = null,
  documentIri = null,
  signer = null
} = {}) {
  if (typeof resolveMember !== 'function') {
    throw new Error('bundling a composite needs to know where its members are: pass resolveMember, or --members <directory> on the command line')
  }
  const { root, members } = await collectClosure(resolve(dir), resolveMember)
  const names = directoryNames(members.keys())
  const ordered = [...members.values()].sort((a, b) => a.iri.localeCompare(b.iri))

  // The composite's own triples, so the same value however the bundle is delivered.
  const digest = await canonicalDigest(root.dataset, { plugin: root.iri })

  // The archive's record is over the composite alone: its members are reached through the pins inside it.
  // The flattened form holds them all in one graph, so its signature covers every one of them directly.
  const archiveProvenance = await provenance({
    dataset: root.dataset, profileIri: root.iri, form: vocabulary.jig.Archive, digest, now, attributedTo, atLocation, documentIri, signer
  })
  const everything = [root, ...ordered]
  const flatProvenance = await provenance({
    dataset: everything.flatMap(p => [...p.dataset]), profileIri: root.iri, form: vocabulary.jig.FlattenedProfile,
    digest, now, attributedTo, atLocation, documentIri, signer
  })

  // Turtle allows a new @base and @prefix between statements, and every profile states its own,
  // so concatenating them leaves each meaning what it meant alone.
  const flat = [
    ...everything.map(p => inlineFiles(p.profileText, p.files).replace(/\n*$/, '\n')),
    `${SEPARATOR}\n${flatProvenance}`
  ].join('\n')

  const archive = zip([
    { name: 'profile.ttl', bytes: Buffer.from(root.profileText, 'utf8') },
    { name: 'provenance.ttl', bytes: Buffer.from(archiveProvenance, 'utf8') },
    ...ordered.flatMap(member => [
      { name: `members/${names.get(member.iri)}/profile.ttl`, bytes: Buffer.from(member.profileText, 'utf8') },
      ...member.files.map(f => ({ name: `members/${names.get(member.iri)}/${f.name}`, bytes: f.bytes }))
    ])
  ])

  return {
    iri: root.iri,
    label: root.label,
    members: ordered.map(m => ({ iri: m.iri, label: m.label, directory: names.get(m.iri) })),
    files: ordered.flatMap(m => m.files.map(f => ({ ...f, name: `${names.get(m.iri)}/${f.name}` }))),
    flat,
    archive,
    digest,
    provenance: archiveProvenance,
    signed: signer != null
  }
}

/** The directory a member lives in under `root`: its IRI's last segment, as plugins/ is laid out. */
export function memberDirectoryUnder (root) {
  return async iri => {
    const at = join(resolve(root), basename(iri.replace(/\/+$/, '')))
    try { await access(join(at, 'profile.ttl')) } catch { throw new Error(`no ${join(at, 'profile.ttl')}`) }
    return at
  }
}
