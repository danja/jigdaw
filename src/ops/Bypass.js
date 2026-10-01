// src/ops/Bypass.js
//
// What a project's connections become when some nodes are bypassed. Pure: the
// dispatcher hands the result to the engine in place of the model's own list,
// so the model still holds every connection and bypass costs nothing to undo.
//
// A bypassed node that passes a signal (an effect takes audio and gives audio, a MIDI processor
// takes MIDI and gives MIDI) is stepped over: each connection into its main input is joined to
// each connection out of it. One that makes a signal from nothing (an instrument, a generator) is
// silent: its outgoing connections of that kind are dropped. Connections into a parameter or a
// second input (a sidechain key) stay where they are and change nothing the plugin does, because
// a bypassed plugin does not process.
import { isMidi } from '../engine/EventRouter.js'

const AUDIO = 'audio'
const MIDI = 'midi'
const kindOf = connection => (isMidi(connection.signalKind) ? MIDI : AUDIO)

/** Whether a connection ends at the node's main input (port 0), not at a parameter or another input. */
const intoMain = connection => connection.to.portSymbol === undefined && (connection.to.portIndex ?? 0) === 0

/**
 * `connections` is the project's list; `bypassed(nodeId)` says which nodes are out;
 * `passes(nodeId, kind)` says whether the node carries that signal kind from input to output.
 * Returns a new list of connections, some of them synthetic (`id` joins the two they came from).
 */
export function effectiveConnections (connections, { bypassed, passes }) {
  let list = connections.map(c => c)
  // Each pass removes one bypassed node that can be stepped over. A chain of them takes a few passes.
  for (let guard = 0; guard <= connections.length + 1; guard++) {
    const target = list
      .flatMap(c => [c.from.node, c.to.node])
      .find(id => bypassed(id) && [AUDIO, MIDI].some(kind => passes(id, kind) &&
        list.some(c => c.to.node === id && kindOf(c) === kind && intoMain(c)) &&
        list.some(c => c.from.node === id && kindOf(c) === kind)))
    if (target === undefined) break
    for (const kind of [AUDIO, MIDI]) {
      if (!passes(target, kind)) continue
      const into = list.filter(c => c.to.node === target && kindOf(c) === kind && intoMain(c))
      const out = list.filter(c => c.from.node === target && kindOf(c) === kind)
      if (into.length === 0 || out.length === 0) continue
      const joined = []
      for (const a of into) {
        for (const b of out) {
          if (a.from.node === b.to.node) continue
          joined.push({ id: `${a.id}~${b.id}`, from: a.from, to: b.to, signalKind: a.signalKind })
        }
      }
      const gone = new Set([...into, ...out])
      list = [...list.filter(c => !gone.has(c)), ...joined]
    }
  }
  // What is left: a bypassed node that passes a signal but has nothing after it is a path to nowhere,
  // so what feeds it is left to end where it is (and is heard there, as any last node is); and what a
  // bypassed node sends on is dropped, whether it makes the signal from nothing or had nothing to pass.
  return list.filter(c => !bypassed(c.from.node) &&
    !(bypassed(c.to.node) && passes(c.to.node, kindOf(c)) && intoMain(c)))
}
