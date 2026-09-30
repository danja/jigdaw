// src/model/EditorState.js
//
// Editor metadata: where a node sits, and how a track is laid out. Held beside
// the project and outside the state a revision covers, so that dragging,
// reordering or colouring never bumps the revision or invalidates anything
// compiled. It is written to its own document (`editor.ttl`), see
// docs/project-format.md, "Two graphs".

export const LANE_SIZES = Object.freeze(['small', 'medium', 'large'])
const COLOR = /^#[0-9a-f]{6}$/

export class EditorState {
  #positions = new Map()
  #tracks = new Map()
  #clips = new Map()
  #listeners = new Set()

  /** Told after any change, so a view can draw again: layout is not an edit, and no revision says it moved. */
  subscribe (fn) {
    this.#listeners.add(fn)
    return () => this.#listeners.delete(fn)
  }
  #changed () { for (const fn of [...this.#listeners]) fn(this) }

  position (id) { return this.#positions.get(id) ?? { x: 0, y: 0 } }
  setPosition (id, x, y) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error('a position needs finite x and y')
    this.#positions.set(id, { x, y })
    this.#changed()
  }

  /** Layout of one track. `order` is null until a person has placed it. */
  track (id) { return { order: null, color: null, laneSize: 'medium', ...this.#tracks.get(id) } }

  setTrack (id, patch) {
    const next = { ...this.#tracks.get(id) }
    if (patch.order !== undefined) {
      if (patch.order !== null && !Number.isInteger(patch.order)) throw new Error('order must be an integer or null')
      next.order = patch.order
    }
    if (patch.color !== undefined) {
      if (patch.color !== null && !COLOR.test(patch.color)) throw new Error('color must be #rrggbb in lower case, or null')
      next.color = patch.color
    }
    if (patch.laneSize !== undefined) {
      if (!LANE_SIZES.includes(patch.laneSize)) throw new Error(`laneSize must be one of ${LANE_SIZES.join(', ')}`)
      next.laneSize = patch.laneSize
    }
    this.#tracks.set(id, next)
    this.#changed()
  }

  /** How a clip is drawn: its colour, or null for the track's own. */
  clip (id) { return { color: null, ...this.#clips.get(id) } }
  setClip (id, patch) {
    const next = { ...this.#clips.get(id) }
    if (patch.color !== undefined) {
      if (patch.color !== null && !COLOR.test(patch.color)) throw new Error('color must be #rrggbb in lower case, or null')
      next.color = patch.color
    }
    this.#clips.set(id, next)
    this.#changed()
  }

  /**
   * Track ids in the order the arrangement shows them: placed tracks by their
   * order, then unplaced ones in the order given (creation order), so a track
   * added after a reorder appears at the end rather than somewhere surprising.
   */
  orderTracks (ids) {
    const placed = ids.filter(id => this.track(id).order !== null)
    const rest = ids.filter(id => this.track(id).order === null)
    placed.sort((a, b) => this.track(a).order - this.track(b).order)
    return [...placed, ...rest]
  }

  /** Replace everything with what `readEditor` returned. Bad values throw and change nothing. */
  load ({ positions, tracks, clips = new Map() }) {
    const next = new EditorState()
    for (const [id, { x, y }] of positions) next.setPosition(id, x, y)
    for (const [id, patch] of tracks) next.setTrack(id, patch)
    for (const [id, patch] of clips) next.setClip(id, patch)
    this.#positions = next.#positions
    this.#tracks = next.#tracks
    this.#clips = next.#clips
    this.#changed()
  }

  /**
   * Move one track `delta` places in the order `ids` shows now, giving every
   * track an explicit place so the arrangement no longer depends on creation
   * order. Refuses to move past either end; returns whether anything moved.
   */
  moveTrack (ids, id, delta) {
    const order = this.orderTracks(ids)
    const from = order.indexOf(id)
    if (from < 0) throw new Error(`no such track: ${id}`)
    const to = from + delta
    if (!Number.isInteger(delta) || to < 0 || to >= order.length || delta === 0) return false
    order.splice(from, 1)
    order.splice(to, 0, id)
    order.forEach((trackId, index) => {
      const next = { ...this.#tracks.get(trackId), order: index }
      this.#tracks.set(trackId, next)
    })
    this.#changed()
    return true
  }

  /** True when nothing here differs from a fresh session, so nothing needs saving. */
  get isDefault () {
    return this.#tracks.size === 0 && this.#clips.size === 0 &&
      [...this.#positions.values()].every(p => p.x === 0 && p.y === 0)
  }

  /** Like `isDefault`, but only for the nodes and tracks that still exist. */
  isDefaultFor (nodeIds, trackIds, clipIds = new Set()) {
    return [...this.#tracks.keys()].every(id => !trackIds.has(id)) &&
      [...this.#clips].every(([id, c]) => !clipIds.has(id) || c.color === null) &&
      [...this.#positions].every(([id, p]) => !nodeIds.has(id) || (p.x === 0 && p.y === 0))
  }

  /** Forget whatever names something that no longer exists. */
  prune (nodeIds, trackIds, clipIds = null) {
    let changed = false
    for (const id of [...this.#positions.keys()]) if (!nodeIds.has(id)) { this.#positions.delete(id); changed = true }
    for (const id of [...this.#tracks.keys()]) if (!trackIds.has(id)) { this.#tracks.delete(id); changed = true }
    if (clipIds !== null) for (const id of [...this.#clips.keys()]) if (!clipIds.has(id)) { this.#clips.delete(id); changed = true }
    if (changed) this.#changed()
  }

  get positions () { return new Map(this.#positions) }
  get trackIds () { return [...this.#tracks.keys()] }
}
