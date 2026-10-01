// src/validate/WasmCode.js
//
// Whether a module can execute memory.grow once jig_init has returned, which
// docs/module-abi.md forbids: growing memory detaches every view a host holds
// on it, and the symptom in a browser is silence rather than an exception.
//
// This decodes every instruction of every function body, because the question
// cannot be answered by searching the bytes for 0x40: that byte is also an
// immediate, a LEB128 continuation, and part of a constant. A decoder is wrong
// the way a hand-written one usually is, by sizing one instruction badly, so it
// is built to find out: a function body must end exactly where its declared size
// says, on its own closing `end`, and a single mis-sized instruction breaks that
// for the rest of the body. tests/validate/WasmCode.test.js decodes every
// module in the repository against it, including the ones using SIMD, bulk
// memory and atomics, which is where @webassemblyjs/wasm-parser failed. An
// opcode this does not know throws, so a module it cannot read is never passed.
//
// Reachability is a safe over-estimate. A function is reachable from an export
// by direct calls, and a second, looser answer treats a call_indirect or a
// ref.func as reaching every function, because the table is not resolved. A
// grow reachable only on the loose answer is reported as such: possible, not
// certain. A missed grow is not possible.

const MAGIC = [0x00, 0x61, 0x73, 0x6d]
const SECTION = { import: 2, export: 7, code: 10 }

// The exports module-abi.md defines. tests/validate/WasmCode.test.js binds this list to the
// document, so a name added to one and not the other fails there.
export const ABI_EXPORTS = Object.freeze([
  'jig_all_notes_off', 'jig_init', 'jig_input_ptr', 'jig_latency_frames', 'jig_max_frames', 'jig_midi_in',
  'jig_midi_in_capacity', 'jig_midi_in_ptr', 'jig_midi_out_capacity', 'jig_midi_out_count', 'jig_midi_out_ptr',
  'jig_note_off', 'jig_note_on', 'jig_output_ptr', 'jig_process', 'jig_set_param', 'jig_transport_ptr'
])

// A host calls this once, before any view is taken (the calling sequence), so growing under it is allowed.
const INIT_EXPORT = 'jig_init'

class Reader {
  constructor (bytes, pos = 0, end = bytes.length) {
    this.bytes = bytes
    this.pos = pos
    this.end = end
  }

  u8 () {
    if (this.pos >= this.end) throw new Error('unexpected end of module')
    return this.bytes[this.pos++]
  }

  skip (n) {
    if (this.pos + n > this.end) throw new Error('unexpected end of module')
    this.pos += n
  }

  /** LEB128, unsigned or signed; only its length matters to a decoder that skips constants. */
  leb (max = 5) {
    let result = 0
    for (let i = 0; i < max; i++) {
      const byte = this.u8()
      result += (byte & 0x7f) * 2 ** (7 * i)
      if ((byte & 0x80) === 0) return result
    }
    throw new Error('LEB128 value too long')
  }

  string () {
    const n = this.leb()
    const start = this.pos
    this.skip(n)
    return Buffer.from(this.bytes.subarray(start, start + n)).toString('utf8')
  }
}

/** A memory argument: alignment, an optional memory index (multi-memory) and an offset. */
function memarg (r) {
  const align = r.leb()
  if (align & 0x40) r.leb()
  r.leb(10)
}

/**
 * One instruction's immediates, consumed. Returns what the instruction does to the
 * analysis: {grow}, {call}, {indirect}, {ref}, or nothing.
 */
function immediates (r, op) {
  if (op >= 0x45 && op <= 0xc4) return null // numeric, no immediates
  switch (op) {
    case 0x00: case 0x01: case 0x05: case 0x0b: case 0x0f: case 0x19: case 0x1a: case 0x1b: case 0xd1:
      return null
    case 0x02: case 0x03: case 0x04: case 0x06: r.leb(10); return null // blocktype is a signed LEB
    case 0x07: case 0x08: case 0x09: case 0x0c: case 0x0d: case 0x18: r.leb(); return null
    case 0x0e: { const n = r.leb(); for (let i = 0; i <= n; i++) r.leb(); return null }
    case 0x10: case 0x12: return { call: r.leb() }
    case 0x11: case 0x13: r.leb(); r.leb(); return { indirect: true }
    case 0x1c: { const n = r.leb(); for (let i = 0; i < n; i++) r.u8(); return null }
    case 0x20: case 0x21: case 0x22: case 0x23: case 0x24: case 0x25: case 0x26: r.leb(); return null
    case 0x3f: r.leb(); return null
    case 0x40: r.leb(); return { grow: true }
    case 0x41: r.leb(5); return null
    case 0x42: r.leb(10); return null
    case 0x43: r.skip(4); return null
    case 0x44: r.skip(8); return null
    case 0xd0: r.u8(); return null
    case 0xd2: r.leb(); return { ref: true }
    case 0xfc: return prefixed(r, 0xfc)
    case 0xfd: return prefixed(r, 0xfd)
    case 0xfe: return prefixed(r, 0xfe)
    default:
      if (op >= 0x28 && op <= 0x3e) { memarg(r); return null }
      throw new Error(`unsupported opcode 0x${op.toString(16)}`)
  }
}

function prefixed (r, prefix) {
  const sub = r.leb()
  if (prefix === 0xfc) {
    if (sub <= 7) return null // saturating truncation
    switch (sub) {
      case 8: r.leb(); r.leb(); return null // memory.init
      case 9: case 13: case 15: case 16: case 17: r.leb(); return null // data.drop, elem.drop, table.grow/size/fill
      case 10: r.leb(); r.leb(); return null // memory.copy
      case 11: r.leb(); return null // memory.fill
      case 12: case 14: r.leb(); r.leb(); return null // table.init, table.copy
      default: throw new Error(`unsupported opcode 0xfc 0x${sub.toString(16)}`)
    }
  }
  if (prefix === 0xfd) {
    if (sub <= 0x0b) { memarg(r); return null } // v128 loads and store
    if (sub === 0x0c || sub === 0x0d) { r.skip(16); return null } // v128.const, i8x16.shuffle
    if (sub >= 0x15 && sub <= 0x22) { r.u8(); return null } // extract and replace lane
    if (sub >= 0x54 && sub <= 0x5b) { memarg(r); r.u8(); return null } // load and store lane
    if (sub === 0x5c || sub === 0x5d) { memarg(r); return null } // load zero
    if (sub <= 0x113) return null
    throw new Error(`unsupported opcode 0xfd 0x${sub.toString(16)}`)
  }
  // 0xfe, the threads proposal.
  if (sub === 0x03) { r.u8(); return null } // atomic.fence
  if (sub <= 0x02 || (sub >= 0x10 && sub <= 0x4e)) { memarg(r); return null }
  throw new Error(`unsupported opcode 0xfe 0x${sub.toString(16)}`)
}

/** Decode one function body, returning what it calls and whether it grows memory. */
function scanBody (bytes, start, end, funcIndex) {
  const r = new Reader(bytes, start, end)
  const localGroups = r.leb()
  for (let i = 0; i < localGroups; i++) { r.leb(); r.u8() }
  const calls = new Set()
  const summary = { grows: false, indirect: false, refs: false, calls }
  let depth = 1
  while (r.pos < end) {
    const op = r.u8()
    if (op === 0x02 || op === 0x03 || op === 0x04 || op === 0x06) depth++
    if (op === 0x0b) {
      depth--
      if (depth === 0) {
        if (r.pos !== end) throw new Error(`function ${funcIndex}: body continues ${end - r.pos} byte(s) past its final end`)
        return summary
      }
    }
    const effect = immediates(r, op)
    if (!effect) continue
    if (effect.grow) summary.grows = true
    if (effect.indirect) summary.indirect = true
    if (effect.ref) summary.refs = true
    if (effect.call !== undefined) calls.add(effect.call)
  }
  throw new Error(`function ${funcIndex}: body ends without its closing end`)
}

/**
 * Read a module and say whether memory.grow can run after jig_init.
 *
 * @returns {{ok: boolean, uncertain: boolean, growers: object[], functions: number, bodies: number}}
 *   `ok` is false when a function containing memory.grow is reached by direct calls from an export
 *   the ABI defines, other than jig_init. `uncertain` is true when one is reachable only if a table
 *   call lands on it. `growers` lists every function containing one: its index, its export names,
 *   whether an ABI export reaches it ('direct', 'indirect' or 'no'), and whether an export outside
 *   the ABI does.
 */
export function checkMemoryGrow (bytes) {
  const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  const r = new Reader(data)
  for (const b of MAGIC) if (r.u8() !== b) throw new Error('not a WebAssembly module (bad magic)')
  r.skip(4)

  let importedFunctions = 0
  const exportsByFunction = new Map()
  let bodies = []
  while (r.pos < data.length) {
    const id = r.u8()
    const size = r.leb()
    const sectionEnd = r.pos + size
    if (sectionEnd > data.length) throw new Error('section runs past the end of the module')
    if (id === SECTION.import) {
      const count = r.leb()
      for (let i = 0; i < count; i++) {
        r.string(); r.string()
        const kind = r.u8()
        if (kind === 0) { r.leb(); importedFunctions++ }
        else if (kind === 1) { r.u8(); const flag = r.u8(); r.leb(); if (flag & 1) r.leb() }
        else if (kind === 2) { const flag = r.u8(); r.leb(); if (flag & 1) r.leb() }
        else if (kind === 3) { r.u8(); r.u8() }
        else if (kind === 4) { r.u8(); r.leb() }
        else throw new Error(`unknown import kind ${kind}`)
      }
    } else if (id === SECTION.export) {
      const count = r.leb()
      for (let i = 0; i < count; i++) {
        const name = r.string()
        const kind = r.u8()
        const index = r.leb()
        if (kind === 0) {
          if (!exportsByFunction.has(index)) exportsByFunction.set(index, [])
          exportsByFunction.get(index).push(name)
        }
      }
    } else if (id === SECTION.code) {
      const count = r.leb()
      for (let i = 0; i < count; i++) {
        const bodySize = r.leb()
        bodies.push({ start: r.pos, end: r.pos + bodySize })
        r.skip(bodySize)
      }
    }
    r.pos = sectionEnd
  }

  const summaries = bodies.map((b, i) => scanBody(data, b.start, b.end, importedFunctions + i))
  const functions = importedFunctions + bodies.length
  const at = index => summaries[index - importedFunctions]

  // The rule is about what a host calls. An export outside the ABI is the plugin's own protocol with
  // its own processor (Ferrite's jig_load_nam, which its processor runs before it takes any view),
  // so it is reported apart and does not fail the check.
  const rootsOf = isRoot => {
    const roots = []
    for (const [index, names] of exportsByFunction) if (names.some(isRoot)) roots.push(index)
    return roots
  }
  const abiRoots = rootsOf(n => ABI_EXPORTS.includes(n) && n !== INIT_EXPORT)
  const privateRoots = rootsOf(n => !ABI_EXPORTS.includes(n))

  // Reachability by direct calls, which is exact where no table is used, and again with every
  // indirect call or function reference assumed to reach every function.
  const reach = (roots, loose) => {
    const reached = new Set()
    const stack = [...roots]
    while (stack.length) {
      const f = stack.pop()
      if (reached.has(f)) continue
      reached.add(f)
      const s = at(f)
      if (!s) continue // an import
      if (loose && (s.indirect || s.refs)) for (let i = importedFunctions; i < functions; i++) stack.push(i)
      for (const callee of s.calls) stack.push(callee)
    }
    return reached
  }
  const abiDirect = reach(abiRoots, false)
  const abiLoose = reach(abiRoots, true)
  const privateDirect = reach(privateRoots, false)

  const growers = []
  summaries.forEach((s, i) => {
    if (!s.grows) return
    const func = importedFunctions + i
    growers.push({
      func,
      exports: exportsByFunction.get(func) ?? [],
      // 'direct' is certain; 'indirect' only because a table call could land here.
      fromAbi: abiDirect.has(func) ? 'direct' : abiLoose.has(func) ? 'indirect' : 'no',
      fromPrivateExport: privateDirect.has(func)
    })
  })
  const ok = growers.every(g => g.fromAbi !== 'direct')
  const uncertain = growers.some(g => g.fromAbi === 'indirect')
  return { ok, uncertain, growers, functions, bodies: bodies.length }
}
