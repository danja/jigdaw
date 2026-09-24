// tests/validate/WasmAbi.test.js
import { describe, it, expect } from 'vitest'
import { resolve } from 'node:path'
import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { checkAbiImports, readImports } from '../../src/validate/WasmAbi.js'

const root = resolve(import.meta.dirname, '../..')

/** Build a minimal WebAssembly binary: magic, version, and whichever
 * sections are given, each already including its own id and size bytes. */
function moduleOf (...sections) {
  return concat([[0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00], ...sections])
}

function concat (parts) {
  const arrays = parts.map(p => (p instanceof Uint8Array ? p : Uint8Array.from(p)))
  const out = new Uint8Array(arrays.reduce((n, a) => n + a.length, 0))
  let offset = 0
  for (const a of arrays) { out.set(a, offset); offset += a.length }
  return out
}

const string = s => [s.length, ...Array.from(s, c => c.charCodeAt(0))]

/** An import section declaring one function import, module.name. */
function importSectionOf (moduleName, name) {
  const content = concat([[1], string(moduleName), string(name), [0x00, 0x00]])
  return concat([[0x02], [content.length], content])
}

const emptyImportSection = Uint8Array.of(0x02, 1, 0)
const typeSection = Uint8Array.of(0x01, 4, 1, 0x60, 0x00, 0x00)

describe('readImports', () => {
  it('refuses anything that is not a WebAssembly module', () => {
    expect(() => readImports(Uint8Array.of(1, 2, 3, 4))).toThrow(/bad magic/)
  })

  it('finds no imports in a module with no import section', () => {
    expect(readImports(moduleOf(typeSection))).toEqual([])
  })

  it('finds no imports in a module with an empty import section', () => {
    expect(readImports(moduleOf(emptyImportSection))).toEqual([])
  })

  it('reads a function import, and keeps parsing past it', () => {
    const one = concat([string('env'), string('foo'), [0x00, 0x00]])
    const two = concat([string('env'), string('bar'), [0x00, 0x01]])
    const content = concat([[2], one, two])
    const section = concat([[0x02], [content.length], content])
    expect(readImports(moduleOf(section))).toEqual([
      { module: 'env', name: 'foo' },
      { module: 'env', name: 'bar' }
    ])
  })

  it('skips a table, memory or global import correctly, reaching what follows', () => {
    // table (reftype + limits with a max), memory (limits, no max), global,
    // then a function import: if any of the first three were skipped by the
    // wrong number of bytes, this one would not parse as "func".
    const content = concat([
      [4],
      string('env'), string('t'), [0x01, 0x70, 0x01, 0x00, 0x05],
      string('env'), string('m'), [0x02, 0x00, 0x01],
      string('env'), string('g'), [0x03, 0x7f, 0x00],
      string('env'), string('f'), [0x00, 0x00]
    ])
    const section = concat([[0x02], [content.length], content])
    expect(readImports(moduleOf(section))).toEqual([
      { module: 'env', name: 't' },
      { module: 'env', name: 'm' },
      { module: 'env', name: 'g' },
      { module: 'env', name: 'f' }
    ])
  })
})

describe('checkAbiImports', () => {
  it('passes a module with no imports', () => {
    expect(checkAbiImports(moduleOf(typeSection))).toEqual({ ok: true, imports: [] })
  })

  it('fails a module that imports anything, and names it', () => {
    expect(checkAbiImports(moduleOf(importSectionOf('env', 'abort')))).toEqual({
      ok: false, imports: [{ module: 'env', name: 'abort' }]
    })
  })
})

describe('against the real worked plugins', () => {
  const wasmFiles = [
    'plugins/pulse/pulse.wasm', 'plugins/cascade/cascade.wasm', 'plugins/ferrite/ferrite.wasm',
    'plugins/boost/boost.wasm', 'plugins/dynamix/dynamix.wasm', 'plugins/bassgen/bassgen.wasm',
    'plugins/8b8/8b8.wasm'
  ].filter(f => existsSync(resolve(root, f)))

  if (wasmFiles.length === 0) console.warn('no built .wasm files found; run each plugin\'s build.sh first')

  it.each(wasmFiles)('%s declares jig:Abi1/jig:Abi2 with no imports', async file => {
    const result = checkAbiImports(await readFile(resolve(root, file)))
    expect(result, JSON.stringify(result.imports)).toMatchObject({ ok: true })
  })
})
