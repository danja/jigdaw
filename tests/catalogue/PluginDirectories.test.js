// tests/catalogue/PluginDirectories.test.js
import { describe, it, expect } from 'vitest'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pluginDirs } from '../../src/catalogue/PluginDirectories.js'

describe('pluginDirs', () => {
  it('lists a directory that has a profile.ttl', async () => {
    const root = await mkdtemp(join(tmpdir(), 'jigdaw-plugindirs-'))
    await mkdir(join(root, 'cascade'))
    await writeFile(join(root, 'cascade', 'profile.ttl'), '# not parsed here')
    expect(await pluginDirs(root)).toEqual(['cascade'])
  })

  it('skips a directory with no profile.ttl, such as a shared runtime source', async () => {
    const root = await mkdtemp(join(tmpdir(), 'jigdaw-plugindirs-'))
    await mkdir(join(root, 'cascade'))
    await writeFile(join(root, 'cascade', 'profile.ttl'), '')
    await mkdir(join(root, '_jsfx-runtime'))
    await writeFile(join(root, '_jsfx-runtime', 'jsfx-runtime.wasm'), '')
    expect(await pluginDirs(root)).toEqual(['cascade'])
  })

  it('skips a file sitting next to the plugin directories', async () => {
    const root = await mkdtemp(join(tmpdir(), 'jigdaw-plugindirs-'))
    await mkdir(join(root, 'cascade'))
    await writeFile(join(root, 'cascade', 'profile.ttl'), '')
    await writeFile(join(root, 'index.json'), '{}')
    expect(await pluginDirs(root)).toEqual(['cascade'])
  })

  it('sorts the result', async () => {
    const root = await mkdtemp(join(tmpdir(), 'jigdaw-plugindirs-'))
    for (const name of ['pulse', 'bassgen', 'cascade']) {
      await mkdir(join(root, name))
      await writeFile(join(root, name, 'profile.ttl'), '')
    }
    expect(await pluginDirs(root)).toEqual(['bassgen', 'cascade', 'pulse'])
  })

  it('agrees with the real plugins/ directory about what is a plugin', async () => {
    const { resolve } = await import('node:path')
    const root = resolve(import.meta.dirname, '../../plugins')
    const found = await pluginDirs(root)
    expect(found).toContain('cascade')
    expect(found).toContain('dynamix')
    expect(found, 'the shared JSFX runtime is not itself a plugin').not.toContain('_jsfx-runtime')
  })
})
