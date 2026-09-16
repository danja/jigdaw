// bin/validate.js
//
// Validate RDF documents against vocabs/shapes.ttl.
//
//   npm run validate -- examples/cascade-profile.ttl
//   npm run validate -- --shapes other.ttl file.ttl
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { shapeValidatorFromFile, validateFile } from '../src/validate/files.js'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

function parseArgs (argv) {
  const files = []
  let shapes = resolve(root, 'vocabs/shapes.ttl')
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--shapes') {
      const value = argv[++i]
      if (!value) throw new Error('--shapes needs a file')
      shapes = resolve(value)
    } else {
      files.push(argv[i])
    }
  }
  return { shapes, files }
}

const { shapes, files } = parseArgs(process.argv.slice(2))

if (files.length === 0) {
  console.error('usage: npm run validate -- [--shapes FILE] FILE...')
  process.exit(2)
}

const validator = await shapeValidatorFromFile(shapes)
let failed = false

for (const file of files) {
  const report = await validateFile(validator, resolve(file))
  const { violations, warnings } = report

  const summary = violations.length === 0
    ? `ok${warnings.length ? `, ${warnings.length} warning(s)` : ''}`
    : `${violations.length} violation(s)`
  console.log(`${file}: ${summary}`)

  for (const r of report.results) {
    const label = r.severity === 'http://www.w3.org/ns/shacl#Warning' ? 'warning' : 'violation'
    console.log(`  ${label}: ${r.focusNode}`)
    console.log(`    ${r.path ?? '(node)'}`)
    console.log(`    ${r.message}`)
  }

  if (!report.conforms) failed = true
}

process.exit(failed ? 1 : 0)
