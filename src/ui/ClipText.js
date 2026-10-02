// src/ui/ClipText.js
//
// What a clip says about itself in words, to a screen reader and on hover. Pure text, so it is tested on its
// own and Timeline.js re-exports it for the callers that already import it from there.
import { colorName } from './TrackPanel.js'

/** Bar and beat, counting from one, as a musician reads a position. */
export function barBeat (beat, beatsPerBar) {
  const bar = Math.floor(beat / beatsPerBar) + 1
  const within = beat - (bar - 1) * beatsPerBar + 1
  return `bar ${bar} beat ${Number.isInteger(within) ? within : within.toFixed(2).replace(/0+$/, '')}`
}

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`

/** What a clip says about itself to a screen reader, and on hover. */
export function describeClip (clip, { beatsPerBar, playsIntoNothing = false, color = null }) {
  const what = clip.kind === 'midi' ? `MIDI clip, ${plural(clip.notes.length, 'note')}` : 'Audio clip'
  const where = `${barBeat(clip.startBeat, beatsPerBar)}, ${plural(clip.lengthBeats, 'beat')}`
  return `${what}${clip.muted ? ', muted' : ''}${clip.locked ? ', locked' : ''}${color ? `, coloured ${colorName(color)}` : ''}, ${where}${playsIntoNothing ? ', plays into nothing: this track has no MIDI input' : ''}`
}
