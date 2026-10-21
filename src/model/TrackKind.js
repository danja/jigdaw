// src/model/TrackKind.js
//
// What kind of track this is, read from the ports of the nodes on it and from
// what feeds it. There is no type stored on a track: a flag would disagree with
// the plugins the day one was swapped, and the ports are already the truth.
import { isMidiSignal } from './Endpoints.js'

/**
 * `profileOf(nodeId)` gives a node's profile, or undefined while it is not loaded.
 * Returns 'bus', 'instrument', 'midi', 'audio', or null when the ports say nothing.
 *
 * A bus is a track other tracks send their output to, whatever it holds. Otherwise
 * the first node that takes MIDI decides: it is an instrument if it makes sound
 * and MIDI only if it does not. A track with audio ports and no MIDI is audio.
 */
export function trackKind (project, track, profileOf) {
  if (project.tracks.some(other => other.id !== track.id && other.output === track.id)) return 'bus'
  const profiles = project.nodes.filter(n => n.track === track.id).map(n => profileOf(n.id)).filter(Boolean)
  const takesMidi = profiles.filter(p => (p.accepts ?? []).some(isMidiSignal))
  if (takesMidi.length > 0) return takesMidi.some(p => (p.audioOutputs ?? 0) > 0) ? 'instrument' : 'midi'
  if (profiles.some(p => (p.audioOutputs ?? 0) > 0 || (p.audioInputs ?? 0) > 0)) return 'audio'
  return null
}

export const TRACK_KIND_LABELS = Object.freeze({ bus: 'Bus', instrument: 'Instrument', midi: 'MIDI', audio: 'Audio' })
