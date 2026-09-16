// bin/check-suites.js
//
// Every tests/<dir>/ must appear in vitest.config.js, or its suites are written
// and never run and nothing says so.
//
// This deliberately runs OUTSIDE vitest, as part of `npm test` rather than as a
// test. A check of the include list that is itself governed by the include list
// cannot catch its own directory being removed: it just stops running. That was
// found by mutation, after the in-vitest version of this check passed while the
// thing it checks was broken. See MISTAKES.md.
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve, join } from 'node:path'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const configPath = join(root, 'vitest.config.js')
const testsDir = join(root, 'tests')

if (!existsSync(configPath)) {
  console.error('check-suites: vitest.config.js is missing')
  process.exit(1)
}
if (!existsSync(testsDir)) {
  console.error('check-suites: tests/ is missing')
  process.exit(1)
}

const config = readFileSync(configPath, 'utf8')

const suites = readdirSync(testsDir, { withFileTypes: true })
  .filter(e => e.isDirectory())
  .map(e => e.name)
  .filter(name => hasTests(join(testsDir, name)))

function hasTests (dir) {
  return readdirSync(dir, { withFileTypes: true, recursive: true })
    .some(e => e.isFile() && e.name.endsWith('.test.js'))
}

if (suites.length === 0) {
  console.error('check-suites: no test directories found, so nothing would run')
  process.exit(1)
}

const missing = suites.filter(name => !config.includes(`tests/${name}/`))

if (missing.length > 0) {
  console.error('check-suites: test directories absent from vitest.config.js:')
  for (const name of missing) console.error(`  tests/${name}/`)
  console.error('Their suites exist and will not run.')
  process.exit(1)
}

console.log(`check-suites: ${suites.length} suite director${suites.length === 1 ? 'y' : 'ies'} all wired`)
