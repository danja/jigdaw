// tests/catalogue/BrowseAll.test.js
//
// An empty search in the page is documented as listing everything this host holds
// (web/app/Browser.js). It asked for 25, and when the 26th plugin arrived the 26th
// onward vanished from the list with nothing to say so. Sam, the 33rd, was one of eight
// hidden. So the page asks for the catalogue's maximum, and this fails the day the
// plugins outgrow that too.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { LocalCatalogue } from '../../src/catalogue/LocalCatalogue.js'
import { pluginDirs } from '../../src/catalogue/PluginDirectories.js'
import { MAX_RESULTS } from '../../src/catalogue/limits.js'

const root = resolve(import.meta.dirname, '../..')

describe('browsing every plugin this host holds', () => {
  it('returns all of them for an empty search at the maximum', async () => {
    const dirs = await pluginDirs(join(root, 'plugins'))
    expect(dirs.length, 'no plugins found, so this checked nothing').toBeGreaterThan(0)
    expect(dirs.length).toBeLessThanOrEqual(MAX_RESULTS)
    expect(await new LocalCatalogue().search({ limit: MAX_RESULTS })).toHaveLength(dirs.length)
  })

  it('is what the page asks for, not a smaller number of its own', () => {
    const source = readFileSync(resolve(root, 'web/app/Browser.js'), 'utf8')
    expect(source).toMatch(/text, limit: MAX_RESULTS,/)
    expect(source).not.toMatch(/limit: \d+/)
  })
})
