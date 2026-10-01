// web/app/AutomationHost.js
//
// Envelopes on plugin parameters, played on the audio clock through each AudioParam's own scheduling,
// which Scheduler drives (src/engine/Scheduler.js) with instructions from src/engine/Automation.js.
//
// What the person set by hand stays in the model and the envelope never overwrites it: stopping puts every
// touched parameter back to that value. And a hand edit while an envelope plays wins: the parameter takes
// the new value at once, the events already scheduled are cancelled, and that envelope stays quiet until
// the transport is stopped, rather than fighting the person's hand on every tick. The edit is told apart
// from the envelope's own writes because those go straight to the AudioParam and never through the
// dispatcher, which reports only the edits that came through it.
export function createAutomationHost (ctx) {
  const { log } = ctx
  // param -> { target, suspended }
  const touched = new Map()
  const warned = new Set()
  const keyOf = ({ node, symbol, kind }) => (kind !== undefined ? `master:${kind}` : `${node}:${symbol}`)
  const MASTER = { masterGain: 'gain', masterPan: 'pan' }
  const paramOf = target => (target.kind !== undefined
    ? (MASTER[target.kind] ? ctx.engine.masterParam(MASTER[target.kind]) : null)
    : ctx.dispatcher.engineNode(target.node)?.node?.parameters?.get(target.symbol))
  // The master is held while an envelope plays on it (Engine.holdMaster), released on stop or on a hand edit.
  const hold = (target, on) => { if (MASTER[target.kind]) ctx.engine.holdMaster(MASTER[target.kind], on) }
  const masterSnapshot = () => JSON.stringify(ctx.dispatcher.project.master)
  let masterAtStart = null

  const manualValue = ({ node, symbol, kind }) => {
    if (kind === 'masterGain') { const m = ctx.dispatcher.project.master; return m.muted ? 0 : m.gain }
    if (kind === 'masterPan') return ctx.dispatcher.project.master.pan
    const set = ctx.dispatcher.project.node(node)?.settings.get(symbol)
    if (set !== undefined) return set
    return ctx.dispatcher.engineNode(node)?.profile?.ports?.find(p => p.symbol === symbol)?.defaultValue
  }

  // The dispatcher is made after this is, and may be replaced, so listening starts with the first envelope
  // that plays and follows whichever dispatcher is current.
  let listeningTo = null
  const listen = () => {
    if (listeningTo === ctx.dispatcher) return
    listeningTo = ctx.dispatcher
    listeningTo.subscribe(event => {
      if (event.type === 'parameter') host.edited(event.nodeId, event.symbol, event.value)
      else if (event.type === 'changed') host.masterEdited(listeningTo.project.master)
    })
  }

  const host = {
    envelopes: () => ctx.dispatcher.project.envelopes.filter(e => (e.target.node !== undefined || MASTER[e.target.kind]) && e.points.length > 0),

    apply (envelope, instruction) {
      listen()
      const param = paramOf(envelope.target)
      if (!param) return
      const state = touched.get(param) ?? { target: envelope.target, suspended: false }
      touched.set(param, state)
      if (state.suspended) return
      if (envelope.target.kind === 'masterGain' && ctx.dispatcher.project.master.muted) return
      if (!state.held) { hold(envelope.target, true); state.held = true; masterAtStart ??= masterSnapshot() }
      try {
        if (instruction.kind === 'set') param.setValueAtTime(instruction.value, instruction.at)
        else if (instruction.kind === 'ramp') param.linearRampToValueAtTime(instruction.endValue, instruction.end)
        else param.setValueCurveAtTime(instruction.values, instruction.at, instruction.duration)
      } catch (error) {
        // Said once per envelope: a refusal repeats on every tick otherwise.
        if (!warned.has(envelope.id)) { warned.add(envelope.id); log(`automation ${envelope.id}: ${error.message}`, 'error') }
      }
    },

    /** A parameter was changed by hand (or by an agent, or by undo): it takes over from its envelope until Stop. */
    edited (nodeId, symbol, value) {
      const target = { node: nodeId, symbol }
      for (const [param, state] of touched) {
        if (keyOf(state.target) !== keyOf(target) || state.suspended) continue
        const now = ctx.engine.context.currentTime
        param.cancelScheduledValues(now)
        param.setValueAtTime(value, now)
        state.suspended = true
        hold(state.target, false)
        log(`${symbol} was changed by hand, so its automation is paused until you press Stop`)
      }
    },

    /**
     * The master was changed through setMaster: an envelope on its level or pan, if one is playing, steps aside.
     * `master` is the project's master as it is now.
     */
    masterEdited (master) {
      if (masterAtStart === null || JSON.stringify(master) === masterAtStart) return
      for (const [param, state] of touched) {
        if (state.target.kind === undefined || state.suspended) continue
        const now = ctx.engine.context.currentTime
        param.cancelScheduledValues(now)
        state.suspended = true
        hold(state.target, false)
        // The engine applies the new level or pan itself, now that the master is no longer held.
        ctx.engine.setMaster(master)
        log(`the master ${state.target.kind === 'masterGain' ? 'level' : 'pan'} was changed by hand, so its automation is paused until you press Stop`)
      }
      masterAtStart = JSON.stringify(master)
    },

    stop () {
      const now = ctx.engine.context.currentTime
      masterAtStart = null
      for (const [param, state] of touched) {
        hold(state.target, false)
        param.cancelScheduledValues(now)
        const value = manualValue(state.target)
        if (value !== undefined) param.setValueAtTime(value, now)
      }
      touched.clear()
    }
  }
  return host
}
