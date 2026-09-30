// src/model/ArrangementOps.js
//
// The operations and state behind docs/track-view-terms.md: the master, sends,
// bus outputs, markers, regions and envelopes, and the checks on signature
// points. Split from Project.js along the seam the document drew: these are
// facts about the sound and the arrangement that no node or clip owns.
//
// The model and the file carry all of it. The compiler and scheduler do not
// yet act on sends, bus outputs or envelopes; see TODO.md, phases T3 and T5.

export const DEFAULT_MASTER = Object.freeze({ gain: 1, pan: 0, muted: false })
export const TAPS = Object.freeze(['pre', 'post'])
export const CURVES = Object.freeze(['step', 'linear', 'smooth'])
export const TARGET_KINDS = Object.freeze(['masterGain', 'masterPan', 'tempo'])

const EPSILON = 1e-9

export function emptyArrangement () {
  return { master: { ...DEFAULT_MASTER }, sends: new Map(), markers: new Map(), regions: new Map(), envelopes: new Map() }
}

export function cloneArrangement (state) {
  return {
    master: { ...state.master },
    sends: new Map([...state.sends].map(([id, s]) => [id, { ...s }])),
    markers: new Map([...state.markers].map(([id, m]) => [id, { ...m }])),
    regions: new Map([...state.regions].map(([id, r]) => [id, { ...r }])),
    envelopes: new Map([...state.envelopes].map(([id, e]) => [id, {
      id, target: { ...e.target }, points: e.points.map(p => ({ ...p }))
    }]))
  }
}

const finiteAtLeast = (n, min, what) => {
  if (!(Number.isFinite(n) && n >= min)) throw new Error(`${what} must be a number at or above ${min}: ${n}`)
}

/**
 * Whether a route from `from` reaches `to` over bus outputs and sends. The
 * track graph is the one place a cycle could hide, because a connection cannot
 * cross tracks and these can.
 */
function reaches (state, from, to) {
  const seen = new Set()
  const stack = [from]
  while (stack.length > 0) {
    const id = stack.pop()
    if (id === to) return true
    if (seen.has(id)) continue
    seen.add(id)
    const track = state.tracks.get(id)
    if (track?.output) stack.push(track.output)
    for (const send of state.sends.values()) if (send.from === id) stack.push(send.to)
  }
  return false
}

function checkNoCycle (state, from, to, what) {
  if (from === to || reaches(state, to, from)) throw new Error(`${what} would make a track feed itself: ${from} to ${to}`)
}

/** `output` is a track id, or null for the master. Used by setTrack. */
export function checkTrackOutput (state, trackId, output) {
  if (output === null) return
  if (!state.tracks.has(output)) throw new Error(`no such track: ${output}`)
  checkNoCycle(state, trackId, output, 'an output')
}

function mint (state, counters, key, prefix, id, what) {
  const table = state[key]
  const minted = id ?? `${prefix}-${++counters[prefix]}`
  if (table.has(minted)) throw new Error(`${what} already exists: ${minted}`)
  const m = new RegExp(`^${prefix}-(\\d+)$`).exec(minted)
  if (m) counters[prefix] = Math.max(counters[prefix], Number(m[1]))
  return minted
}

function checkPoints (points, target) {
  if (!Array.isArray(points)) throw new Error('points must be an array')
  const seen = new Set()
  for (const p of points) {
    finiteAtLeast(p.atBeat, 0, 'an envelope point atBeat')
    if (seen.has(p.atBeat)) throw new Error(`two envelope points at beat ${p.atBeat}`)
    seen.add(p.atBeat)
    if (!Number.isFinite(p.value)) throw new Error(`an envelope point needs a finite value: ${p.value}`)
    if (!CURVES.includes(p.curve ?? 'linear')) throw new Error(`curve must be one of ${CURVES.join(', ')}`)
    // What the project itself can judge. A node parameter's range is in its
    // profile, which the dispatcher holds and this file does not.
    if (target.kind === 'masterGain') finiteAtLeast(p.value, 0, 'a master gain value')
    if (target.kind === 'masterPan' && (p.value < -1 || p.value > 1)) throw new Error(`a master pan value is between -1 and 1: ${p.value}`)
    if (target.kind === 'tempo' && !(p.value > 0)) throw new Error(`a tempo value is above zero: ${p.value}`)
  }
  return points.map(p => ({ atBeat: p.atBeat, value: p.value, curve: p.curve ?? 'linear' })).sort((a, b) => a.atBeat - b.atBeat)
}

function checkTarget (state, target) {
  if (!target || typeof target !== 'object') throw new Error('an envelope needs a target')
  if (target.kind !== undefined) {
    if (!TARGET_KINDS.includes(target.kind)) throw new Error(`target kind must be one of ${TARGET_KINDS.join(', ')}`)
    return { kind: target.kind }
  }
  if (!state.nodes.has(target.node)) throw new Error(`target names no such node: ${target.node}`)
  if (typeof target.symbol !== 'string' || target.symbol === '') throw new Error('a node target needs the parameter symbol')
  return { node: target.node, symbol: target.symbol }
}

export const ARRANGEMENT_OPERATIONS = {
  setMaster (state, change) {
    const next = { ...state.master }
    if (change.gain !== undefined) { finiteAtLeast(change.gain, 0, 'master gain'); next.gain = change.gain }
    if (change.pan !== undefined) {
      if (!Number.isFinite(change.pan) || change.pan < -1 || change.pan > 1) throw new Error(`pan must be between -1 and 1: ${change.pan}`)
      next.pan = change.pan
    }
    if (change.muted !== undefined) next.muted = Boolean(change.muted)
    state.master = next
    return 'master'
  },

  addSend (state, change, counters) {
    for (const key of ['from', 'to']) if (!state.tracks.has(change[key])) throw new Error(`no such track: ${change[key]}`)
    checkNoCycle(state, change.from, change.to, 'a send')
    for (const s of state.sends.values()) {
      if (s.from === change.from && s.to === change.to) throw new Error(`${change.from} already sends to ${change.to}`)
    }
    const level = change.level ?? 1
    finiteAtLeast(level, 0, 'a send level')
    const tap = change.tap ?? 'post'
    if (!TAPS.includes(tap)) throw new Error(`tap must be one of ${TAPS.join(', ')}`)
    const id = mint(state, counters, 'sends', 'send', change.id, 'send')
    state.sends.set(id, { id, from: change.from, to: change.to, level, tap })
    return id
  },

  setSend (state, change) {
    const send = state.sends.get(change.id)
    if (!send) throw new Error(`no such send: ${change.id}`)
    if (change.level !== undefined) { finiteAtLeast(change.level, 0, 'a send level'); send.level = change.level }
    if (change.tap !== undefined) {
      if (!TAPS.includes(change.tap)) throw new Error(`tap must be one of ${TAPS.join(', ')}`)
      send.tap = change.tap
    }
    return change.id
  },

  removeSend (state, change) {
    if (!state.sends.delete(change.id)) throw new Error(`no such send: ${change.id}`)
    return change.id
  },

  addMarker (state, change, counters) {
    finiteAtLeast(change.atBeat, 0, 'a marker atBeat')
    const id = mint(state, counters, 'markers', 'marker', change.id, 'marker')
    state.markers.set(id, { id, atBeat: change.atBeat, label: change.label ?? null })
    return id
  },

  setMarker (state, change) {
    const marker = state.markers.get(change.id)
    if (!marker) throw new Error(`no such marker: ${change.id}`)
    if (change.atBeat !== undefined) { finiteAtLeast(change.atBeat, 0, 'a marker atBeat'); marker.atBeat = change.atBeat }
    if (change.label !== undefined) marker.label = change.label
    return change.id
  },

  removeMarker (state, change) {
    if (!state.markers.delete(change.id)) throw new Error(`no such marker: ${change.id}`)
    return change.id
  },

  addRegion (state, change, counters) {
    finiteAtLeast(change.startBeat, 0, 'a region startBeat')
    if (!(Number.isFinite(change.lengthBeats) && change.lengthBeats > 0)) throw new Error('a region needs a lengthBeats above zero')
    const id = mint(state, counters, 'regions', 'region', change.id, 'region')
    state.regions.set(id, { id, startBeat: change.startBeat, lengthBeats: change.lengthBeats, label: change.label ?? null })
    return id
  },

  setRegion (state, change) {
    const region = state.regions.get(change.id)
    if (!region) throw new Error(`no such region: ${change.id}`)
    const startBeat = change.startBeat ?? region.startBeat
    const lengthBeats = change.lengthBeats ?? region.lengthBeats
    finiteAtLeast(startBeat, 0, 'a region startBeat')
    if (!(Number.isFinite(lengthBeats) && lengthBeats > 0)) throw new Error('a region needs a lengthBeats above zero')
    region.startBeat = startBeat
    region.lengthBeats = lengthBeats
    if (change.label !== undefined) region.label = change.label
    return change.id
  },

  removeRegion (state, change) {
    if (!state.regions.delete(change.id)) throw new Error(`no such region: ${change.id}`)
    return change.id
  },

  addEnvelope (state, change, counters) {
    const target = checkTarget(state, change.target)
    for (const e of state.envelopes.values()) {
      if (JSON.stringify(e.target) === JSON.stringify(target)) throw new Error(`${e.id} already automates that target`)
    }
    const points = checkPoints(change.points ?? [], target)
    const id = mint(state, counters, 'envelopes', 'envelope', change.id, 'envelope')
    state.envelopes.set(id, { id, target, points })
    return id
  },

  /** Replace the whole point list at once, so one drawn gesture is one edit and one undo. */
  setEnvelope (state, change) {
    const envelope = state.envelopes.get(change.id)
    if (!envelope) throw new Error(`no such envelope: ${change.id}`)
    envelope.points = checkPoints(change.points, envelope.target)
    return change.id
  },

  removeEnvelope (state, change) {
    if (!state.envelopes.delete(change.id)) throw new Error(`no such envelope: ${change.id}`)
    return change.id
  }
}

/** Sends touching a track, outputs pointing at it, are gone when it is. */
export function dropForTrack (state, trackId) {
  for (const [id, s] of [...state.sends]) if (s.from === trackId || s.to === trackId) state.sends.delete(id)
  for (const t of state.tracks.values()) if (t.output === trackId) t.output = null
}

/** Envelopes on a node's parameters are gone when it is. */
export function dropForNode (state, nodeId) {
  for (const [id, e] of [...state.envelopes]) if (e.target.node === nodeId) state.envelopes.delete(id)
}

/**
 * Signature points must come after beat zero, be one per beat, and each fall on
 * a bar line of the signature before it. A half bar of one signature and a half
 * of another has no reading a musician would accept.
 */
export function checkSignaturePoints (initialBeatsPerBar, points) {
  if (!Array.isArray(points)) throw new Error('signaturePoints must be an array')
  const sorted = [...points].sort((a, b) => a.atBeat - b.atBeat)
  let barStart = 0
  let bar = initialBeatsPerBar
  for (const p of sorted) {
    if (!(Number.isFinite(p.atBeat) && p.atBeat > 0)) throw new Error(`a signature point comes after beat zero: ${p.atBeat}`)
    if (!Number.isInteger(p.beatsPerBar) || p.beatsPerBar < 1) throw new Error(`a bar has at least one beat: ${p.beatsPerBar}`)
    if (!Number.isInteger(p.beatUnit) || p.beatUnit < 1) throw new Error(`a beat unit is a note value: ${p.beatUnit}`)
    const bars = (p.atBeat - barStart) / bar
    if (Math.abs(bars - Math.round(bars)) > EPSILON) {
      throw new Error(`a signature change must fall on a bar line: beat ${p.atBeat} is not one`)
    }
    if (p.atBeat === barStart && barStart !== 0) throw new Error(`two signature points at beat ${p.atBeat}`)
    barStart = p.atBeat
    bar = p.beatsPerBar
  }
  return sorted.map(p => ({ atBeat: p.atBeat, beatsPerBar: p.beatsPerBar, beatUnit: p.beatUnit }))
}

/** The changes that rebuild this part of a snapshot, after tracks and nodes exist. */
export function arrangementChanges (snapshot) {
  return [
    { op: 'setMaster', ...snapshot.master },
    ...snapshot.tracks.filter(t => t.output).map(t => ({ op: 'setTrack', id: t.id, output: t.output })),
    ...snapshot.sends.map(s => ({ op: 'addSend', ...s })),
    ...snapshot.markers.map(m => ({ op: 'addMarker', ...m })),
    ...snapshot.regions.map(r => ({ op: 'addRegion', ...r })),
    ...snapshot.envelopes.map(e => ({ op: 'addEnvelope', id: e.id, target: e.target, points: e.points }))
  ]
}

/**
 * The changes that turn `current` into `target`, for undo and redo. Removals
 * first and additions after, so no step is refused for a cycle or a duplicate
 * that the removals were about to clear. Data, so a changed thing is replaced
 * whole under its own id.
 */
export function arrangementReconcile (current, target) {
  const changes = []
  const table = [
    ['sends', 'removeSend', 'addSend'],
    ['markers', 'removeMarker', 'addMarker'],
    ['regions', 'removeRegion', 'addRegion'],
    ['envelopes', 'removeEnvelope', 'addEnvelope']
  ]
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
  for (const [key, remove] of table) {
    const wanted = new Map(target[key].map(x => [x.id, x]))
    for (const item of current[key]) if (!same(wanted.get(item.id), item)) changes.push({ op: remove, id: item.id })
  }
  const outputs = t => (t.output ?? null)
  const currentTracks = new Map(current.tracks.map(t => [t.id, t]))
  for (const t of target.tracks) {
    if (outputs(currentTracks.get(t.id) ?? {}) !== outputs(t)) changes.push({ op: 'setTrack', id: t.id, output: outputs(t) })
  }
  if (!same(current.master, target.master)) changes.push({ op: 'setMaster', ...target.master })
  for (const [key, , add] of table) {
    const live = new Map(current[key].map(x => [x.id, x]))
    for (const item of target[key]) if (!same(live.get(item.id), item)) changes.push({ op: add, ...item })
  }
  return changes
}
