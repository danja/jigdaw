// src/ops/ParameterOps.js
//
// Setting parameters, resetting them, reading a plugin's live state, replacing an asset, and finding the AudioParams a parameter is. The
// dispatcher owns the model, the engine and the order of things; these are the operations on one plugin's parameters and state, handed what
// they read through `host`:
//
//   engine                      the running engine, or null (read each time)
//   nodeIds, memberIds, composites   the dispatcher's maps from model nodes to engine nodes (docs/nested-plugins.md)
//   apply(changes, options)     the dispatcher's one way to change the model
//   emit(event), engineNode(id)
import { parameterTargets } from '../host/CompositeParameters.js'
import { collectState } from '../host/CompositeState.js'
import { flatIdOf } from './CompositeExpansion.js'

export class ParameterOps {
  #host

  constructor (host) { this.#host = host }

  /**
   * Set a parameter. Goes to the model and the AudioParam, never a message.
   *
   * The clamp is asked for before the write rather than corrected after it. The
   * engine clamps to the declared range and the model must record what was
   * actually applied, not what was asked for, per messaging.md 2.3: a surface
   * renders what it is told, not what it requested. Writing the asked-for value
   * and then writing the clamped one was two revisions for one edit, and the
   * second went straight to the project, around this dispatcher's own gate.
   */
  setParameter (nodeId, symbol, value) {
    let prepared
    try {
      prepared = this.prepareParameter(nodeId, symbol, value)
    } catch (error) {
      return { ok: false, kind: 'change', message: error.message }
    }
    const result = this.#host.apply([{ op: 'setSetting', node: nodeId, symbol, value: prepared.applied }])
    if (!result.ok) return result

    prepared.push()
    this.#host.emit({ type: 'parameter', nodeId, symbol, value: prepared.applied })
    return { ...result, value: prepared.applied }
  }

  /**
   * What a write to one parameter would do: the value as the plugin will hold it, and how to send it.
   *
   * A plain node's value is clamped by the plugin's declared range. A composite's is clamped by the range its
   * exposed port declares and sent unchanged to every real parameter that port drives (section 2.2), each of
   * which clamps it again to its own. Throws, before anything has changed, for a parameter that is not there.
   */
  prepareParameter (nodeId, symbol, value) {
    const composite = this.#host.composites.get(nodeId)
    if (composite) {
      const port = composite.entry.profile.ports.find(p => p.symbol === symbol)
      if (!port) throw new Error(`${composite.entry.profile.label} has no parameter "${symbol}"`)
      const bounded = Math.min(port.maximum ?? Infinity, Math.max(port.minimum ?? -Infinity, value))
      const targets = parameterTargets(composite.entry.tree, symbol).map(target => {
        const engineId = this.#host.memberIds.get(flatIdOf(nodeId, target.path))
        return { engineId, symbol: target.symbol, value: this.#host.engine ? this.#host.engine.clampParameter(engineId, target.symbol, bounded) : bounded }
      })
      return { applied: bounded, push: () => { for (const t of targets) this.#host.engine?.setParameter(t.engineId, t.symbol, t.value) } }
    }
    const engineId = this.#host.nodeIds.get(nodeId)
    const applied = engineId && this.#host.engine ? this.#host.engine.clampParameter(engineId, symbol, value) : value
    return { applied, push: () => { if (engineId && this.#host.engine) this.#host.engine.setParameter(engineId, symbol, applied) } }
  }

  /**
   * Put a parameter back to its plugin's default and forget its setting, so
   * the model says what a node that was never touched says. What undo does
   * for a parameter that had not been set before the edit being undone:
   * restoring "no setting" in the model alone left the AudioParam, the panel
   * and an open editor all at the value being undone.
   */
  resetParameter (nodeId, symbol) {
    const composite = this.#host.composites.get(nodeId)
    let value = null
    let prepared = null
    try {
      if (composite) {
        const port = composite.entry.profile.ports.find(p => p.symbol === symbol)
        if (!port) throw new Error(`${composite.entry.profile.label} has no parameter "${symbol}"`)
        value = port.defaultValue
        prepared = this.prepareParameter(nodeId, symbol, value)
      } else {
        const engineId = this.#host.nodeIds.get(nodeId)
        if (engineId && this.#host.engine) value = this.#host.engine.defaultParameter(engineId, symbol)
      }
    } catch (error) {
      return { ok: false, kind: 'change', message: error.message }
    }
    const result = this.#host.apply([{ op: 'clearSetting', node: nodeId, symbol }])
    if (!result.ok) return result
    if (prepared) {
      prepared.push()
      this.#host.emit({ type: 'parameter', nodeId, symbol, value: prepared.applied })
      return { ...result, value: prepared.applied }
    }
    const engineId = this.#host.nodeIds.get(nodeId)
    if (engineId && this.#host.engine && value !== null) {
      this.#host.engine.setParameter(engineId, symbol, value)
      this.#host.emit({ type: 'parameter', nodeId, symbol, value })
    }
    return { ...result, value }
  }

  /**
   * Ask a node's own processor for its current state, live, rather than
   * whatever `jig:nodeState` last happened to hold in the model. Called
   * before writing a session, per contract section 8: parameter values are
   * never part of state, so this is the only way a saved project carries
   * what a stateful plugin is actually doing.
   *
   * `null` for a node the engine has no entry for (not yet loaded, or a
   * foreign plugin, whose own adapter this does not reach into) and for a
   * plugin that never answers, which are both ordinary rather than errors.
   */
  async getNodeState (nodeId) {
    // A composite has no processor to ask, so the host assembles its state from its members (section 6).
    const composite = this.#host.composites.get(nodeId)
    if (composite && this.#host.engine) {
      const state = await collectState(composite.entry.tree, path => this.#host.engine.requestState(this.#host.memberIds.get(flatIdOf(nodeId, path))))
      return state ?? null
    }
    const engineId = this.#host.nodeIds.get(nodeId)
    if (!engineId || !this.#host.engine) return null
    // A plugin that declares jig:stateless never answers: asking would only wait out the timeout.
    if (this.#host.engine.get(engineId)?.profile?.stateless) return null
    return this.#host.engine.requestState(engineId)
  }

  /**
   * Replace one `jig:userReplaceable` asset in a running node: a person
   * choosing a different file from the generated panel. Not routed through
   * `apply()`: it changes neither the graph nor a parameter the model
   * tracks, only bytes a processor holds, which is exactly what
   * `jig:nodeState` exists to carry, and the next `getNodeState` reflects it
   * without this needing to touch the project itself.
   */
  loadAsset (nodeId, key, bytes) {
    const engineId = this.#host.nodeIds.get(nodeId)
    if (this.#host.composites.has(nodeId)) return { ok: false, message: 'a composite plugin has no assets of its own to replace' }
    if (!engineId || !this.#host.engine) {
      return { ok: false, message: 'no such node, or nothing to load an asset into' }
    }
    this.#host.engine.loadAsset(engineId, key, bytes)
    return { ok: true }
  }

  /**
   * Rebuild the audio links to match the compiled graph.
   *
   * The whole set is torn down and rebuilt rather than diffed. A diff is an
   * optimisation and this is the correctness-first version: after any edit the
   * links are exactly what the compiler said, with no stale delay node left
   * feeding silence into a mix because an edge moved.
   */

  /**
   * Set several parameters as one edit.
   *
   * Not a loop over setParameter, which would be one revision and one compile
   * per value: a preset of thirty parameters would arrive as thirty edits, be
   * thirty entries in an undo stack, and be audible as a sweep through
   * intermediate states. Clamped first, for the same reason as the single
   * value, then written once, then pushed to the AudioParams.
   */
  setParameters (settings, { expectedRevision } = {}) {
    if (!Array.isArray(settings) || settings.length === 0) {
      return { ok: false, kind: 'change', message: 'needs a non-empty list of settings' }
    }

    const applied = []
    for (const { nodeId, symbol, value } of settings) {
      try {
        const prepared = this.prepareParameter(nodeId, symbol, value)
        applied.push({ nodeId, symbol, value: prepared.applied, push: prepared.push })
      } catch (error) {
        return { ok: false, kind: 'change', message: error.message }
      }
    }

    const result = this.#host.apply(
      applied.map(a => ({ op: 'setSetting', node: a.nodeId, symbol: a.symbol, value: a.value })),
      { expectedRevision }
    )
    if (!result.ok) return result

    for (const a of applied) {
      a.push()
      this.#host.emit({ type: 'parameter', nodeId: a.nodeId, symbol: a.symbol, value: a.value })
    }

    return { ...result, applied: applied.map(({ nodeId, symbol, value }) => ({ nodeId, symbol, value })) }
  }


  /**
   * The AudioParams a node's parameter is, for automation: one for a plugin, and for a composite one for every
   * member parameter the exposed port drives. Empty for a parameter that is not there or a node not loaded.
   */
  audioParams (nodeId, symbol) {
    const composite = this.#host.composites.get(nodeId)
    if (composite && this.#host.engine) {
      return parameterTargets(composite.entry.tree, symbol)
        .map(target => this.#host.engine.get(this.#host.memberIds.get(flatIdOf(nodeId, target.path))).node.parameters?.get(target.symbol))
        .filter(Boolean)
    }
    const param = this.#host.engineNode(nodeId)?.node?.parameters?.get(symbol)
    return param ? [param] : []
  }
}
