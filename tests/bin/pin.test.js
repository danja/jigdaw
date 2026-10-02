// tests/bin/pin.test.js
//
// bin/pin.js against the real plugins: it must report a pin as current only when it is, and a stale one
// must not look current. The digest it prints is the one the loader checks, so the last test loads with it.
import { describe, it, expect, beforeAll } from 'vitest'
import { resolve, join } from 'node:path'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { execFileSync } from 'node:child_process'
import { pinsFor } from '../../bin/pin.js'
import { memberDirectoryUnder } from '../../bin/bundle-composite.js'
import { pinnedRack } from '../../src/testing/CompositeFixtures.js'

const root = resolve(import.meta.dirname, '../..')
const members = memberDirectoryUnder(resolve(root, 'plugins'))

async function rackIn (text) {
  const dir = await mkdtemp(join(tmpdir(), 'jigdaw-pin-'))
  await writeFile(join(dir, 'profile.ttl'), text)
  return dir
}

describe('bin/pin.js', () => {
  let pinned
  beforeAll(async () => { pinned = await pinnedRack(root) })

  it('finds every member current in a rack pinned to the plugins as they are', async () => {
    const rows = await pinsFor(await rackIn(pinned), members)
    expect(rows.map(r => r.state)).toEqual(['current', 'current', 'current'])
    expect(rows.map(r => r.plugin).sort()).toEqual([
      'https://strandz.it/jigdaw/plugins/boost/', 'https://strandz.it/jigdaw/plugins/cascade/', 'https://strandz.it/jigdaw/plugins/tremolo/'
    ])
  })

  it('calls the placeholder pins stale and prints the digest each should have', async () => {
    const rows = await pinsFor(await rackIn(await (await import('node:fs/promises')).readFile(resolve(root, 'examples/reference-composite.ttl'), 'utf8')), members)
    expect(rows.map(r => r.state)).toEqual(['stale', 'stale', 'stale'])
    // The digest it offers is the one the pinned rack carries.
    for (const row of rows) expect(pinned).toContain(row.digest)
  })

  it('calls a member with no pin missing', async () => {
    const text = pinned.replace(/\s*jig:pinnedDigest "sha384-[^"]+" ;\s*\n\s*jig:setting <#trem-rate> \./, '\n    jig:setting <#trem-rate> .')
    const rows = await pinsFor(await rackIn(text), members)
    expect(rows.find(r => r.plugin.endsWith('/tremolo/')).state).toBe('missing')
  })

  it('refuses a profile that is not a composite, and a member that is not on disk', async () => {
    await expect(pinsFor(resolve(root, 'plugins/boost'), members)).rejects.toThrow(/not a composite/)
    const empty = await mkdtemp(join(tmpdir(), 'jigdaw-none-'))
    await expect(pinsFor(await rackIn(pinned), memberDirectoryUnder(empty))).rejects.toThrow(/no .*profile\.ttl/)
  })

  it('exits non-zero under --check when a pin is stale, and zero when every pin is current', async () => {
    const run = (dir, ...flags) => {
      try { execFileSync('node', [resolve(root, 'bin/pin.js'), dir, '--members', resolve(root, 'plugins'), ...flags], { stdio: 'pipe' }); return 0 } catch (e) { return e.status }
    }
    expect(run(await rackIn(pinned), '--check')).toBe(0)
    const stale = await rackIn(pinned.replace(/sha384-[A-Za-z0-9+/]+=*"/, `sha384-${'B'.repeat(64)}"`))
    expect(run(stale, '--check')).toBe(1)
    expect(run(stale)).toBe(0)
  })
})
