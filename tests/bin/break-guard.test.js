// tests/bin/break-guard.test.js
//
// bin/break-guard.js breaks a file on purpose, runs a command, and puts the file back. The things worth holding are the ones that go
// wrong quietly: a mutation that did not apply (a `sed` that matched nothing), one that applied twice, a file left broken because the
// command failed or the process was killed, and a verdict that says "caught" because the command failed for some other reason.
import { describe, it, expect } from 'vitest'
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawn, spawnSync } from 'node:child_process'
import { breakGuard, failedTests, occurrences } from '../../bin/break-guard.js'

const root = resolve(import.meta.dirname, '../..')
const script = join(root, 'bin/break-guard.js')

// A directory holding a file to break and a check that fails, naming a test the way vitest does, when the file says BAD.
function workspace (content = 'a good value\n') {
  const dir = mkdtempSync(join(tmpdir(), 'bg-test-'))
  writeFileSync(join(dir, 'target.txt'), content)
  writeFileSync(join(dir, 'check.js'), `
    const fs = require('node:fs')
    const text = fs.readFileSync('target.txt', 'utf8')
    fs.appendFileSync('ran.txt', 'x')
    fs.appendFileSync('seen.txt', text + '|')
    if (text.includes('BAD')) { console.log(' × the target is good 3ms'); console.log('Tests  1 failed'); process.exit(1) }
    console.log('Tests  1 passed')
  `)
  return dir
}
const done = dir => rmSync(dir, { recursive: true, force: true })
const check = ['node', 'check.js']

describe('breaking a guard', () => {
  it('reports the guard as caught, names the failing test, and puts the file back byte for byte', async () => {
    const dir = workspace()
    try {
      const result = await breakGuard({ file: 'target.txt', from: 'good', to: 'BAD' }, check, { cwd: dir })
      expect(result.code).toBe(0)
      expect(result.failed).toEqual(['the target is good'])
      expect(result.message).toBe('caught by 1 test')
      expect(readFileSync(join(dir, 'target.txt'), 'utf8')).toBe('a good value\n')
    } finally { done(dir) }
  })

  it('says where the copy of the original is before it touches the file, so even a kill -9 leaves a way back', async () => {
    const dir = workspace()
    try {
      const lines = []
      let seenBroken = null
      const result = await breakGuard({ file: 'target.txt', from: 'good', to: 'BAD' }, check, { cwd: dir, log: line => { lines.push(line); seenBroken = readFileSync(join(dir, 'target.txt'), 'utf8') } })
      expect(result.code).toBe(0)
      expect(lines).toHaveLength(1)
      expect(lines[0]).toMatch(/^original of target\.txt kept at .*break-guard-/)
      // At the moment it spoke, the file was not yet broken.
      expect(seenBroken).toBe('a good value\n')
    } finally { done(dir) }
  })

  it('reports a mutation that SURVIVED when the command still passes, which means nothing guards the text', async () => {
    const dir = workspace()
    try {
      const result = await breakGuard({ file: 'target.txt', from: 'value', to: 'thing' }, check, { cwd: dir })
      expect(result.code).toBe(1)
      expect(result.message).toMatch(/^SURVIVED/)
      expect(readFileSync(join(dir, 'target.txt'), 'utf8')).toBe('a good value\n')
    } finally { done(dir) }
  })

  it('does not call a failure caught when no test was named, since the command may have failed for another reason', async () => {
    const dir = workspace()
    try {
      const result = await breakGuard({ file: 'target.txt', from: 'good', to: 'BAD', baseline: false }, ['node', '-e', 'process.exit(1)'], { cwd: dir })
      expect(result.code).toBe(0)
      expect(result.failed).toEqual([])
      expect(result.message).toMatch(/no failing test was named/)
    } finally { done(dir) }
  })

  it('refuses to break anything when the command already fails, since that "catches" every mutation and proves none', async () => {
    const dir = workspace('a BAD value\n')
    try {
      const result = await breakGuard({ file: 'target.txt', from: 'value', to: 'thing' }, check, { cwd: dir })
      expect(result.code).toBe(2)
      expect(result.message).toMatch(/FAILS before anything is broken/)
      expect(result.failed).toEqual(['the target is good'])
      // Run once, unmutated, and not again.
      expect(readFileSync(join(dir, 'ran.txt'), 'utf8')).toBe('x')
      expect(readFileSync(join(dir, 'target.txt'), 'utf8')).toBe('a BAD value\n')
    } finally { done(dir) }
  })

  it('runs the command once unmutated and once mutated, and skips the first with --no-baseline', async () => {
    const dir = workspace()
    try {
      await breakGuard({ file: 'target.txt', from: 'good', to: 'BAD' }, check, { cwd: dir })
      expect(readFileSync(join(dir, 'ran.txt'), 'utf8')).toBe('xx')
      rmSync(join(dir, 'ran.txt'))
      await breakGuard({ file: 'target.txt', from: 'good', to: 'BAD', baseline: false }, check, { cwd: dir })
      expect(readFileSync(join(dir, 'ran.txt'), 'utf8')).toBe('x')
    } finally { done(dir) }
  })

  it('refuses, runs nothing and changes nothing when the text is not in the file', async () => {
    const dir = workspace()
    try {
      const result = await breakGuard({ file: 'target.txt', from: 'absent', to: 'BAD' }, check, { cwd: dir })
      expect(result.code).toBe(2)
      expect(result.message).toMatch(/occurs 0 times/)
      expect(existsSync(join(dir, 'ran.txt'))).toBe(false)
      expect(readFileSync(join(dir, 'target.txt'), 'utf8')).toBe('a good value\n')
    } finally { done(dir) }
  })

  it('refuses, runs nothing and changes nothing when the text is in the file more than once', async () => {
    const dir = workspace('good good\n')
    try {
      const result = await breakGuard({ file: 'target.txt', from: 'good', to: 'BAD' }, check, { cwd: dir })
      expect(result.code).toBe(2)
      expect(result.message).toMatch(/occurs 2 times/)
      expect(existsSync(join(dir, 'ran.txt'))).toBe(false)
    } finally { done(dir) }
  })

  it('takes the text literally, never as a pattern', async () => {
    const dir = workspace('a.b and axb\n')
    try {
      const result = await breakGuard({ file: 'target.txt', from: 'a.b', to: 'BAD' }, check, { cwd: dir })
      expect(result.code).toBe(0)
      expect(readFileSync(join(dir, 'target.txt'), 'utf8')).toBe('a.b and axb\n')
      // "$&" in the replacement is text, not "the match": what the command saw is what was typed, and no more.
      await breakGuard({ file: 'target.txt', from: 'a.b', to: '$&BAD' }, check, { cwd: dir })
      // The last thing the command saw, since each run before it (the unmutated one) leaves an entry too.
      expect(readFileSync(join(dir, 'seen.txt'), 'utf8').split('|').filter(Boolean).at(-1)).toBe('$&BAD and axb\n')
    } finally { done(dir) }
  })

  it('restores the file when the command cannot even be started', async () => {
    const dir = workspace()
    try {
      const result = await breakGuard({ file: 'target.txt', from: 'good', to: 'BAD' }, ['no-such-command-here'], { cwd: dir })
      expect(result.code).toBe(2)
      expect(result.message).toMatch(/could not be run/)
      expect(readFileSync(join(dir, 'target.txt'), 'utf8')).toBe('a good value\n')
    } finally { done(dir) }
  })

  // The command makes the file read-only, so the restore fails. Skipped as root, which may write anyway.
  it.skipIf(process.getuid?.() === 0)('says where the original is, and keeps it, when the file cannot be put back', async () => {
    const dir = workspace()
    try {
      const result = await breakGuard({ file: 'target.txt', from: 'good', to: 'BAD', baseline: false }, ['node', '-e', "require('fs').chmodSync('target.txt', 0o444); console.log(' × the target is good 1ms'); process.exit(1)"], { cwd: dir })
      expect(result.code).toBe(2)
      expect(result.message).toMatch(/^COULD NOT RESTORE target\.txt/)
      const backup = /The original is at (\S+)$/.exec(result.message)?.[1]
      expect(readFileSync(backup, 'utf8')).toBe('a good value\n')
      rmSync(join(backup, '..'), { recursive: true, force: true })
    } finally { rmSync(join(dir, 'target.txt'), { force: true }); done(dir) }
  })

  it('says so, and changes nothing, for a file that does not exist', async () => {
    const dir = workspace()
    try {
      const result = await breakGuard({ file: 'missing.txt', from: 'a', to: 'b' }, check, { cwd: dir })
      expect(result.code).toBe(2)
      expect(result.message).toMatch(/cannot read/)
    } finally { done(dir) }
  })
})

describe('the command line', () => {
  it('restores the file when the process is killed in the middle of the run', async () => {
    const dir = workspace()
    try {
      const child = spawn(process.execPath, [script, '--file', 'target.txt', '--from', 'good', '--to', 'BAD', '--no-baseline', '--', 'node', '-e', 'setTimeout(() => {}, 30000)'], { cwd: dir })
      // Wait until the file is actually broken, so the signal arrives while it is.
      for (let i = 0; i < 100 && !readFileSync(join(dir, 'target.txt'), 'utf8').includes('BAD'); i++) await new Promise(r => setTimeout(r, 50))
      expect(readFileSync(join(dir, 'target.txt'), 'utf8')).toContain('BAD')
      const code = await new Promise(resolveExit => { child.on('close', resolveExit); child.kill('SIGTERM') })
      expect(code).toBe(143)
      expect(readFileSync(join(dir, 'target.txt'), 'utf8')).toBe('a good value\n')
    } finally { done(dir) }
  })

  it('exits 0 and says "exactly one test" for a good mutation, 1 for a survivor and 2 for bad arguments', () => {
    const dir = workspace()
    try {
      const run = (...args) => spawnSync(process.execPath, [script, ...args], { cwd: dir, encoding: 'utf8' })
      const caught = run('--file', 'target.txt', '--from', 'good', '--to', 'BAD', '--', ...check)
      expect(caught.status).toBe(0)
      expect(caught.stdout).toContain('exactly one test failed')
      expect(run('--file', 'target.txt', '--from', 'value', '--to', 'thing', '--', ...check).status).toBe(1)
      expect(run('--file', 'target.txt', '--from', 'good').status).toBe(2)
      expect(run('--file', 'target.txt', '--from', 'good', '--to', 'BAD', '--no-baseline', '--', ...check).status).toBe(0)
      expect(run('--file', 'target.txt', '--from', 'good', '--to', 'good', '--', ...check).stderr).toContain('nothing would be broken')
      expect(run().status).toBe(2)
    } finally { done(dir) }
  })
})

describe('reading test output', () => {
  it('finds the failing tests in vitest\'s output, once each', () => {
    const out = ' ✓ fine 2ms\n   × refuses a quote 5ms\n   × refuses a quote 5ms\n × another one\nTests  2 failed'
    expect(failedTests(out)).toEqual(['refuses a quote', 'another one'])
  })
  it('counts a piece of text without overlapping', () => {
    expect(occurrences('aaaa', 'aa')).toBe(2)
    expect(occurrences('abc', '')).toBe(0)
  })
})
