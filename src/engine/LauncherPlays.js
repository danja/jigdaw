// src/engine/LauncherPlays.js
//
// What the clip launcher asks the scheduler to play: each run of LauncherState turned into the pattern it repeats, the node it
// plays into and the beats it covers. Pure, so the scheduler is tested with plain data.
import { playedContent } from '../model/ClipLoop.js'

/**
 * `[{ nodeId, trackId, from, to, length, notes, controllers }]`: `notes` and `controllers` are the clip's content relative to its
 * start (looped as the clip loops), repeated every `length` beats from `from` until `to` (null: until stopped). A run whose clip
 * has gone, or whose track plays into nothing, is left out.
 */
export function launcherPlays (project, state) {
  const plays = []
  for (const run of state.runs) {
    const clip = project.clip(run.clipId)
    const track = project.track(run.trackId)
    if (!clip || !track?.midiInput || clip.kind !== 'midi' || clip.muted) continue
    const content = playedContent(clip)
    plays.push({
      nodeId: track.midiInput, trackId: run.trackId, from: run.from, to: run.to, length: clip.lengthBeats,
      notes: content.notes, controllers: content.controllers
    })
  }
  return plays
}
