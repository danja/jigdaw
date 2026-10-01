// src/ops/ChainReorder.js
//
// Swap two neighbours in an audio chain, as one changeset. A plugin is in a chain by its
// connections, so moving one means rewiring: with P > A > B > N (P and N optional), swapping A and B
// gives P > B > A > N, and the three connections are replaced by three that join the same ports in
// the new order. Each port stays where it was in the slot it was in, so a plugin with its input on
// port 1 still has it there.
//
// Only a plain chain is reordered: every link involved is the only audio connection of its ends, and
// both plugins take audio and give audio. Anything else has no single right rewiring and is refused
// with the reason, since guessing would silently rewire a graph somebody built (the same restriction
// Project.reorderNode and removeNode's heal keep).
import { isMidi } from '../engine/EventRouter.js'

const audioOnly = connection => !isMidi(connection.signalKind)
const mainInput = connection => connection.to.portSymbol === undefined && (connection.to.portIndex ?? 0) === 0

/**
 * The changes that move `nodeId` one place earlier (`delta` -1) or later (+1) in its audio chain,
 * or an Error saying why not. `passesAudio(nodeId)` says whether a plugin takes and gives audio.
 */
export function chainSwapChanges (project, nodeId, delta, { passesAudio }) {
  if (delta !== -1 && delta !== 1) throw new Error('a chain moves one place at a time')
  const node = project.node(nodeId)
  if (!node) throw new Error(`no such node: ${nodeId}`)
  const audio = project.connections.filter(audioOnly)
  const into = id => audio.filter(c => c.to.node === id && mainInput(c))
  const outOf = id => audio.filter(c => c.from.node === id && c.to.portSymbol === undefined)

  // A is the earlier of the two being swapped, B the later.
  const neighbours = delta === -1 ? into(nodeId) : outOf(nodeId)
  if (neighbours.length !== 1) {
    throw new Error(`${node.label ?? nodeId} has ${neighbours.length === 0 ? 'nothing' : 'several things'} ${delta === -1 ? 'before' : 'after'} it in an audio chain, so there is nothing to swap with`)
  }
  const middle = neighbours[0]
  const a = delta === -1 ? middle.from.node : nodeId
  const b = delta === -1 ? nodeId : middle.to.node
  const nameOf = id => project.node(id)?.label ?? id
  if (!passesAudio(a) || !passesAudio(b)) {
    throw new Error(`${nameOf(a)} and ${nameOf(b)} cannot swap: each has to take audio and give audio`)
  }
  if (project.node(a).track !== project.node(b).track) throw new Error('only plugins on one track are reordered')

  const before = into(a)
  const after = outOf(b)
  if (into(b).length !== 1 || outOf(a).length !== 1) throw new Error(`${nameOf(a)} and ${nameOf(b)} are joined to other things as well, so the chain is not a plain one`)
  if (before.length > 1 || after.length > 1) throw new Error('the chain branches here, so swapping would have to guess which branch goes where')
  if (before.length === 1 && before[0].from.node === b) throw new Error('these plugins feed each other in a loop')

  const p = before[0] ?? null
  const n = after[0] ?? null
  const link = (from, fromPort, to, toPort, kind) => ({
    op: 'addConnection', from: { node: from, portIndex: fromPort }, to: { node: to, portIndex: toPort }, signalKind: kind
  })
  const removals = [p, middle, n].filter(Boolean).map(c => ({ op: 'removeConnection', id: c.id }))
  const additions = []
  if (p) additions.push(link(p.from.node, p.from.portIndex ?? 0, b, middle.to.portIndex ?? 0, p.signalKind))
  additions.push(link(b, n ? n.from.portIndex ?? 0 : 0, a, p ? p.to.portIndex ?? 0 : 0, middle.signalKind))
  if (n) additions.push(link(a, middle.from.portIndex ?? 0, n.to.node, n.to.portIndex ?? 0, n.signalKind))
  return [...removals, ...additions]
}
