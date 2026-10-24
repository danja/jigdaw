// src/model/ProjectRules.js
//
// What a change to the project is checked against: the defaults a track and the transport start from, how the state is copied for a trial, and
// the small validators every operation shares (endpoints, scenes, notes, controllers, fades, placement, which clips a lock protects). Pure
// functions over the plain state Project holds, so each is read and tested without a Project. The operations that use them are in
// ProjectOperations.js and the class that applies a changeset is Project.js, which is the front door.
import {
  MASTER_TRACK, cloneArrangement
} from './ArrangementOps.js'

export const DEFAULT_CHANNEL = Object.freeze({ gain: 1, pan: 0, muted: false, soloed: false })

export const DEFAULT_TRANSPORT = Object.freeze({
  playing: false,
  beatsPerBar: 4,
  beatUnit: 4,
  loopStart: 0,
  loopEnd: 0,
  loopEnabled: false,
  // How long a clip launcher launch or stop waits (src/model/LauncherState.js): none, beat, bar, 2bars or 4bars.
  launchQuantise: 'bar',
  tempoPoints: [{ atBeat: 0, bpm: 120 }],
  // Time signature changes after beat zero. The fields above hold before the first.
  signaturePoints: []
})

/** An endpoint names its port exactly one way. project-format.md, sh:xone. */
export function checkEndpoint (state, endpoint, what) {
  if (!endpoint || typeof endpoint !== 'object') throw new Error(`${what} is missing`)
  if (!state.nodes.has(endpoint.node)) throw new Error(`${what} names no such node: ${endpoint.node}`)

  const hasIndex = endpoint.portIndex !== undefined && endpoint.portIndex !== null
  const hasSymbol = endpoint.portSymbol !== undefined && endpoint.portSymbol !== null
  if (hasIndex === hasSymbol) {
    throw new Error(`${what} must give exactly one of portIndex, for an audio or MIDI port, or portSymbol, for a parameter`)
  }
  if (hasIndex && (!Number.isInteger(endpoint.portIndex) || endpoint.portIndex < 0)) {
    throw new Error(`${what} has a portIndex that is not a non-negative integer`)
  }
}

/**
 * Keep the id counter ahead of ids it did not mint.
 *
 * A project loaded from a file, or replayed into a copy, arrives carrying ids
 * of the same shape the counter produces. Without this, the next minted id
 * collides with one already there, and the failure appears on an unrelated
 * later edit rather than at the load.
 */
export function noteExplicitId (counters, prefix, counterKey, id) {
  const minted = new RegExp(`^${prefix}-(\\d+)$`).exec(id)
  if (minted) counters[counterKey] = Math.max(counters[counterKey], Number(minted[1]))
}

/**
 * Whether a plugin IRI can be loaded.
 *
 * https everywhere, and http on loopback.
 *
 * The loopback exception is not a relaxation of the rule. A browser treats
 * http://localhost as a secure context precisely because it cannot be
 * intercepted, and every other secure-context feature is available there for
 * the same reason. Without it the only way to develop a plugin is to deploy it,
 * which is the opposite of what a local host is for.
 */
export function isLoadableIRI (value) {
  let url
  try { url = new URL(String(value)) } catch { return false }
  if (url.protocol === 'https:') return true
  if (url.protocol !== 'http:') return false
  return url.hostname === 'localhost' ||
    url.hostname === '127.0.0.1' ||
    url.hostname === '[::1]' ||
    url.hostname === '::1' ||
    url.hostname.endsWith('.localhost')
}

// What makes two connections the same connection.
//
// The signal kind is part of the identity, not decoration. An audio edge and a
// host-routed MIDI edge between the same two port coordinates are different
// edges handled by entirely different machinery, one by Web Audio and one by the
// event router, and a plugin that both takes MIDI and takes audio on port 0 is
// ordinary. Leaving the kind out made the second of the two a duplicate.
export const connectionKey = c =>
  `${c.signalKind}|${c.from.node}:${c.from.portIndex ?? c.from.portSymbol}` +
  `->${c.to.node}:${c.to.portIndex ?? c.to.portSymbol}`

/**
 * A scene is a row of the clip launcher: a whole number from zero. A clip with one is a launcher clip, kept off the timeline, and a
 * track has at most one in each scene (docs/clip-launcher.md).
 */
export function checkScene (state, trackId, scene, exceptId = null) {
  if (!Number.isInteger(scene) || scene < 0) throw new Error(`a scene is a whole number from zero: ${scene}`)
  for (const other of state.clips.values()) {
    if (other.id !== exceptId && other.track === trackId && other.scene === scene) {
      throw new Error(`scene ${scene} on ${trackId} already holds ${other.id}`)
    }
  }
  return scene
}

/** A clip with its own copy of every list it holds, so an edit to one never reaches a snapshot of it. */
export const cloneClip = c => ({ ...c, notes: c.notes.map(n => ({ ...n })), controllers: (c.controllers ?? []).map(e => ({ ...e })) })

export const cloneState = state => ({
  clips: new Map([...state.clips].map(([id, c]) => [id, cloneClip(c)])),
  tracks: new Map([...state.tracks].map(([id, t]) => [id, { ...t, channel: { ...t.channel } }])),
  nodes: new Map([...state.nodes].map(([id, n]) => [id, { ...n, settings: new Map(n.settings) }])),
  connections: new Map([...state.connections].map(([id, c]) => [id, { ...c, from: { ...c.from }, to: { ...c.to } }])),
  transport: {
    ...state.transport,
    tempoPoints: state.transport.tempoPoints.map(p => ({ ...p })),
    signaturePoints: (state.transport.signaturePoints ?? []).map(p => ({ ...p }))
  },
  ...cloneArrangement(state)
})

/** A channel strip with `change` applied, refusing values no mixer means. */
export function nextChannel (channel, change) {
  const next = { ...channel }
  if (change.gain !== undefined) {
    if (!Number.isFinite(change.gain) || change.gain < 0) {
      // A negative gain is an inverted signal, which is a plugin's job.
      throw new Error(`gain must be a number at or above zero: ${change.gain}`)
    }
    next.gain = change.gain
  }
  if (change.pan !== undefined) {
    if (!Number.isFinite(change.pan) || change.pan < -1 || change.pan > 1) {
      throw new Error(`pan must be between -1 and 1: ${change.pan}`)
    }
    next.pan = change.pan
  }
  if (change.muted !== undefined) next.muted = Boolean(change.muted)
  if (change.soloed !== undefined) next.soloed = Boolean(change.soloed)
  return next
}

/**
 * Check a track input names a node on that track, or is null to clear it.
 * project-format.md: the node a track's clips play into MUST be on it, or the
 * clips would sound on some other track's fader.
 */
export function checkTrackInput (state, trackId, nodeId, what) {
  if (nodeId === null) return
  const node = state.nodes.get(nodeId)
  if (!node) throw new Error(`${what} names no such node: ${nodeId}`)
  if (node.track !== trackId) throw new Error(`${what} ${nodeId} is not on track ${trackId}`)
}

/**
 * Check a list of notes, project-format.md "Clips": a start at or after the
 * clip's own start, a length above zero, a MIDI pitch and a velocity MIDI
 * does not read as a note off. Returns copies, sorted by start and pitch, so
 * two lists of the same notes compare equal whatever order they came in.
 */
export function checkNotes (notes) {
  if (!Array.isArray(notes)) throw new Error('notes must be an array')
  return notes.map((note, i) => {
    const { startBeat, lengthBeats, pitch, velocity, chance } = note ?? {}
    if (!(Number.isFinite(startBeat) && startBeat >= 0)) throw new Error(`note ${i} needs a startBeat at or after zero`)
    if (!(Number.isFinite(lengthBeats) && lengthBeats > 0)) throw new Error(`note ${i} needs a lengthBeats above zero`)
    if (!(Number.isInteger(pitch) && pitch >= 0 && pitch <= 127)) throw new Error(`note ${i} needs a pitch from 0 to 127`)
    if (!(Number.isInteger(velocity) && velocity >= 1 && velocity <= 127)) {
      throw new Error(`note ${i} needs a velocity from 1 to 127; MIDI reads 0 as a note off`)
    }
    // A chance of 1 is no chance at all: kept off the note, so a note that always plays is the same note it always was.
    if (chance !== undefined && !(Number.isFinite(chance) && chance > 0 && chance <= 1)) throw new Error(`note ${i} needs a chance above 0 and at most 1`)
    return chance === undefined || chance === 1 ? { startBeat, lengthBeats, pitch, velocity } : { startBeat, lengthBeats, pitch, velocity, chance }
  }).sort((a, b) => a.startBeat - b.startBeat || a.pitch - b.pitch)
}

/** What a controller event may carry, by controller: a CC is 0 to 127 and pitch bend is 14 bits around its centre, zero. */
export const PITCH_BEND = 'pitchBend'
export const BEND_RANGE = Object.freeze({ min: -8192, max: 8191 })

/**
 * Check a list of controller events: a start at or after zero (relative to the clip, like a note), a controller that is
 * a CC number 0 to 127 or `pitchBend`, and a whole value in that controller's range. Sorted by start, then controller, so
 * two lists of the same events compare equal whatever order they came in. Two events for one controller at one beat are
 * refused: the later one would only hide the earlier.
 */
export function checkControllers (events) {
  if (!Array.isArray(events)) throw new Error('controllers must be an array')
  const seen = new Set()
  const checked = events.map((event, i) => {
    const { atBeat, controller, value } = event ?? {}
    if (!(Number.isFinite(atBeat) && atBeat >= 0)) throw new Error(`controller event ${i} needs an atBeat at or after zero`)
    const bend = controller === PITCH_BEND
    if (!bend && !(Number.isInteger(controller) && controller >= 0 && controller <= 127)) throw new Error(`controller event ${i} needs a controller from 0 to 127, or pitchBend`)
    const [low, high] = bend ? [BEND_RANGE.min, BEND_RANGE.max] : [0, 127]
    if (!(Number.isInteger(value) && value >= low && value <= high)) throw new Error(`controller event ${i} needs a whole value from ${low} to ${high}`)
    const key = `${controller}@${atBeat}`
    if (seen.has(key)) throw new Error(`controller event ${i} repeats ${bend ? 'pitch bend' : `controller ${controller}`} at beat ${atBeat}`)
    seen.add(key)
    return { atBeat, controller, value }
  })
  const order = e => (e.controller === PITCH_BEND ? 128 : e.controller)
  return checked.sort((a, b) => a.atBeat - b.atBeat || order(a) - order(b))
}

/** A fade lasts no time or some. */
export function checkFade (name, value) {
  if (!(Number.isFinite(value) && value >= 0)) throw new Error(`${name} must be zero or more beats`)
  return value
}

/** A clip is muted or it is not. */
export function checkMuted (value) { return checkFlag('muted', value) }

export function checkFlag (name, value) {
  if (typeof value !== 'boolean') throw new Error(`${name} must be true or false`)
  return value
}

/**
 * A locked clip refuses to be changed, moved, resized or removed, so a gesture that
 * lands on it by mistake does nothing and says why. `force` is for undo, which must
 * put things back whatever their state, and is never set by a person's edit.
 */
export function refuseIfLocked (clip, change, what) {
  if (clip.locked && change.force !== true) throw new Error(`clip ${clip.id} is locked, so it cannot be ${what}; unlock it first`)
}

/** Check a clip's placement. */
export function checkPlacement (startBeat, lengthBeats) {
  if (!(Number.isFinite(startBeat) && startBeat >= 0)) throw new Error('a clip needs a startBeat at or after zero')
  if (!(Number.isFinite(lengthBeats) && lengthBeats > 0)) throw new Error('a clip needs a lengthBeats above zero')
}

/** Forget a node as any track's input. Called wherever a node leaves a track. */
export function releaseInputs (state, nodeId) {
  for (const track of state.tracks.values()) {
    if (track.midiInput === nodeId) track.midiInput = null
    if (track.audioInput === nodeId) track.audioInput = null
  }
  if (state.master.audioInput === nodeId) state.master = { ...state.master, audioInput: null }
}

/** A node is on a track, or on the master: the two places its sound can go. */
export function checkPlace (state, track) {
  if (track !== MASTER_TRACK && !state.tracks.has(track)) throw new Error(`no such track: ${track}`)
}
