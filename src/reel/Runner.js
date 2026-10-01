// src/reel/Runner.js
//
// The second of Reel's two steps: carry out a plan. A plan has already been validated, so what can still
// go wrong here is the world changing under it, and the rule for that is the live one: report it, skip
// that statement, and keep the music going. A statement that fails inside an `every` is cancelled until the
// next evaluation and never retried every beat.
//
// Everything reaches the project through the agent tools, which are the dispatcher's Ops, so a script has no
// capability the tools do not (src/reel/Capabilities.js). The scheduler is the host's: it fires a function at
// a transport position, by stream position and never by a timer (CLAUDE.md, the real-time rules).
import { evaluate, makeRng, ReelError } from './Values.js'
import { SCRIPTABLE } from './Capabilities.js'

// How many expression nodes one firing may evaluate. A firing runs on the message thread between blocks,
// so a script that is slow must fail and not stall a bar.
export const TICK_BUDGET = 200

/**
 * @param tools     the agent tools as { name: handler }
 * @param scheduler { at(beat, fn) => cancel, every(beats, fn) => cancel }, fired on the transport
 * @param session   { names: Map<string, nodeId> } the plugins Reel knows by name; written as it loads
 * @param beatsPerBar
 * @param currentBeat () => the transport position in beats, for where an unplaced ramp begins
 * @param unrecorded (fn) => fn's result, run so that its edits are not undo steps. The host passes
 *   dispatcher.withoutRecording: a firing during a performance changes the model, so a save holds it, and is
 *   not an edit to step back over (docs/livecoding.md, "Live changes").
 */
export function createRunner ({ tools, scheduler, session, beatsPerBar, currentBeat = () => 0, unrecorded = fn => fn() }) {
  for (const tool of Object.values(SCRIPTABLE)) {
    if (!tools[tool]) throw new Error(`the host has no ${tool} tool, which Reel needs`)
  }

  /**
   * `since` is the elapsed time of the bar line the script takes over at, so what it schedules counts from there
   * and its own downbeat is not missed (ReelClock.at).
   */
  async function run (plan, { onError = () => {}, since = null } = {}) {
    const errors = []
    const report = (line, message) => { const e = { line, message }; errors.push(e); onError(e) }
    const cancels = []
    const rng = makeRng(plan.seed)

    // Lets are evaluated once, at the start, in order. A later `every` that uses one sees the same value.
    const env = new Map()
    for (const l of plan.lets) {
      try { env.set(l.name, evaluate(l.expr, env, rng, { left: 2000 })) } catch (error) {
        if (!(error instanceof ReelError)) throw error
        report(l.line, error.message)
      }
    }

    for (const load of plan.loads) {
      const result = await tools[SCRIPTABLE.load]({ iri: load.iri })
      if (!result.ok) { report(load.line, `cannot load ${load.name}: ${result.error}`); continue }
      session.names.set(load.name, result.nodeId)
    }

    const idOf = (name, line) => {
      const id = session.names.get(name)
      if (!id) report(line, `${name} is not loaded`)
      return id
    }

    const value = (expr, port) => {
      const v = evaluate(expr, env, rng, { left: TICK_BUDGET })
      const scaled = v.dim === null ? v.v : v.v * port.factor
      // The planner proved the range for what it could see; this stands between a surprise and a parameter.
      return Math.min(port.maximum, Math.max(port.minimum, scaled))
    }

    const nextBar = beat => Math.ceil(beat / beatsPerBar - 1e-9) * beatsPerBar

    // One firing of one statement. Returns false when it failed, so a repeating one can be stopped.
    const fire = async step => {
      const a = step.action
      try {
        if (a.type === 'connect') {
          const from = idOf(a.from, step.line); const to = idOf(a.to, step.line)
          if (!from || !to) return false
          const r = await tools[SCRIPTABLE.connect]({ from, to })
          if (!r.ok) { report(step.line, r.error); return false }
          return true
        }
        const node = idOf(a.node, step.line)
        if (!node) return false
        if (a.type === 'set') {
          const r = await tools[SCRIPTABLE.set]({ node, symbol: a.symbol, value: value(a.expr, a.port) })
          if (!r.ok) { report(step.line, r.error); return false }
          return true
        }
        const start = step.when.kind === 'at' ? step.when.beat : nextBar(currentBeat())
        const r = await tools[SCRIPTABLE.ramp]({
          nodeId: node,
          symbol: a.symbol,
          points: [
            { atBeat: start, value: value(a.from, a.port), curve: 'linear' },
            { atBeat: start + a.lengthBeats, value: value(a.to, a.port) }
          ]
        })
        if (!r.ok) { report(step.line, r.error); return false }
        return true
      } catch (error) {
        if (!(error instanceof ReelError)) throw error
        report(step.line, error.message)
        return false
      }
    }

    for (const step of plan.steps) {
      if (step.when.kind === 'now') {
        await fire(step)
      } else if (step.when.kind === 'at') {
        // A ramp's own `at` is its start, and is carried out now, as an envelope the engine plays.
        if (step.action.type === 'ramp') await fire(step)
        else cancels.push(scheduler.at(step.when.beat, () => unrecorded(() => fire(step)), { since }))
      } else {
        let cancel = null
        let dead = false
        cancel = scheduler.every(step.when.beats, async () => {
          if (dead) return
          if (!(await unrecorded(() => fire(step)))) { dead = true; cancel?.() }
        }, { since })
        cancels.push(cancel)
      }
    }

    return { ok: errors.length === 0, errors, names: session.names, stop: () => { for (const c of cancels) c?.() } }
  }

  return { run }
}
