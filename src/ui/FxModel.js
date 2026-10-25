// src/ui/FxModel.js
//
// What a channel's FX list needs to know about each plugin on its track, from the same description the chain strip is drawn
// from (ChainModel.js), so the two cannot disagree about what a plugin is doing or where it can be moved. Pure: the page hands
// in what only it knows.
import { describeChain } from './ChainModel.js'

/**
 * The plugins on a track, or on the master, in signal order, as `[{ id, label, loaded, failed, bypassed, canEarlier, canLater }]`.
 * A plugin can move earlier or later only where the neighbour that way takes and gives audio as well, as in the chain strip.
 * `deps` is what describeChain takes: `profileOf`, `labelOf`, `failedOf`, `trackLabelOf`.
 */
export function fxPluginsOf (project, trackId, deps) {
  const { nodes } = describeChain(project, trackId, deps)
  return nodes.map((node, index) => ({
    id: node.id,
    label: node.label,
    loaded: node.loaded,
    failed: node.failed,
    bypassed: node.bypassed,
    canEarlier: node.passesAudio && nodes[index - 1]?.passesAudio === true,
    canLater: node.passesAudio && nodes[index + 1]?.passesAudio === true
  }))
}
