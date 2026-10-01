// src/reel/Planner.js
//
// The first of Reel's two steps (docs/livecoding.md): turn a parsed script into a plan, touching nothing.
// Every name is resolved, every plugin the script loads is fetched and validated by the host's own
// loader, every unit is checked against the port it is written to, and every value is checked against
// that port's range, including the whole interval a `pick` or `rand` could produce. A script with any
// error produces no plan, so nothing it says is dispatched, and the music that was playing keeps playing.
//
// All errors are collected and returned together, because a person under the clock fixes one pass and
// not one error at a time.
import { bounds, portDimension, ReelError } from './Values.js'

export const MAX_STATEMENTS = 500

/** The nearest few candidates by edit distance, for "did you mean". */
export function nearest (word, candidates, count = 3) {
  const distance = (a, b) => {
    const row = Array.from({ length: b.length + 1 }, (_, j) => j)
    for (let i = 1; i <= a.length; i++) {
      let previous = row[0]
      row[0] = i
      for (let j = 1; j <= b.length; j++) {
        const above = row[j]
        row[j] = Math.min(row[j] + 1, row[j - 1] + 1, previous + (a[i - 1] === b[j - 1] ? 0 : 1))
        previous = above
      }
    }
    return row[b.length]
  }
  return [...candidates].sort((x, y) => distance(word, x) - distance(word, y)).slice(0, count)
}

const hint = (word, candidates) => {
  const near = nearest(word, candidates)
  return near.length ? `; nearest: ${near.join(', ')}` : ''
}

/**
 * @param statements the parser's output
 * @param context {
 *   beatsPerBar: number,
 *   existing: Map<string, {ports: object[]}>   plugins already in the project, by the name Reel knows them by
 *   resolvePlugin: (iri) => Promise<{ok, ports?, message?, step?}>   the host's own fetch and validation
 * }
 * @returns {Promise<{ok: true, plan: object} | {ok: false, errors: object[]}>}
 */
export async function plan (statements, context) {
  const { beatsPerBar, existing = new Map(), resolvePlugin } = context
  const errors = []
  const fail = (line, message, column = null) => errors.push({ line, column, message })

  if (statements.length > MAX_STATEMENTS) {
    return { ok: false, errors: [{ line: null, column: null, message: `a script is limited to ${MAX_STATEMENTS} statements, this has ${statements.length}` }] }
  }

  // The plugins in scope: those already there, then those this script loads.
  const scope = new Map([...existing].map(([name, v]) => [name, v.ports]))
  const loads = []
  const fetched = new Map()
  for (const s of statements.filter(s => s.type === 'load')) {
    if (scope.has(s.name)) { fail(s.line, `"${s.name}" is already a plugin name`, s.column); continue }
    if (!fetched.has(s.iri)) fetched.set(s.iri, resolvePlugin(s.iri))
    scope.set(s.name, null)
    loads.push(s)
  }
  // Every fetch is started before any is awaited, so a script naming five plugins waits for the slowest
  // and not for the sum of them.
  for (const s of loads) {
    let result
    try { result = await fetched.get(s.iri) } catch (error) { result = { ok: false, message: error.message } }
    if (!result?.ok) {
      fail(s.line, `cannot load ${s.name} from ${s.iri}: ${result?.message ?? 'refused'}${result?.step ? ` (at ${result.step})` : ''}`, s.column)
      // Kept in scope with no ports, so what uses it is not reported a second time as an unknown name.
    } else {
      scope.set(s.name, result.ports)
    }
  }

  const lets = new Map()
  const out = { seed: 1, loads: loads.map(({ name, iri, line }) => ({ name, iri, line })), lets: [], steps: [] }

  const portOf = (name, symbol, line, column) => {
    if (!scope.has(name)) { fail(line, `no plugin called "${name}"${hint(name, scope.keys())}`, column); return null }
    const ports = scope.get(name)
    if (!ports) return null // a load that failed has already been reported
    const port = ports.find(p => p.symbol === symbol)
    if (!port) { fail(line, `${name} has no parameter "${symbol}"${hint(symbol, ports.map(p => p.symbol))}`, column); return null }
    return port
  }

  const check = (expr, port, name, line) => {
    let b
    try { b = bounds(expr, lets) } catch (error) {
      if (!(error instanceof ReelError)) throw error
      fail(line, error.message, error.column); return null
    }
    const unit = portDimension(port.unit)
    if (b.dim !== null) {
      if (!unit?.dim) { fail(line, `${name}.${port.symbol} takes ${unit ? `${unit.name}` : 'a plain number'}, not a ${b.dim} quantity`, expr.column); return null }
      if (unit.dim !== b.dim) { fail(line, `${name}.${port.symbol} is in ${unit.name}, and this value is ${b.dim}`, expr.column); return null }
    }
    const factor = b.dim === null ? 1 : unit.factor
    const lo = b.lo * factor
    const hi = b.hi * factor
    const { minimum, maximum } = port
    if (lo < minimum - 1e-9 || hi > maximum + 1e-9) {
      const reach = lo === hi ? `${lo}` : `${lo} to ${hi}`
      fail(line, `${name}.${port.symbol} can be set to ${reach}, outside its range ${minimum} to ${maximum}`, expr.column)
      return null
    }
    return { unit: port.unit ?? null, factor, minimum, maximum }
  }

  const beatOf = pos => (pos.bar - 1) * beatsPerBar + (pos.beat - 1)
  const lengthBeats = length => (length.unit === 'bars' ? length.n * beatsPerBar : length.n)

  const action = (a, when, line) => {
    const { name, symbol, column } = a.target
    const port = portOf(name, symbol, line, column)
    if (!port) return
    if (a.type === 'set') {
      const meta = check(a.expr, port, name, line)
      if (meta) out.steps.push({ line, when, action: { type: 'set', node: name, symbol, expr: a.expr, port: meta } })
    } else {
      if (when.kind === 'every') { fail(line, 'a ramp cannot be repeated by every; use at to place it', a.column); return }
      const from = check(a.from, port, name, line)
      const to = check(a.to, port, name, line)
      if (from && to) {
        out.steps.push({ line, when, action: { type: 'ramp', node: name, symbol, from: a.from, to: a.to, lengthBeats: lengthBeats(a.length), port: from } })
      }
    }
  }

  for (const s of statements) {
    switch (s.type) {
      case 'load': break
      case 'seed': out.seed = s.value; break
      case 'let': {
        if (lets.has(s.name)) { fail(s.line, `"${s.name}" is already defined`, s.column); break }
        try { lets.set(s.name, bounds(s.expr, lets)); out.lets.push({ name: s.name, expr: s.expr, line: s.line }) } catch (error) {
          if (!(error instanceof ReelError)) throw error
          fail(s.line, error.message, error.column)
        }
        break
      }
      case 'connect': {
        for (const end of [s.from, s.to]) if (!scope.has(end)) fail(s.line, `no plugin called "${end}"${hint(end, scope.keys())}`, s.column)
        if (scope.has(s.from) && scope.has(s.to)) out.steps.push({ line: s.line, when: { kind: 'now' }, action: { type: 'connect', from: s.from, to: s.to } })
        break
      }
      case 'set': case 'ramp': action(s, { kind: 'now' }, s.line); break
      case 'at': action(s.body, { kind: 'at', beat: beatOf(s.pos) }, s.line); break
      case 'every': action(s.body, { kind: 'every', beats: lengthBeats(s.length) }, s.line); break
      default: fail(s.line, `unknown statement ${s.type}`)
    }
  }

  return errors.length ? { ok: false, errors } : { ok: true, plan: out }
}
