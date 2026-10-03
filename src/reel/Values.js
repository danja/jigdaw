// src/reel/Values.js
//
// Reel's values: numbers that carry a dimension, so `8kHz` cannot be written to a gain and `-6dB` cannot
// be written to a frequency, and the same expressions evaluated two ways. `evaluate` gives a value, with
// a seeded generator, for the runner. `bounds` gives the interval a value can fall in without running
// anything, for the planner, so a script whose `pick` or `rand` could leave a parameter's range is
// refused before the first note and not found out on stage.

export class ReelError extends Error {
  constructor (message, line = null, column = null) {
    super(message)
    this.line = line
    this.column = column
  }
}

// What each literal unit means: its dimension, and its factor to the dimension's base. Time is held in
// milliseconds, frequency in hertz.
const LITERAL = {
  Hz: ['hz', 1], kHz: ['hz', 1000], ms: ['time', 1], s: ['time', 1000],
  dB: ['db', 1], st: ['st', 1], '%': ['pc', 1], cents: ['cent', 1]
}

// What a port's declared unit means, by the local name of the unit's IRI in lower case: its dimension and the
// factor from the base to the port's own number. Any other unit is not one Reel can write a quantity to.
const PORT = {
  hz: ['hz', 1], khz: ['hz', 1 / 1000], ms: ['time', 1], s: ['time', 1 / 1000],
  db: ['db', 1], semitone12tet: ['st', 1], pc: ['pc', 1], cent: ['cent', 1]
}

export const portDimension = unit => {
  if (!unit) return null
  const local = String(unit).split(/[#/]/).pop().toLowerCase()
  return PORT[local] ? { dim: PORT[local][0], factor: PORT[local][1], name: local } : { dim: undefined, factor: 1, name: local }
}

/** A quantity {v, dim}: `dim` null for a plain number. */
const q = (v, dim = null) => ({ v, dim })

function literal (node) {
  if (node.unit === null) return q(node.value)
  const [dim, factor] = LITERAL[node.unit]
  return q(node.value * factor, dim)
}

const need = (condition, message, node) => { if (!condition) throw new ReelError(message, null, node?.column ?? null) }

function combine (op, a, b, node) {
  if (op === '+' || op === '-') {
    need(a.dim === b.dim, `cannot ${op === '+' ? 'add' : 'subtract'} ${a.dim ?? 'a plain number'} and ${b.dim ?? 'a plain number'}`, node)
    return q(op === '+' ? a.v + b.v : a.v - b.v, a.dim)
  }
  if (op === '*') {
    need(a.dim === null || b.dim === null, 'cannot multiply two quantities that both carry a unit', node)
    return q(a.v * b.v, a.dim ?? b.dim)
  }
  need(b.dim === null, 'cannot divide by a quantity that carries a unit', node)
  need(b.v !== 0, 'division by zero', node)
  return q(a.v / b.v, a.dim)
}

// Functions a script may call. Each has its arity and how it treats dimensions.
const FUNCTIONS = {
  pick: { min: 1, max: 64 },
  rand: { min: 2, max: 2 },
  round: { min: 1, max: 1 }
}

export const FUNCTION_NAMES = Object.freeze(Object.keys(FUNCTIONS))

function checkCall (node) {
  const f = FUNCTIONS[node.name]
  need(f, `unknown function "${node.name}"; Reel has ${Object.keys(FUNCTIONS).join(', ')}`, node)
  need(node.args.length >= f.min && node.args.length <= f.max,
    `${node.name} takes ${f.min === f.max ? f.min : `${f.min} to ${f.max}`} argument(s), not ${node.args.length}`, node)
}

/**
 * The value of an expression.
 * @param env a Map of name to quantity, from `let`
 * @param rng a function returning a number in [0, 1)
 * @param budget {left: number}, decremented per node; a script that would run past it throws
 */
export function evaluate (node, env, rng, budget = { left: 2000 }) {
  if (--budget.left < 0) throw new ReelError('this expression is too large to run inside a tick', null, node.column)
  switch (node.type) {
    case 'number': return literal(node)
    case 'variable': {
      need(env.has(node.name), `"${node.name}" is not defined; use let ${node.name} = ... first`, node)
      return env.get(node.name)
    }
    case 'negate': { const a = evaluate(node.operand, env, rng, budget); return q(-a.v, a.dim) }
    case 'binary': return combine(node.op, evaluate(node.left, env, rng, budget), evaluate(node.right, env, rng, budget), node)
    case 'call': {
      checkCall(node)
      const args = node.args.map(a => evaluate(a, env, rng, budget))
      if (node.name === 'pick') return args[Math.min(args.length - 1, Math.floor(rng() * args.length))]
      if (node.name === 'round') return q(Math.round(args[0].v), args[0].dim)
      need(args[0].dim === args[1].dim, 'rand needs both ends in the same unit', node)
      return q(args[0].v + rng() * (args[1].v - args[0].v), args[0].dim)
    }
    default: throw new ReelError(`unknown expression ${node.type}`)
  }
}

/** The interval {lo, hi, dim} a value can fall in, without running anything. */
export function bounds (node, env) {
  const i = (lo, hi, dim) => ({ lo: Math.min(lo, hi), hi: Math.max(lo, hi), dim })
  switch (node.type) {
    case 'number': { const v = literal(node); return i(v.v, v.v, v.dim) }
    case 'variable': {
      need(env.has(node.name), `"${node.name}" is not defined; use let ${node.name} = ... first`, node)
      return env.get(node.name)
    }
    case 'negate': { const a = bounds(node.operand, env); return i(-a.hi, -a.lo, a.dim) }
    case 'binary': {
      const a = bounds(node.left, env)
      const b = bounds(node.right, env)
      const corners = [[a.lo, b.lo], [a.lo, b.hi], [a.hi, b.lo], [a.hi, b.hi]]
      const dim = combine(node.op, q(1, a.dim), q(1, b.dim === null && node.op === '/' ? null : b.dim), node).dim
      if (node.op === '/') need(b.lo > 0 || b.hi < 0, 'division by a value that could be zero', node)
      const all = corners.map(([x, y]) => (node.op === '+' ? x + y : node.op === '-' ? x - y : node.op === '*' ? x * y : x / y))
      return i(Math.min(...all), Math.max(...all), dim)
    }
    case 'call': {
      checkCall(node)
      const args = node.args.map(a => bounds(a, env))
      if (node.name === 'rand') {
        need(args[0].dim === args[1].dim, 'rand needs both ends in the same unit', node)
        return i(args[0].lo, args[1].hi, args[0].dim)
      }
      if (node.name === 'pick') {
        for (const a of args) need(a.dim === args[0].dim, 'pick needs every choice in the same unit', node)
        return i(Math.min(...args.map(a => a.lo)), Math.max(...args.map(a => a.hi)), args[0].dim)
      }
      return i(Math.round(args[0].lo), Math.round(args[0].hi), args[0].dim)
    }
    default: throw new ReelError(`unknown expression ${node.type}`)
  }
}

/** A small deterministic generator (mulberry32), so a performance can be repeated. */
export function makeRng (seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
