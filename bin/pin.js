// bin/pin.js
//
// Say what each member of a composite plugin should be pinned to, and whether the composite
// pins it to that now. docs/nested-plugins.md section 8.
//
// A pin is the canonical digest of a member's profile (plugin-bundles.md section 5). It has to be
// written into the composite's own profile by its author, because the canonical digest names one
// plugin however it was delivered and a tool that edited the profile on the way to a bundle would be
// making a different plugin. So this reports and does not rewrite: it prints the line to paste, and
// with --check it exits non-zero when any pin is missing or stale, which is the check to run before
// publishing, and again whenever a member is rebuilt.
import { readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { parseText } from '../src/rdf/parse.js'
import { readComposite, isComposite } from '../src/rdf/CompositeReader.js'
import { readProfile } from '../src/rdf/ProfileReader.js'
import { pluginForm } from '../src/rdf/Canonical.js'
import { digestOf } from '../src/host/Integrity.js'
import { memberDirectoryUnder } from './bundle-composite.js'

/**
 * One row per member: `{ member, plugin, digest, pinned, state }`, where `state` is `current`, `stale` or
 * `missing`. Throws when the composite cannot be read or a member cannot be found.
 */
export async function pinsFor (directory, resolveMember) {
  const text = await readFile(join(directory, 'profile.ttl'), 'utf8')
  const dataset = await parseText(text, 'urn:jigdaw:pin')
  if (!isComposite(dataset)) throw new Error(`${directory}/profile.ttl is not a composite plugin, so it has no members to pin`)
  const composite = readComposite(dataset)

  const rows = []
  for (const member of composite.members) {
    const memberDirectory = await resolveMember(member.plugin)
    const memberDataset = await parseText(await readFile(join(memberDirectory, 'profile.ttl'), 'utf8'), 'urn:jigdaw:pin')
    if (!memberDataset.match(null, null, null).size) throw new Error(`${memberDirectory}/profile.ttl is empty`)
    // Over the identity the member's profile states, as a host takes it, which is not member.plugin when the
    // directory is a local copy of a plugin whose IRI is elsewhere.
    const identity = isComposite(memberDataset) ? readComposite(memberDataset).iri : readProfile(memberDataset).iri
    const digest = await digestOf(new TextEncoder().encode(pluginForm(memberDataset, identity)), 'sha384')
    rows.push({
      member: member.id,
      plugin: member.plugin,
      digest,
      pinned: member.pinnedDigest,
      state: member.pinnedDigest === null ? 'missing' : member.pinnedDigest === digest ? 'current' : 'stale'
    })
  }
  return rows
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2)
  const check = args.includes('--check')
  const at = args.indexOf('--members')
  const members = at >= 0 ? args[at + 1] : null
  const [directory] = args.filter((a, i) => !a.startsWith('--') && i !== at + 1)
  if (!directory || !members) {
    console.error([
      'usage: node bin/pin.js <composite-directory> --members <directory> [--check]',
      '',
      '  --members <dir>  a directory holding one plugin directory per member, named as the end of its IRI',
      '  --check          exit 1 if any member is unpinned or pinned to a profile that has since changed'
    ].join('\n'))
    process.exit(2)
  }
  try {
    const rows = await pinsFor(resolve(directory), memberDirectoryUnder(members))
    for (const row of rows) {
      console.log(`${row.state.padEnd(8)} ${row.member}`)
      console.log(`         ${row.plugin}`)
      if (row.state !== 'current') console.log(`         jig:pinnedDigest "${row.digest}" ;`)
    }
    const bad = rows.filter(r => r.state !== 'current').length
    console.log(bad === 0 ? 'every member is pinned to the profile on disk' : `${bad} of ${rows.length} need attention`)
    process.exit(check && bad > 0 ? 1 : 0)
  } catch (error) {
    console.error(error.message)
    process.exit(1)
  }
}
