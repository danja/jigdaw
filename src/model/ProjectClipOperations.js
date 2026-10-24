// src/model/ProjectClipOperations.js
//
// The operations on clips: add, set, replace the notes or the controller events, and remove. Part of the table in ProjectOperations.js, which
// spreads this in; split out because clips are the largest group. A lock protects a clip from the edits it names, a scene is a clip launcher row
// with one clip to a track (docs/clip-launcher.md), and a launcher clip has no place on the timeline.
import { checkLoopBeats } from './ClipLoop.js'
import { noteExplicitId, checkScene, checkNotes, checkControllers, checkFade, checkMuted, checkFlag, refuseIfLocked, checkPlacement } from './ProjectRules.js'

export const CLIP_OPERATIONS = {
  addClip (state, change, counters) {
    if (!state.tracks.has(change.track)) throw new Error(`no such track: ${change.track}`)
    if (change.kind !== 'midi' && change.kind !== 'audio') throw new Error('kind must be midi or audio')
    checkPlacement(change.startBeat, change.lengthBeats)
    const id = change.id ?? `clip-${++counters.clip}`
    if (state.clips.has(id)) throw new Error(`clip already exists: ${id}`)
    noteExplicitId(counters, 'clip', 'clip', id)
    const clip = { id, track: change.track, kind: change.kind, startBeat: change.startBeat, lengthBeats: change.lengthBeats, muted: checkMuted(change.muted ?? false), locked: checkFlag('locked', change.locked ?? false) }
    if (change.scene !== undefined && change.scene !== null) {
      if (change.kind !== 'midi') throw new Error('only a MIDI clip can be in the clip launcher')
      if (change.startBeat !== 0) throw new Error('a launcher clip has no place on the timeline, so its start is 0')
      clip.scene = checkScene(state, change.track, change.scene)
    }
    if (change.kind === 'midi') {
      clip.notes = checkNotes(change.notes ?? [])
      clip.controllers = checkControllers(change.controllers ?? [])
      if (change.loopBeats !== undefined && change.loopBeats !== null) clip.loopBeats = checkLoopBeats(change.loopBeats)
    } else {
      if (change.loopBeats !== undefined && change.loopBeats !== null) throw new Error('only a MIDI clip can loop')
      // Absolute: a reader resolves a relative jig:source against the session
      // document before it gets here, so anything relative is a mistake.
      if (typeof change.source !== 'string' || !URL.canParse(change.source)) {
        throw new Error('an audio clip needs a source, the absolute IRI of the file it plays')
      }
      const offset = change.offsetSeconds ?? 0
      if (!(Number.isFinite(offset) && offset >= 0)) throw new Error('offsetSeconds must be at or after zero')
      clip.source = change.source
      clip.offsetSeconds = offset
      clip.fadeInBeats = checkFade('fadeInBeats', change.fadeInBeats ?? 0)
      clip.fadeOutBeats = checkFade('fadeOutBeats', change.fadeOutBeats ?? 0)
      clip.notes = []
      clip.controllers = []
    }
    state.clips.set(id, clip)
    return id
  },

  /** Move a clip in time or to another track, resize it, or change its offset. */
  setClip (state, change) {
    const clip = state.clips.get(change.id)
    if (!clip) throw new Error(`no such clip: ${change.id}`)
    if (['startBeat', 'lengthBeats', 'track', 'offsetSeconds'].some(k => change[k] !== undefined)) refuseIfLocked(clip, change, 'moved or resized')
    const startBeat = change.startBeat ?? clip.startBeat
    const lengthBeats = change.lengthBeats ?? clip.lengthBeats
    checkPlacement(startBeat, lengthBeats)
    if (change.track !== undefined && !state.tracks.has(change.track)) throw new Error(`no such track: ${change.track}`)
    if (change.offsetSeconds !== undefined) {
      if (clip.kind !== 'audio') throw new Error('only an audio clip has an offset')
      if (!(Number.isFinite(change.offsetSeconds) && change.offsetSeconds >= 0)) throw new Error('offsetSeconds must be at or after zero')
      clip.offsetSeconds = change.offsetSeconds
    }
    if (change.muted !== undefined) clip.muted = checkMuted(change.muted)
    for (const key of ['fadeInBeats', 'fadeOutBeats']) {
      if (change[key] === undefined) continue
      if (clip.kind !== 'audio') throw new Error('only an audio clip has fades')
      clip[key] = checkFade(key, change[key])
    }
    if (change.loopBeats !== undefined) {
      if (clip.kind !== 'midi') throw new Error('only a MIDI clip can loop')
      refuseIfLocked(clip, change, 'looped')
      // Kept only while set, so a clip that never looped is the same object it always was.
      if (change.loopBeats === null) delete clip.loopBeats
      else clip.loopBeats = checkLoopBeats(change.loopBeats)
    }
    if (change.locked !== undefined) clip.locked = checkFlag('locked', change.locked)
    const track = change.track ?? clip.track
    // Into the launcher, out of it, or to another scene or track in it. A launcher clip has no start, so one moved in is put at 0.
    let scene = clip.scene
    if (change.scene !== undefined) {
      refuseIfLocked(clip, change, 'moved')
      if (change.scene === null) { if (scene === undefined) throw new Error(`${change.id} is not in the clip launcher`); scene = undefined }
      else if (clip.kind !== 'midi') throw new Error('only a MIDI clip can be in the clip launcher')
      else scene = change.scene
    }
    if (scene !== undefined) {
      if (change.startBeat !== undefined && change.startBeat !== 0) throw new Error('a launcher clip has no place on the timeline, so its start is 0')
      checkScene(state, track, scene, clip.id)
      clip.scene = scene
      clip.startBeat = 0
    } else {
      delete clip.scene
      clip.startBeat = startBeat
    }
    clip.lengthBeats = lengthBeats
    if (change.track !== undefined) clip.track = change.track
    return change.id
  },

  /**
   * Replace a MIDI clip's notes. The whole list at once, so one gesture in a
   * piano roll, or one agent's phrase, is one edit and one undo.
   */
  setClipNotes (state, change) {
    const clip = state.clips.get(change.id)
    if (!clip) throw new Error(`no such clip: ${change.id}`)
    if (clip.kind !== 'midi') throw new Error(`clip ${change.id} is audio and holds no notes`)
    refuseIfLocked(clip, change, 'edited')
    clip.notes = checkNotes(change.notes)
    return change.id
  },

  /** Replace a MIDI clip's controller and pitch bend events, all at once, like its notes. */
  setClipControllers (state, change) {
    const clip = state.clips.get(change.id)
    if (!clip) throw new Error(`no such clip: ${change.id}`)
    if (clip.kind !== 'midi') throw new Error(`clip ${change.id} is audio and holds no controller events`)
    refuseIfLocked(clip, change, 'edited')
    clip.controllers = checkControllers(change.controllers)
    return change.id
  },

  removeClip (state, change) {
    if (!state.clips.has(change.id)) throw new Error(`no such clip: ${change.id}`)
    refuseIfLocked(state.clips.get(change.id), change, 'removed')
    state.clips.delete(change.id)
    return change.id
  }
}
