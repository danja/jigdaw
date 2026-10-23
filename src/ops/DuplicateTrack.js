// src/ops/DuplicateTrack.js
//
// Copy a track with its plugins, as one undoable edit. The plan is src/model/TrackDuplicate.js;
// this is the sequence that runs it, which is the part that cannot be pure: each plugin is
// fetched and instantiated before its node means anything.
//
// All or nothing. A plugin that will not load abandons the copy and takes back what was made,
// because a duplicate missing its synth is a track that looks like the original and is silent.
// That differs from opening a session, where one bad node costs one node (src/ops/OpenProject.js).
import { describeTrackCopy, finishTrackCopy } from '../model/TrackDuplicate.js'

/**
 * @returns {Promise<{ ok: true, trackId, nodeIds, skipped } | { ok: false, message }>}
 *   `nodeIds` maps each original node's id to its copy's.
 */
export async function duplicateTrack (dispatcher, trackId) {
  let plan
  try {
    plan = describeTrackCopy(dispatcher.project, trackId)
  } catch (error) {
    return { ok: false, kind: 'change', message: error.message }
  }
  const newTrack = plan.track.id

  return dispatcher.grouped(async () => {
    const takeBack = (ids) => dispatcher.apply([...ids.map(id => ({ op: 'removeNode', id })), { op: 'removeTrack', id: newTrack }])

    const created = dispatcher.apply([plan.track])
    if (!created.ok) return created

    const idMap = new Map()
    for (const node of plan.nodes) {
      const { from, pluginIri, ...rest } = node
      // addPlugin returns a failed load but throws for a dispatcher that cannot load at all.
      const result = await dispatcher.addPlugin(pluginIri, { ...rest, track: newTrack }).catch(error => ({ ok: false, kind: 'load', message: error.message }))
      if (!result.ok) {
        takeBack([...idMap.values()])
        return { ...result, message: `${node.label ?? pluginIri}: ${result.message}` }
      }
      idMap.set(from, result.nodeId)
      for (const [symbol, value] of Object.entries(node.settings)) {
        const set = dispatcher.setParameter(result.nodeId, symbol, value)
        if (!set.ok) {
          takeBack([...idMap.values()])
          return { ok: false, kind: set.kind ?? 'change', message: `${node.label ?? pluginIri}.${symbol}: ${set.message}` }
        }
      }
    }

    const rest = finishTrackCopy(dispatcher.project, trackId, newTrack, idMap)
    if (rest.length > 0) {
      const applied = dispatcher.apply(rest)
      if (!applied.ok) {
        takeBack([...idMap.values()])
        return applied
      }
    }
    return { ok: true, trackId: newTrack, nodeIds: Object.fromEntries(idMap), skipped: plan.skipped }
  }, { label: 'Duplicate a track' })
}
