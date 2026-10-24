// src/ops/ChangesetChecks.js
//
// Two small judgements the dispatcher makes about a changeset: whether it asks the engine for a wire that cannot exist, which is refused before the
// model is touched, and how a thrown error becomes the result a caller reads. Pure, so each is tested without a dispatcher.
import { findPort } from '../model/Endpoints.js'
import { RevisionConflict, ChangeError } from '../model/Project.js'

/**
 * The first end of a new connection that names a port its node has not got, or a track or the master given an audio input with no audio input,
 * as the message to refuse it with; null when nothing is wrong. `profileOf(nodeId)` gives a node's profile, or undefined while it has not loaded.
 *
 * A node whose plugin is not loaded yet is not refused: it cannot be checked, and is not wired until it is.
 */
export function unroutableChange (changes, profileOf) {
  for (const change of changes ?? []) {
    // Audio arrives at a track's or the master's audio input node, so the node must have an audio input.
    if ((change?.op === 'setTrack' || change?.op === 'setMaster') && change.audioInput) {
      const profile = profileOf(change.audioInput)
      if (profile && (profile.audioInputs ?? 0) < 1) {
        return `${change.audioInput} has no audio input, so audio cannot arrive at it`
      }
    }
    if (change?.op !== 'addConnection') continue
    for (const direction of ['from', 'to']) {
      const endpoint = change[direction]
      if (!endpoint?.node) continue
      const found = findPort(profileOf(endpoint.node), endpoint, direction, change.signalKind)
      if (!found.ok) return found.message
    }
  }
  return null
}

/** The result for an error thrown while applying a changeset: a conflict or a refused change. Anything else is a defect and is thrown on. */
export function failureResult (error, revision) {
  if (error instanceof RevisionConflict) {
    return { ok: false, kind: 'conflict', revision, expected: error.expected, message: error.message }
  }
  if (error instanceof ChangeError) {
    return { ok: false, kind: 'change', revision, index: error.index, message: error.message }
  }
  throw error
}
