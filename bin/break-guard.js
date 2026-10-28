// bin/break-guard.js
//
// Break a guard once, on purpose, and see whether anything notices. CLAUDE.md: "Break every guard once." A test that passes with the
// thing it guards broken is not a guard, and the only way to know is to break the thing.
//
//   node bin/break-guard.js --file src/ui/Focus.js --from "const inner = active?.shadowRoot?.activeElement" --to "const inner = null" \
//     -- npx vitest run tests/ui/Focus.test.js
//
// It first runs the command unmutated, since a command that already fails would "catch" any mutation and prove nothing. Then it
// replaces one exact piece of text in one file, runs the command after `--`, puts the file back byte for byte whatever happened (a
// failing command, an interrupt, an error), and says which tests failed. `--no-baseline` skips the first run. Exit codes:
//   0  the guard fired: the command failed, and the failing tests are listed
//   1  the mutation SURVIVED: the command passed with the thing broken, so nothing guards it
//   2  nothing was mutated or the result cannot be trusted: wrong arguments, the text is not in the file exactly once, the command
//      fails before any mutation, or the file could not be put back
//
// What it will not do: it takes literal text, never a pattern, so what it changed is what you typed; it refuses a mutation that does
// not apply or applies twice, which a `sed` quietly does not; and it never uses git. The mutated file is restored from a copy kept
// outside the repository, so a killed process leaves the original recoverable and says where.
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { isMain } from './is-main.js'

/** Lines of test output that say a test failed, in the forms vitest prints. Deduplicated, in order. */
export function failedTests (output) {
  const seen = new Set()
  for (const line of output.split('\n')) {
    const m = /^\s*(?:×|✗|✖)\s+(.+?)(?:\s+\d+ms)?\s*$/.exec(line)
    if (m) seen.add(m[1])
  }
  return [...seen]
}

/** How many times `needle` occurs in `text`, not overlapping. */
export function occurrences (text, needle) {
  if (!needle) return 0
  let count = 0
  for (let at = text.indexOf(needle); at !== -1; at = text.indexOf(needle, at + needle.length)) count++
  return count
}

function parse (argv) {
  const split = argv.indexOf('--')
  const own = split === -1 ? argv : argv.slice(0, split)
  const command = split === -1 ? [] : argv.slice(split + 1)
  const options = { baseline: true }
  for (let i = 0; i < own.length; i += own[i] === '--no-baseline' ? 1 : 2) {
    if (own[i] === '--no-baseline') { options.baseline = false; continue }
    const flag = /^--(file|from|to)$/.exec(own[i])
    if (!flag || own[i + 1] === undefined) return { error: `unexpected argument ${own[i]}` }
    options[flag[1]] = own[i + 1]
  }
  if (!options.file || options.from === undefined || options.to === undefined || command.length === 0) {
    return { error: 'usage: node bin/break-guard.js --file PATH --from TEXT --to TEXT -- COMMAND [ARGS...]' }
  }
  if (options.from === options.to) return { error: '--from and --to are the same, so nothing would be broken' }
  return { options, command }
}

function run (command, cwd) {
  return new Promise(done => {
    const child = spawn(command[0], command.slice(1), { cwd, stdio: ['ignore', 'pipe', 'pipe'] })
    let output = ''
    child.stdout.on('data', chunk => { output += chunk })
    child.stderr.on('data', chunk => { output += chunk })
    child.on('error', error => done({ status: null, output: `${output}\n${error.message}` }))
    child.on('close', status => done({ status, output }))
  })
}

/**
 * @param {{ file: string, from: string, to: string, baseline?: boolean }} options
 * @param {string[]} command
 * @param {{ cwd?: string, out?: (output: string) => void, log?: (line: string) => void }} context
 * @returns {Promise<{ code: number, failed: string[], message: string }>}
 */
export async function breakGuard ({ file, from, to, baseline = true }, command, { cwd = process.cwd(), out = () => {}, log = () => {} } = {}) {
  const path = resolve(cwd, file)
  let original
  try {
    original = await readFile(path)
  } catch (error) {
    return { code: 2, failed: [], message: `cannot read ${path}: ${error.message}` }
  }
  const text = original.toString('utf8')
  const count = occurrences(text, from)
  if (count !== 1) return { code: 2, failed: [], message: `the text to replace occurs ${count} times in ${file}, and must occur exactly once. Nothing was run and nothing changed.` }

  // The command must pass as it is. One that fails already "catches" every mutation, which says nothing about any of them.
  if (baseline) {
    const before = await run(command, cwd)
    if (before.status === null) return { code: 2, failed: [], message: `the command could not be run: ${before.output.trim().split('\n').pop()}` }
    if (before.status !== 0) return { code: 2, failed: failedTests(before.output), message: 'the command FAILS before anything is broken, so a failure after proves nothing. Fix that first, or run a narrower command. Nothing was changed.' }
  }

  // A copy outside the repository, kept until the original is back and checked.
  const backupDir = await mkdtemp(join(tmpdir(), 'break-guard-'))
  const backup = join(backupDir, 'original')
  await writeFile(backup, original)
  // Said before the file is touched, so a process killed outright (which no handler can catch) still leaves a path to the original.
  log(`original of ${file} kept at ${backup} until it is restored`)

  let restored = false
  const restore = async () => {
    if (restored) return
    await writeFile(path, original)
    restored = true
  }
  const onSignal = signal => { restore().finally(() => process.exit(signal === 'SIGINT' ? 130 : 143)) }
  process.once('SIGINT', onSignal)
  process.once('SIGTERM', onSignal)

  try {
    await writeFile(path, text.replace(from, () => to))
    const result = await run(command, cwd)
    // If the file cannot be put back (a command made it read-only, say), that is the one thing that must not be lost in an exception:
    // the copy is kept and its place is said.
    const trouble = await restore().then(() => null, error => error)
    if (trouble) return { code: 2, failed: [], message: `COULD NOT RESTORE ${file}: ${trouble.message}. The original is at ${backup}` }
    await rm(backupDir, { recursive: true, force: true })

    if (result.status === null) return { code: 2, failed: [], message: `the command could not be run: ${result.output.trim().split('\n').pop()}` }
    const failed = failedTests(result.output)
    out(result.output)
    if (result.status === 0) return { code: 1, failed: [], message: 'SURVIVED: the command passed with the guarded text broken, so nothing guards it' }
    return { code: 0, failed, message: failed.length ? `caught by ${failed.length} test${failed.length === 1 ? '' : 's'}` : 'the command failed, but no failing test was named: read its output, since it may have failed for another reason' }
  } finally {
    process.removeListener('SIGINT', onSignal)
    process.removeListener('SIGTERM', onSignal)
    // Already attempted above on the normal path. This is for an exception between the write and there; a failure here has
    // nowhere to go but the copy, which is still on disk.
    await restore().catch(() => {})
  }
}

if (isMain(import.meta.url)) {
  const parsed = parse(process.argv.slice(2))
  if (parsed.error) {
    console.error(parsed.error)
    process.exit(2)
  }
  const result = await breakGuard(parsed.options, parsed.command, { log: line => console.error(line) })
  console.log(result.message)
  for (const name of result.failed) console.log(`  failed: ${name}`)
  if (result.code === 0 && result.failed.length === 1) console.log('exactly one test failed, which is what a good mutation does')
  if (result.code === 0 && result.failed.length > 1) console.log('more than one test failed: check each is failing for the reason you broke, and not because the mutation is too large')
  process.exit(result.code)
}
