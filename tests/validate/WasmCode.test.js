// tests/validate/WasmCode.test.js
//
// The memory.grow check, and the decoder under it. The decoder is held to account two ways: small
// hand-built modules for each instruction family whose size is easy to get wrong, and every real
// module in the repository, where a single mis-sized instruction misaligns the rest of a body and
// the decoder refuses it.
import { describe, it, expect } from 'vitest'
import { resolve } from 'node:path'
import { readFileSync, readdirSync, existsSync, statSync, writeFileSync, mkdtempSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { checkMemoryGrow, ABI_EXPORTS } from '../../src/validate/WasmCode.js'

const root = resolve(import.meta.dirname, '../..')

const leb = n => { const out = []; do { let b = n & 0x7f; n >>>= 7; if (n) b |= 0x80; out.push(b) } while (n); return out }
const str = s => [...leb(s.length), ...Array.from(s, c => c.charCodeAt(0))]
const section = (id, content) => [id, ...leb(content.length), ...content]

/**
 * A module of functions with the given bodies (instruction bytes only: the locals vector and the
 * closing end are added), and the given exports as [name, functionIndex].
 */
function build (bodies, exports, { raw = false } = {}) {
  const types = section(1, [1, 0x60, 0, 0])
  const funcs = section(3, [...leb(bodies.length), ...bodies.map(() => 0)])
  const exp = section(7, [...leb(exports.length), ...exports.flatMap(([n, i]) => [...str(n), 0, i])])
  const code = section(10, [...leb(bodies.length), ...bodies.flatMap(b => {
    const body = raw ? b : [0, ...b, 0x0b]
    return [...leb(body.length), ...body]
  })])
  return Uint8Array.from([0, 0x61, 0x73, 0x6d, 1, 0, 0, 0, ...types, ...funcs, ...exp, ...code])
}

/**
 * A module with a table: types 0 (no parameters) and 1 (one i32), jig_process (function 0) calling through the
 * table with `callType`, and function 1 the grower, of type `growerType`. Each element is [form, ...functions].
 */
function tabled ({ elements, callType, growerType = 0, importTable = false }) {
  const types = section(1, [2, 0x60, 0, 0, 0x60, 1, 0x7f, 0])
  const imports = importTable ? section(2, [1, ...str('env'), ...str('t'), 1, 0x70, 0, 1]) : []
  const funcs = section(3, [2, callType, growerType])
  const table = importTable ? [] : section(4, [1, 0x70, 0, 1])
  const exp = section(7, [1, ...str('jig_process'), 0, 0])
  const exprs = i => [1, 0xd2, i, 0x0b]
  const segment = ([form, ...fns]) => {
    const offset = [0x41, 0, 0x0b]
    switch (form) {
      case 0: return [0, ...offset, ...leb(fns.length), ...fns]
      case 1: return [1, 0, ...leb(fns.length), ...fns]
      case 2: return [2, 0, ...offset, 0, ...leb(fns.length), ...fns]
      case 3: return [3, 0, ...leb(fns.length), ...fns]
      case 4: return [4, ...offset, ...exprs(fns[0])]
      case 5: return [5, 0x70, ...exprs(fns[0])]
      case 6: return [6, 0, ...offset, 0x70, ...exprs(fns[0])]
      default: return [7, 0x70, ...exprs(fns[0])]
    }
  }
  const elem = elements.length ? section(9, [elements.length, ...elements.flatMap(segment)]) : []
  const callBody = [0, 0x41, 0, 0x11, callType, 0, 0x0b]
  const growBody = [0, ...GROW, 0x0b]
  const code = section(10, [2, ...leb(callBody.length), ...callBody, ...leb(growBody.length), ...growBody])
  return Uint8Array.from([0, 0x61, 0x73, 0x6d, 1, 0, 0, 0, ...types, ...imports, ...funcs, ...table, ...exp, ...elem, ...code])
}

const GROW = [0x41, 1, 0x40, 0, 0x1a] // i32.const 1, memory.grow 0, drop
const CALL = i => [0x10, i]

describe('checkMemoryGrow, on what the rule is about', () => {
  it('passes a module with no memory.grow', () => {
    const r = checkMemoryGrow(build([[0x01]], [['jig_process', 0]]))
    expect(r).toMatchObject({ ok: true, uncertain: false, growers: [] })
  })

  it('fails a module whose jig_process grows memory', () => {
    const r = checkMemoryGrow(build([GROW], [['jig_process', 0]]))
    expect(r.ok).toBe(false)
    expect(r.growers).toEqual([{ func: 0, exports: ['jig_process'], fromAbi: 'direct', fromPrivateExport: false }])
  })

  it('fails when a helper that grows is called from an ABI export', () => {
    const r = checkMemoryGrow(build([CALL(1), GROW], [['jig_set_param', 0]]))
    expect(r.ok).toBe(false)
    expect(r.growers[0]).toMatchObject({ func: 1, fromAbi: 'direct' })
  })

  it('follows calls more than one deep', () => {
    const r = checkMemoryGrow(build([CALL(1), CALL(2), GROW], [['jig_process', 0]]))
    expect(r.ok).toBe(false)
  })

  it('allows growth reachable only from jig_init, which runs before any view is taken', () => {
    const r = checkMemoryGrow(build([GROW, [0x01]], [['jig_init', 0], ['jig_process', 1]]))
    expect(r.ok).toBe(true)
    expect(r.growers[0].fromAbi).toBe('no')
  })

  it('fails a helper shared by jig_init and jig_process, because jig_process reaches it', () => {
    const r = checkMemoryGrow(build([CALL(2), CALL(2), GROW], [['jig_init', 0], ['jig_process', 1]]))
    expect(r.ok).toBe(false)
  })

  it('reports growth under an export outside the ABI apart from the rule', () => {
    // Ferrite's jig_load_nam: the plugin's own protocol with its own processor.
    const r = checkMemoryGrow(build([GROW, [0x01]], [['jig_load_nam', 0], ['jig_process', 1]]))
    expect(r.ok).toBe(true)
    expect(r.growers[0]).toMatchObject({ fromAbi: 'no', fromPrivateExport: true })
  })

  it('does not reach a function through a table call when no table holds it', () => {
    // call_indirect type 0, table 0, and a function nothing ever puts in a table.
    const r = checkMemoryGrow(build([[0x41, 0, 0x11, 0, 0], GROW], [['jig_process', 0]]))
    expect(r).toMatchObject({ ok: true, uncertain: false })
    expect(r.growers[0].fromAbi).toBe('no')
  })

  it('fails growth that an element segment puts where a matching table call lands', () => {
    const r = checkMemoryGrow(tabled({ elements: [[0, 1]], callType: 0 }))
    expect(r.ok).toBe(false)
    expect(r.uncertain).toBe(false)
    expect(r.growers[0].fromAbi).toBe('table')
  })

  it('does not reach a function in a table whose signature the call does not name', () => {
    // The grower takes an i32 (type 1) and the call names type 0.
    const r = checkMemoryGrow(tabled({ elements: [[0, 1]], callType: 0, growerType: 1 }))
    expect(r).toMatchObject({ ok: true, uncertain: false })
    expect(r.growers[0].fromAbi).toBe('no')
  })

  it('reads the passive and expression forms of element segment, so a function put there is not missed', () => {
    for (const elements of [[[1, 1]], [[2, 1]], [[3, 1]], [[4, 1]], [[5, 1]], [[6, 1]], [[7, 1]]]) {
      const r = checkMemoryGrow(tabled({ elements, callType: 0 }))
      expect(r.growers[0].fromAbi, `form ${elements[0][0]}`).toBe('table')
    }
  })

  it('flags growth as uncertain when the table is imported and so could hold anything', () => {
    const r = checkMemoryGrow(tabled({ elements: [], callType: 0, importTable: true }))
    expect(r.ok).toBe(true)
    expect(r.uncertain).toBe(true)
    expect(r.growers[0].fromAbi).toBe('indirect')
  })

  it('finds a grow after instructions whose immediates contain the byte 0x40', () => {
    // i32.const -64 is 41 40, a load with alignment 0x40 would set the memory-index bit, and a
    // constant 0x40 in an i64.const. None of them is a memory.grow, and the real one after
    // them still must be found, which it is only if every size above was right.
    const body = [0x41, 0x40, 0x1a, 0x42, 0x40, 0x1a, 0x41, 0, 0x28, 0x02, 0x40, 0x1a, ...GROW]
    const r = checkMemoryGrow(build([body], [['jig_process', 0]]))
    expect(r.ok).toBe(false)
    expect(r.growers).toHaveLength(1)
  })

  it('reads the memory index a multi-memory load carries, so its offset is not decoded as an instruction', () => {
    // Alignment 0x40 sets the bit that says a memory index follows: align 0x40, memory 0, offset 0x40.
    // If the index were not read, the offset byte 0x40 would be taken for a memory.grow. (The
    // immediate of atomic.fence is always 0x00, which a decoder that skipped it would read as the
    // harmless unreachable, so nothing can tell that mutation apart and no test pretends to.)
    const r = checkMemoryGrow(build([[0x41, 0, 0x28, 0x40, 0x00, 0x40, 0x1a]], [['jig_process', 0]]))
    expect(r.growers).toEqual([])
  })

  it('does not mistake an immediate 0x40 for a grow', () => {
    const r = checkMemoryGrow(build([[0x41, 0x40, 0x1a, 0x42, 0x40, 0x1a]], [['jig_process', 0]]))
    expect(r.growers).toEqual([])
  })
})

describe('checkMemoryGrow, decoding every instruction family', () => {
  // Each body ends in a real grow. If the family in front of it is sized wrongly the grow is not
  // found, or the body does not end where it should and the decoder throws.
  const families = {
    'block, loop, if and else': [0x41, 0, 0x04, 0x40, 0x03, 0x40, 0x0b, 0x05, 0x01, 0x0b],
    'br_table': [0x41, 0, 0x0e, 2, 0, 0, 0],
    'v128.const and shuffle': [0xfd, 0x0c, ...new Array(16).fill(1), 0x1a],
    'a SIMD lane extract': [0xfd, 0x15, 3, 0x1a],
    'a SIMD load with a memarg': [0x41, 0, 0xfd, 0x00, 0x04, 0x00, 0x1a],
    'a SIMD load lane': [0x41, 0, 0xfd, 0x54, 0x00, 0x00, 1, 0x1a],
    'a SIMD operator with no immediate': [0xfd, 0xae, 0x01, 0x1a],
    'bulk memory copy and fill': [0xfc, 0x0a, 0, 0, 0xfc, 0x0b, 0],
    'saturating truncation': [0x43, 0, 0, 0, 0, 0xfc, 0x00, 0x1a],
    'atomic fence and a wait': [0xfe, 0x03, 0x00, 0x41, 0, 0xfe, 0x01, 0x02, 0x00, 0x1a],
    'f64.const': [0x44, 1, 2, 3, 4, 5, 6, 7, 8, 0x1a],
    'a call with a multi-byte index': [0x10, 0x80, 0x01]
  }
  for (const [name, instructions] of Object.entries(families)) {
    it(`sizes ${name} so the grow after it is still found`, () => {
      const body = name.startsWith('a call') ? [...instructions] : [...instructions, ...GROW]
      // The multi-byte call needs a function 128 to exist, so it is only checked for sizing.
      if (name.startsWith('a call')) {
        expect(() => checkMemoryGrow(build([[...body]], [['jig_process', 0]]))).not.toThrow()
        return
      }
      const r = checkMemoryGrow(build([body], [['jig_process', 0]]))
      expect(r.growers, name).toHaveLength(1)
    })
  }
})

describe('checkMemoryGrow, refusing what it cannot read', () => {
  it('throws on an opcode it does not know, so an unreadable module is never passed', () => {
    expect(() => checkMemoryGrow(build([[0xff]], [['jig_process', 0]]))).toThrow(/unsupported opcode/)
  })

  it('throws on a body that ends without its closing end', () => {
    expect(() => checkMemoryGrow(build([[0, 0x01]], [['jig_process', 0]], { raw: true }))).toThrow(/closing end/)
  })

  it('throws on a body that continues after its final end', () => {
    expect(() => checkMemoryGrow(build([[0, 0x01, 0x0b, 0x01]], [['jig_process', 0]], { raw: true }))).toThrow(/past its final end/)
  })

  it('throws on a truncated instruction and on bad magic', () => {
    expect(() => checkMemoryGrow(build([[0, 0x41]], [['jig_process', 0]], { raw: true }))).toThrow()
    expect(() => checkMemoryGrow(Uint8Array.of(1, 2, 3, 4, 1, 0, 0, 0))).toThrow(/bad magic/)
  })
})

describe('checkMemoryGrow, against every module in the repository', () => {
  const walk = dir => readdirSync(dir).flatMap(name => {
    if (['node_modules', 'target', '.git', '_deps'].includes(name)) return []
    const path = resolve(dir, name)
    return statSync(path).isDirectory() ? walk(path) : name.endsWith('.wasm') ? [path] : []
  })
  const modules = [...walk(resolve(root, 'plugins')), ...walk(resolve(root, 'examples'))].filter(existsSync)

  it('finds modules to check', () => {
    expect(modules.length).toBeGreaterThan(20)
  })

  it('decodes every function of every one to exactly its declared size', () => {
    // Includes Ferrite, which @webassemblyjs/wasm-parser could not read, and the SIMD and bulk-memory
    // modules. A decoder that mis-sizes any instruction throws here.
    const failures = []
    for (const file of modules) {
      try { checkMemoryGrow(readFileSync(file)) } catch (error) { failures.push(`${file}: ${error.message}`) }
    }
    expect(failures).toEqual([])
  })

  it('finds no module growing memory under an ABI export, and reads the table of each module', () => {
    const found = {}
    for (const file of modules) {
      const r = checkMemoryGrow(readFileSync(file))
      expect(r.ok, file).toBe(true)
      if (r.growers.length) found[file.replace(`${root}/`, '')] = r.growers.map(g => `${g.fromAbi}${g.fromPrivateExport ? '+private' : ''}`)
    }
    // Ferrite grows when a model loads. No ABI export reaches it, directly or through a table call
    // (its table was read, not assumed), and its jig_load_nam does, which its processor runs before
    // taking any view. If this changes, the module changed, and ferrite-processor.js and module-abi.md
    // need a look.
    expect(found).toEqual({ 'plugins/ferrite/ferrite.wasm': ['no+private'] })
  })
})

describe('the list of ABI exports', () => {
  it('is the set of jig_ names module-abi.md defines', () => {
    const doc = readFileSync(resolve(root, 'docs/module-abi.md'), 'utf8')
    const named = [...new Set(doc.match(/\bjig_[a-z0-9_]+/g))].sort()
    expect([...ABI_EXPORTS].sort()).toEqual(named)
  })
})

describe('npm run check-wasm-abi', () => {
  const run = file => spawnSync('node', ['bin/check-wasm-abi.js', file], { cwd: root, encoding: 'utf8' })

  it('exits non-zero for a module that grows memory under jig_process, and says where', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'jigdaw-grow-')), 'grows.wasm')
    writeFileSync(file, build([GROW], [['jig_process', 0]]))
    const r = run(file)
    expect(r.status).toBe(1)
    expect(r.stdout).toMatch(/memory\.grow is reachable from an ABI export/)
  })

  it('exits zero for a module that does not, and for one that grows only under its own export', () => {
    expect(run(resolve(root, 'plugins/keyframe/keyframe.wasm')).status).toBe(0)
    const r = run(resolve(root, 'plugins/ferrite/ferrite.wasm'))
    expect(r.status).toBe(0)
    expect(r.stdout).toMatch(/not reachable from an ABI export; reached by a plugin-private export/)
  })
})
