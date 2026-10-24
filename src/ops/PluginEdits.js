// src/ops/PluginEdits.js
//
// The edits that replace plugins with other plugins: unpack a composite into its members, swap one plugin for another, and describe a selection
// as a composite to publish. Each is planned by a pure function (CompositeUnpack.js, SwapPlugin.js, CompositePack.js) and carried out here
// through the dispatcher's own operations, so it is one undo step and a refusal leaves the project as it was. The dispatcher hands over what
// it reads through `host`:
//
//   project, engine, composites     the model, the running engine or null, and the composites by node id (read each time)
//   grouped(fn, { label }), apply(changes), addPlugin(iri, node), setParameter(id, symbol, value)
//   getNodeState(id), engineNode(id)
import { planUnpack } from './CompositeUnpack.js'
import { planSwap, NEW_NODE } from './SwapPlugin.js'
import { planPack } from './CompositePack.js'
import { writeComposite } from '../rdf/CompositeWriter.js'
import { encodeState } from '../host/StateCodec.js'

export class PluginEdits {
  #host

  constructor (host) { this.#host = host }

  /**
   * Turn a composite plugin's node back into its members, as ordinary nodes on the same track, joined to what was around it, with
   * the value each had inside the rack so it sounds the same. One undoable edit. docs/nested-plugins.md section 12.
   *
   * The members are added first and the composite is removed last, in the same change as the wiring, so a member that will not load
   * leaves the rack exactly as it was and no stray nodes behind. A composite with automation on it is refused: an envelope is on one
   * of its exposed parameters, which will not exist, and dropping it silently would lose a person's work.
   */
  async unpackComposite (nodeId) {
    const composite = this.#host.composites.get(nodeId)
    if (!composite) return { ok: false, kind: 'change', message: `${nodeId} is not a composite plugin, so there is nothing to unpack` }
    if (this.#host.project.envelopes.some(e => e.target.node === nodeId)) {
      return { ok: false, kind: 'change', message: `${composite.entry.profile.label} has automation on it, which unpacking would lose. Remove its envelopes first.` }
    }

    const plan = planUnpack({ project: this.#host.project, nodeId, tree: composite.entry.tree, state: await this.#host.getNodeState(nodeId) })

    return this.#host.grouped(async () => {
      const made = new Map()
      const abandon = async failure => {
        for (const id of made.values()) this.#host.apply([{ op: 'removeNode', id }])
        return failure
      }

      for (const member of plan.members) {
        const added = await this.#host.addPlugin(member.plugin, {
          track: plan.track, label: member.label, ...(member.state === null ? {} : { state: encodeState(member.state) })
        })
        if (!added.ok) return abandon({ ...added, message: `could not unpack ${composite.entry.profile.label}: ${member.label}: ${added.message}` })
        made.set(member.key, added.nodeId)
        for (const [symbol, value] of Object.entries(member.settings)) {
          const set = this.#host.setParameter(added.nodeId, symbol, value)
          if (!set.ok) return abandon({ ...set, message: `could not unpack ${composite.entry.profile.label}: ${member.label}: ${set.message}` })
        }
        if (plan.bypassed) this.#host.apply([{ op: 'setNode', id: added.nodeId, bypassed: true }])
      }

      const idOf = e => (e.member === undefined ? e : { node: made.get(e.member), ...Object.fromEntries(Object.entries(e).filter(([k]) => k !== 'member')) })
      const changes = [
        { op: 'removeNode', id: nodeId },
        ...plan.connections.map(c => ({ op: 'addConnection', from: idOf(c.from), to: idOf(c.to), signalKind: c.signalKind })),
        ...(plan.midiInput ? [{ op: 'setTrack', id: plan.track, midiInput: made.get(plan.midiInput) }] : []),
        ...(plan.audioInput ? [{ op: 'setTrack', id: plan.track, audioInput: made.get(plan.audioInput) }] : [])
      ]
      const result = this.#host.apply(changes)
      if (!result.ok) return abandon(result)
      return { ...result, nodeIds: [...made.values()] }
    }, { label: 'Unpack a composite plugin' })
  }

  /**
   * Replace a plugin with another, in the same place: on its track, joined to what it was joined to wherever the new one has a port
   * for it, with the settings it has parameters for, its label if a person gave one, and its bypass. One undoable edit. What could not
   * be carried is returned in `dropped`, in words. The new one is loaded first and the old one removed in the same change as the wiring,
   * so a plugin that will not load leaves the old one exactly as it was. Not for a composite (unpack it first), and refused when the
   * old one has automation on it.
   */
  async swapPlugin (nodeId, iri) {
    const old = this.#host.project.node(nodeId)
    if (!old) return { ok: false, kind: 'change', message: `no such node: ${nodeId}` }
    if (this.#host.composites.has(nodeId)) return { ok: false, kind: 'change', message: 'a composite plugin cannot be swapped; unpack it first' }
    if (old.pluginIri === iri) return { ok: false, kind: 'change', message: 'that is the plugin already there' }
    // Before anything is loaded, so a refusal changes nothing, not even the revision.
    if (this.#host.project.envelopes.some(e => e.target.node === nodeId)) {
      return { ok: false, kind: 'change', message: `${old.label ?? nodeId} has automation on it, which swapping would lose. Remove its envelopes first.` }
    }
    const oldProfile = this.#host.engineNode(nodeId)?.profile ?? null

    return this.#host.grouped(async () => {
      // A label a person gave is kept; the old plugin's own name is not, since it would be wrong for the new one.
      const mine = old.label !== null && old.label !== undefined && old.label !== oldProfile?.label
      const added = await this.#host.addPlugin(iri, { track: old.track, ...(mine ? { label: old.label } : {}) })
      if (!added.ok) return added
      const newId = added.nodeId
      const abandon = failure => { this.#host.apply([{ op: 'removeNode', id: newId }]); return failure }

      let plan
      try {
        plan = planSwap({ project: this.#host.project, nodeId, oldProfile, newProfile: added.entry.profile })
      } catch (error) {
        return abandon({ ok: false, kind: 'change', message: error.message })
      }
      const dropped = [...plan.dropped]
      for (const [symbol, value] of Object.entries(plan.settings)) {
        const set = this.#host.setParameter(newId, symbol, value)
        if (!set.ok) dropped.push(`the setting ${symbol} was not carried: ${set.message}`)
      }
      const idOf = e => (e.node === NEW_NODE ? { ...e, node: newId } : e)
      const changes = [
        { op: 'removeNode', id: nodeId },
        ...plan.connections.map(c => ({ op: 'addConnection', from: idOf(c.from), to: idOf(c.to), signalKind: c.signalKind })),
        ...(plan.bypassed ? [{ op: 'setNode', id: newId, bypassed: true }] : []),
        ...(plan.midiInput ? [{ op: 'setTrack', id: plan.track, midiInput: newId }] : []),
        ...(plan.audioInput ? [{ op: 'setTrack', id: plan.track, audioInput: newId }] : []),
        ...(plan.masterInput ? [{ op: 'setMaster', audioInput: newId }] : [])
      ]
      const result = this.#host.apply(changes)
      if (!result.ok) return abandon(result)
      return { ...result, nodeId: newId, replaced: nodeId, dropped }
    }, { label: 'Swap a plugin' })
  }

  /**
   * Describe a selection of nodes as a composite plugin, as the Turtle profile a person would publish. Changes nothing in the project:
   * a composite is a plugin at an IRI, and an IRI is where only its author can put it, so what comes back is a document and not a node.
   * Each member is pinned to the digest of the profile fetched for it now. docs/nested-plugins.md section 12.
   *
   * `iri` is where it will be published, `https:` or loopback `http:`. Returns `{ ok, turtle, summary, warnings }`, the warnings saying
   * what a composite cannot carry (bypass, saved state, automation, a connection into a member's own parameter).
   */
  async packSelection ({ nodeIds, iri, label, comment = null, expose = 'set' } = {}) {
    if (!/^(https:\/\/|http:\/\/(localhost|127\.0\.0\.1|\[::1\])(:[0-9]+)?\/)/.test(iri ?? '')) {
      return { ok: false, kind: 'change', message: 'a composite is published at an https IRI, or an http one on loopback, and needs one to be named by' }
    }
    if (typeof label !== 'string' || label.trim() === '') return { ok: false, kind: 'change', message: 'a composite needs a name' }
    let plan
    try {
      plan = planPack({ project: this.#host.project, nodeIds, profileOf: id => this.#host.engineNode(id)?.profile ?? null, expose })
    } catch (error) {
      return { ok: false, kind: 'change', message: error.message }
    }

    const warnings = [...plan.warnings]
    const pins = new Map()
    for (const plugin of new Set(plan.members.map(m => m.plugin))) {
      try {
        pins.set(plugin, await this.#host.engine.profileDigest(plugin))
      } catch (error) {
        warnings.push(`${plugin} could not be pinned (${error.message}), so a signature on this composite would not reach it`)
      }
    }
    const turtle = writeComposite({
      iri, label: label.trim(), comment,
      ...plan,
      members: plan.members.map(m => ({ ...m, pinnedDigest: pins.get(m.plugin) ?? null }))
    })
    return {
      ok: true,
      turtle,
      summary: { members: plan.members.length, controls: plan.ports.length, audioInputs: plan.audioInputs, audioOutputs: plan.audioOutputs, pinned: pins.size },
      warnings
    }
  }
}
