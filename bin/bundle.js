// bin/bundle.js
//
// Make a shareable bundle of a plugin, in both the forms docs/plugin-bundles.md defines: a flattened profile to send to
// someone, and a .jig archive to publish or mirror. The work is in bundle-core.js and, for a composite plugin that is made
// of others, bundle-composite.js; this is the front door that callers import and the command line.
//
// Usage is printed by `node bin/bundle.js` with no arguments.
import { writeFile } from 'node:fs/promises'
import { resolve, join, basename } from 'node:path'
import { bundle } from './bundle-core.js'

export * from './bundle-core.js'

// ── Command line ───────────────────────────────────────────────────────────

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2)
  const options = {}
  const positional = []
  for (let i = 0; i < args.length; i++) {
    const flag = /^--(by|key|at|date|members)$/.exec(args[i])
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
      '  --date <iso>  the bundling time, for a reproducible record',
      '  --members <dir>  for a composite: a directory holding each member plugin, named as its IRI ends'
    ].join('\n'))
    process.exit(2)
  }
  const out = given ?? dir

  try {
    const { loadSigner } = await import('./keys.js')
    const { memberDirectoryUnder } = await import('./bundle-composite.js')
    const made = await bundle(resolve(dir), {
      resolveMember: options.members ? memberDirectoryUnder(options.members) : undefined,
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
