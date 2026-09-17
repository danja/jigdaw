// bin/build-plugin-index.js
//
// Generate plugins/index.json from the profiles on disk.
//
// The server reads this rather than parsing Turtle at runtime, which keeps
// bin/serve.js to node builtins alone: no npm install on the server, no
// dependency tree to keep current there, and nothing to go wrong at start-up
// except the code itself.
//
// That property was broken once by importing an RDF parser into the server,
// which crashed it on a deployment that had no node_modules and took the site
// down with a 502. tests/docs/conventions.test.js now fails if anything
// reachable from bin/serve.js imports a package again.
import { readdir, readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, resolve, join } from 'node:path'
import { parseText } from '../src/rdf/parse.js'
import { readProfile } from '../src/rdf/ProfileReader.js'
import { compactTerm } from '../src/catalogue/facets.js'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const dir = join(root, 'plugins')

const entries = []
const problems = []

for (const item of await readdir(dir, { withFileTypes: true })) {
  if (!item.isDirectory()) continue
  const path = join(dir, item.name, 'profile.ttl')
  try {
    const profile = readProfile(await parseText(await readFile(path, 'utf8'), `file://${path}`))
    entries.push({
      iri: profile.iri,
      label: profile.label,
      comment: profile.comment,
      vendor: profile.vendor,
      homepage: profile.homepage ?? profile.iri,
      // Ours, so they run here by definition.
      web: true,
      local: true,
      roles: profile.roles.map(compactTerm),
      formats: profile.formats.map(compactTerm),
      accepts: profile.accepts.map(compactTerm),
      produces: profile.produces.map(compactTerm),
      requires: profile.requires.map(compactTerm),
      cautions: profile.cautions,
      parameters: profile.ports.map(p => p.symbol)
    })
  } catch (error) {
    problems.push(`${item.name}: ${error.message}`)
  }
}

entries.sort((a, b) => (a.label ?? '').localeCompare(b.label ?? ''))

const output = {
  generated: 'bin/build-plugin-index.js',
  note: 'Generated from each plugins/<name>/profile.ttl. Do not edit; run npm run build:index.',
  plugins: entries
}

await writeFile(join(dir, 'index.json'), JSON.stringify(output, null, 2) + '\n')
if (problems.length > 0) console.warn('skipped:', problems.join('; '))
console.log(`plugins/index.json: ${entries.length} plugin(s) (${entries.map(e => e.label).join(', ')})`)
