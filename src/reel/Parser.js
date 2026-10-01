// src/reel/Parser.js
//
// Reel's grammar, one statement per line (docs/livecoding.md). A parse error names its line and
// column and stops that line only, so one mistake does not hide the next: the planner refuses a
// script with any error, and a person fixing it sees them all at once.
//
// A comment is `#` at the start of a line or after whitespace, never inside a word, because an IRI
// carries a fragment (`.../cascade/#x`).

export const MAX_EXPRESSION_DEPTH = 32

const UNITS = ['kHz', 'Hz', 'ms', 's', 'dB', 'st', '%', 'cents']

/** One source line with its comment removed. */
function stripComment (text) {
  const match = /(^|\s)#/.exec(text)
  return (match ? text.slice(0, match.index) : text).replace(/\s+$/, '')
}

class LineError extends Error {
  constructor (message, column) {
    super(message)
    this.column = column
  }
}

class Tokens {
  constructor (text) {
    this.text = text
    this.pos = 0
  }

  skipSpace () { while (this.pos < this.text.length && /\s/.test(this.text[this.pos])) this.pos++ }

  atEnd () { this.skipSpace(); return this.pos >= this.text.length }

  peek (s) { this.skipSpace(); return this.text.startsWith(s, this.pos) }

  /** A punctuation token, such as `=`, `->`, `(`. */
  eat (s) {
    if (!this.peek(s)) return false
    this.pos += s.length
    return true
  }

  expect (s, what = `"${s}"`) {
    if (!this.eat(s)) throw new LineError(`expected ${what}`, this.pos + 1)
  }

  ident () {
    this.skipSpace()
    const m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(this.text.slice(this.pos))
    if (!m) return null
    this.pos += m[0].length
    return m[0]
  }

  /** A keyword, only when it is a whole word. */
  keyword (word) {
    this.skipSpace()
    const m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(this.text.slice(this.pos))
    if (m && m[0] === word) { this.pos += word.length; return true }
    return false
  }

  rest () {
    this.skipSpace()
    const r = this.text.slice(this.pos)
    this.pos = this.text.length
    return r.trim()
  }
}

/** A number with an optional unit suffix, or null. `8kHz`, `-6dB`, `35%`, `0.5`. */
function number (t) {
  t.skipSpace()
  const m = /^\d+(\.\d+)?|^\.\d+/.exec(t.text.slice(t.pos))
  if (!m) return null
  t.pos += m[0].length
  let unit = null
  for (const u of UNITS) {
    if (t.text.startsWith(u, t.pos) && !/[A-Za-z0-9_]/.test(t.text[t.pos + u.length] ?? '')) { unit = u; t.pos += u.length; break }
  }
  return { type: 'number', value: Number(m[0]), unit }
}

function expression (t, depth = 0) {
  if (depth > MAX_EXPRESSION_DEPTH) throw new LineError('expression nested too deeply', t.pos + 1)
  let left = term(t, depth)
  for (;;) {
    t.skipSpace()
    const c = t.text[t.pos]
    // `->` is the arrow of ramp and connect, not a minus.
    if ((c === '+' || (c === '-' && t.text[t.pos + 1] !== '>'))) {
      t.pos++
      left = { type: 'binary', op: c, left, right: term(t, depth) }
    } else return left
  }
}

function term (t, depth) {
  let left = factor(t, depth)
  for (;;) {
    t.skipSpace()
    const c = t.text[t.pos]
    if (c === '*' || c === '/') {
      t.pos++
      left = { type: 'binary', op: c, left, right: factor(t, depth) }
    } else return left
  }
}

function factor (t, depth) {
  t.skipSpace()
  const column = t.pos + 1
  if (t.eat('(')) {
    const e = expression(t, depth + 1)
    t.expect(')')
    return e
  }
  if (t.peek('-') && !t.peek('->')) {
    t.pos++
    return { type: 'negate', operand: factor(t, depth + 1) }
  }
  const n = number(t)
  if (n) return n
  const name = t.ident()
  if (!name) throw new LineError('expected a number, a name or a call', column)
  if (t.eat('(')) {
    const args = []
    if (!t.eat(')')) {
      do { args.push(expression(t, depth + 1)) } while (t.eat(','))
      t.expect(')')
    }
    return { type: 'call', name, args, column }
  }
  return { type: 'variable', name, column }
}

/** `name.symbol`, the way a parameter is addressed. */
function target (t) {
  const column = t.pos + 1
  const name = t.ident()
  if (!name) throw new LineError('expected a plugin name', column)
  t.expect('.', '"." and a parameter symbol')
  const symbol = t.ident()
  if (!symbol) throw new LineError(`expected a parameter symbol after "${name}."`, t.pos + 1)
  return { name, symbol, column }
}

/** `BAR:BEAT`, one based, the beat possibly fractional. */
function position (t) {
  t.skipSpace()
  const m = /^(\d+):(\d+(?:\.\d+)?)/.exec(t.text.slice(t.pos))
  if (!m) throw new LineError('expected a position such as 4:1 (bar, then beat)', t.pos + 1)
  t.pos += m[0].length
  const bar = Number(m[1])
  const beat = Number(m[2])
  if (bar < 1 || beat < 1) throw new LineError('bars and beats count from 1', t.pos - m[0].length + 1)
  return { bar, beat }
}

/** `N bars`, `N beats`, or `1 bar`. */
function duration (t) {
  const n = number(t)
  if (!n || n.unit) throw new LineError('expected a length such as 2 bars', t.pos + 1)
  const unit = t.ident()
  if (!['bar', 'bars', 'beat', 'beats'].includes(unit)) throw new LineError('expected "bars" or "beats" after the length', t.pos + 1)
  if (n.value <= 0) throw new LineError('a length must be more than zero', t.pos + 1)
  return { n: n.value, unit: unit.startsWith('bar') ? 'bars' : 'beats' }
}

function action (t) {
  const column = t.pos + 1
  if (t.keyword('ramp')) {
    const tgt = target(t)
    const from = expression(t)
    t.expect('->')
    const to = expression(t)
    if (!t.keyword('over')) throw new LineError('expected "over" and a length', t.pos + 1)
    return { type: 'ramp', target: tgt, from, to, length: duration(t), column }
  }
  const tgt = target(t)
  t.expect('=')
  return { type: 'set', target: tgt, expr: expression(t), column }
}

function statement (text) {
  const t = new Tokens(text)
  const column = t.pos + 1
  let s
  if (t.keyword('load')) {
    const name = t.ident()
    if (!name) throw new LineError('expected a name for the plugin', t.pos + 1)
    t.expect('=')
    const iri = t.rest()
    if (!/^https?:\/\/\S+$/.test(iri)) throw new LineError('expected an http or https address, written out in full', t.pos - iri.length + 1)
    return { type: 'load', name, iri, column }
  }
  if (t.keyword('let')) {
    const name = t.ident()
    if (!name) throw new LineError('expected a name', t.pos + 1)
    t.expect('=')
    s = { type: 'let', name, expr: expression(t), column }
  } else if (t.keyword('seed')) {
    const n = number(t)
    if (!n || n.unit) throw new LineError('expected a whole number for the seed', t.pos + 1)
    s = { type: 'seed', value: Math.trunc(n.value), column }
  } else if (t.keyword('connect')) {
    const from = t.ident()
    t.expect('->')
    const to = t.ident()
    if (!from || !to) throw new LineError('expected "connect FROM -> TO"', t.pos + 1)
    s = { type: 'connect', from, to, column }
  } else if (t.keyword('at')) {
    const pos = position(t)
    s = { type: 'at', pos, body: action(t), column }
  } else if (t.keyword('every')) {
    const length = duration(t)
    t.expect(':')
    s = { type: 'every', length, body: action(t), column }
  } else {
    s = action(t)
  }
  if (!t.atEnd()) throw new LineError(`unexpected "${t.rest().slice(0, 20)}"`, t.pos + 1)
  return s
}

/**
 * Parse a script.
 * @returns {{statements: object[], errors: {line: number, column: number, message: string}[]}}
 */
export function parse (source) {
  const statements = []
  const errors = []
  String(source).split(/\r?\n/).forEach((raw, index) => {
    const text = stripComment(raw)
    if (text.trim() === '') return
    const line = index + 1
    try {
      statements.push({ ...statement(text), line })
    } catch (error) {
      if (!(error instanceof LineError)) throw error
      errors.push({ line, column: error.column, message: error.message })
    }
  })
  return { statements, errors }
}
