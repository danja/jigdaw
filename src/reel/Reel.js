// src/reel/Reel.js
//
// Reel as one object: parse, plan, and carry out, with the rules for replacing a script that is
// already playing (docs/livecoding.md, "Live changes"). The principle is live performance:
//
//  - A script that does not parse or plan changes nothing. What was playing keeps playing.
//  - A new script takes over at the next bar line, atomically: the old script's schedules stop and the new
//    one's begin in the same step, so the music neither stutters nor doubles. With the transport stopped
//    there is no music to stutter and it takes over at once, and `now` asks for that during playback too.
//  - Runs that arrive while one is waiting for its bar line replace it: the latest wins, because the player
//    has moved on from the one before.
//  - A run is one undo group. What it schedules for later is done without recording, so a performance is not
//    a flood of undo steps.
import { parse } from './Parser.js'
import { plan as makePlan } from './Planner.js'
import { createRunner } from './Runner.js'
import { existingPlugins } from './Host.js'

/**
 * @param dispatcher   the OpDispatcher
 * @param tools        the agent tools as { name: handler }
 * @param clock        a ReelClock
 * @param resolvePlugin the planner's validator for a `load` (createPluginValidator)
 * @param beatsPerBar  () => the transport's beats per bar now
 * @param currentBeat  () => the transport position in beats now
 * @param onError      (error) => called as a firing fails, while the music goes on
 * @param onPhase      (phase) => 'checking' as a run begins and 'waiting' when it is checked and holding for its bar line,
 *   so a panel can say what is happening during the seconds a run can take
 */
export function createReel ({ dispatcher, tools, clock, resolvePlugin, beatsPerBar, currentBeat = () => 0, onError = () => {}, onPhase = () => {} }) {
  const session = { names: new Map() }
  let current = null // { stop }
  let pending = null // { cancel, resolve }

  const runner = () => createRunner({
    tools, scheduler: clock, session, beatsPerBar: beatsPerBar(), currentBeat,
    unrecorded: fn => dispatcher.withoutRecording(fn)
  })

  /** Parse and plan, touching nothing. The dry run, and the first half of a run. */
  async function check (source) {
    const parsed = parse(source)
    if (parsed.errors.length) return { ok: false, stage: 'parse', errors: parsed.errors }
    const { existing, ids } = existingPlugins(dispatcher, session)
    // The runner finds a plugin by this map, so a plugin known by its label must be in it.
    for (const [name, id] of ids) if (!session.names.has(name)) session.names.set(name, id)
    const planned = await makePlan(parsed.statements, { beatsPerBar: beatsPerBar(), existing, resolvePlugin })
    return planned.ok ? { ok: true, plan: planned.plan } : { ok: false, stage: 'plan', errors: planned.errors }
  }

  /** The swap itself: the old schedules stop and the new run begins, as one step. */
  async function swap (plan) {
    current?.stop()
    current = null
    const run = await dispatcher.grouped(() => runner().run(plan, { onError }))
    current = run
    return run
  }

  /** Call `fn` once, at the next bar line the clock reaches. Returns a cancel. */
  function atNextBar (fn) {
    let cancel = null
    let done = false
    cancel = clock.every(beatsPerBar(), () => {
      if (done) return
      done = true
      cancel?.()
      fn()
    })
    return () => { done = true; cancel?.() }
  }

  /**
   * Check a script and, if it is sound, make it the playing one.
   * @returns {Promise<{ok: boolean, stage?: string, errors?: object[], swapped?: 'now'|'at-bar'|'superseded'}>}
   *   Resolves when the script has taken over, which with the transport running is at the next bar line.
   */
  async function run (source, { now = false } = {}) {
    onPhase('checking')
    const checked = await check(source)
    if (!checked.ok) return checked

    if (pending) { pending.cancel(); pending.resolve({ ok: true, swapped: 'superseded' }); pending = null }

    if (now || !clock.running || !current) {
      const result = await swap(checked.plan)
      return { ok: result.ok, errors: result.errors, swapped: 'now' }
    }

    onPhase('waiting')
    return new Promise(resolve => {
      const cancel = atNextBar(async () => {
        pending = null
        const result = await swap(checked.plan)
        resolve({ ok: result.ok, errors: result.errors, swapped: 'at-bar' })
      })
      pending = { cancel, resolve }
    })
  }

  function stop () {
    if (pending) { pending.cancel(); pending.resolve({ ok: true, swapped: 'superseded' }); pending = null }
    current?.stop()
    current = null
  }

  return {
    check,
    run,
    stop,
    describe: describePlan,
    get running () { return current !== null },
    get waiting () { return pending !== null },
    session
  }
}

/** A plan as plain data for an agent or a log: what happens, when, and to what. No expressions. */
export function describePlan (plan) {
  return {
    seed: plan.seed,
    loads: plan.loads.map(({ name, iri, line }) => ({ name, iri, line })),
    steps: plan.steps.map(s => ({
      line: s.line,
      when: s.when.kind === 'now' ? 'now' : s.when.kind === 'at' ? `at beat ${s.when.beat}` : `every ${s.when.beats} beats`,
      do: s.action.type === 'connect'
        ? `connect ${s.action.from} -> ${s.action.to}`
        : `${s.action.type} ${s.action.node}.${s.action.symbol}`
    }))
  }
}
