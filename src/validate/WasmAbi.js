// src/validate/WasmAbi.js
//
// A static check of a jig:Abi1/jig:Abi2 module's own bytes against the one
// requirement in docs/module-abi.md that a running host can also observe
// going wrong: "Instantiate the module with no imports. A module declaring
// this ABI MUST NOT require any." This reads the WebAssembly binary's own
// import section directly, needing nothing more than the section and
// LEB128 encoding every WebAssembly module uses
// (webassembly.github.io/spec/core/binary), so it is a few dozen lines
// rather than a dependency.
//
// Deliberately not attempted here: whether the module ever executes
// memory.grow, which module-abi.md also forbids after jig_init. Answering
// that needs decoding every instruction in the code section correctly,
// including the newer 0xFC/0xFD-prefixed ones (bulk memory, saturating
// conversions, SIMD). A real, maintained parser (@webassemblyjs/wasm-parser)
// was tried against this project's own plugin .wasm files and failed to
// decode one of them ("Unexpected instruction: 0xfc00"), so a hand-rolled
// decoder here would very likely be wrong in the same way, and a check that
// is wrong there is worse than no check at all (AGENTS.md: "a fake more
// permissive than the real thing turns a specification error into a
// passing test"). Left open in TODO.md.
const MAGIC = Uint8Array.of(0x00, 0x61, 0x73, 0x6d)
const IMPORT_SECTION = 2

class Reader {
  constructor (bytes) {
    this.bytes = bytes
    this.pos = 0
  }

  u8 () {
    if (this.pos >= this.bytes.length) throw new Error('unexpected end of module')
    return this.bytes[this.pos++]
  }

  take (n) {
    const slice = this.bytes.subarray(this.pos, this.pos + n)
    if (slice.length !== n) throw new Error('unexpected end of module')
    this.pos += n
    return slice
  }

  /** Unsigned LEB128, as the binary format uses for every count and length. */
  u32 () {
    let result = 0
    let shift = 0
    for (;;) {
      const byte = this.u8()
      result |= (byte & 0x7f) << shift
      if ((byte & 0x80) === 0) return result >>> 0
      shift += 7
      if (shift >= 35) throw new Error('LEB128 value too long')
    }
  }

  string () {
    return Buffer.from(this.take(this.u32())).toString('utf8')
  }
}

/** A table or memory's limits: a flag byte, a minimum, and a maximum if the
 * flag says there is one. Only skipped, never used. */
function skipLimits (r) {
  const flag = r.u8()
  r.u32()
  if (flag & 1) r.u32()
}

const sameBytes = (a, b) => a.length === b.length && a.every((v, i) => v === b[i])

/**
 * The module's own imports, as `{module, name}` pairs, read from the binary
 * without instantiating it. Empty for a module with none.
 */
export function readImports (bytes) {
  const r = new Reader(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes))
  if (!sameBytes(r.take(4), MAGIC)) throw new Error('not a WebAssembly module (bad magic)')
  r.take(4) // version: every module this project has seen is version 1

  while (r.pos < r.bytes.length) {
    const id = r.u8()
    const size = r.u32()
    const sectionEnd = r.pos + size
    if (id !== IMPORT_SECTION) { r.pos = sectionEnd; continue }

    const count = r.u32()
    const imports = []
    for (let i = 0; i < count; i++) {
      const moduleName = r.string()
      const name = r.string()
      const kind = r.u8()
      if (kind === 0) r.u32() // func: typeidx
      else if (kind === 1) { r.u8(); skipLimits(r) } // table: reftype, limits
      else if (kind === 2) skipLimits(r) // memory: limits
      else if (kind === 3) { r.u8(); r.u8() } // global: valtype, mutability
      else throw new Error(`unknown import kind ${kind} in ${moduleName}.${name}`)
      imports.push({ module: moduleName, name })
    }
    return imports
  }
  return []
}

/**
 * Check a jig:Abi1/jig:Abi2 module against module-abi.md's "MUST NOT
 * require any [imports]".
 *
 * @returns {ok, imports} imports is every import the module declares
 *   ({module, name}), empty when it conforms.
 */
export function checkAbiImports (bytes) {
  const imports = readImports(bytes)
  return { ok: imports.length === 0, imports }
}
