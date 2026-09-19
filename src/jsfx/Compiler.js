// src/jsfx/Compiler.js
//
// Compiles the AST src/jsfx/Parser.js produces into the bytecode format
// plugins/_jsfx-runtime/src/lib.rs's VM executes. The two files must agree
// exactly on opcode numbers, builtin function ids and arities, and the
// section-header layout; OPCODES and BUILTINS below are the one place either
// changes, and tests/jsfx/Compiler.test.js checks the compiled output against
// what the VM actually does with it rather than against the numbers alone.
//
// Every EEL2 variable, across @init/@slider/@block and @sample alike, is
// globally scoped and gets one fixed register for the life of the script
// (allocated here, at compile time, never looked up by name at run time).
// That is real EEL2 semantics, not a simplification: "All are double-
// precision floating point, globally scoped by default." spl0, spl1,
// srate, num_ch, samplesblock and slider1..slider64 are pre-seeded into the
// same table at the fixed registers lib.rs reserves for them, so a script
// referring to spl0 reads and writes the same register the host does.
import { parseSection, ParseError } from './Parser.js'

export { ParseError }

const OPCODES = Object.freeze({
  HALT: 0, PUSH: 1, LOAD: 2, STORE: 3, POP: 4,
  ADD: 5, SUB: 6, MUL: 7, DIV: 8, MOD: 9, POW: 10, NEG: 11, NOT: 12,
  EQ: 13, NE: 14, LT: 15, GT: 16, LE: 17, GE: 18,
  JUMP: 19, JUMPZ: 20, JUMPNZ: 21, CALL: 22, LOADMEM: 23, STOREMEM: 24, TRUNC: 25
})

const BINARY_OP = Object.freeze({
  '+': OPCODES.ADD, '-': OPCODES.SUB, '*': OPCODES.MUL, '/': OPCODES.DIV,
  '%': OPCODES.MOD, '^': OPCODES.POW,
  '==': OPCODES.EQ, '!=': OPCODES.NE, '<': OPCODES.LT, '>': OPCODES.GT,
  '<=': OPCODES.LE, '>=': OPCODES.GE
})

// Name, arity, opcode id. Arity is enforced at compile time: a mismatch here
// is a script this VM refuses to compile rather than a wrong answer at run
// time. rand() is the one exception, taking 0 or 1 arguments; a missing one
// compiles as though `1` were written, REAPER's own default maximum.
const BUILTINS = Object.freeze({
  sin: [0, 1], cos: [1, 1], tan: [2, 1], asin: [3, 1], acos: [4, 1], atan: [5, 1],
  atan2: [6, 2], exp: [7, 1], pow: [8, 2], log: [9, 1], log10: [10, 1],
  sqrt: [11, 1], sqr: [12, 1], abs: [13, 1], min: [14, 2], max: [15, 2],
  sign: [16, 1], floor: [17, 1], ceil: [18, 1], invsqrt: [19, 1], rand: [20, 1]
})

export const REG_SLIDER_BASE = 0
export const REG_SPL_BASE = 64
export const REG_SRATE = 66
export const REG_NUM_CH = 67
export const REG_SAMPLESBLOCK = 68
export const REG_USER_BASE = 69
const MAX_REGISTERS = 256

class CompileError extends Error {}

class Emitter {
  constructor () { this.bytes = [] }
  u8 (v) { this.bytes.push(v & 0xff) }
  u16 (v) { this.bytes.push(v & 0xff, (v >> 8) & 0xff) }
  u32 (v) { this.bytes.push(v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >> 24) & 0xff) }
  f64 (v) {
    const buf = new ArrayBuffer(8)
    new Float64Array(buf)[0] = v
    this.bytes.push(...new Uint8Array(buf))
  }
  here () { return this.bytes.length }
  /** Emit an opcode with a placeholder 4-byte jump target; returns the
   * offset of the placeholder, to hand to patch() once the target is known. */
  jumpPlaceholder (opcode) {
    this.u8(opcode)
    const at = this.here()
    this.u32(0)
    return at
  }
  patch (at, target) {
    this.bytes[at] = target & 0xff
    this.bytes[at + 1] = (target >> 8) & 0xff
    this.bytes[at + 2] = (target >> 16) & 0xff
    this.bytes[at + 3] = (target >> 24) & 0xff
  }
}

/** The shared symbol table across every section of one script. */
function makeScope (sliderAliases = {}) {
  const registers = new Map()
  registers.set('srate', REG_SRATE)
  registers.set('num_ch', REG_NUM_CH)
  registers.set('samplesblock', REG_SAMPLESBLOCK)
  registers.set('spl0', REG_SPL_BASE)
  registers.set('spl1', REG_SPL_BASE + 1)
  for (let i = 1; i <= 64; i++) registers.set(`slider${i}`, REG_SLIDER_BASE + (i - 1))
  // slider1:gain=5<0,10,1>Label lets a script say `gain` instead of `slider1`.
  for (const [alias, sliderNumber] of Object.entries(sliderAliases)) {
    registers.set(alias, REG_SLIDER_BASE + (sliderNumber - 1))
  }

  let next = REG_USER_BASE
  return {
    resolve (name) {
      if (registers.has(name)) return registers.get(name)
      if (next >= MAX_REGISTERS) {
        throw new CompileError(`too many distinct variables (over ${MAX_REGISTERS - REG_USER_BASE})`)
      }
      const idx = next++
      registers.set(name, idx)
      return idx
    },
    allocHidden () {
      if (next >= MAX_REGISTERS) throw new CompileError('out of registers')
      return next++
    }
  }
}

/** Compile one expression node, leaving exactly one value on the stack. */
function compileExpr (node, e, scope) {
  switch (node.type) {
    case 'num':
      e.u8(OPCODES.PUSH); e.f64(node.value)
      return

    case 'var':
      e.u8(OPCODES.LOAD); e.u16(scope.resolve(node.name))
      return

    case 'index':
      compileMemAddress(node, e, scope)
      e.u8(OPCODES.LOADMEM)
      return

    case 'unary':
      compileExpr(node.operand, e, scope)
      e.u8(node.op === '-' ? OPCODES.NEG : OPCODES.NOT)
      return

    case 'binary':
      if (node.op === '&&') { compileAnd(node, e, scope); return }
      if (node.op === '||') { compileOr(node, e, scope); return }
      compileExpr(node.left, e, scope)
      compileExpr(node.right, e, scope)
      e.u8(BINARY_OP[node.op])
      return

    case 'ternary': {
      compileExpr(node.cond, e, scope)
      const toElse = e.jumpPlaceholder(OPCODES.JUMPZ)
      compileExpr(node.then, e, scope)
      const toEnd = e.jumpPlaceholder(OPCODES.JUMP)
      e.patch(toElse, e.here())
      compileExpr(node.else, e, scope)
      e.patch(toEnd, e.here())
      return
    }

    case 'assign':
      compileAssign(node, e, scope)
      return

    case 'call':
      compileCall(node, e, scope)
      return

    case 'seq':
      compileSeqAsValue(node, e, scope)
      return

    default:
      throw new CompileError(`cannot compile node of type ${node.type}`)
  }
}

/** Push mem[]'s combined index (the base variable plus the bracket
 * expression) without the final LOADMEM/STOREMEM, shared by a read and the
 * assignment target of a write. */
function compileMemAddress (node, e, scope) {
  compileExpr(node.object, e, scope)
  compileExpr(node.index, e, scope)
  e.u8(OPCODES.ADD)
}

function compileAnd (node, e, scope) {
  compileExpr(node.left, e, scope)
  const toFalse1 = e.jumpPlaceholder(OPCODES.JUMPZ)
  compileExpr(node.right, e, scope)
  const toFalse2 = e.jumpPlaceholder(OPCODES.JUMPZ)
  e.u8(OPCODES.PUSH); e.f64(1)
  const toEnd = e.jumpPlaceholder(OPCODES.JUMP)
  const falseAt = e.here()
  e.patch(toFalse1, falseAt); e.patch(toFalse2, falseAt)
  e.u8(OPCODES.PUSH); e.f64(0)
  e.patch(toEnd, e.here())
}

function compileOr (node, e, scope) {
  compileExpr(node.left, e, scope)
  const toTrue = e.jumpPlaceholder(OPCODES.JUMPNZ)
  compileExpr(node.right, e, scope)
  const toFalse = e.jumpPlaceholder(OPCODES.JUMPZ)
  const trueAt = e.here()
  e.patch(toTrue, trueAt)
  e.u8(OPCODES.PUSH); e.f64(1)
  const toEnd = e.jumpPlaceholder(OPCODES.JUMP)
  e.patch(toFalse, e.here())
  e.u8(OPCODES.PUSH); e.f64(0)
  e.patch(toEnd, e.here())
}

function compileAssign (node, e, scope) {
  const isCompound = node.op !== '='
  if (node.target.type === 'var') {
    const idx = scope.resolve(node.target.name)
    if (isCompound) {
      e.u8(OPCODES.LOAD); e.u16(idx)
      compileExpr(node.value, e, scope)
      e.u8(BINARY_OP[node.op.slice(0, -1)])
    } else {
      compileExpr(node.value, e, scope)
    }
    e.u8(OPCODES.STORE); e.u16(idx)
    return
  }

  // target.type === 'index': mem[addr] = value, or mem[addr] op= value.
  // STOREMEM pops the index first, so the compiled order is value then
  // index, the reverse of how they read left to right.
  if (isCompound) {
    compileMemAddress(node.target, e, scope)
    e.u8(OPCODES.LOADMEM)
    compileExpr(node.value, e, scope)
    e.u8(BINARY_OP[node.op.slice(0, -1)])
    // Stack is now [newValue]; STOREMEM also needs the index, so the
    // address is recomputed rather than kept, which is correct even when
    // the address expression itself has no side effects to worry about
    // repeating (this restricted subset has none).
    compileMemAddress(node.target, e, scope)
    e.u8(OPCODES.STOREMEM)
    return
  }
  compileExpr(node.value, e, scope)
  compileMemAddress(node.target, e, scope)
  e.u8(OPCODES.STOREMEM)
}

function compileCall (node, e, scope) {
  if (node.name === 'while') return compileWhile(node, e, scope)
  if (node.name === 'loop') return compileLoop(node, e, scope)

  const spec = BUILTINS[node.name]
  if (!spec) throw new CompileError(`unknown function: ${node.name}`)
  const [id, arity] = spec
  const args = [...node.args]
  if (node.name === 'rand' && args.length === 0) args.push({ type: 'num', value: 1 })
  if (args.length !== arity) {
    throw new CompileError(`${node.name}() takes ${arity} argument(s), got ${args.length}`)
  }
  for (const arg of args) compileExpr(arg, e, scope)
  e.u8(OPCODES.CALL); e.u8(id)
}

function compileWhile (node, e, scope) {
  if (node.args.length !== 1) throw new CompileError('while() takes exactly one argument in this subset')
  const start = e.here()
  compileExpr(node.args[0], e, scope)
  const toEnd = e.jumpPlaceholder(OPCODES.JUMPZ)
  e.u8(OPCODES.JUMP); e.u32(start)
  e.patch(toEnd, e.here())
  e.u8(OPCODES.PUSH); e.f64(0) // while, as a whole, is a statement with no useful value
}

function compileLoop (node, e, scope) {
  if (node.args.length !== 2) throw new CompileError('loop() takes exactly two arguments: count, body')
  const counter = scope.allocHidden()
  compileExpr(node.args[0], e, scope)
  e.u8(OPCODES.TRUNC)
  e.u8(OPCODES.STORE); e.u16(counter)
  e.u8(OPCODES.POP)

  const start = e.here()
  e.u8(OPCODES.LOAD); e.u16(counter)
  e.u8(OPCODES.PUSH); e.f64(0)
  e.u8(OPCODES.GT)
  const toEnd = e.jumpPlaceholder(OPCODES.JUMPZ)

  compileExpr(node.args[1], e, scope)
  e.u8(OPCODES.POP)
  e.u8(OPCODES.LOAD); e.u16(counter)
  e.u8(OPCODES.PUSH); e.f64(1)
  e.u8(OPCODES.SUB)
  e.u8(OPCODES.STORE); e.u16(counter)
  e.u8(OPCODES.POP)
  e.u8(OPCODES.JUMP); e.u32(start)

  e.patch(toEnd, e.here())
  e.u8(OPCODES.PUSH); e.f64(0)
}

/** A `seq` used where its value matters: a ternary branch, a while/loop
 * body, or any other nested block. All but the last statement's value is
 * discarded; the last is left on the stack. */
function compileSeqAsValue (node, e, scope) {
  if (node.statements.length === 0) { e.u8(OPCODES.PUSH); e.f64(0); return }
  node.statements.forEach((stmt, i) => {
    compileExpr(stmt, e, scope)
    if (i < node.statements.length - 1) e.u8(OPCODES.POP)
  })
}

/** Compile one section's source to its own bytecode buffer, discarding
 * whatever value the section as a whole would leave: nothing reads it. */
function compileSection (source, scope) {
  const ast = parseSection(source)
  const e = new Emitter()
  compileSeqAsValue(ast, e, scope)
  e.u8(OPCODES.POP)
  return new Uint8Array(e.bytes)
}

/**
 * Compile a whole JSFX script's four sections into the format
 * jig_load_script reads: an 8xu32 little-endian header (offset, length for
 * init, slider, block, sample in that order) followed by the concatenated
 * bytecode. Every variable is resolved against one shared scope across all
 * four, matching EEL2's global scoping.
 */
export function compileScript ({ init = '', slider = '', block = '', sample = '' }, { sliderAliases = {} } = {}) {
  const scope = makeScope(sliderAliases)
  const sections = [
    compileSection(init, scope),
    compileSection(slider, scope),
    compileSection(block, scope),
    compileSection(sample, scope)
  ]

  const header = new ArrayBuffer(32)
  const view = new DataView(header)
  let offset = 32
  sections.forEach((bytes, i) => {
    view.setUint32(i * 8, offset, true)
    view.setUint32(i * 8 + 4, bytes.length, true)
    offset += bytes.length
  })

  const out = new Uint8Array(offset)
  out.set(new Uint8Array(header), 0)
  let at = 32
  for (const bytes of sections) { out.set(bytes, at); at += bytes.length }
  return out
}

export { OPCODES, BUILTINS, CompileError }
