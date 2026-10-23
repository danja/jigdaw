// src/ops/SwapPlugin.js
//
// What replacing one plugin with another in place involves, worked out and not yet done. The dispatcher's `swapPlugin` carries the
// plan out as one undoable edit.
//
// Pure: it reads the project and the two plugins' profiles. Everything the new plugin can take over, it takes: the joins whose port
// exists on it (found by the same `findPort` the model checks a join with, so the plan cannot name a join the model would refuse),
// the settings whose parameter symbol it also has, the bypass flag and the roles the old one held as the
// track's or the master's input. Everything it cannot is listed, in words, so nothing is dropped unseen.
import { findPort, inputsOf } from '../model/Endpoints.js'
import { isMidi } from '../engine/EventRouter.js'

/** Stands for the new node in a plan, until the dispatcher has an id for it. */
export const NEW_NODE = '\u0000new'

/**
 * @param project     `node(id)`, `track(id)`, `connections`, `envelopes`, `master`
 * @param nodeId      the plugin being replaced
 * @param oldProfile  its profile, or null when it did not load
 * @param newProfile  the replacement's profile
 * @returns {{ track, bypassed, connections, settings, midiInput, audioInput, masterInput, dropped }}
 *   `connections` use NEW_NODE where the old node was; `settings` are symbol to value;
 *   `dropped` is a list of sentences, one for each thing that could not be carried over.
 * @throws when it cannot be done at all, with the reason
 */
export function planSwap ({ project, nodeId, oldProfile, newProfile }) {
  const node = project.node(nodeId)
  if (!node) throw new Error(`no such node: ${nodeId}`)
  const name = node.label ?? oldProfile?.label ?? nodeId
  const replacement = newProfile.label ?? 'the new plugin'
  if (project.envelopes.some(e => e.target.node === nodeId)) {
    throw new Error(`${name} has automation on it, which swapping would lose. Remove its envelopes first.`)
  }

  const dropped = []
  const connections = []
  for (const c of project.connections) {
    const outgoing = c.from.node === nodeId
    const incoming = c.to.node === nodeId
    if (!outgoing && !incoming) continue
    const swapped = {
      from: outgoing ? { ...c.from, node: NEW_NODE } : { ...c.from },
      to: incoming ? { ...c.to, node: NEW_NODE } : { ...c.to },
      signalKind: c.signalKind
    }
    const checks = []
    if (outgoing) checks.push(findPort(newProfile, swapped.from, 'from', c.signalKind))
    if (incoming) checks.push(findPort(newProfile, swapped.to, 'to', c.signalKind))
    const refused = checks.find(check => !check.ok)
    if (refused) {
      const other = project.node(outgoing ? c.to.node : c.from.node)
      dropped.push(`the ${isMidi(c.signalKind) ? 'MIDI' : 'audio'} join ${outgoing ? 'to' : 'from'} ${other?.label ?? (outgoing ? c.to.node : c.from.node)} was not carried: ${refused.message}`)
    } else {
      connections.push(swapped)
    }
  }

  const settings = {}
  const known = new Set((newProfile.ports ?? []).map(p => p.symbol))
  for (const [symbol, value] of node.settings) {
    if (known.has(symbol)) settings[symbol] = value
    else dropped.push(`the setting ${symbol} was not carried: ${replacement} has no such parameter`)
  }

  const takes = inputsOf(newProfile).filter(p => p.portSymbol === undefined)
  const track = project.track(node.track)
  const heldMidi = track?.midiInput === nodeId
  const heldAudio = track?.audioInput === nodeId
  const midiInput = heldMidi && takes.some(p => isMidi(p.kind))
  const audioInput = heldAudio && takes.some(p => !isMidi(p.kind))
  if (heldMidi && !midiInput) dropped.push(`${replacement} takes no MIDI, so the track's clips no longer play into it`)
  if (heldAudio && !audioInput) dropped.push(`${replacement} takes no audio, so the track's audio clips no longer play into it`)
  const heldMix = project.master.audioInput === nodeId
  const masterInput = heldMix && takes.some(p => !isMidi(p.kind))
  if (heldMix && !masterInput) dropped.push(`${replacement} takes no audio, so the mix no longer arrives at it`)

  return {
    track: node.track,
    bypassed: node.bypassed === true,
    connections,
    settings,
    midiInput,
    audioInput,
    masterInput,
    dropped
  }
}
