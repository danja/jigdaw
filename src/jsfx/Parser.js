// src/jsfx/Parser.js
//
// A recursive-descent parser for a restricted subset of Cockos's EEL2, the
// language a REAPER JSFX effect's @init/@slider/@block/@sample sections are
// written in. Verified against REAPER's own reference
// (https://www.reaper.fm/sdk/js/basiccode.php), not against a simplified
// dialect: this is real EEL2 grammar, a deliberately smaller piece of it.
//
// Not supported, and each a real EEL2 feature rather than an oversight:
// user-defined `function`, strings, namespaces (`this.foo`), hex and
// character literals ($x10, $'a'), the two-parenthesis-group form of while
// (`while(cond) (body)`; the one-argument form `while(body)` is supported),
// and case-insensitive identifiers (REAPER treats `Gain` and `gain` as the
// same variable; this parser does not). src/jsfx/Compiler.js's module
// comment has the reasoning for the ones that matter to how a script's
// meaning could silently change instead of failing to parse.
//
// EEL2 has no if/else keywords: a conditional is the ternary operator, `?:`,
// and nothing else. while and loop are not keywords either, syntactically:
// they parse as an ordinary identifier-call, `name(args)`, the same as sin()
// or any other function, and it is src/jsfx/Compiler.js that gives those two
// names special meaning. That symmetry is why this parser has no dedicated
// grammar rule for either.

const KEYWORD_LIKE = new Set(['while', 'loop'])

class ParseError extends Error {}

function tokenize (source) {
  const tokens = []
  let i = 0
  const n = source.length
  const isDigit = c => c >= '0' && c <= '9'
  const isIdentStart = c => /[A-Za-z_]/.test(c)
  const isIdentPart = c => /[A-Za-z0-9_.]/.test(c)

  while (i < n) {
    const c = source[i]
    if (c === ' ' || c === '\t' || c === '\r' || c === '\n') { i++; continue }
    if (c === '/' && source[i + 1] === '/') { while (i < n && source[i] !== '\n') i++; continue }
    if (c === '/' && source[i + 1] === '*') {
      i += 2
      while (i < n && !(source[i] === '*' && source[i + 1] === '/')) i++
      i += 2
      continue
    }

    if (isDigit(c) || (c === '.' && isDigit(source[i + 1]))) {
      let j = i
      while (j < n && isDigit(source[j])) j++
      if (source[j] === '.') { j++; while (j < n && isDigit(source[j])) j++ }
      tokens.push({ type: 'num', value: Number(source.slice(i, j)) })
      i = j
      continue
    }

    if (isIdentStart(c)) {
      let j = i + 1
      while (j < n && isIdentPart(source[j])) j++
      tokens.push({ type: 'ident', value: source.slice(i, j) })
      i = j
      continue
    }

    const two = source.slice(i, i + 2)
    if (['==', '!=', '<=', '>=', '&&', '||', '+=', '-=', '*=', '/=', '%=', '^='].includes(two)) {
      tokens.push({ type: 'op', value: two })
      i += 2
      continue
    }

    if ('+-*/%^<>=!?:;,()[]'.includes(c)) {
      tokens.push({ type: 'op', value: c })
      i++
      continue
    }

    throw new ParseError(`unexpected character ${JSON.stringify(c)} at offset ${i}`)
  }
  tokens.push({ type: 'eof', value: null })
  return tokens
}

class Cursor {
  constructor (tokens) { this.tokens = tokens; this.pos = 0 }
  peek () { return this.tokens[this.pos] }
  at (value) { const t = this.peek(); return t.type === 'op' && t.value === value }
  next () { return this.tokens[this.pos++] }
  expect (value) {
    if (!this.at(value)) {
      throw new ParseError(`expected ${JSON.stringify(value)}, got ${JSON.stringify(this.peek())}`)
    }
    return this.next()
  }
}

const ASSIGN_OPS = new Set(['=', '+=', '-=', '*=', '/=', '%=', '^='])

function parseStatementSeq (c) {
  const statements = [parseStatement(c)]
  while (c.at(';')) {
    c.next()
    if (c.at(')') || c.peek().type === 'eof') break
    statements.push(parseStatement(c))
  }
  return { type: 'seq', statements }
}

function parseStatement (c) { return parseAssignment(c) }

function parseAssignment (c) {
  const left = parseTernary(c)
  const t = c.peek()
  if (t.type === 'op' && ASSIGN_OPS.has(t.value)) {
    if (left.type !== 'var' && left.type !== 'index') {
      throw new ParseError(`cannot assign to ${left.type}`)
    }
    c.next()
    const value = parseAssignment(c)
    return { type: 'assign', op: t.value, target: left, value }
  }
  return left
}

function parseTernary (c) {
  const cond = parseLogicalOr(c)
  if (c.at('?')) {
    c.next()
    const then = parseAssignment(c)
    let alt = { type: 'num', value: 0 }
    if (c.at(':')) { c.next(); alt = parseAssignment(c) }
    return { type: 'ternary', cond, then, else: alt }
  }
  return cond
}

function parseLogicalOr (c) {
  let left = parseLogicalAnd(c)
  while (c.at('||')) { c.next(); left = { type: 'binary', op: '||', left, right: parseLogicalAnd(c) } }
  return left
}

function parseLogicalAnd (c) {
  let left = parseEquality(c)
  while (c.at('&&')) { c.next(); left = { type: 'binary', op: '&&', left, right: parseEquality(c) } }
  return left
}

function parseEquality (c) {
  let left = parseRelational(c)
  while (c.at('==') || c.at('!=')) {
    const op = c.next().value
    left = { type: 'binary', op, left, right: parseRelational(c) }
  }
  return left
}

function parseRelational (c) {
  let left = parseAdditive(c)
  while (c.at('<') || c.at('>') || c.at('<=') || c.at('>=')) {
    const op = c.next().value
    left = { type: 'binary', op, left, right: parseAdditive(c) }
  }
  return left
}

function parseAdditive (c) {
  let left = parseMultiplicative(c)
  while (c.at('+') || c.at('-')) {
    const op = c.next().value
    left = { type: 'binary', op, left, right: parseMultiplicative(c) }
  }
  return left
}

function parseMultiplicative (c) {
  let left = parsePower(c)
  while (c.at('*') || c.at('/') || c.at('%')) {
    const op = c.next().value
    left = { type: 'binary', op, left, right: parsePower(c) }
  }
  return left
}

/** Right-associative: 2^3^2 is 2^(3^2), matching REAPER's documented table. */
function parsePower (c) {
  const left = parseUnary(c)
  if (c.at('^')) { c.next(); return { type: 'binary', op: '^', left, right: parsePower(c) } }
  return left
}

function parseUnary (c) {
  if (c.at('-')) { c.next(); return { type: 'unary', op: '-', operand: parseUnary(c) } }
  if (c.at('!')) { c.next(); return { type: 'unary', op: '!', operand: parseUnary(c) } }
  if (c.at('+')) { c.next(); return parseUnary(c) }
  return parsePostfix(c)
}

function parsePostfix (c) {
  let node = parsePrimary(c)
  while (c.at('[')) {
    c.next()
    const index = parseAssignment(c)
    c.expect(']')
    node = { type: 'index', object: node, index }
  }
  return node
}

const asExpr = seq => (seq.statements.length === 1 ? seq.statements[0] : seq)

/**
 * while and loop are not ordinary calls: the content between their parens is
 * semicolon-delimited statements, not comma-delimited arguments, because
 * REAPER's own `while(cond; morecond)` and `loop(count, a; b)` bodies are a
 * parenthesised block reusing call syntax, not a call with a block argument.
 * while takes that whole block as its one argument; loop takes a plain
 * expression, a comma, then a block for its second.
 */
function parseWhileOrLoop (name, c) {
  c.expect('(')
  if (name === 'while') {
    const body = asExpr(parseStatementSeq(c))
    c.expect(')')
    return { type: 'call', name: 'while', args: [body] }
  }
  const count = parseAssignment(c)
  c.expect(',')
  const body = asExpr(parseStatementSeq(c))
  c.expect(')')
  return { type: 'call', name: 'loop', args: [count, body] }
}

function parsePrimary (c) {
  const t = c.peek()

  if (t.type === 'num') { c.next(); return { type: 'num', value: t.value } }

  if (t.type === 'op' && t.value === '(') {
    c.next()
    const seq = parseStatementSeq(c)
    c.expect(')')
    return seq.statements.length === 1 ? seq.statements[0] : seq
  }

  if (t.type === 'ident') {
    c.next()
    if (KEYWORD_LIKE.has(t.value) && c.at('(')) return parseWhileOrLoop(t.value, c)
    if (c.at('(')) {
      c.next()
      const args = []
      if (!c.at(')')) {
        args.push(parseAssignment(c))
        while (c.at(',')) { c.next(); args.push(parseAssignment(c)) }
      }
      c.expect(')')
      return { type: 'call', name: t.value, args }
    }
    return { type: 'var', name: t.value }
  }

  throw new ParseError(`unexpected token ${JSON.stringify(t)}`)
}

/**
 * Parse one EEL2 section body (the text of an @init, @slider, @block or
 * @sample block) into a `seq` node. An empty or whitespace-only section
 * parses to an empty sequence rather than throwing: a JSFX effect with no
 * @block, say, is ordinary, not malformed.
 */
export function parseSection (source) {
  const trimmed = source.trim()
  if (trimmed.length === 0) return { type: 'seq', statements: [] }
  const c = new Cursor(tokenize(trimmed))
  const seq = parseStatementSeq(c)
  if (c.peek().type !== 'eof') {
    throw new ParseError(`unexpected trailing input: ${JSON.stringify(c.peek())}`)
  }
  return seq
}

export { ParseError, KEYWORD_LIKE }
