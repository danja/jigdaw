// src/ui/MatrixModel.js
//
// Every output a plugin has against every input any plugin has, across every
// track, and which pairs are joined. Pure: it reads the project and is handed
// the page's knowledge of profiles and names.
//
// Audio and MIDI ports only. A plugin's parameters are modulation targets, and
// there can be dozens on one synth; they stay in the plugin view (NodeView),
// where a person picking one is looking for it by name.
//
// A pair that cannot be joined has no cell to press: a different signal kind, or
// a plugin to itself. Left out, not disabled, so every control in the table does
// something.
import { outputsOf, inputsOf, compatible, isMidiSignal } from '../model/Endpoints.js'

const name = kind => (isMidiSignal(kind) ? 'MIDI' : 'audio')

/**
 * `profileOf(nodeId)` gives a profile or undefined while it has not loaded.
 * `labelOf(nodeId)` and `trackLabelOf(trackId)` give display names.
 * Returns `{ rows, cols, connectionAt(row, col), possible(row, col) }`, rows
 * being outputs and columns inputs, each with `key`, `node`, `track`, `port`,
 * `label` and `trackLabel`, in the order the arrangement shows the tracks.
 */
export function buildMatrix (project, { profileOf, labelOf, trackLabelOf }) {
  const rows = []
  const cols = []
  for (const track of project.orderedTracks) {
    for (const node of project.nodes.filter(n => n.track === track.id)) {
      const profile = profileOf(node.id)
      const common = { node: node.id, track: track.id, label: labelOf(node.id), trackLabel: trackLabelOf(track.id) }
      for (const port of outputsOf(profile)) {
        rows.push({ ...common, port, key: `${node.id}-out-${name(port.kind)}-${port.portIndex}`, text: `${common.label} ${port.name}` })
      }
      for (const port of inputsOf(profile).filter(p => p.portSymbol === undefined)) {
        cols.push({ ...common, port, key: `${node.id}-in-${name(port.kind)}-${port.portIndex}`, text: `${common.label} ${port.name}` })
      }
    }
  }

  const possible = (row, col) => row.node !== col.node && compatible(row.port, col.port)
  const connectionAt = (row, col) => project.connections.find(c =>
    c.from.node === row.node && (c.from.portIndex ?? 0) === row.port.portIndex &&
    c.to.node === col.node && c.to.portSymbol === undefined && (c.to.portIndex ?? 0) === col.port.portIndex &&
    name(c.signalKind) === name(row.port.kind)) ?? null

  // A row or column with nothing it can be joined to is an empty line in the
  // table, and there is nothing to press in it, so it is left out.
  const usefulRows = rows.filter(r => cols.some(c => possible(r, c)))
  const usefulCols = cols.filter(c => rows.some(r => possible(r, c)))
  return { rows: usefulRows, cols: usefulCols, possible, connectionAt }
}
